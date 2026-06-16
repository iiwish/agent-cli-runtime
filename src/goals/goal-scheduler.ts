import { GoalStore } from "./goal-store.js";
import type { CreateGoalRequest, GoalHandle, ScheduledTask } from "./goal-types.js";
import { createPlannerPrompt, createTaskPrompt } from "./planner-prompts.js";
import { dependencyOrder, parsePlannerOutput, validateTaskGraph } from "./task-graph.js";
import { runValidationCommands } from "./validation-runner.js";
import type { RunScheduler } from "../runs/run-scheduler.js";
import type { RunResult } from "../runs/run-result.js";

export class GoalScheduler {
  private readonly currentRuns = new Map<string, string>();
  private readonly cancelRequested = new Set<string>();

  constructor(
    private readonly runScheduler: RunScheduler,
    private readonly store = new GoalStore(),
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
      this.store.emit(goal.id, { type: "scheduler_error", code: "AGENT_EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) });
      this.finish(goal.id, "failed");
    });
    return handle;
  }

  async cancelGoal(goalId: string): Promise<void> {
    this.cancelRequested.add(goalId);
    const runId = this.currentRuns.get(goalId);
    if (runId) await this.runScheduler.cancelRun(runId);
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

    for (const task of dependencyOrder(tasks)) {
      if (this.cancelRequested.has(goalId)) {
        this.cancelPending(goalId, tasks);
        return this.finish(goalId, "cancelled");
      }
      task.status = "running";
      this.store.updateTask(goalId, task);
      if (this.store.isTerminal(goalId)) return;
      const result = await this.runTask(goalId, request, task);
      if (this.store.isTerminal(goalId)) return;
      const validationResults = result === "success" && task.validationCommands?.length
        ? await runValidationCommands({
            commands: task.validationCommands,
            cwd: task.cwd,
            env: request.env,
            timeoutMs: request.validationTimeoutMs,
          })
        : [];
      const finalResult: RunResult =
        result === "success" && validationResults.some((validation) => !validation.passed)
          ? "failed"
          : result;
      task.status = finalResult === "success" ? "succeeded" : finalResult === "cancelled" ? "canceled" : "failed";
      task.evidence = {
        runId: task.evidence?.runId,
        result: finalResult,
        validationCommands: task.validationCommands ?? [],
        validationResults,
        summary: validationResults.length > 0
          ? `Task ${task.id} finished with ${finalResult}; ${validationResults.filter((validation) => validation.passed).length}/${validationResults.length} validation commands passed.`
          : `Task ${task.id} finished with ${finalResult}.`,
      };
      this.store.updateTask(goalId, task);
      if (this.store.isTerminal(goalId)) return;
      this.store.emit(goalId, { type: "task_finished", goalId, taskId: task.id, result: finalResult });
      if (this.store.isTerminal(goalId)) return;
      if (finalResult !== "success" && !request.continueOnFailure) {
        this.blockDependents(goalId, tasks, task.id);
        return this.finish(goalId, finalResult === "cancelled" ? "cancelled" : "failed");
      }
    }
    this.finish(goalId, "success");
  }

  private async runTask(goalId: string, request: CreateGoalRequest, task: ScheduledTask): Promise<RunResult> {
    let result: RunResult = "failed";
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
    task.evidence = { runId: handle.runId, validationCommands: task.validationCommands ?? [], summary: "" };
    this.currentRuns.set(goalId, handle.runId);
    this.store.emit(goalId, { type: "task_started", goalId, taskId: task.id, runId: handle.runId });
    if (this.store.isTerminal(goalId)) {
      await handle.cancel();
      return "failed";
    }
    for await (const event of handle.events) {
      this.store.emit(goalId, { type: "run_event", goalId, taskId: task.id, runId: handle.runId, event });
      if (this.store.isTerminal(goalId)) {
        await handle.cancel();
        break;
      }
      if (event.type === "run_finished") result = event.result;
    }
    this.currentRuns.delete(goalId);
    return this.cancelRequested.has(goalId) ? "cancelled" : result;
  }

  private async runAndCollectText(goalId: string, taskId: string | undefined, request: Parameters<RunScheduler["startRun"]>[0]): Promise<string> {
    const handle = await this.runScheduler.startRun(request);
    this.currentRuns.set(goalId, handle.runId);
    let text = "";
    let result: RunResult = "failed";
    for await (const event of handle.events) {
      this.store.emit(goalId, { type: "run_event", goalId, taskId, runId: handle.runId, event });
      if (this.store.isTerminal(goalId)) {
        await handle.cancel();
        break;
      }
      if (event.type === "text_delta") text += event.text;
      if (event.type === "run_finished") result = event.result;
    }
    this.currentRuns.delete(goalId);
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

  private blockDependents(goalId: string, tasks: ScheduledTask[], failedTaskId: string): void {
    for (const task of tasks) {
      if (task.status === "pending" && task.dependencies.includes(failedTaskId)) {
        task.status = "blocked";
        this.store.updateTask(goalId, task);
      }
    }
  }

  private finish(goalId: string, result: RunResult): void {
    if (this.store.isTerminal(goalId)) return;
    this.store.setStatus(goalId, result === "success" ? "succeeded" : result === "cancelled" ? "canceled" : "failed", result);
    this.store.emit(goalId, { type: "goal_finished", goalId, result });
    this.currentRuns.delete(goalId);
    this.cancelRequested.delete(goalId);
  }
}
