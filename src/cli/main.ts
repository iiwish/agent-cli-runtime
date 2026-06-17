#!/usr/bin/env node
import { lstat, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentRuntime } from "../index.js";
import { redactText } from "../core/redaction.js";
import { runParserFixtureCases } from "../smoke/parser-fixtures.js";
import { atomicWriteJsonFile, exportDiagnosticsBundle, inspectStoreDirectory, inspectStoreRepairDryRun } from "../storage/store-inspection.js";
import type { DetectedAgent, RunRecord } from "../index.js";

const DEFAULT_OBSERVED_TEXT_TAIL_BYTES = 2_048;
const MAX_CWD_SCAN_ENTRIES = 1_000;
const MAX_CWD_MUTATION_SAMPLE = 20;
const SKIPPED_CWD_SCAN_DIRS = new Set([".git", "node_modules", "dist", ".agent-runtime"]);

interface RealSmokeExpectation {
  prompt: string;
  expectedText?: string;
  expectedTextRequired: boolean;
}

interface RealSmokeEvidence {
  observedText: string;
  textDeltaCount: number;
  expectedText?: string;
  expectedTextRequired: boolean;
}

interface CwdSnapshot {
  checked: boolean;
  entries: Map<string, string>;
  entryCount: number;
  limitReached: boolean;
  error?: string;
}

interface CwdMutationEvidence {
  cwdMutationChecked: boolean;
  cwdMutated: boolean;
  cwdMutationCount: number;
  cwdMutationSample: Array<{ path: string; action: "created" | "updated" | "deleted" }>;
  cwdMutationLimitReached?: boolean;
  cwdMutationError?: string;
}

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
  if (parsed.command === "store-repair") {
    const storageDir = requiredStringFlag(parsed, "storage-dir", "store-repair requires --storage-dir <dir>");
    if (parsed.flags.has("apply")) throw new Error("store-repair --apply is not implemented; run --dry-run to inspect repair actions");
    if (!parsed.flags.has("dry-run")) throw new Error("store-repair requires --dry-run unless --apply is implemented");
    output(parsed, inspectStoreRepairDryRun(path.resolve(storageDir)));
    return;
  }
  if (parsed.command === "diagnostics") {
    await runDiagnosticsCommand(parsed);
    return;
  }
  const runtime = createAgentRuntime(runtimeOptionsFromFlags(parsed));
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
    const runtime = createAgentRuntime(runtimeOptionsFromFlags(parsed));
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
    const runtime = createAgentRuntime(runtimeOptionsFromFlags(parsed));
    const detected = (await runtime.detect({ includeUnavailable: true })).find((item) => item.id === agent);
    const preflight = realSmokePreflight(agent, detected);
    if (preflight) {
      output(parsed, preflight);
      return;
    }
    const cwdFlag = stringFlag(parsed, "cwd");
    const cwd = path.resolve(cwdFlag ?? await mkdtemp(path.join(os.tmpdir(), "agent-runtime-real-smoke-")));
    const expectation = await realSmokeExpectation(parsed, agent);
    const beforeCwd = await snapshotCwd(cwd);
    const handle = await runtime.run({
      agentId: agent,
      cwd,
      prompt: expectation.prompt,
      permissionPolicy: "read-only",
      timeoutMs: numberFlag(parsed, "timeout-ms") ?? 30_000,
    });
    await streamRealSmoke(parsed, agent, cwd, cwdFlag === undefined, expectation, beforeCwd, handle.events, () => runtime.getRun(handle.runId));
    return;
  }
  throw new Error("--mode must be one of: detection, fixtures, real");
}

async function realSmokeExpectation(parsed: ParsedArgs, agent: string): Promise<RealSmokeExpectation> {
  const explicitPrompt = parsed.flags.has("prompt") || parsed.flags.has("prompt-file");
  const prompt = await optionalPromptFromFlags(parsed) ?? defaultRealSmokePrompt(agent);
  const expectText = stringFlag(parsed, "expect-text");
  if (expectText !== undefined) return { prompt, expectedText: expectText, expectedTextRequired: true };
  if (explicitPrompt) return { prompt, expectedTextRequired: false };
  return { prompt, expectedText: defaultRealSmokeExpectedText(agent), expectedTextRequired: true };
}

function defaultRealSmokePrompt(agent: string): string {
  return `Reply exactly: ${defaultRealSmokeExpectedText(agent)}. Do not edit files.`;
}

function defaultRealSmokeExpectedText(agent: string): string {
  return `agent-runtime ${agent} smoke ok`;
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
  expectation: RealSmokeExpectation,
  beforeCwd: CwdSnapshot,
  events: AsyncIterable<unknown>,
  loadRun: () => Promise<RunRecord | null>,
): Promise<void> {
  const evidence: RealSmokeEvidence = {
    observedText: "",
    textDeltaCount: 0,
    expectedText: expectation.expectedText,
    expectedTextRequired: expectation.expectedTextRequired,
  };
  if (parsed.flags.get("stream") === "jsonl") {
    for await (const event of events) {
      collectRealSmokeEvidence(evidence, event);
      process.stdout.write(`${JSON.stringify(redactForCli(event))}\n`);
    }
    if (parsed.flags.has("diagnostics")) {
      const run = await loadRun();
      const mutation = await cwdMutationEvidence(cwd, beforeCwd);
      process.stdout.write(`${JSON.stringify(redactForCli(realSmokeSummary(agent, cwd, isolatedCwd, run, evidence, mutation)))}\n`);
    }
    return;
  }
  let last: unknown = null;
  for await (const event of events) {
    last = event;
    collectRealSmokeEvidence(evidence, event);
    if (parsed.flags.has("json")) continue;
    if (typeof event === "object" && event && "type" in event) {
      const typed = event as { type: string; text?: string; message?: string; result?: string };
      if (typed.type === "text_delta" && typed.text) process.stdout.write(typed.text);
      else if (typed.type.endsWith("finished")) process.stdout.write(`\n${typed.type}: ${typed.result ?? "done"}\n`);
      else if (typed.type === "error" && typed.message) process.stderr.write(`${redactText(typed.message)}\n`);
    }
  }
  const run = await loadRun();
  const mutation = await cwdMutationEvidence(cwd, beforeCwd);
  output(parsed, realSmokeSummary(agent, cwd, isolatedCwd, run ?? (last as RunRecord | null), evidence, mutation));
}

function collectRealSmokeEvidence(evidence: RealSmokeEvidence, event: unknown): void {
  if (!event || typeof event !== "object" || !("type" in event)) return;
  const typed = event as { type?: unknown; text?: unknown };
  if (typed.type !== "text_delta" || typeof typed.text !== "string") return;
  evidence.observedText += typed.text;
  evidence.textDeltaCount += 1;
}

function realSmokeSummary(
  agent: string,
  cwd: string,
  isolatedCwd: boolean,
  run: RunRecord | null,
  evidence: RealSmokeEvidence,
  mutation: CwdMutationEvidence,
): unknown {
  const expectedTextMatched = evidence.expectedText ? evidence.observedText.includes(evidence.expectedText) : null;
  const hasObservedText = evidence.observedText.trim().length > 0;
  const classification = classifyRealSmokeRun(run, {
    hasObservedText,
    expectedTextMatched,
    expectedTextRequired: evidence.expectedTextRequired,
    cwdMutated: mutation.cwdMutated,
  });
  return {
    type: "real_smoke_summary",
    ok: classification === "success",
    mode: "real",
    agent,
    cwd: isolatedCwd ? "<isolated-cwd>" : "<cwd>",
    isolatedCwd,
    expectedText: evidence.expectedText,
    expectedTextRequired: evidence.expectedTextRequired,
    expectedTextMatched,
    observedTextDeltaCount: evidence.textDeltaCount,
    observedTextTail: tailText(evidence.observedText, DEFAULT_OBSERVED_TEXT_TAIL_BYTES),
    ...mutation,
    classification,
    run,
    diagnostics: run?.diagnostics ?? [],
  };
}

function classifyRealSmokeRun(
  run: RunRecord | null,
  evidence?: {
    hasObservedText: boolean;
    expectedTextMatched: boolean | null;
    expectedTextRequired: boolean;
    cwdMutated: boolean;
  },
): string {
  if (!run) return "missing_run_record";
  if (run.status === "succeeded") {
    if (evidence?.cwdMutated) return "cwd_mutated";
    if (!evidence?.hasObservedText) return "unexpected_output";
    if (evidence.expectedTextRequired && !evidence.expectedTextMatched) return "unexpected_output";
    return "success";
  }
  if (run.errorCode === "AGENT_TIMEOUT") return "timeout";
  if (run.errorCode === "AGENT_UNAVAILABLE" || run.errorCode === "AGENT_NOT_EXECUTABLE") return "unavailable_executable";
  if (run.diagnostics.some((diagnostic) => diagnostic.code === "unsupported_flag")) return "unsupported_flag";
  if (run.diagnostics.some((diagnostic) => diagnostic.code === "auth_missing" || diagnostic.code === "AGENT_AUTH_REQUIRED")) return "auth_missing";
  return run.errorCode ?? "failed";
}

async function snapshotCwd(cwd: string): Promise<CwdSnapshot> {
  const entries = new Map<string, string>();
  try {
    let entryCount = 0;
    let limitReached = false;
    async function visit(dir: string): Promise<void> {
      if (limitReached) return;
      const dirents = await readdir(dir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (limitReached) return;
        if (dirent.isDirectory() && SKIPPED_CWD_SCAN_DIRS.has(dirent.name)) continue;
        const absolute = path.join(dir, dirent.name);
        const relative = path.relative(cwd, absolute);
        entryCount += 1;
        if (entryCount > MAX_CWD_SCAN_ENTRIES) {
          limitReached = true;
          return;
        }
        const stats = await lstat(absolute);
        entries.set(relative, `${entryKind(stats)}:${stats.size}:${Math.trunc(stats.mtimeMs)}`);
        if (dirent.isDirectory()) await visit(absolute);
      }
    }
    await visit(cwd);
    return { checked: true, entries, entryCount: Math.min(entryCount, MAX_CWD_SCAN_ENTRIES), limitReached };
  } catch (error) {
    return {
      checked: true,
      entries,
      entryCount: entries.size,
      limitReached: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function cwdMutationEvidence(cwd: string, before: CwdSnapshot): Promise<CwdMutationEvidence> {
  const after = await snapshotCwd(cwd);
  if (!before.checked || !after.checked) {
    return {
      cwdMutationChecked: false,
      cwdMutated: false,
      cwdMutationCount: 0,
      cwdMutationSample: [],
    };
  }
  const mutations: Array<{ path: string; action: "created" | "updated" | "deleted" }> = [];
  for (const [entryPath, signature] of after.entries) {
    const beforeSignature = before.entries.get(entryPath);
    if (beforeSignature === undefined) mutations.push({ path: sanitizeRelativePath(entryPath), action: "created" });
    else if (beforeSignature !== signature) mutations.push({ path: sanitizeRelativePath(entryPath), action: "updated" });
  }
  for (const entryPath of before.entries.keys()) {
    if (!after.entries.has(entryPath)) mutations.push({ path: sanitizeRelativePath(entryPath), action: "deleted" });
  }
  mutations.sort((left, right) => left.path.localeCompare(right.path) || left.action.localeCompare(right.action));
  const error = before.error ?? after.error;
  return {
    cwdMutationChecked: true,
    cwdMutated: mutations.length > 0,
    cwdMutationCount: mutations.length,
    cwdMutationSample: mutations.slice(0, MAX_CWD_MUTATION_SAMPLE),
    cwdMutationLimitReached: before.limitReached || after.limitReached || undefined,
    cwdMutationError: error ? redactText(error) : undefined,
  };
}

function entryKind(stats: Awaited<ReturnType<typeof lstat>>): string {
  if (stats.isDirectory()) return "dir";
  if (stats.isFile()) return "file";
  if (stats.isSymbolicLink()) return "symlink";
  return "other";
}

function sanitizeRelativePath(value: string): string {
  return redactText(value.split(path.sep).join("/"));
}

function tailText(value: string, max: number): string {
  return value.length > max ? value.slice(value.length - max) : value;
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

function runtimeOptionsFromFlags(parsed: ParsedArgs) {
  const durability = enumFlag(parsed, "storage-durability", ["relaxed", "fsync"]) as "relaxed" | "fsync" | undefined;
  return {
    storageDir: stringFlag(parsed, "storage-dir"),
    storage: durability ? { durability } : undefined,
  };
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
agent-runtime smoke [--mode detection|fixtures|real] [--agent all|codex|claude|opencode] [--allow-real-run] [--cwd <dir>] [--prompt <text>] [--prompt-file <file>] [--expect-text <text>] [--timeout-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime run --agent <id> --cwd <dir> (--prompt "..." | --prompt-file <file>) [--model <id>] [--permission <policy>] [--timeout-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime goal --agent <id> --cwd <dir> (--prompt "..." | --prompt-file <file>) [--permission <policy>] [--timeout-ms <ms>] [--max-concurrent-tasks <n>] [--max-attempts <n>] [--retryable-error-codes <codes>] [--retry-backoff-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime runs [--storage-dir <dir>] [--status active|queued|running|succeeded|failed|canceled] [--json]
agent-runtime run-status <runId> [--storage-dir <dir>] [--json]
agent-runtime replay-run <runId> [--storage-dir <dir>] [--after <eventId>] [--jsonl]
agent-runtime goals [--storage-dir <dir>] [--status active|planning|running|succeeded|failed|canceled] [--json]
agent-runtime goal-status <goalId> [--storage-dir <dir>] [--json]
agent-runtime replay-goal <goalId> [--storage-dir <dir>] [--after <eventId>] [--jsonl]
agent-runtime store-health --storage-dir <dir> [--json]
agent-runtime store-repair --storage-dir <dir> --dry-run [--json]
agent-runtime diagnostics run <runId> --storage-dir <dir> [--json] [--out <file>]
agent-runtime diagnostics goal <goalId> --storage-dir <dir> [--json] [--out <file>]

Storage durability:
  --storage-durability relaxed|fsync
`);
}

main().catch((error) => {
  process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
