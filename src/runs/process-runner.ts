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
}

export class RunningProcess extends EventEmitter {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super();
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  async cancel(graceMs = 750): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, graceMs);
      timer.unref?.();
      this.child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.child.exitCode === null && this.child.signalCode === null) this.kill("SIGKILL");
  }

  private kill(signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && typeof this.child.pid === "number") {
        process.kill(-this.child.pid, signal);
        return;
      }
    } catch {
      // Fall through to direct child signal.
    }
    try {
      this.child.kill(signal);
    } catch {
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
  if (request.stdinData !== undefined) {
    child.stdin.end(request.stdinData);
  } else {
    child.stdin.end();
  }
  const close = new Promise<ProcessClose>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  return { child, running: new RunningProcess(child), close };
}
