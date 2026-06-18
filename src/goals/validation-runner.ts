import { exec } from "node:child_process";
import { promisify } from "node:util";
import { redactEnv, redactText } from "../core/redaction.js";
import type { ValidationCommandResult } from "./goal-types.js";

const execP = promisify(exec);

export async function runValidationCommands(input: {
  commands: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<ValidationCommandResult[]> {
  const results: ValidationCommandResult[] = [];
  const timeoutMs = input.timeoutMs ?? 60_000;
  const redactedEnv = input.env ? redactEnv(input.env) : undefined;
  for (const command of input.commands) {
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execP(command, {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      results.push({
        command: redactText(command),
        cwd: "<cwd>",
        timeoutMs,
        env: redactedEnv,
        exitCode: 0,
        signal: null,
        stdout: tail(redactText(String(stdout))),
        stderr: tail(redactText(String(stderr))),
        durationMs: Date.now() - startedAt,
        passed: true,
        classification: "success",
      });
    } catch (error) {
      const err = error as {
        code?: unknown;
        signal?: string | null;
        stdout?: unknown;
        stderr?: unknown;
        killed?: unknown;
      };
      const durationMs = Date.now() - startedAt;
      const classification = classifyValidationFailure(err, durationMs, timeoutMs);
      results.push({
        command: redactText(command),
        cwd: "<cwd>",
        timeoutMs,
        env: redactedEnv,
        exitCode: typeof err.code === "number" ? err.code : null,
        signal: err.signal ?? null,
        stdout: tail(redactText(String(err.stdout ?? ""))),
        stderr: tail(redactText(String(err.stderr ?? ""))),
        durationMs,
        passed: false,
        classification,
      });
    }
  }
  return results;
}

function classifyValidationFailure(
  error: { code?: unknown; signal?: string | null; killed?: unknown },
  durationMs: number,
  timeoutMs: number,
): ValidationCommandResult["classification"] {
  if (error.killed === true || error.signal === "SIGTERM" || (timeoutMs > 0 && durationMs >= timeoutMs)) return "timeout";
  if (typeof error.code === "number") return "failed";
  return "spawn_error";
}

function tail(value: string, max = 4_000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}
