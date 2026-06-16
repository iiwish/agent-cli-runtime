import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ProbeResult {
  stdout: string;
  stderr: string;
  cwd: string;
}

export async function execProbe(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-probe-"));
  try {
    const { stdout, stderr } = await execFileP(command, args, {
      cwd,
      env: options.env,
      timeout: options.timeoutMs ?? 3_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr), cwd };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
