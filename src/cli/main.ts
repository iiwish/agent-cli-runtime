#!/usr/bin/env node
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentRuntime } from "../index.js";
import {
  diagnosticCodeFromEvent,
  envelopeReplayEvents,
  envelopeStreamEvent,
  type EventScope,
} from "../core/event-contract.js";
import { redactText } from "../core/redaction.js";
import { runParserFixtureCases } from "../smoke/parser-fixtures.js";
import { defaultAdapters } from "../adapters/registry.js";
import {
  atomicWriteJsonFile,
  exportDiagnosticsBundle,
  getStoredGoal,
  getStoredRun,
  inspectStoreDirectory,
  inspectStoreLock,
  inspectStoreRepair,
  inspectStoreRepairDryRun,
  listStoredGoals,
  listStoredRuns,
  replayStoredGoalEvents,
  replayStoredRunEvents,
} from "../storage/store-inspection.js";
import type { AgentAdapterDef, DetectedAgent, RuntimeDiagnostic, RunRecord } from "../index.js";

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

interface ConformanceAdapterSummary {
  adapter: string;
  version: string | null;
  resolvedExecutable: string | null;
  auth: DetectedAgent["authStatus"] | "not_checked";
  modelsSource: DetectedAgent["modelsSource"] | "fixtures" | "fake" | "none";
  capabilities: DetectedAgent["capabilities"] | null;
  argvProfile: {
    defaultArgs: string[];
    knownFlags: Array<{ flag: string; mapsTo: string; status: "known" | "needs_verification"; notes?: string }>;
    needsVerification: Array<{ mapsTo: string; flags?: string[]; notes: string }>;
  } | null;
  promptTransport: string | null;
  parserMode: string | null;
  runClassification: string;
  expectedTextMatched: boolean | null;
  observedTextTail: string | null;
  cwdMutated: boolean | null;
  diagnosticsCount: number;
  diagnostics: Array<Pick<RuntimeDiagnostic, "code" | "message" | "probe" | "actionableHints">>;
  skippedReason: string | null;
  failureReason: string | null;
}

interface ConformanceReport {
  schemaVersion: "agent-runtime.conformance.v1";
  ok: boolean;
  mode: "fixtures" | "fake" | "real";
  agents: ConformanceAdapterSummary[];
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
  if (parsed.command === "store-lock") {
    const storageDir = requiredStringFlag(parsed, "storage-dir", "store-lock requires --storage-dir <dir>");
    output(parsed, inspectStoreLock(path.resolve(storageDir)));
    return;
  }
  if (parsed.command === "store-repair") {
    const storageDir = requiredStringFlag(parsed, "storage-dir", "store-repair requires --storage-dir <dir>");
    if (parsed.flags.has("apply") && parsed.flags.has("dry-run")) throw new Error("store-repair accepts either --dry-run or --apply, not both");
    output(parsed, parsed.flags.has("apply")
      ? inspectStoreRepair(path.resolve(storageDir), { apply: true })
      : inspectStoreRepairDryRun(path.resolve(storageDir)));
    return;
  }
  if (parsed.command === "diagnostics") {
    await runDiagnosticsCommand(parsed);
    return;
  }
  if (isReadOnlyStoreCommand(parsed.command)) {
    runReadOnlyStoreCommand(parsed);
    return;
  }
  if (parsed.command === "smoke") {
    await runSmoke(parsed);
    return;
  }
  if (parsed.command === "conformance") {
    await runConformance(parsed);
    return;
  }
  const runtime = createAgentRuntime(runtimeOptionsFromFlags(parsed));
  try {
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
    await streamRun(parsed, handle.events, { kind: "run", id: handle.runId }, "run_summary", () => runtime.getRun(handle.runId));
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
    await streamRun(parsed, handle.events, { kind: "goal", id: handle.goalId }, "goal_summary", () => runtime.getGoal(handle.goalId));
    return;
  }
  throw new Error(`Unknown command: ${parsed.command}`);
  } finally {
    await runtime.shutdown("CLI command complete");
  }
}

function isReadOnlyStoreCommand(command: string): boolean {
  return command === "runs"
    || command === "run-status"
    || command === "replay-run"
    || command === "run-events"
    || command === "goals"
    || command === "goal-status"
    || command === "replay-goal"
    || command === "goal-events";
}

function runReadOnlyStoreCommand(parsed: ParsedArgs): void {
  const storageDirFlag = stringFlag(parsed, "storage-dir");
  const storageDir = storageDirFlag ? path.resolve(storageDirFlag) : undefined;
  if (parsed.command === "runs") {
    output(parsed, storageDir ? listStoredRuns(storageDir, { status: runStatusFlag(parsed) }) : []);
    return;
  }
  if (parsed.command === "run-status") {
    const runId = parsed.positional[0];
    if (!runId) throw new Error("run-status requires a runId");
    output(parsed, storageDir ? getStoredRun(storageDir, runId) : null);
    return;
  }
  if (parsed.command === "replay-run" || parsed.command === "run-events") {
    const runId = parsed.positional[0];
    if (!runId) throw new Error(`${parsed.command} requires a runId`);
    outputReplay(parsed, storageDir ? replayStoredRunEvents(storageDir, runId, numberFlag(parsed, "after")) : []);
    return;
  }
  if (parsed.command === "goals") {
    output(parsed, storageDir ? listStoredGoals(storageDir, { status: goalStatusFlag(parsed) }) : []);
    return;
  }
  if (parsed.command === "goal-status") {
    const goalId = parsed.positional[0];
    if (!goalId) throw new Error("goal-status requires a goalId");
    output(parsed, storageDir ? getStoredGoal(storageDir, goalId) : null);
    return;
  }
  if (parsed.command === "replay-goal" || parsed.command === "goal-events") {
    const goalId = parsed.positional[0];
    if (!goalId) throw new Error(`${parsed.command} requires a goalId`);
    outputReplay(parsed, storageDir ? replayStoredGoalEvents(storageDir, goalId, numberFlag(parsed, "after")) : []);
  }
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
    try {
      const agents = await runtime.detect({ includeUnavailable: true });
      output(parsed, {
        ok: agents.some((item) => item.available),
        mode,
        agents: agent === "all" ? agents : agents.filter((item) => item.id === agent),
      });
    } finally {
      await runtime.shutdown("CLI command complete");
    }
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
    try {
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
      await streamRealSmoke(parsed, agent, cwd, cwdFlag === undefined, expectation, beforeCwd, handle.events, { kind: "run", id: handle.runId }, () => runtime.getRun(handle.runId));
    } finally {
      await runtime.shutdown("CLI command complete");
    }
    return;
  }
  throw new Error("--mode must be one of: detection, fixtures, real");
}

async function runConformance(parsed: ParsedArgs): Promise<void> {
  const mode = (enumFlag(parsed, "mode", ["fixtures", "fake", "real"]) ?? "fixtures") as "fixtures" | "fake" | "real";
  const requestedAgent = stringFlag(parsed, "agent") ?? "all";
  const agents = selectedAgents(requestedAgent);
  const allowRealRun = parsed.flags.has("allow-real-run");
  if (mode === "fixtures") {
    const summaries = agents.map((agentId) => fixtureConformanceSummary(agentId));
    output(parsed, {
      schemaVersion: "agent-runtime.conformance.v1",
      ok: summaries.every((summary) => summary.runClassification === "success"),
      mode,
      agents: summaries,
    } satisfies ConformanceReport);
    return;
  }

  const fake = mode === "fake" ? await setupFakeConformanceEnv() : undefined;
  const runMode = mode as "fake" | "real";
  const runtime = createAgentRuntime(runtimeOptionsFromFlags(parsed, fake ? { env: fake.env, searchPath: [fake.binDir] } : undefined));
  try {
    const detected = await runtime.detect({ includeUnavailable: true, timeoutMs: mode === "fake" ? 10_000 : undefined });
    const summaries: ConformanceAdapterSummary[] = [];
    for (const agentId of agents) {
      const detection = detected.find((item) => item.id === agentId);
      summaries.push(await runAgentConformance(parsed, runtime, agentId, detection, runMode, allowRealRun));
    }
    output(parsed, {
      schemaVersion: "agent-runtime.conformance.v1",
      ok: conformanceOk(mode, requestedAgent, summaries, allowRealRun),
      mode,
      agents: summaries,
    } satisfies ConformanceReport);
  } finally {
    await runtime.shutdown("CLI command complete");
  }
}

function conformanceOk(mode: string, requestedAgent: string, summaries: ConformanceAdapterSummary[], allowRealRun: boolean): boolean {
  if (mode !== "real") return summaries.every((summary) => summary.runClassification === "success");
  if (!allowRealRun) return summaries.length > 0 && summaries.every((summary) => summary.failureReason === null);
  if (requestedAgent !== "all") return summaries.every((summary) => summary.runClassification === "success");
  const successCount = summaries.filter((summary) => summary.runClassification === "success").length;
  const failedRuns = summaries.filter((summary) => summary.skippedReason === null && summary.runClassification !== "success");
  return successCount > 0 && failedRuns.length === 0;
}

function selectedAgents(agent: string): Array<"codex" | "claude" | "opencode"> {
  const all: Array<"codex" | "claude" | "opencode"> = ["codex", "claude", "opencode"];
  if (agent === "all") return all;
  if (agent === "codex" || agent === "claude" || agent === "opencode") return [agent];
  throw new Error("--agent must be one of: codex, claude, opencode, all");
}

function fixtureConformanceSummary(agent: "codex" | "claude" | "opencode"): ConformanceAdapterSummary {
  const fixtures = runParserFixtureCases(agent);
  const ok = fixtures.length > 0 && fixtures.every((fixture) => fixture.ok);
  const adapter = defaultAdapters().find((item) => item.id === agent) ?? null;
  return {
    adapter: agent,
    version: null,
    resolvedExecutable: null,
    auth: "not_checked",
    modelsSource: "fixtures",
    capabilities: adapterCapabilities(adapter),
    argvProfile: adapterArgvProfile(adapter),
    promptTransport: adapterPromptTransport(adapter),
    parserMode: adapter?.compatibility?.streamFormat ?? null,
    runClassification: ok ? "success" : "parser_fixture_failed",
    expectedTextMatched: null,
    observedTextTail: null,
    cwdMutated: null,
    diagnosticsCount: fixtures.filter((fixture) => !fixture.ok).length,
    diagnostics: fixtures
      .filter((fixture) => !fixture.ok)
      .map((fixture) => ({
        code: "AGENT_STREAM_PARSE_FAILED",
        message: `${agent} parser fixture failed: ${fixture.name}`,
        actionableHints: ["Inspect parser fixture expectations before updating the adapter stream profile."],
      })),
    skippedReason: null,
    failureReason: ok ? null : "parser_fixture_failed",
  };
}

async function runAgentConformance(
  parsed: ParsedArgs,
  runtime: ReturnType<typeof createAgentRuntime>,
  agent: string,
  detected: DetectedAgent | undefined,
  mode: "fake" | "real",
  allowRealRun: boolean,
): Promise<ConformanceAdapterSummary> {
  const adapter = runtime.getAdapter(agent);
  const preflight = conformancePreflight(agent, detected, adapter, mode, allowRealRun);
  if (preflight) return preflight;
  const cwdFlag = stringFlag(parsed, "cwd");
  const cwd = path.resolve(cwdFlag ?? await mkdtemp(path.join(os.tmpdir(), `agent-runtime-${mode}-conformance-`)));
  const expectation = await realSmokeExpectation(parsed, agent);
  const beforeCwd = await snapshotCwd(cwd);
  const handle = await runtime.run({
    agentId: agent,
    cwd,
    prompt: expectation.prompt,
    permissionPolicy: "read-only",
    timeoutMs: numberFlag(parsed, "timeout-ms") ?? 30_000,
  });
  const evidence: RealSmokeEvidence = {
    observedText: "",
    textDeltaCount: 0,
    expectedText: expectation.expectedText,
    expectedTextRequired: expectation.expectedTextRequired,
  };
  for await (const event of handle.events) collectRealSmokeEvidence(evidence, event);
  const run = await runtime.getRun(handle.runId);
  const mutation = await cwdMutationEvidence(cwd, beforeCwd);
  const expectedTextMatched = evidence.expectedText ? evidence.observedText.includes(evidence.expectedText) : null;
  const classification = classifyRealSmokeRun(run, {
    hasObservedText: evidence.observedText.trim().length > 0,
    expectedTextMatched,
    expectedTextRequired: evidence.expectedTextRequired,
    cwdMutated: mutation.cwdMutated,
  });
  const failureReason = classification === "success" ? null : classification;
  return {
    adapter: agent,
    version: detected?.version ?? null,
    resolvedExecutable: detected?.path ?? null,
    auth: detected?.authStatus ?? "unknown",
    modelsSource: detected?.modelsSource ?? "none",
    capabilities: detected?.capabilities ?? adapterCapabilities(adapter),
    argvProfile: adapterArgvProfile(adapter),
    promptTransport: adapterPromptTransport(adapter),
    parserMode: adapter?.compatibility?.streamFormat ?? null,
    runClassification: classification,
    expectedTextMatched,
    observedTextTail: failureReason ? tailText(evidence.observedText, DEFAULT_OBSERVED_TEXT_TAIL_BYTES) : null,
    cwdMutated: mutation.cwdMutated,
    diagnosticsCount: (detected?.diagnostics.length ?? 0) + (run?.diagnostics.length ?? 0),
    diagnostics: compactDiagnostics([...(detected?.diagnostics ?? []), ...(run?.diagnostics ?? [])]),
    skippedReason: null,
    failureReason,
  };
}

function conformancePreflight(
  agent: string,
  detected: DetectedAgent | undefined,
  adapter: AgentAdapterDef | null,
  mode: "fake" | "real",
  allowRealRun: boolean,
): ConformanceAdapterSummary | null {
  if (!detected) {
    return skippedConformance(agent, "unavailable_executable", "no_detection_result", 1, undefined, adapter);
  }
  if (!detected.available) {
    return skippedConformance(agent, "unavailable_executable", "unavailable_executable", detected.diagnostics.length, detected, adapter);
  }
  if (detected.authStatus === "missing" || detected.authStatus === "expired") {
    return skippedConformance(agent, "auth_missing", "auth_missing", detected.diagnostics.length, detected, adapter);
  }
  if (detected.diagnostics.some((item) => item.code === "unsupported_flag")) {
    return skippedConformance(agent, "unsupported_flag", "unsupported_flag", detected.diagnostics.length, detected, adapter);
  }
  if (mode === "real" && !allowRealRun) {
    return skippedConformance(agent, "real_run_skipped", "real_run_not_allowed", detected.diagnostics.length, detected, adapter);
  }
  return null;
}

function skippedConformance(
  agent: string,
  classification: string,
  reason: string,
  diagnosticsCount: number,
  detected?: DetectedAgent,
  adapter?: AgentAdapterDef | null,
): ConformanceAdapterSummary {
  return {
    adapter: agent,
    version: detected?.version ?? null,
    resolvedExecutable: detected?.path ?? null,
    auth: detected?.authStatus ?? "unknown",
    modelsSource: detected?.modelsSource ?? "none",
    capabilities: detected?.capabilities ?? adapterCapabilities(adapter ?? null),
    argvProfile: adapterArgvProfile(adapter ?? null),
    promptTransport: adapterPromptTransport(adapter ?? null),
    parserMode: adapter?.compatibility?.streamFormat ?? null,
    runClassification: classification,
    expectedTextMatched: null,
    observedTextTail: null,
    cwdMutated: null,
    diagnosticsCount,
    diagnostics: compactDiagnostics(detected?.diagnostics ?? (diagnosticsCount > 0 ? [{
      code: "not_installed",
      message: `No adapter detection result for ${agent}`,
      actionableHints: ["Verify the requested adapter id and executable configuration."],
    }] : [])),
    skippedReason: reason,
    failureReason: null,
  };
}

function adapterCapabilities(adapter: AgentAdapterDef | null): DetectedAgent["capabilities"] | null {
  if (!adapter) return null;
  return {
    streaming: adapter.capabilities?.streaming ?? true,
    tools: adapter.capabilities?.tools ?? false,
    models: adapter.capabilities?.models ?? Boolean(adapter.listModels),
    authProbe: Boolean(adapter.authProbe),
    prompt: [adapter.promptTransport.kind],
  };
}

function adapterArgvProfile(adapter: AgentAdapterDef | null): ConformanceAdapterSummary["argvProfile"] {
  if (!adapter?.compatibility) return null;
  return {
    defaultArgs: adapter.compatibility.defaultArgs,
    knownFlags: adapter.compatibility.knownFlags.map((flag) => ({
      flag: flag.flag,
      mapsTo: flag.mapsTo,
      status: flag.needsVerification ? "needs_verification" : "known",
      notes: flag.notes,
    })),
    needsVerification: adapter.compatibility.needsVerification ?? [],
  };
}

function adapterPromptTransport(adapter: AgentAdapterDef | null): string | null {
  if (!adapter) return null;
  if (adapter.compatibility?.promptTransport) return adapter.compatibility.promptTransport;
  const format = adapter.promptTransport.kind === "stdin" && adapter.promptTransport.inputFormat ? `:${adapter.promptTransport.inputFormat}` : "";
  return `${adapter.promptTransport.kind}${format}`;
}

function compactDiagnostics(diagnostics: RuntimeDiagnostic[]): ConformanceAdapterSummary["diagnostics"] {
  return diagnostics.map((item) => ({
    code: item.code,
    message: item.message,
    probe: item.probe,
    actionableHints: item.actionableHints,
  }));
}

async function setupFakeConformanceEnv(): Promise<{ binDir: string; env: NodeJS.ProcessEnv }> {
  const binDir = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-conformance-bin-"));
  await writeFakeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli fake-conformance"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-fake", display_name: "GPT Fake" }] })); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
});
`);
  await writeFakeExecutable(binDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Claude Code fake-conformance"); process.exit(0); }
if (args[0] === "-p" && args[1] === "--help") { console.log("--include-partial-messages\\n--add-dir"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") { console.log(JSON.stringify({ loggedIn: true, authMethod: "fake", apiProvider: "anthropic-compatible" })); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "system" }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "agent-runtime claude smoke ok" }] } }));
});
`);
  await writeFakeExecutable(binDir, "opencode", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("opencode fake-conformance"); process.exit(0); }
if (args[0] === "models") { console.log("openai/gpt-fake"); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "step_start" }));
  console.log(JSON.stringify({ type: "text", part: { text: "agent-runtime opencode smoke ok" } }));
});
`);
  return {
    binDir,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      CODEX_BIN: path.join(binDir, "codex"),
      CLAUDE_BIN: path.join(binDir, "claude"),
      OPENCODE_BIN: path.join(binDir, "opencode"),
    },
  };
}

async function writeFakeExecutable(binDir: string, name: string, body: string): Promise<void> {
  const file = path.join(binDir, name);
  await writeFile(file, `#!${process.execPath}\n${body}`, "utf8");
  await chmod(file, 0o755);
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
  scope: EventScope,
  summaryType: "run_summary" | "goal_summary",
  loadSummary: () => Promise<unknown>,
): Promise<void> {
  if (parsed.flags.get("stream") === "jsonl") {
    let sequence = 1;
    let diagnosticCode: string | undefined;
    for await (const event of events) {
      diagnosticCode = diagnosticCodeFromEvent(event) ?? diagnosticCode;
      process.stdout.write(`${JSON.stringify(redactForCli(envelopeStreamEvent(event, scope, sequence, diagnosticCode)))}\n`);
      sequence += 1;
    }
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
  scope: EventScope,
  loadRun: () => Promise<RunRecord | null>,
): Promise<void> {
  const evidence: RealSmokeEvidence = {
    observedText: "",
    textDeltaCount: 0,
    expectedText: expectation.expectedText,
    expectedTextRequired: expectation.expectedTextRequired,
  };
  if (parsed.flags.get("stream") === "jsonl") {
    let sequence = 1;
    let diagnosticCode: string | undefined;
    for await (const event of events) {
      collectRealSmokeEvidence(evidence, event);
      diagnosticCode = diagnosticCodeFromEvent(event) ?? diagnosticCode;
      process.stdout.write(`${JSON.stringify(redactForCli(envelopeStreamEvent(event, scope, sequence, diagnosticCode)))}\n`);
      sequence += 1;
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
    for (const event of envelopeReplayEvents(events as never[])) process.stdout.write(`${JSON.stringify(redactForCli(event))}\n`);
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

function runtimeOptionsFromFlags(parsed: ParsedArgs, override?: { env?: NodeJS.ProcessEnv; searchPath?: string[] }) {
  const durability = enumFlag(parsed, "storage-durability", ["relaxed", "fsync"]) as "relaxed" | "fsync" | undefined;
  return {
    env: override?.env,
    searchPath: override?.searchPath,
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
agent-runtime conformance [--mode fixtures|fake|real] [--agent all|codex|claude|opencode] [--allow-real-run] [--cwd <dir>] [--prompt <text>] [--prompt-file <file>] [--expect-text <text>] [--timeout-ms <ms>] [--json] [--storage-dir <dir>]
agent-runtime run --agent <id> --cwd <dir> (--prompt "..." | --prompt-file <file>) [--model <id>] [--permission <policy>] [--timeout-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime goal --agent <id> --cwd <dir> (--prompt "..." | --prompt-file <file>) [--permission <policy>] [--timeout-ms <ms>] [--max-concurrent-tasks <n>] [--max-attempts <n>] [--retryable-error-codes <codes>] [--retry-backoff-ms <ms>] [--json] [--stream jsonl] [--diagnostics] [--storage-dir <dir>]
agent-runtime runs [--storage-dir <dir>] [--status active|queued|running|succeeded|failed|canceled] [--json]
agent-runtime run-status <runId> [--storage-dir <dir>] [--json]
agent-runtime replay-run <runId> [--storage-dir <dir>] [--after <eventId>] [--jsonl]
agent-runtime goals [--storage-dir <dir>] [--status active|planning|running|succeeded|failed|canceled] [--json]
agent-runtime goal-status <goalId> [--storage-dir <dir>] [--json]
agent-runtime replay-goal <goalId> [--storage-dir <dir>] [--after <eventId>] [--jsonl]
agent-runtime store-health --storage-dir <dir> [--json]
agent-runtime store-lock --storage-dir <dir> [--json]
agent-runtime store-repair --storage-dir <dir> [--dry-run | --apply] [--json]
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
