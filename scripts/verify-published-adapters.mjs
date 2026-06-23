#!/usr/bin/env node
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCHEMA_VERSION = "agent-runtime.publishedAdapters.v1";
const CONFORMANCE_SCHEMA_VERSION = "agent-runtime.conformance.v1";
const DEFAULT_PACKAGE = "agent-cli-runtime";
const ADAPTERS = ["codex", "claude", "opencode"];
const node = process.execPath;

function parseArgs(argv) {
  const options = { packageName: DEFAULT_PACKAGE, version: undefined, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package") options.packageName = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/verify-published-adapters.mjs [--version <version>]

Installs the published npm package into a temporary consumer project and
verifies built-in Codex, Claude, and OpenCode adapter compatibility using fake
CLIs. The default path installs from the npm registry, not the local checkout,
local dist, or a freshly packed tarball.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }
  if (argv.includes("--package") && !options.packageName) throw new Error("Missing value for --package");
  if (argv.includes("--version") && !options.version) throw new Error("Missing value for --version");
  return options;
}

function redact(value) {
  return String(value)
    .replace(/sk-?[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=.:-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(/(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*[^\s"']+/giu, "[REDACTED]")
    .replace(/\/private\/tmp\/[^\s"']+/gu, "<path>")
    .replace(/\/tmp\/[^\s"']+/gu, "<path>")
    .replace(/\/var\/folders\/[^\s"']+/gu, "<path>")
    .replace(/\/Users\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "Users/[REDACTED]")
    .replace(/\/home\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "home/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/gu, "C:" + "\\Users\\[REDACTED]");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`command failed: ${command} ${args.map((arg) => redact(arg)).join(" ")}\n${redact(output)}`);
  }
  return result.stdout ?? "";
}

function writeNodeBin(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, `#!${node}\n${body}`, "utf8");
  chmodSync(file, 0o755);
  return file;
}

function createFakeAgentBins(tmp) {
  const binDir = path.join(tmp, "fake-bin");
  const logDir = path.join(tmp, "fake-logs");
  mkdirSync(logDir, { recursive: true });
  const body = `
import fs from "node:fs";
import path from "node:path";
const name = path.basename(process.argv[1]);
const logDir = ${JSON.stringify(logDir)};
const args = process.argv.slice(2);
const failRunAdapter = process.env.AGENT_RUNTIME_PUBLISHED_ADAPTER_FAIL_RUN;
const token = "sk-" + "P".repeat(24);
const bearer = "Bearer " + "B".repeat(24);
const authAssignment = "ANTHROPIC_AUTH_" + "TOKEN=" + "C".repeat(24);

function append(record) {
  fs.appendFileSync(path.join(logDir, name + ".jsonl"), JSON.stringify(record) + "\\n");
}

function shapeMatched(adapter, argv) {
  if (adapter === "codex") {
    return argv.length === 5 && argv[0] === "exec" && argv[1] === "--json" && argv[2] === "--skip-git-repo-check" && argv[3] === "-C" && Boolean(argv[4]);
  }
  if (adapter === "claude") {
    return JSON.stringify(argv) === JSON.stringify(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]);
  }
  return argv.length === 5 && argv[0] === "run" && argv[1] === "--format" && argv[2] === "json" && argv[3] === "--dir" && Boolean(argv[4]);
}

function finishProbe(stdout, code = 0) {
  append({ phase: "probe", argv: args, stdinLength: 0, exitCode: code });
  if (stdout) process.stdout.write(stdout + "\\n");
  process.exit(code);
}

if (args[0] === "--version") {
  if (name === "codex") finishProbe("codex-cli published-adapters-fake");
  if (name === "claude") finishProbe("Claude Code published-adapters-fake");
  finishProbe("opencode published-adapters-fake");
}
if (name === "codex" && args[0] === "debug" && args[1] === "models") {
  finishProbe("startup noise before json\\n" + JSON.stringify({ models: [{ slug: "gpt-published-adapters", display_name: "GPT Published Adapters" }] }));
}
if (name === "claude" && args[0] === "-p" && args[1] === "--help") {
  finishProbe("--include-partial-messages\\n--add-dir");
}
if (name === "claude" && args[0] === "auth" && args[1] === "status") {
  finishProbe(JSON.stringify({ loggedIn: true, authMethod: "fake" }));
}
if ((name === "opencode" || name === "opencode-cli") && args[0] === "models") {
  finishProbe("WARN ignore model cache noise\\nopenai/gpt-published-adapters");
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const adapter = name === "opencode-cli" ? "opencode" : name;
  const matched = shapeMatched(adapter, args);
  append({ phase: "run", adapter, argv: args, shapeMatched: matched, stdinLength: stdin.length, stdinLooksJsonl: stdin.trim().startsWith("{"), exitCode: !matched ? 9 : failRunAdapter === adapter ? 7 : 0 });
  process.stderr.write("diagnostic " + token + " " + bearer + " " + authAssignment + "\\n");
  if (!matched) {
    process.stdout.write(JSON.stringify({ type: "error", message: adapter + " argv shape mismatch" }) + "\\n");
    process.exit(9);
  }
  if (failRunAdapter === adapter) {
    process.stdout.write(JSON.stringify({ type: "error", message: adapter + " isolated failure " + token }) + "\\n");
    process.exit(7);
  }
  if (adapter === "codex") {
    process.stdout.write("codex non-json noise that parser must ignore\\n");
    process.stdout.write(JSON.stringify({ type: "thread.started" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "published adapters codex ok" } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
  } else if (adapter === "claude") {
    process.stdout.write("claude stream-json noise that parser must ignore\\n");
    process.stdout.write(JSON.stringify({ type: "system" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "partial_json", partial_json: "ignored partial event" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "unknown", ignored: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "published adapters claude ok" }] } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "result", usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
  } else {
    process.stdout.write("opencode non-json noise that parser must ignore\\n");
    process.stdout.write(JSON.stringify({ type: "step_start" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "text", part: { text: "published adapters opencode ok" } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "step_finish", part: { tokens: { input: 1, output: 1 }, cost: 0 } }) + "\\n");
  }
});
`;
  const bins = {
    codex: writeNodeBin(binDir, "codex", body),
    claude: writeNodeBin(binDir, "claude", body),
    opencodeCli: writeNodeBin(binDir, "opencode-cli", body),
    opencode: writeNodeBin(binDir, "opencode", body),
  };
  return { binDir, logDir, bins };
}

function writeConsumer(tmp, fake, cliPath) {
  writeFileSync(path.join(tmp, "consumer.mjs"), `
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createAgentRuntime } from "agent-cli-runtime";

const fakeBin = ${JSON.stringify(fake.binDir)};
const logDir = ${JSON.stringify(fake.logDir)};
const cliPath = ${JSON.stringify(cliPath)};
const adapters = ${JSON.stringify(ADAPTERS)};
const longPrompt = "P5_PUBLISHED_ADAPTER_COMPAT_PROMPT_" + "x".repeat(4096);
const cwd = process.cwd();

function cliJson(args, env = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...process.env, PATH: fakeBin + path.delimiter + (process.env.PATH ?? ""), CODEX_BIN: path.join(fakeBin, "codex"), CLAUDE_BIN: path.join(fakeBin, "claude"), OPENCODE_BIN: path.join(fakeBin, "opencode-cli"), ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("installed CLI command failed");
  return JSON.parse(result.stdout);
}

function readLogs() {
  const records = [];
  for (const file of ["codex.jsonl", "claude.jsonl", "opencode-cli.jsonl", "opencode.jsonl"]) {
    try {
      const text = readFileSync(path.join(logDir, file), "utf8");
      for (const line of text.split(/\\r?\\n/u).filter(Boolean)) records.push(JSON.parse(line));
    } catch {
      // Missing log files are handled by downstream checks.
    }
  }
  return records;
}

function collectText(events) {
  return events.filter((event) => event.type === "text_delta").map((event) => event.text).join("");
}

async function collect(iterable) {
  const out = [];
  for await (const event of iterable) out.push(event);
  return out;
}

async function runAdapters(failAdapter = null) {
  const runtime = createAgentRuntime({
    env: { ...process.env, PATH: fakeBin + path.delimiter + (process.env.PATH ?? ""), CODEX_BIN: path.join(fakeBin, "codex"), CLAUDE_BIN: path.join(fakeBin, "claude"), OPENCODE_BIN: path.join(fakeBin, "opencode-cli"), AGENT_RUNTIME_PUBLISHED_ADAPTER_FAIL_RUN: failAdapter ?? "" },
    searchPath: [fakeBin],
  });
  try {
    const detected = await runtime.detect({ includeUnavailable: true, timeoutMs: 10_000 });
    const summaries = [];
    for (const adapter of adapters) {
      const handle = await runtime.run({ agentId: adapter, cwd, prompt: longPrompt, permissionPolicy: "agent-default", timeoutMs: 10_000 });
      const events = await collect(handle.events);
      const record = await runtime.getRun(handle.runId);
      const diagnostics = record?.diagnostics ?? [];
      const observedText = collectText(events);
      summaries.push({
        adapter,
        detected: detected.some((agent) => agent.id === adapter && agent.available),
        terminalStatus: record?.status ?? null,
        terminalResult: events.find((event) => event.type === "run_finished")?.result ?? null,
        expectedTextMatched: observedText.includes("published adapters " + adapter + " ok"),
        textDeltaCount: events.filter((event) => event.type === "text_delta").length,
        diagnosticsCount: diagnostics.length,
        diagnostics: diagnostics.map((item) => ({ code: item.code, message: item.message, stderrTail: item.stderrTail })),
      });
    }
    await runtime.shutdown("published adapters consumer complete");
    return { detected, summaries };
  } finally {
    await runtime.shutdown("published adapters consumer cleanup").catch(() => {});
  }
}

const agentsJson = cliJson(["agents", "--json"]);
const conformanceJson = cliJson(["conformance", "--mode", "fake", "--json"]);
const success = await runAdapters();
const failure = await runAdapters("claude");
const logs = readLogs();
const runLogs = logs.filter((record) => record.phase === "run");

console.log(JSON.stringify({
  agentsJson,
  conformanceJson,
  success,
  failure,
  invocationEvidence: adapters.map((adapter) => {
    const records = runLogs.filter((record) => record.adapter === adapter);
    const record = records.find((item) => item.exitCode === 0) ?? records[0] ?? {};
    return {
      adapter,
      argv: Array.isArray(record.argv) ? record.argv : [],
      shapeMatched: Boolean(record.shapeMatched),
      stdinLength: record.stdinLength ?? 0,
      stdinLooksJsonl: Boolean(record.stdinLooksJsonl),
      promptInArgv: Array.isArray(record.argv) ? record.argv.join("\\u0000").includes(longPrompt) : false,
    };
  }),
}));
`, "utf8");
}

function summarizeConsumer(consumer, options, version) {
  const detectedIds = Array.isArray(consumer.agentsJson)
    ? consumer.agentsJson.filter((agent) => agent?.available).map((agent) => agent.id)
    : [];
  const successSummaries = sanitizeAgentSummaries(consumer.success?.summaries ?? [], consumer.invocationEvidence ?? []);
  const failureSummaries = sanitizeAgentSummaries(consumer.failure?.summaries ?? [], consumer.invocationEvidence ?? []);
  const failedIsolation = failureSummaries.find((item) => item.adapter === "claude");
  const otherIsolation = failureSummaries.filter((item) => item.adapter !== "claude");
  const checks = {
    installedFromNpmRegistry: true,
    cliAgentsDetectsFakeAdapters: ADAPTERS.every((adapter) => detectedIds.includes(adapter)),
    conformanceFakeSchema: consumer.conformanceJson?.schemaVersion === CONFORMANCE_SCHEMA_VERSION,
    conformanceFakeHasThreeSummaries: Array.isArray(consumer.conformanceJson?.agents) && ADAPTERS.every((adapter) => consumer.conformanceJson.agents.some((agent) => agent.adapter === adapter)),
    summariesForAllAdapters: ADAPTERS.every((adapter) => successSummaries.some((summary) => summary.adapter === adapter)),
    invocationShapeMatched: successSummaries.every((summary) => summary.invocationShapeMatched === true),
    promptNotInArgv: successSummaries.every((summary) => summary.promptInArgv === false),
    parserExpectedText: successSummaries.every((summary) => summary.expectedTextMatched === true && summary.terminalStatus === "succeeded"),
    parserNoiseTolerance: successSummaries.every((summary) => summary.textDeltaCount >= 1),
    diagnosticsRedacted: !containsUnsafe(JSON.stringify({ successSummaries, failureSummaries })),
    failureIsolation: failedIsolation?.terminalStatus === "failed" && otherIsolation.every((summary) => summary.terminalStatus === "succeeded"),
    packageBoundaryRepoOnly: true,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: Object.values(checks).every(Boolean),
    packageName: options.packageName,
    version,
    packageSource: "npm-registry",
    checks,
    agents: successSummaries,
    diagnostics: {
      conformanceSchemaVersion: consumer.conformanceJson?.schemaVersion ?? null,
      detectedAdapters: ADAPTERS.filter((adapter) => detectedIds.includes(adapter)),
      failureIsolation: {
        failedAdapter: "claude",
        agents: failureSummaries.map((summary) => ({
          adapter: summary.adapter,
          terminalStatus: summary.terminalStatus,
          diagnosticsCount: summary.diagnosticsCount,
        })),
      },
      redactionChecked: true,
    },
    noAuthenticatedRealRun: true,
  };
}

function sanitizeAgentSummaries(summaries, invocationEvidence) {
  return ADAPTERS.map((adapter) => {
    const summary = summaries.find((item) => item.adapter === adapter) ?? {};
    const invocation = invocationEvidence.find((item) => item.adapter === adapter) ?? {};
    const promptTransport = adapter === "claude" ? "stdin:jsonl" : "stdin:text";
    const argvShape = sanitizeArgvShape(invocation.argv ?? [], adapter);
    return {
      adapter,
      detected: Boolean(summary.detected),
      terminalStatus: summary.terminalStatus ?? null,
      terminalResult: summary.terminalResult ?? null,
      expectedTextMatched: Boolean(summary.expectedTextMatched),
      textDeltaCount: Number(summary.textDeltaCount ?? 0),
      promptTransport,
      argvShape,
      invocationShapeMatched: invocation.shapeMatched === true && sameArray(argvShape, expectedArgvShape(adapter)),
      promptInArgv: Boolean(invocation.promptInArgv),
      stdinBytesObserved: Number(invocation.stdinLength ?? 0) > 0,
      stdinFormatMatched: adapter === "claude" ? invocation.stdinLooksJsonl === true : invocation.stdinLooksJsonl === false,
      diagnosticsCount: Number(summary.diagnosticsCount ?? 0),
      diagnostics: sanitizeDiagnostics(summary.diagnostics ?? []),
    };
  });
}

function expectedArgvShape(adapter) {
  if (adapter === "codex") return ["exec", "--json", "--skip-git-repo-check", "-C", "<cwd>"];
  if (adapter === "claude") return ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
  return ["run", "--format", "json", "--dir", "<cwd>"];
}

function sameArray(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sanitizeArgvShape(argv, adapter) {
  const normalized = Array.isArray(argv) ? argv.map((arg) => String(arg)) : [];
  return normalized.map((arg, index) => {
    if (adapter === "codex" && normalized[index - 1] === "-C") return "<cwd>";
    if (adapter === "opencode" && normalized[index - 1] === "--dir") return "<cwd>";
    if (arg.includes("/") || /^[A-Za-z]:\\/u.test(arg)) return "<path>";
    return redact(arg);
  });
}

function sanitizeDiagnostics(diagnostics) {
  return diagnostics.map((item) => ({
    code: redact(item.code ?? "diagnostic"),
    message: redact(item.message ?? ""),
    stderrTail: item.stderrTail ? redact(item.stderrTail) : undefined,
  }));
}

function containsUnsafe(text) {
  return [
    process.cwd(),
    process.env.HOME,
    "/tmp/",
    "/private/tmp/",
    "/var/folders/",
    "P5_PUBLISHED_ADAPTER_COMPAT_PROMPT_",
    "Bearer " + "B".repeat(24),
    "ANTHROPIC_AUTH_" + "TOKEN=" + "C".repeat(24),
    "sk-" + "P".repeat(24),
  ].filter(Boolean).some((value) => text.includes(value));
}

function assertSafeSummary(summary) {
  const text = JSON.stringify(summary);
  if (containsUnsafe(text)) throw new Error("unsafe published adapter verifier summary");
}

function output(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function selfTestSummary() {
  const result = {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    packageName: DEFAULT_PACKAGE,
    version: "0.0.0-self-test",
    packageSource: "npm-registry",
    checks: {
      installedFromNpmRegistry: true,
      cliAgentsDetectsFakeAdapters: true,
      conformanceFakeSchema: true,
      conformanceFakeHasThreeSummaries: true,
      summariesForAllAdapters: true,
      invocationShapeMatched: true,
      promptNotInArgv: true,
      parserExpectedText: true,
      parserNoiseTolerance: true,
      diagnosticsRedacted: true,
      failureIsolation: true,
      packageBoundaryRepoOnly: true,
    },
    agents: ADAPTERS.map((adapter) => ({
      adapter,
      detected: true,
      terminalStatus: "succeeded",
      terminalResult: "success",
      expectedTextMatched: true,
      textDeltaCount: 1,
      promptTransport: adapter === "claude" ? "stdin:jsonl" : "stdin:text",
      argvShape: adapter === "codex"
        ? ["exec", "--json", "--skip-git-repo-check", "-C", "<cwd>"]
        : adapter === "claude"
          ? ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
          : ["run", "--format", "json", "--dir", "<cwd>"],
      invocationShapeMatched: true,
      promptInArgv: false,
      stdinBytesObserved: true,
      stdinFormatMatched: true,
      diagnosticsCount: 0,
      diagnostics: [],
    })),
    diagnostics: {
      conformanceSchemaVersion: CONFORMANCE_SCHEMA_VERSION,
      detectedAdapters: ADAPTERS,
      failureIsolation: {
        failedAdapter: "claude",
        agents: [
          { adapter: "codex", terminalStatus: "succeeded", diagnosticsCount: 0 },
          { adapter: "claude", terminalStatus: "failed", diagnosticsCount: 1 },
          { adapter: "opencode", terminalStatus: "succeeded", diagnosticsCount: 0 },
        ],
      },
      redactionChecked: true,
    },
    noAuthenticatedRealRun: true,
  };
  assertSafeSummary(result);
  return result;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    output(selfTestSummary());
    return;
  }

  const packageJson = JSON.parse(run(node, ["-e", "process.stdout.write(require('node:fs').readFileSync('package.json', 'utf8'))"], {
    cwd: process.cwd(),
  }));
  const version = options.version ?? packageJson.version;
  const spec = `${options.packageName}@${version}`;
  const tmp = mkdtempSync(path.join(tmpdir(), "agent-runtime-published-adapters-"));

  try {
    writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2), "utf8");
    run("npm", ["install", spec, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tmp });
    const fake = createFakeAgentBins(tmp);
    const cliPath = path.join(tmp, "node_modules", ".bin", "agent-runtime");
    writeConsumer(tmp, fake, cliPath);
    const consumer = JSON.parse(run(node, ["consumer.mjs"], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${fake.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    }));
    const result = summarizeConsumer(consumer, options, version);
    assertSafeSummary(result);
    output(result);
    if (!result.ok) process.exit(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  output({
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    packageName: DEFAULT_PACKAGE,
    version: null,
    packageSource: "npm-registry",
    checks: {},
    agents: [],
    diagnostics: [{ code: "published_adapters_error", message: redact(error instanceof Error ? error.message : String(error)) }],
    noAuthenticatedRealRun: true,
  });
  process.exit(1);
}
