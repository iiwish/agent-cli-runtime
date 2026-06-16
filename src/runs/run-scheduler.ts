import { accessSync, constants, existsSync, statSync } from "node:fs";
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
import { spawnProcess, type KillReport, type ProcessClose, type RunningProcess } from "./process-runner.js";
import { isTerminal, RunStore } from "./run-store.js";
import type { RunHandle, RunRequest } from "./run-types.js";
import type { RunResult } from "./run-result.js";

interface ActiveRun {
  process?: RunningProcess;
  cancelRequested: boolean;
  timeoutFired: boolean;
  timeout?: NodeJS.Timeout;
  done: Promise<void>;
  resolveDone: () => void;
  killDiagnostics: string[];
  killPromise?: Promise<void>;
  abortListener?: () => void;
  finished: boolean;
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
    const active = createActiveRun();
    this.active.set(run.id, active);
    const events = this.store.events(run.id);
    const handle: RunHandle = {
      runId: run.id,
      events,
      cancel: async (reason) => this.cancelRun(run.id, reason),
    };

    if (!adapter) {
      this.failBeforeSpawn(run.id, "AGENT_UNAVAILABLE", `Unknown adapter: ${request.agentId}`);
      return handle;
    }

    void this.execute(run.id, adapter, { ...request, cwd }).catch((error) => {
      if (!this.store.hasPersistenceFailed(run.id)) {
        this.emitError(run.id, "AGENT_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
        this.finish(run.id, "failed", 1, null, {
          error: error instanceof Error ? redactText(error.message) : redactText(String(error)),
          errorCode: "AGENT_EXECUTION_FAILED",
        });
      }
      this.cleanupActive(run.id);
    });
    return handle;
  }

  async cancelRun(runId: string, reason = "Run was cancelled"): Promise<void> {
    const active = this.active.get(runId);
    if (!active) return;
    active.cancelRequested = true;
    if (active.timeout) clearTimeout(active.timeout);
    if (!active.process) return;
    active.killPromise = active.process.cancel().then((report) => {
      active.killDiagnostics.push(killReportMessage(reason, report));
    });
    await active.killPromise;
  }

  async shutdown(reason = "Runtime shutdown", graceMs = 2_000): Promise<void> {
    const activeRuns = [...this.active.entries()];
    await Promise.all(activeRuns.map(([runId]) => this.cancelRun(runId, reason)));
    await Promise.race([
      Promise.all(activeRuns.map(([, active]) => active.done)),
      delay(graceMs),
    ]);
    for (const [runId, active] of activeRuns) {
      if (!this.active.has(runId) || active.finished) continue;
      this.emitError(runId, "AGENT_CANCELLED", reason, false);
      this.finish(runId, "cancelled", null, "RUNTIME_SHUTDOWN", {
        error: reason,
        errorCode: "AGENT_CANCELLED",
      });
      this.cleanupActive(runId);
    }
  }

  private async execute(runId: string, adapter: AgentAdapterDef, request: RunRequest): Promise<void> {
    const permissionPolicy = request.permissionPolicy ?? adapter.defaults?.permissionPolicy ?? "agent-default";
    validateExtraAllowedDirs(request.extraAllowedDirs ?? []);
    const env = mergeEnv(this.options.env ?? process.env, adapter.env, request.env);
    const resolution = resolveExecutable(adapter, { env, searchPath: this.options.searchPath });
    if (!resolution.selectedPath) {
      const notExecutablePath = notExecutableCandidatePath(adapter, env, resolution.searchedLocations);
      if (notExecutablePath) {
        const message = `${adapter.displayName} executable is not executable`;
        this.store.addDiagnostic(runId, diagnostic("AGENT_NOT_EXECUTABLE", message, { agentId: adapter.id, path: notExecutablePath }));
        this.failBeforeSpawn(runId, "AGENT_NOT_EXECUTABLE", message);
      } else {
        this.store.addDiagnostic(runId, diagnostic("AGENT_UNAVAILABLE", `${adapter.displayName} executable was not found`, { agentId: adapter.id, searchedLocations: resolution.searchedLocations }));
        this.failBeforeSpawn(runId, "AGENT_UNAVAILABLE", `${adapter.displayName} executable was not found`);
      }
      return;
    }

    const prompt = composePrompt(request);
    const prepared = await preparePromptTransport(adapter.promptTransport, prompt);
    let sawSubstantiveEvent = false;
    let errorEventCode: RuntimeErrorCode | undefined;
    let stderrTail = "";
    const active = this.active.get(runId);
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
      let parsedEventCount = 0;
      let stdoutTail = "";
      this.store.setStatus(runId, "running");
      if (this.store.hasPersistenceFailed(runId)) return;
      if (!this.emit(runId, { type: "run_started", runId, agentId: adapter.id, cwd: request.cwd, model: request.model })) return;
      if (active?.cancelRequested) {
        this.emitError(runId, "AGENT_CANCELLED", "Run was cancelled", false);
        this.finish(runId, "cancelled", null, null, {
          error: "Run was cancelled",
          errorCode: "AGENT_CANCELLED",
        });
        return;
      }
      const spawned = spawnProcess({
        command: resolution.selectedPath,
        args,
        cwd: request.cwd,
        env,
        stdinData: prepared.stdinData,
      });
      if (active) {
        active.process = spawned.running;
        active.timeout = this.armTimeout(runId, request.timeoutMs ?? adapter.defaults?.timeoutMs);
        if (active.cancelRequested || active.timeoutFired) {
          active.killPromise = spawned.running.cancel().then((report) => {
            active.killDiagnostics.push(killReportMessage(active.timeoutFired ? "Run timed out" : "Run was cancelled", report));
          });
        }
      }
      if (request.signal) {
        active!.abortListener = () => {
          void this.cancelRun(runId, "AbortSignal cancelled run");
        };
        request.signal.addEventListener("abort", active!.abortListener, { once: true });
        if (request.signal.aborted) void this.cancelRun(runId, "AbortSignal cancelled run");
      }

      spawned.child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdoutTail = tail(`${stdoutTail}${text}`);
        const parsedEvents = parser.parse(text);
        parsedEventCount += parsedEvents.length;
        for (const event of parsedEvents) {
          if (event.type === "error") errorEventCode ??= event.code;
          if (isSubstantive(event)) sawSubstantiveEvent = true;
          if (!this.emit(runId, event)) {
            void this.active.get(runId)?.process?.cancel();
            break;
          }
        }
      });
      spawned.child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = tail(`${stderrTail}${chunk.toString("utf8")}`);
      });

      const close = await spawned.close;
      const flushedEvents = parser.flush();
      parsedEventCount += flushedEvents.length;
      for (const event of flushedEvents) {
        if (event.type === "error") errorEventCode ??= event.code;
        if (isSubstantive(event)) sawSubstantiveEvent = true;
        if (!this.emit(runId, event)) return;
      }
      await active?.killPromise;
      if (active?.timeout) clearTimeout(active.timeout);
      if (active?.timeoutFired) {
        this.addTerminalDiagnostic(
          runId,
          "AGENT_TIMEOUT",
          `Run timed out after ${request.timeoutMs ?? adapter.defaults?.timeoutMs}ms`,
          adapter,
          close,
          {
            args,
            cwd: request.cwd,
            stdoutTail,
            stderrTail,
            parsedEventCount,
            killDiagnostics: active.killDiagnostics,
          },
        );
        this.finish(runId, "failed", close.exitCode, close.signal, {
          error: "Run timed out",
          errorCode: "AGENT_TIMEOUT",
        });
      } else if (active?.cancelRequested) {
        this.addTerminalDiagnostic(runId, "AGENT_CANCELLED", "Run was cancelled", adapter, close, {
          args,
          cwd: request.cwd,
          stdoutTail,
          stderrTail,
          parsedEventCount,
          killDiagnostics: active.killDiagnostics,
        });
        this.emitError(runId, "AGENT_CANCELLED", "Run was cancelled", false);
        this.finish(runId, "cancelled", close.exitCode, close.signal, {
          error: "Run was cancelled",
          errorCode: "AGENT_CANCELLED",
        });
      } else if (close.error) {
        const code = classifyProcessError(close.error);
        const message = processErrorMessage(adapter, close.error);
        this.store.addDiagnostic(runId, diagnostic(code, redactText(message), {
          agentId: adapter.id,
          argv: safeArgv(args, request.cwd),
          promptTransport: promptTransportLabel(adapter),
          streamFormat: adapter.compatibility?.streamFormat,
          parsedEventCount,
          stdoutTail: sanitizeDiagnosticText(stdoutTail, request.cwd),
          stderrTail: sanitizeDiagnosticText(stderrTail, request.cwd),
          retryable: code === "AGENT_UNAVAILABLE",
        }));
        this.emitError(runId, code, redactText(message), code === "AGENT_UNAVAILABLE");
        this.finish(runId, "failed", close.exitCode, close.signal, {
          error: redactText(message),
          errorCode: code,
        });
      } else if (close.stdinError) {
        const message = `Failed to write prompt to ${adapter.displayName} stdin: ${close.stdinError.message}`;
        this.store.addDiagnostic(runId, diagnostic("AGENT_EXECUTION_FAILED", redactText(message), {
          agentId: adapter.id,
          argv: safeArgv(args, request.cwd),
          promptTransport: promptTransportLabel(adapter),
          streamFormat: adapter.compatibility?.streamFormat,
          parsedEventCount,
          stdoutTail: sanitizeDiagnosticText(stdoutTail, request.cwd),
          stderrTail: sanitizeDiagnosticText(stderrTail, request.cwd),
        }));
        this.emitError(runId, "AGENT_EXECUTION_FAILED", redactText(message));
        this.finish(runId, "failed", close.exitCode, close.signal, {
          error: redactText(message),
          errorCode: "AGENT_EXECUTION_FAILED",
        });
      } else if (errorEventCode) {
        this.finish(runId, "failed", close.exitCode, close.signal, { errorCode: errorEventCode });
      } else if (close.exitCode !== 0) {
        this.store.addDiagnostic(runId, diagnostic("AGENT_EXECUTION_FAILED", `${adapter.displayName} exited with code ${close.exitCode}`, {
          agentId: adapter.id,
          argv: safeArgv(args, request.cwd),
          promptTransport: promptTransportLabel(adapter),
          streamFormat: adapter.compatibility?.streamFormat,
          parsedEventCount,
          exitCode: close.exitCode,
          signal: close.signal,
          stdoutTail: sanitizeDiagnosticText(stdoutTail, request.cwd),
          stderrTail: sanitizeDiagnosticText(stderrTail, request.cwd),
          actionableHints: timeoutHints(adapter, stdoutTail, stderrTail, parsedEventCount, close),
        }));
        this.emitError(runId, "AGENT_EXECUTION_FAILED", `${adapter.displayName} exited with code ${close.exitCode ?? "unknown"}`);
        this.finish(runId, "failed", close.exitCode, close.signal, {
          error: `${adapter.displayName} exited with code ${close.exitCode ?? "unknown"}`,
          errorCode: "AGENT_EXECUTION_FAILED",
        });
      } else if (!sawSubstantiveEvent) {
        this.emitError(runId, "AGENT_EXECUTION_FAILED", `${adapter.displayName} produced no output`);
        this.finish(runId, "failed", close.exitCode, close.signal, {
          error: `${adapter.displayName} produced no output`,
          errorCode: "AGENT_EXECUTION_FAILED",
        });
      } else {
        this.finish(runId, "success", close.exitCode, close.signal);
      }
    } finally {
      await prepared.cleanup().catch(() => undefined);
      if (active?.timeout) clearTimeout(active.timeout);
      if (request.signal && active?.abortListener) request.signal.removeEventListener("abort", active.abortListener);
      this.cleanupActive(runId);
    }
  }

  private armTimeout(runId: string, timeoutMs: number | undefined): NodeJS.Timeout | undefined {
    if (!timeoutMs || timeoutMs <= 0) return undefined;
    const timer = setTimeout(() => {
      this.emitError(runId, "AGENT_TIMEOUT", `Run timed out after ${timeoutMs}ms`);
      const active = this.active.get(runId);
      if (active) active.timeoutFired = true;
      if (active?.process) active.killPromise = active.process.cancel().then((report) => {
        active?.killDiagnostics.push(killReportMessage("Run timed out", report));
      });
    }, timeoutMs);
    timer.unref?.();
    return timer;
  }

  private failBeforeSpawn(runId: string, code: RuntimeErrorCode, message: string): void {
    this.emitError(runId, code, message);
    this.finish(runId, "failed", 1, null, { error: message, errorCode: code });
    this.cleanupActive(runId);
  }

  private cleanupActive(runId: string): void {
    const active = this.active.get(runId);
    if (active?.timeout) clearTimeout(active.timeout);
    this.active.delete(runId);
    active?.resolveDone();
  }

  private emit(runId: string, event: AgentEventInput): boolean {
    this.store.append(runId, withTimestamp<AgentEvent>(event));
    return !this.store.hasPersistenceFailed(runId);
  }

  private emitError(runId: string, code: RuntimeErrorCode, message: string, retryable = false): boolean {
    return this.emit(runId, { type: "error", code, message, retryable });
  }

  private addTerminalDiagnostic(
    runId: string,
    code: RuntimeErrorCode,
    message: string,
    adapter: AgentAdapterDef,
    close: ProcessClose,
    details: {
      args: string[];
      cwd: string;
      stdoutTail: string;
      stderrTail: string;
      parsedEventCount: number;
      killDiagnostics: string[];
    },
  ): void {
    this.store.addDiagnostic(runId, diagnostic(code, redactText(message), {
      agentId: adapter.id,
      argv: safeArgv(details.args, details.cwd),
      promptTransport: promptTransportLabel(adapter),
      streamFormat: adapter.compatibility?.streamFormat,
      parsedEventCount: details.parsedEventCount,
      exitCode: close.exitCode,
      signal: close.signal,
      stdoutTail: sanitizeDiagnosticText(details.stdoutTail, details.cwd),
      stderrTail: sanitizeDiagnosticText([details.stderrTail, ...details.killDiagnostics].filter(Boolean).join("\n"), details.cwd),
      actionableHints: timeoutHints(adapter, details.stdoutTail, details.stderrTail, details.parsedEventCount, close),
      retryable: false,
    }));
  }

  private finish(
    runId: string,
    result: RunResult,
    exitCode: number | null,
    signal: string | null,
    init: { error?: string | null; errorCode?: string | null } = {},
  ): void {
    const active = this.active.get(runId);
    const record = this.store.get(runId);
    if (record && isTerminal(record.status)) return;
    if (active?.finished) return;
    if (active) active.finished = true;
    if (this.store.hasPersistenceFailed(runId)) return;
    this.store.setStatus(runId, result === "success" ? "succeeded" : result === "cancelled" ? "canceled" : "failed", { exitCode, signal, ...init });
    this.emit(runId, { type: "run_finished", result, exitCode, signal });
  }
}

function createActiveRun(): ActiveRun {
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  return {
    cancelRequested: false,
    timeoutFired: false,
    done,
    resolveDone,
    killDiagnostics: [],
    finished: false,
  };
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

function notExecutableCandidatePath(adapter: AgentAdapterDef, env: NodeJS.ProcessEnv, searchedLocations: string[]): string | null {
  const configured = configuredNotExecutablePath(adapter, env);
  if (configured) return configured;
  return searchedLocations.find((candidate) => isNotExecutableFile(candidate)) ?? null;
}

function configuredNotExecutablePath(adapter: AgentAdapterDef, env: NodeJS.ProcessEnv): string | null {
  if (!adapter.binEnvVar) return null;
  const raw = env[adapter.binEnvVar];
  if (typeof raw !== "string" || !path.isAbsolute(raw)) return null;
  return isNotExecutableFile(raw) ? raw : null;
}

function isNotExecutableFile(candidate: string): boolean {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
    if (process.platform === "win32") return false;
    accessSync(candidate, constants.X_OK);
    return false;
  } catch {
    return true;
  }
}

function isSubstantive(event: AgentEventInput): boolean {
  return event.type === "text_delta" || event.type === "thinking_delta" || event.type === "tool_call" || event.type === "tool_result" || event.type === "usage" || event.type === "status";
}

function safeArgv(args: string[], cwd: string): string[] {
  return args.map((arg) => sanitizeArg(arg, cwd));
}

function sanitizeArg(value: string, cwd: string): string {
  if (value === cwd) return "<cwd>";
  const home = process.env.HOME;
  let out = value;
  if (home) out = out.split(home).join("~");
  out = out.split(cwd).join("<cwd>");
  return redactText(out);
}

function sanitizeDiagnosticText(value: string, cwd: string): string | undefined {
  if (!value) return undefined;
  const home = process.env.HOME;
  let out = value;
  if (home) out = out.split(home).join("~");
  out = out.split(cwd).join("<cwd>");
  return redactText(out);
}

function promptTransportLabel(adapter: AgentAdapterDef): string {
  const format = adapter.promptTransport.kind === "stdin" && adapter.promptTransport.inputFormat ? `:${adapter.promptTransport.inputFormat}` : "";
  return `${adapter.promptTransport.kind}${format}`;
}

function timeoutHints(adapter: AgentAdapterDef, stdoutTail: string, stderrTail: string, parsedEventCount: number, close: ProcessClose): string[] {
  const text = `${stdoutTail}\n${stderrTail}`;
  const hints: string[] = [];
  if (/unknown (option|flag)|unrecognized (option|flag)|unsupported (option|flag)|unknown argument/i.test(text)) {
    hints.push("Installed CLI output looks like an unsupported flag or argument; verify this adapter profile against the local CLI help/version.");
  }
  if (/auth(entication)? required|not authenticated|not logged in|login required|unauthorized|invalid api key/i.test(text)) {
    hints.push("CLI output looks auth-related; verify local CLI authentication or provider environment outside the runtime.");
  }
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|fetch failed|socket hang up|Connect|HTTP request failed|chatgpt\.com|mcp/i.test(text)) {
    hints.push("CLI output looks network or startup-integration related; inspect local CLI network/proxy/plugin configuration and retry the same command directly.");
  }
  if (parsedEventCount === 0) {
    hints.push("No structured events were parsed before timeout; the CLI may be waiting for interactive input, model/auth setup, or may not support the configured JSON/stdin profile.");
  } else {
    hints.push("Structured events were parsed before timeout, so invocation started; the CLI did not emit a terminal event before the runtime deadline.");
  }
  if (adapter.id === "opencode" && adapter.promptTransport.kind === "stdin") {
    hints.push("OpenCode help for this version documents positional message input but not stdin prompt input; keep stdin as the safe default unless a non-argv prompt transport is verified.");
  }
  if (close.exitCode === 0 && close.signal === null) {
    hints.push("Process closed with exitCode 0 after the runtime timeout fired; treat this run as timeout because no terminal agent result arrived before the deadline.");
  }
  return [...new Set(hints)];
}

function tail(value: string, max = 4_000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function killReportMessage(reason: string, report: KillReport): string {
  const hard = report.hardSignal ? `, escalated to ${report.hardSignal}` : "";
  const errors = report.errors.length ? `; kill errors: ${report.errors.join("; ")}` : "";
  return `${reason}: sent ${report.softSignal}${hard}${errors}`;
}

function classifyProcessError(error: NodeJS.ErrnoException): RuntimeErrorCode {
  if (error.code === "ENOENT") return "AGENT_UNAVAILABLE";
  if (error.code === "EACCES" || error.code === "EPERM") return "AGENT_NOT_EXECUTABLE";
  return "AGENT_EXECUTION_FAILED";
}

function processErrorMessage(adapter: AgentAdapterDef, error: NodeJS.ErrnoException): string {
  if (error.code === "ENOENT") return `${adapter.displayName} executable was not found or could not be launched: ${error.message}`;
  if (error.code === "EACCES" || error.code === "EPERM") return `${adapter.displayName} executable is not executable: ${error.message}`;
  return `${adapter.displayName} failed to launch: ${error.message}`;
}
