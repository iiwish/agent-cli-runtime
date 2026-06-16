import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

export interface SpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinData?: string;
}

export interface ProcessClose {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
  stdinError?: Error;
}

export interface KillReport {
  softSignal: NodeJS.Signals;
  hardSignal?: NodeJS.Signals;
  escalated: boolean;
  errors: string[];
}

export class RunningProcess extends EventEmitter {
  private cancelPromise?: Promise<KillReport>;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super();
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  async cancel(graceMs = 750): Promise<KillReport> {
    if (this.cancelPromise) return this.cancelPromise;
    this.cancelPromise = this.cancelOnce(graceMs);
    return this.cancelPromise;
  }

  private async cancelOnce(graceMs: number): Promise<KillReport> {
    const report: KillReport = { softSignal: "SIGTERM", escalated: false, errors: [] };
    if (this.child.exitCode !== null || this.child.signalCode !== null) return report;
    this.kill("SIGTERM", report);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, graceMs);
      timer.unref?.();
      this.child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.child.exitCode === null && this.child.signalCode === null) {
      report.escalated = true;
      report.hardSignal = "SIGKILL";
      this.kill("SIGKILL", report);
    }
    return report;
  }

  private kill(signal: NodeJS.Signals, report: KillReport): void {
    try {
      if (process.platform !== "win32" && typeof this.child.pid === "number") {
        process.kill(-this.child.pid, signal);
        return;
      }
    } catch (error) {
      report.errors.push(errorMessage(error));
      // Fall through to direct child signal.
    }
    try {
      this.child.kill(signal);
    } catch (error) {
      report.errors.push(errorMessage(error));
      // best effort
    }
  }
}

export function spawnProcess(request: SpawnRequest): {
  child: ChildProcessWithoutNullStreams;
  running: RunningProcess;
  close: Promise<ProcessClose>;
} {
  const child = spawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdinError: Error | undefined;
  child.stdin.once("error", (error) => {
    stdinError = error;
  });
  try {
    if (request.stdinData !== undefined) {
      child.stdin.end(request.stdinData);
    } else {
      child.stdin.end();
    }
  } catch (error) {
    stdinError = error instanceof Error ? error : new Error(String(error));
  }
  const close = new Promise<ProcessClose>((resolve) => {
    let settled = false;
    const settle = (value: ProcessClose): void => {
      if (settled) return;
      settled = true;
      resolve({ ...value, stdinError });
    };
    child.once("error", (error: NodeJS.ErrnoException) => settle({ exitCode: null, signal: null, error }));
    child.once("close", (exitCode, signal) => settle({ exitCode, signal, stdinError }));
  });
  return { child, running: new RunningProcess(child), close };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
