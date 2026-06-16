import { exec } from "node:child_process";
import { promisify } from "node:util";
import { redactText } from "../core/redaction.js";
import type { ValidationCommandResult } from "./goal-types.js";

const execP = promisify(exec);

export async function runValidationCommands(input: {
  commands: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<ValidationCommandResult[]> {
  const results: ValidationCommandResult[] = [];
  for (const command of input.commands) {
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execP(command, {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        timeout: input.timeoutMs ?? 60_000,
        maxBuffer: 1024 * 1024,
      });
      results.push({
        command,
        exitCode: 0,
        signal: null,
        stdout: tail(redactText(String(stdout))),
        stderr: tail(redactText(String(stderr))),
        durationMs: Date.now() - startedAt,
        passed: true,
      });
    } catch (error) {
      const err = error as {
        code?: unknown;
        signal?: string | null;
        stdout?: unknown;
        stderr?: unknown;
      };
      results.push({
        command,
        exitCode: typeof err.code === "number" ? err.code : null,
        signal: err.signal ?? null,
        stdout: tail(redactText(String(err.stdout ?? ""))),
        stderr: tail(redactText(String(err.stderr ?? ""))),
        durationMs: Date.now() - startedAt,
        passed: false,
      });
    }
  }
  return results;
}

function tail(value: string, max = 4_000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}
