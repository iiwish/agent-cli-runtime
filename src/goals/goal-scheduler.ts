import { GoalStore } from "./goal-store.js";
import type { CreateGoalRequest, GoalHandle, ScheduledTask, TaskAttemptEvidence, TaskRetryPolicy, ValidationCommandResult } from "./goal-types.js";
import { createPlannerPrompt, createTaskPrompt } from "./planner-prompts.js";
import { parsePlannerOutput, TaskGraphError, validateTaskGraph } from "./task-graph.js";
import { runValidationCommands } from "./validation-runner.js";
import type { RunScheduler } from "../runs/run-scheduler.js";
import type { RunResult } from "../runs/run-result.js";
import type { RunRecord } from "../runs/run-types.js";
import { diagnostic, type RuntimeDiagnostic, type RuntimeErrorCode } from "../core/diagnostics.js";

export class GoalScheduler {
  private readonly currentRuns = new Map<string, Map<string, string>>();
  private readonly cancelRequested = new Set<string>();

  constructor(
    private readonly runScheduler: RunScheduler,
    private readonly store = new GoalStore(),
    private readonly options: { maxConcurrentTasks?: number } = {},
  ) {}

  async createGoal(request: CreateGoalRequest): Promise<GoalHandle> {
    const goal = this.store.create(request);
    const events = this.store.events(goal.id);
    const handle: GoalHandle = {
      goalId: goal.id,
      events,
      cancel: async () => this.cancelGoal(goal.id),
    };
    void this.execute(goal.id, request).catch((error) => {
      if (this.store.isTerminal(goal.id)) return;
      if (this.cancelRequested.has(goal.id)) {
        this.cancelPendingFromStore(goal.id);
        this.finish(goal.id, "cancelled");
        return;
      }
      const code = error instanceof TaskGraphError ? error.code : "AGENT_EXECUTION_FAILED";
      this.store.emit(goal.id, {
        type: "scheduler_error",
        code,
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
      this.finish(goal.id, "failed");
    });
    return handle;
  }

  async cancelGoal(goalId: string): Promise<void> {
    this.cancelRequested.add(goalId);
    this.cancelPendingFromStore(goalId);
    await this.cancelCurrentRuns(goalId);
  }

  async shutdown(reason = "Runtime shutdown", graceMs = 2_000): Promise<void> {
    const goalIds = this.store.list({ status: "active" }).map((goal) => goal.id);
    await Promise.all(goalIds.map((goalId) => this.cancelGoal(goalId)));
    await Promise.race([
      waitFor(() => goalIds.every((goalId) => this.store.isTerminal(goalId))),
      delay(graceMs),
    ]);
    for (const goalId of goalIds) {
      if (this.store.isTerminal(goalId)) continue;
      this.store.emit(goalId, {
        type: "scheduler_error",
        code: "AGENT_CANCELLED",
        message: reason,
        retryable: false,
      });
      this.cancelPendingFromStore(goalId);
      this.finish(goalId, "cancelled");
    }
  }

  private async execute(goalId: string, request: CreateGoalRequest): Promise<void> {
    this.store.emit(goalId, { type: "goal_started", goalId, objective: request.objective });
    if (this.store.isTerminal(goalId)) return;
    const plannerText = await this.runAndCollectText(goalId, undefined, {
      agentId: request.plannerAgentId ?? request.defaultAgentId,
      cwd: request.cwd,
      prompt: createPlannerPrompt(request),
      permissionPolicy: request.permissionPolicy,
      model: request.model,
      reasoning: request.reasoning,
      contextBlocks: request.contextBlocks,
      env: request.env,
      timeoutMs: request.timeoutMs,
    });
    if (this.cancelRequested.has(goalId)) return this.finish(goalId, "cancelled");
    const tasks = validateTaskGraph(parsePlannerOutput(plannerText), request);
    this.store.setTasks(goalId, tasks);
    for (const task of tasks) this.store.emit(goalId, { type: "task_created", goalId, task });
    if (this.store.isTerminal(goalId)) return;
    this.store.setStatus(goalId, "running");
    if (this.store.isTerminal(goalId)) return;

    const result = await this.runReadyQueue(goalId, request, tasks);
    this.finish(goalId, result);
  }

  private async runReadyQueue(goalId: string, request: CreateGoalRequest, tasks: ScheduledTask[]): Promise<RunResult> {
    const maxConcurrentTasks = normalizeMaxConcurrentTasks(request.maxConcurrentTasks ?? this.options.maxConcurrentTasks);
    const running = new Map<string, Promise<{ task: ScheduledTask; result: RunResult }>>();
    let terminalResult: RunResult = "success";
    let stopScheduling = false;

    const launchReady = (): void => {
      while (!stopScheduling && !this.cancelRequested.has(goalId) && running.size < maxConcurrentTasks) {
        const task = tasks.find((candidate) => candidate.status === "pending" && dependenciesSucceeded(candidate, tasks));
        if (!task) return;
        task.status = "running";
        this.store.updateTask(goalId, task);
        const promise = this.runTask(goalId, request, task)
          .then((result) => ({ task, result }));
        running.set(task.id, promise);
      }
    };

    while (true) {
      if (this.cancelRequested.has(goalId)) {
        terminalResult = "cancelled";
        stopScheduling = true;
        this.cancelPending(goalId, tasks);
        await this.cancelCurrentRuns(goalId);
      }

      launchReady();

      if (running.size === 0) {
        this.blockUnavailableDependents(goalId, tasks);
        if (tasks.every((task) => task.status !== "pending" && task.status !== "running")) break;
        const hasReady = tasks.some((task) => task.status === "pending" && dependenciesSucceeded(task, tasks));
        if (!hasReady) {
          for (const task of tasks) {
            if (task.status === "pending") {
              task.status = "blocked";
              this.store.updateTask(goalId, task);
            }
          }
          terminalResult = terminalResult === "success" ? "failed" : terminalResult;
          break;
        }
      }

      if (running.size === 0) continue;
      const settled = await Promise.race(running.values());
      running.delete(settled.task.id);
      if (settled.result === "failed") terminalResult = "failed";
      if (settled.result === "cancelled" && terminalResult !== "failed") terminalResult = "cancelled";

      if (settled.result !== "success" && !request.continueOnFailure) {
        stopScheduling = true;
        if (settled.result === "failed") {
          this.blockDependents(goalId, tasks, settled.task.id);
          this.cancelPendingExceptBlocked(goalId, tasks);
          await this.cancelCurrentRuns(goalId);
        } else {
          this.cancelPending(goalId, tasks);
          await this.cancelCurrentRuns(goalId);
        }
      } else if (settled.result !== "success") {
        this.blockDependents(goalId, tasks, settled.task.id);
      }
    }

    if (terminalResult === "success" && tasks.some((task) => task.status === "failed" || task.status === "blocked")) return "failed";
    if (terminalResult === "success" && tasks.some((task) => task.status === "canceled")) return "cancelled";
    return terminalResult;
  }

  private async runTask(goalId: string, request: CreateGoalRequest, task: ScheduledTask): Promise<RunResult> {
    const retryPolicy = normalizeRetryPolicy(task.retryPolicy ?? request.retryPolicy);
    const attempts = task.evidence?.attempts ? [...task.evidence.attempts] : [];
    let finalResult: RunResult = "failed";
    let validationResults: ValidationCommandResult[] = [];
    let lastErrorCode: string | undefined;

    for (let attemptNumber = 1; attemptNumber <= retryPolicy.maxAttempts; attemptNumber += 1) {
      if (this.cancelRequested.has(goalId)) {
        finalResult = "cancelled";
        break;
      }
      const attempt = await this.runTaskAttempt(goalId, request, task, attemptNumber, attempts);
      finalResult = attempt.result;
      lastErrorCode = attempt.errorCode;
      if (attempt.result === "success" && task.validationCommands?.length) {
        validationResults = await runValidationCommands({
          commands: task.validationCommands,
          cwd: task.cwd,
          env: request.env,
          timeoutMs: request.validationTimeoutMs,
        });
        const failedValidation = validationResults.find((validation) => !validation.passed);
        if (failedValidation) {
          finalResult = "failed";
          lastErrorCode = failedValidation.classification === "timeout" ? "AGENT_TIMEOUT" : "AGENT_EXECUTION_FAILED";
          attempt.evidence.result = "failed";
          attempt.evidence.diagnostics = [
            ...attempt.evidence.diagnostics,
            diagnostic(lastErrorCode, `Task ${task.id} validation ${failedValidation.classification}.`, {
              retryable: isRetryable(lastErrorCode, retryPolicy),
              exitCode: failedValidation.exitCode,
              signal: failedValidation.signal,
            }),
          ];
          this.updateAttemptEvidence(goalId, task, attempts, attempt.evidence, finalResult, validationResults);
        }
      }

      const retryable = !this.cancelRequested.has(goalId)
        && finalResult !== "success"
        && attemptNumber < retryPolicy.maxAttempts
        && isRetryable(lastErrorCode, retryPolicy);
      this.store.emit(goalId, {
        type: "task_attempt_finished",
        goalId,
        taskId: task.id,
        attemptId: attempt.evidence.attemptId,
        attemptNumber,
        runId: attempt.evidence.runId,
        result: finalResult,
        retryable,
      });
      if (!retryable) break;
      if (retryPolicy.backoffMs > 0) await delay(retryPolicy.backoffMs);
    }

    if (this.cancelRequested.has(goalId)) finalResult = "cancelled";
    task.status = finalResult === "success" ? "succeeded" : finalResult === "cancelled" ? "canceled" : "failed";
    task.evidence = {
      runId: task.evidence?.runId,
      result: finalResult,
      attempts,
      validationCommands: task.validationCommands ?? [],
      validationResults,
      summary: evidenceSummary(task.id, finalResult, attempts, validationResults),
    };
    this.store.updateTask(goalId, task);
    if (!this.store.isTerminal(goalId)) this.store.emit(goalId, { type: "task_finished", goalId, taskId: task.id, result: finalResult });
    return finalResult;
  }

  private async runTaskAttempt(
    goalId: string,
    request: CreateGoalRequest,
    task: ScheduledTask,
    attemptNumber: number,
    attempts: TaskAttemptEvidence[],
  ): Promise<{ result: RunResult; errorCode?: string; evidence: TaskAttemptEvidence }> {
    let result: RunResult = "failed";
    let runRecord: RunRecord | null = null;
    const prompt = createTaskPrompt(request.objective, task);
    const handle = await this.runScheduler.startRun({
      agentId: task.agentId ?? request.defaultAgentId,
      cwd: request.cwd,
      prompt,
      permissionPolicy: task.permissionPolicy,
      model: request.model,
      reasoning: request.reasoning,
      env: request.env,
      timeoutMs: request.taskTimeoutMs ?? request.timeoutMs,
    });
    const attemptEvidence: TaskAttemptEvidence = {
      attemptId: `${task.id}:attempt:${attemptNumber}`,
      runId: handle.runId,
      startedAt: Date.now(),
      diagnostics: [],
    };
    attempts.push(attemptEvidence);
    task.evidence = {
      runId: handle.runId,
      attempts,
      validationCommands: task.validationCommands ?? [],
      summary: "",
    };
    this.store.updateTask(goalId, task);
    this.setCurrentRun(goalId, task.id, handle.runId);
    this.store.emit(goalId, { type: "task_attempt_started", goalId, taskId: task.id, attemptId: attemptEvidence.attemptId, attemptNumber, runId: handle.runId });
    this.store.emit(goalId, { type: "task_started", goalId, taskId: task.id, runId: handle.runId });
    if (this.store.isTerminal(goalId)) {
      await handle.cancel();
      return { result: "failed", evidence: attemptEvidence };
    }
    try {
      for await (const event of handle.events) {
        this.store.emit(goalId, { type: "run_event", goalId, taskId: task.id, runId: handle.runId, event });
        if (this.store.isTerminal(goalId)) {
          await handle.cancel();
          break;
        }
        if (event.type === "run_finished") result = event.result;
      }
    } finally {
      this.clearCurrentRun(goalId, task.id);
    }
    runRecord = await this.runScheduler.getRun(handle.runId);
    attemptEvidence.finishedAt = Date.now();
    attemptEvidence.result = this.cancelRequested.has(goalId) ? "cancelled" : result;
    attemptEvidence.diagnostics = summarizeAttemptDiagnostics(runRecord);
    this.updateAttemptEvidence(goalId, task, attempts, attemptEvidence, attemptEvidence.result, []);
    return {
      result: attemptEvidence.result,
      errorCode: runRecord?.errorCode ?? firstDiagnosticCode(attemptEvidence.diagnostics),
      evidence: attemptEvidence,
    };
  }

  private async runAndCollectText(goalId: string, taskId: string | undefined, request: Parameters<RunScheduler["startRun"]>[0]): Promise<string> {
    const handle = await this.runScheduler.startRun(request);
    this.setCurrentRun(goalId, taskId ?? "__planner__", handle.runId);
    let text = "";
    let result: RunResult = "failed";
    try {
      for await (const event of handle.events) {
        this.store.emit(goalId, { type: "run_event", goalId, taskId, runId: handle.runId, event });
        if (this.store.isTerminal(goalId)) {
          await handle.cancel();
          break;
        }
        if (event.type === "text_delta") text += event.text;
        if (event.type === "run_finished") result = event.result;
      }
    } finally {
      this.clearCurrentRun(goalId, taskId ?? "__planner__");
    }
    if (this.cancelRequested.has(goalId)) return "";
    if (result !== "success") throw new Error(`Planner run failed with ${result}`);
    return text;
  }

  private cancelPending(goalId: string, tasks: ScheduledTask[]): void {
    for (const task of tasks) {
      if (task.status === "pending") {
        task.status = "canceled";
        this.store.updateTask(goalId, task);
      }
    }
  }

  private cancelPendingExceptBlocked(goalId: string, tasks: ScheduledTask[]): void {
    for (const task of tasks) {
      if (task.status === "pending") {
        task.status = "canceled";
        this.store.updateTask(goalId, task);
      }
    }
  }

  private cancelPendingFromStore(goalId: string): void {
    const goal = this.store.get(goalId);
    if (!goal) return;
    this.cancelPending(goalId, goal.tasks);
  }

  private blockDependents(goalId: string, tasks: ScheduledTask[], failedTaskId: string): void {
    let changed = true;
    const blocked = new Set([failedTaskId]);
    while (changed) {
      changed = false;
      for (const task of tasks) {
        if (task.status !== "pending" || !task.dependencies.some((dep) => blocked.has(dep))) continue;
        task.status = "blocked";
        blocked.add(task.id);
        this.store.updateTask(goalId, task);
        changed = true;
      }
    }
  }

  private blockUnavailableDependents(goalId: string, tasks: ScheduledTask[]): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of tasks) {
        if (task.status !== "pending") continue;
        const hasUnavailableDependency = task.dependencies.some((dep) => {
          const dependency = tasks.find((candidate) => candidate.id === dep);
          return dependency?.status === "failed" || dependency?.status === "blocked";
        });
        if (!hasUnavailableDependency) continue;
        task.status = "blocked";
        this.store.updateTask(goalId, task);
        changed = true;
      }
    }
  }

  private setCurrentRun(goalId: string, taskId: string, runId: string): void {
    const runs = this.currentRuns.get(goalId) ?? new Map<string, string>();
    runs.set(taskId, runId);
    this.currentRuns.set(goalId, runs);
  }

  private clearCurrentRun(goalId: string, taskId: string): void {
    const runs = this.currentRuns.get(goalId);
    if (!runs) return;
    runs.delete(taskId);
    if (runs.size === 0) this.currentRuns.delete(goalId);
  }

  private async cancelCurrentRuns(goalId: string): Promise<void> {
    const runs = [...(this.currentRuns.get(goalId)?.values() ?? [])];
    await Promise.all(runs.map((runId) => this.runScheduler.cancelRun(runId)));
  }

  private updateAttemptEvidence(
    goalId: string,
    task: ScheduledTask,
    attempts: TaskAttemptEvidence[],
    attempt: TaskAttemptEvidence,
    result: RunResult,
    validationResults: ValidationCommandResult[],
  ): void {
    const index = attempts.findIndex((candidate) => candidate.attemptId === attempt.attemptId);
    if (index >= 0) attempts[index] = attempt;
    task.evidence = {
      runId: attempt.runId,
      result,
      attempts,
      validationCommands: task.validationCommands ?? [],
      validationResults,
      summary: evidenceSummary(task.id, result, attempts, validationResults),
    };
    this.store.updateTask(goalId, task);
  }

  private finish(goalId: string, result: RunResult): void {
    if (this.store.isTerminal(goalId)) return;
    this.store.setStatus(goalId, result === "success" ? "succeeded" : result === "cancelled" ? "canceled" : "failed", result);
    this.store.emit(goalId, { type: "goal_finished", goalId, result });
    this.currentRuns.delete(goalId);
    this.cancelRequested.delete(goalId);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  while (!predicate()) await delay(20);
}

function normalizeMaxConcurrentTasks(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function normalizeRetryPolicy(policy: TaskRetryPolicy | undefined): Required<TaskRetryPolicy> {
  return {
    maxAttempts: Math.max(1, Math.floor(policy?.maxAttempts ?? 1)),
    retryableErrorCodes: policy?.retryableErrorCodes ?? [],
    backoffMs: Math.max(0, Math.floor(policy?.backoffMs ?? 0)),
  };
}

function dependenciesSucceeded(task: ScheduledTask, tasks: ScheduledTask[]): boolean {
  return task.dependencies.every((dependencyId) => tasks.find((candidate) => candidate.id === dependencyId)?.status === "succeeded");
}

function isRetryable(errorCode: string | undefined, policy: Required<TaskRetryPolicy>): boolean {
  return Boolean(errorCode && policy.retryableErrorCodes.includes(errorCode));
}

function summarizeAttemptDiagnostics(run: RunRecord | null): RuntimeDiagnostic[] {
  if (!run) return [];
  if (run.diagnostics.length > 0) return run.diagnostics.map((item) => ({ ...item }));
  if (!run.errorCode) return [];
  return [
    diagnostic(run.errorCode as RuntimeErrorCode, run.error ?? `Run ${run.id} finished with ${run.status}.`, {
      exitCode: run.exitCode,
      signal: run.signal,
      retryable: false,
    }),
  ];
}

function firstDiagnosticCode(diagnostics: RuntimeDiagnostic[]): string | undefined {
  return diagnostics[0]?.code;
}

function evidenceSummary(
  taskId: string,
  result: RunResult,
  attempts: TaskAttemptEvidence[],
  validationResults: ValidationCommandResult[],
): string {
  const attemptSummary = `${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`;
  if (validationResults.length > 0) {
    const passed = validationResults.filter((validation) => validation.passed).length;
    return `Task ${taskId} finished with ${result} after ${attemptSummary}; ${passed}/${validationResults.length} validation commands passed.`;
  }
  return `Task ${taskId} finished with ${result} after ${attemptSummary}.`;
}
