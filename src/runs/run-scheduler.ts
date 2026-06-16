import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AgentEvent, AgentEventInput } from "../core/events.js";
import { withTimestamp } from "../core/events.js";
import { diagnostic, type RuntimeErrorCode } from "../core/diagnostics.js";
import { redactText } from "../core/redaction.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { AgentAdapterDef, AgentId, PermissionPolicy } from "../adapters/adapter-types.js";
import { resolveExecutable } from "../detection/executable-resolution.js";
import { mergeEnv } from "../detection/env.js";
import { composePrompt, preparePromptTransport } from "./prompt-transport.js";
import { spawnProcess, type RunningProcess } from "./process-runner.js";
import { RunStore } from "./run-store.js";
import type { RunHandle, RunRequest } from "./run-types.js";
import type { RunResult } from "./run-result.js";

interface ActiveRun {
  process?: RunningProcess;
  cancelRequested: boolean;
  timeout?: NodeJS.Timeout;
}

export class RunScheduler {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly registry: AdapterRegistry,
    private readonly store: RunStore,
    private readonly options: { env?: NodeJS.ProcessEnv; searchPath?: string[] } = {},
  ) {}

  async startRun(request: RunRequest): Promise<RunHandle> {
    const adapter = this.registry.get(request.agentId);
    const cwd = validateCwd(request.cwd);
    const run = this.store.create({ agentId: request.agentId, cwd });
    const active: ActiveRun = { cancelRequested: false };
    this.active.set(run.id, active);
    const events = this.store.events(run.id);
    const handle: RunHandle = {
      runId: run.id,
      events,
      cancel: async () => this.cancelRun(run.id),
    };

    if (!adapter) {
      this.failBeforeSpawn(run.id, "AGENT_UNAVAILABLE", `Unknown adapter: ${request.agentId}`);
      return handle;
    }

    void this.execute(run.id, adapter, { ...request, cwd }).catch((error) => {
      this.emitError(run.id, "AGENT_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
      this.finish(run.id, "failed", 1, null);
    });
    return handle;
  }

  async cancelRun(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) return;
    active.cancelRequested = true;
    if (active.timeout) clearTimeout(active.timeout);
    await active.process?.cancel();
  }

  private async execute(runId: string, adapter: AgentAdapterDef, request: RunRequest): Promise<void> {
    const permissionPolicy = request.permissionPolicy ?? adapter.defaults?.permissionPolicy ?? "agent-default";
    validateExtraAllowedDirs(request.extraAllowedDirs ?? []);
    const env = mergeEnv(this.options.env ?? process.env, adapter.env, request.env);
    const resolution = resolveExecutable(adapter, { env, searchPath: this.options.searchPath });
    if (!resolution.selectedPath) {
      this.store.addDiagnostic(runId, diagnostic("AGENT_UNAVAILABLE", `${adapter.displayName} executable was not found`, { agentId: adapter.id, searchedLocations: resolution.searchedLocations }));
      this.emitError(runId, "AGENT_UNAVAILABLE", `${adapter.displayName} executable was not found`);
      this.finish(runId, "failed", 1, null);
      return;
    }

    const prompt = composePrompt(request);
    const prepared = await preparePromptTransport(adapter.promptTransport, prompt);
    let sawSubstantiveEvent = false;
    let sawParserError = false;
    let stderrTail = "";
    try {
      const args = adapter.buildArgs({
        prompt,
        cwd: request.cwd,
        model: request.model,
        reasoning: request.reasoning,
        extraAllowedDirs: request.extraAllowedDirs ?? [],
        permissionPolicy,
        promptFilePath: prepared.promptFilePath,
        session: request.session,
        contextBlocks: request.contextBlocks,
      });
      const parser = adapter.stream.create();
      this.store.setStatus(runId, "running");
      this.emit(runId, { type: "run_started", runId, agentId: adapter.id, cwd: request.cwd, model: request.model });
      const spawned = spawnProcess({
        command: resolution.selectedPath,
        args,
        cwd: request.cwd,
        env,
        stdinData: prepared.stdinData,
      });
      const active = this.active.get(runId);
      if (active) {
        active.process = spawned.running;
        active.timeout = this.armTimeout(runId, request.timeoutMs ?? adapter.defaults?.timeoutMs);
      }
      request.signal?.addEventListener("abort", () => {
        void this.cancelRun(runId);
      }, { once: true });

      spawned.child.stdout.on("data", (chunk: Buffer) => {
        for (const event of parser.parse(chunk.toString("utf8"))) {
          if (event.type === "error") sawParserError = true;
          if (isSubstantive(event)) sawSubstantiveEvent = true;
          this.emit(runId, event);
        }
      });
      spawned.child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = tail(`${stderrTail}${chunk.toString("utf8")}`);
      });

      const close = await spawned.close;
      for (const event of parser.flush()) {
        if (event.type === "error") sawParserError = true;
        if (isSubstantive(event)) sawSubstantiveEvent = true;
        this.emit(runId, event);
      }
      if (active?.timeout) clearTimeout(active.timeout);
      if (active?.cancelRequested) {
        this.emitError(runId, "AGENT_CANCELLED", "Run was cancelled", false);
        this.finish(runId, "cancelled", close.exitCode, close.signal);
      } else if (sawParserError) {
        this.finish(runId, "failed", close.exitCode, close.signal);
      } else if (close.exitCode !== 0) {
        this.store.addDiagnostic(runId, diagnostic("AGENT_EXECUTION_FAILED", `${adapter.displayName} exited with code ${close.exitCode}`, { agentId: adapter.id, exitCode: close.exitCode, signal: close.signal, stderrTail: redactText(stderrTail) }));
        this.emitError(runId, "AGENT_EXECUTION_FAILED", `${adapter.displayName} exited with code ${close.exitCode ?? "unknown"}`);
        this.finish(runId, "failed", close.exitCode, close.signal);
      } else if (!sawSubstantiveEvent) {
        this.emitError(runId, "AGENT_EXECUTION_FAILED", `${adapter.displayName} produced no output`);
        this.finish(runId, "failed", close.exitCode, close.signal);
      } else {
        this.finish(runId, "success", close.exitCode, close.signal);
      }
    } finally {
      await prepared.cleanup();
      this.active.delete(runId);
    }
  }

  private armTimeout(runId: string, timeoutMs: number | undefined): NodeJS.Timeout | undefined {
    if (!timeoutMs || timeoutMs <= 0) return undefined;
    const timer = setTimeout(() => {
      this.emitError(runId, "AGENT_TIMEOUT", `Run timed out after ${timeoutMs}ms`);
      const active = this.active.get(runId);
      if (active) active.cancelRequested = false;
      void active?.process?.cancel();
    }, timeoutMs);
    timer.unref?.();
    return timer;
  }

  private failBeforeSpawn(runId: string, code: RuntimeErrorCode, message: string): void {
    this.emitError(runId, code, message);
    this.finish(runId, "failed", 1, null);
    this.active.delete(runId);
  }

  private emit(runId: string, event: AgentEventInput): void {
    this.store.append(runId, withTimestamp<AgentEvent>(event));
  }

  private emitError(runId: string, code: RuntimeErrorCode, message: string, retryable = false): void {
    this.emit(runId, { type: "error", code, message, retryable });
  }

  private finish(runId: string, result: RunResult, exitCode: number | null, signal: string | null): void {
    this.store.setStatus(runId, result === "success" ? "succeeded" : result === "cancelled" ? "canceled" : "failed", { exitCode, signal });
    this.emit(runId, { type: "run_finished", result, exitCode, signal });
  }
}

function validateCwd(cwd: string): string {
  if (!path.isAbsolute(cwd)) throw new Error("RunRequest.cwd must be an absolute path");
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`RunRequest.cwd does not exist: ${cwd}`);
  return cwd;
}

function validateExtraAllowedDirs(dirs: string[]): void {
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) throw new Error(`extraAllowedDirs entries must be absolute paths: ${dir}`);
  }
}

function isSubstantive(event: AgentEventInput): boolean {
  return event.type === "text_delta" || event.type === "thinking_delta" || event.type === "tool_call" || event.type === "tool_result" || event.type === "usage" || event.type === "status";
}

function tail(value: string, max = 4_000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}
