#!/usr/bin/env node
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentRuntime } from "../index.js";
import { redactText } from "../core/redaction.js";
import { runParserFixtureCases } from "../smoke/parser-fixtures.js";
import { atomicWriteJsonFile, exportDiagnosticsBundle, inspectStoreDirectory } from "../storage/store-inspection.js";
import type { DetectedAgent, RunRecord } from "../index.js";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.command === "help" || parsed.flags.has("help")) {
    printHelp();
    return;
  }
  if (parsed.command === "store-health") {
    const storageDir = requiredStringFlag(parsed, "storage-dir", "store-health requires --storage-dir <dir>");
    output(parsed, inspectStoreDirectory(path.resolve(storageDir)));
    return;
  }
  if (parsed.command === "diagnostics") {
    await runDiagnosticsCommand(parsed);
    return;
  }
  const runtime = createAgentRuntime({ storageDir: stringFlag(parsed, "storage-dir") });
  if (parsed.command === "agents") {
    const agents = await runtime.detect({ includeUnavailable: true });
    output(parsed, agents);
    return;
  }
  if (parsed.command === "doctor") {
    const agents = await runtime.detect({ includeUnavailable: true });
    output(parsed, {
      ok: agents.some((agent) => agent.available),
      agents,
    });
    return;
  }
  if (parsed.command === "smoke") {
    await runSmoke(parsed);
    return;
  }
  if (parsed.command === "runs") {
    output(parsed, await runtime.listRuns({ status: runStatusFlag(parsed) }));
    return;
  }
  if (parsed.command === "run-status") {
    const runId = parsed.positional[0];
    if (!runId) throw new Error("run-status requires a runId");
    output(parsed, await runtime.getRun(runId));
    return;
  }
  if (parsed.command === "replay-run" || parsed.command === "run-events") {
    const runId = parsed.positional[0];
    if (!runId) throw new Error(`${parsed.command} requires a runId`);
    outputReplay(parsed, await runtime.replayRunEvents(runId, { afterEventId: numberFlag(parsed, "after") }));
    return;
  }
  if (parsed.command === "goals") {
    output(parsed, await runtime.listGoals({ status: goalStatusFlag(parsed) }));
    return;
  }
  if (parsed.command === "goal-status") {
    const goalId = parsed.positional[0];
    if (!goalId) throw new Error("goal-status requires a goalId");
    output(parsed, await runtime.getGoal(goalId));
    return;
  }
  if (parsed.command === "replay-goal" || parsed.command === "goal-events") {
    const goalId = parsed.positional[0];
    if (!goalId) throw new Error(`${parsed.command} requires a goalId`);
    outputReplay(parsed, await runtime.replayGoalEvents(goalId, { afterEventId: numberFlag(parsed, "after") }));
    return;
  }
  if (parsed.command === "run") {
    const prompt = await promptFromFlags(parsed);
    const handle = await runtime.run({
      agentId: stringFlag(parsed, "agent") ?? "codex",
      cwd: path.resolve(stringFlag(parsed, "cwd") ?? "."),
      prompt,
      model: stringFlag(parsed, "model"),
      permissionPolicy: permissionFlag(parsed),
      timeoutMs: numberFlag(parsed, "timeout-ms"),
    });
    await streamRun(parsed, handle.events, "run_summary", () => runtime.getRun(handle.runId));
    return;
  }
  if (parsed.command === "goal") {
    const prompt = await promptFromFlags(parsed);
    const handle = await runtime.createGoal({
      defaultAgentId: stringFlag(parsed, "agent") ?? "codex",
      cwd: path.resolve(stringFlag(parsed, "cwd") ?? "."),
      objective: prompt,
      permissionPolicy: permissionFlag(parsed),
      timeoutMs: numberFlag(parsed, "timeout-ms"),
      maxConcurrentTasks: numberFlag(parsed, "max-concurrent-tasks"),
      retryPolicy: retryPolicyFromFlags(parsed),
    });
    await streamRun(parsed, handle.events, "goal_summary", () => runtime.getGoal(handle.goalId));
    return;
  }
  throw new Error(`Unknown command: ${parsed.command}`);
}

async function runDiagnosticsCommand(parsed: ParsedArgs): Promise<void> {
  const kind = parsed.positional[0];
  const id = parsed.positional[1];
  if (kind !== "run" && kind !== "goal") throw new Error("diagnostics requires run or goal");
  if (!id) throw new Error(`diagnostics ${kind} requires an id`);
  const storageDir = path.resolve(requiredStringFlag(parsed, "storage-dir", "diagnostics requires --storage-dir <dir>"));
  const bundle = kind === "run"
    ? exportDiagnosticsBundle({ kind, runId: id }, storageDir)
    : exportDiagnosticsBundle({ kind, goalId: id }, storageDir);
  const out = stringFlag(parsed, "out");
  if (out) {
    const outFile = path.resolve(out);
    await mkdir(path.dirname(outFile), { recursive: true });
    atomicWriteJsonFile(outFile, bundle);
  }
  output(parsed, bundle);
}

async function runSmoke(parsed: ParsedArgs): Promise<void> {
  const mode = stringFlag(parsed, "mode") ?? "detection";
  const agent = stringFlag(parsed, "agent") ?? "all";
  if (mode === "detection") {
    const runtime = createAgentRuntime({ storageDir: stringFlag(parsed, "storage-dir") });
    const agents = await runtime.detect({ includeUnavailable: true });
    output(parsed, {
      ok: agents.some((item) => item.available),
      mode,
      agents: agent === "all" ? agents : agents.filter((item) => item.id === agent),
    });
    return;
  }
  if (mode === "fixtures") {
    const fixtures = runParserFixtureCases(agent);
    output(parsed, {
      ok: fixtures.length > 0 && fixtures.every((fixture) => fixture.ok),
      mode,
      fixtures,
    });
    return;
  }
  if (mode === "real") {
    if (!parsed.flags.has("allow-real-run")) {
      throw new Error("smoke --mode real requires --allow-real-run");
    }
    if (agent === "all") throw new Error("smoke --mode real requires --agent <id>");
    const runtime = createAgentRuntime({ storageDir: stringFlag(parsed, "storage-dir") });
    const detected = (await runtime.detect({ includeUnavailable: true })).find((item) => item.id === agent);
    const preflight = realSmokePreflight(agent, detected);
    if (preflight) {
      output(parsed, preflight);
      return;
    }
    const cwdFlag = stringFlag(parsed, "cwd");
    const cwd = path.resolve(cwdFlag ?? await mkdtemp(path.join(os.tmpdir(), "agent-runtime-real-smoke-")));
    const prompt = await optionalPromptFromFlags(parsed) ?? `Reply exactly: agent-runtime ${agent} smoke ok. Do not edit files.`;
    const handle = await runtime.run({
      agentId: agent,
      cwd,
      prompt,
      permissionPolicy: "read-only",
      timeoutMs: numberFlag(parsed, "timeout-ms") ?? 30_000,
    });
    await streamRealSmoke(parsed, agent, cwd, cwdFlag === undefined, handle.events, () => runtime.getRun(handle.runId));
    return;
  }
  throw new Error("--mode must be one of: detection, fixtures, real");
}

function realSmokePreflight(agent: string, detected: DetectedAgent | undefined): unknown | null {
  if (!detected) {
    return {
      ok: false,
      mode: "real",
      agent,
      skipped: true,
      classification: "unavailable_executable",
      diagnostics: [{ code: "not_installed", message: `No adapter detection result for ${agent}` }],
    };
  }
  if (!detected.available) {
    return {
      ok: false,
      mode: "real",
      agent,
      skipped: true,
      classification: "unavailable_executable",
      detection: detected,
      diagnostics: detected.diagnostics,
    };
  }
  if (detected.authStatus === "missing" || detected.authStatus === "expired") {
    return {
      ok: false,
      mode: "real",
      agent,
      skipped: true,
      classification: "auth_missing",
      detection: detected,
      diagnostics: detected.diagnostics,
    };
  }
  return null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { command, positional, flags };
}

async function promptFromFlags(parsed: ParsedArgs): Promise<string> {
  const prompt = await optionalPromptFromFlags(parsed);
  if (prompt !== undefined) return prompt;
  throw new Error("--prompt or --prompt-file is required");
}

async function optionalPromptFromFlags(parsed: ParsedArgs): Promise<string | undefined> {
  const prompt = stringFlag(parsed, "prompt");
  if (prompt) return prompt;
  const promptFile = stringFlag(parsed, "prompt-file");
  if (promptFile) return readFile(path.resolve(promptFile), "utf8");
  return undefined;
}

async function streamRun(
  parsed: ParsedArgs,
  events: AsyncIterable<unknown>,
  summaryType: "run_summary" | "goal_summary",
  loadSummary: () => Promise<unknown>,
): Promise<void> {
  if (parsed.flags.get("stream") === "jsonl") {
    for await (const event of events) process.stdout.write(`${JSON.stringify(redactForCli(event))}\n`);
    if (parsed.flags.has("diagnostics")) {
      process.stdout.write(`${JSON.stringify(redactForCli({ type: summaryType, summary: await loadSummary() }))}\n`);
    }
    return;
  }
  let last: unknown = null;
  for await (const event of events) {
    last = event;
    if (parsed.flags.has("json")) continue;
    if (typeof event === "object" && event && "type" in event) {
      const typed = event as { type: string; text?: string; message?: string; result?: string };
      if (typed.type === "text_delta" && typed.text) process.stdout.write(typed.text);
      else if (typed.type.endsWith("finished")) process.stdout.write(`\n${typed.type}: ${typed.result ?? "done"}\n`);
      else if (typed.type === "error" && typed.message) process.stderr.write(`${redactText(typed.message)}\n`);
    }
  }
  if (parsed.flags.has("json")) output(parsed, (await loadSummary()) ?? last ?? {});
}

async function streamRealSmoke(
  parsed: ParsedArgs,
  agent: string,
  cwd: string,
  isolatedCwd: boolean,
  events: AsyncIterable<unknown>,
  loadRun: () => Promise<RunRecord | null>,
): Promise<void> {
  if (parsed.flags.get("stream") === "jsonl") {
    for await (const event of events) process.stdout.write(`${JSON.stringify(redactForCli(event))}\n`);
    if (parsed.flags.has("diagnostics")) {
      const run = await loadRun();
      process.stdout.write(`${JSON.stringify(redactForCli(realSmokeSummary(agent, cwd, isolatedCwd, run)))}\n`);
    }
    return;
  }
  let last: unknown = null;
  for await (const event of events) {
    last = event;
    if (parsed.flags.has("json")) continue;
    if (typeof event === "object" && event && "type" in event) {
      const typed = event as { type: string; text?: string; message?: string; result?: string };
      if (typed.type === "text_delta" && typed.text) process.stdout.write(typed.text);
      else if (typed.type.endsWith("finished")) process.stdout.write(`\n${typed.type}: ${typed.result ?? "done"}\n`);
      else if (typed.type === "error" && typed.message) process.stderr.write(`${redactText(typed.message)}\n`);
    }
  }
  const run = await loadRun();
  output(parsed, realSmokeSummary(agent, cwd, isolatedCwd, run ?? (last as RunRecord | null)));
}

function realSmokeSummary(agent: string, cwd: string, isolatedCwd: boolean, run: RunRecord | null): unknown {
  const classification = classifyRealSmokeRun(run);
  return {
    ok: run?.status === "succeeded",
    mode: "real",
    agent,
    cwd,
    isolatedCwd,
    classification,
    run,
    diagnostics: run?.diagnostics ?? [],
  };
}

function classifyRealSmokeRun(run: RunRecord | null): string {
  if (!run) return "missing_run_record";
  if (run.status === "succeeded") return "success";
  if (run.errorCode === "AGENT_TIMEOUT") return "timeout";
  if (run.errorCode === "AGENT_UNAVAILABLE" || run.errorCode === "AGENT_NOT_EXECUTABLE") return "unavailable_executable";
  if (run.diagnostics.some((diagnostic) => diagnostic.code === "unsupported_flag")) return "unsupported_flag";
  if (run.diagnostics.some((diagnostic) => diagnostic.code === "auth_missing" || diagnostic.code === "AGENT_AUTH_REQUIRED")) return "auth_missing";
  return run.errorCode ?? "failed";
}

function output(parsed: ParsedArgs, value: unknown): void {
  const safeValue = redactForCli(value);
  if (parsed.flags.has("json")) {
    process.stdout.write(`${JSON.stringify(safeValue, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(safeValue, null, 2)}\n`);
}

function outputReplay(parsed: ParsedArgs, events: unknown[]): void {
  if (parsed.flags.has("jsonl")) {
    for (const event of events) process.stdout.write(`${JSON.stringify(redactForCli(event))}\n`);
    return;
  }
  output(parsed, events);
}

function redactForCli(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactForCli(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactForCli(item)]));
}

function stringFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function requiredStringFlag(parsed: ParsedArgs, key: string, message: string): string {
  const value = stringFlag(parsed, key);
  if (!value) throw new Error(message);
  return value;
}

function numberFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = stringFlag(parsed, key);
  if (!value) return undefined;
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) throw new Error(`--${key} must be a number`);
  return parsedValue;
}

function permissionFlag(parsed: ParsedArgs) {
  return stringFlag(parsed, "permission") as never;
}

function retryPolicyFromFlags(parsed: ParsedArgs) {
  const maxAttempts = numberFlag(parsed, "max-attempts");
  const retryableErrorCodes = csvFlag(parsed, "retryable-error-codes");
  const backoffMs = numberFlag(parsed, "retry-backoff-ms");
  if (maxAttempts === undefined && retryableErrorCodes === undefined && backoffMs === undefined) return undefined;
  return { maxAttempts, retryableErrorCodes, backoffMs };
}

function csvFlag(parsed: ParsedArgs, key: string): string[] | undefined {
  const value = stringFlag(parsed, key);
  if (!value) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function runStatusFlag(parsed: ParsedArgs) {
  return enumFlag(parsed, "status", ["active", "queued", "running", "succeeded", "failed", "canceled"]) as never;
}

function goalStatusFlag(parsed: ParsedArgs) {
  return enumFlag(parsed, "status", ["active", "planning", "running", "succeeded", "failed", "canceled"]) as never;
}

function enumFlag(parsed: ParsedArgs, key: string, allowed: string[]): string | undefined {
  const value = stringFlag(parsed, key);
  if (!value) return undefined;
  if (!allowed.includes(value)) throw new Error(`--${key} must be one of: ${allowed.join(", ")}`);
  return value;
}

function printHelp(): void {
  process.stdout.write(`agent-runtime agents [--json] [--storage-dir <dir>]
agent-runtime doctor [--json] [--storage-dir <dir>]
agent-runtime smoke [--mode detection|fixtures|real] [--agent all|codex|claude|opencode] [--allow-real-run] [--cwd <dir>] [--prompt-file <file>] [--timeout-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime run --agent <id> --cwd <dir> (--prompt "..." | --prompt-file <file>) [--model <id>] [--permission <policy>] [--timeout-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime goal --agent <id> --cwd <dir> (--prompt "..." | --prompt-file <file>) [--permission <policy>] [--timeout-ms <ms>] [--max-concurrent-tasks <n>] [--max-attempts <n>] [--retryable-error-codes <codes>] [--retry-backoff-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime runs [--storage-dir <dir>] [--status active|queued|running|succeeded|failed|canceled] [--json]
agent-runtime run-status <runId> [--storage-dir <dir>] [--json]
agent-runtime replay-run <runId> [--storage-dir <dir>] [--after <eventId>] [--jsonl]
agent-runtime goals [--storage-dir <dir>] [--status active|planning|running|succeeded|failed|canceled] [--json]
agent-runtime goal-status <goalId> [--storage-dir <dir>] [--json]
agent-runtime replay-goal <goalId> [--storage-dir <dir>] [--after <eventId>] [--jsonl]
agent-runtime store-health --storage-dir <dir> [--json]
agent-runtime diagnostics run <runId> --storage-dir <dir> [--json] [--out <file>]
agent-runtime diagnostics goal <goalId> --storage-dir <dir> [--json] [--out <file>]
`);
}

main().catch((error) => {
  process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
