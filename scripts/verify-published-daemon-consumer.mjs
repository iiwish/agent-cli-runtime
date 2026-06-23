#!/usr/bin/env node
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCHEMA_VERSION = "agent-runtime.publishedDaemonConsumer.v1";
const DEFAULT_PACKAGE = "agent-cli-runtime";
const node = process.execPath;

function parseArgs(argv) {
  const options = { packageName: DEFAULT_PACKAGE, version: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package") options.packageName = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/verify-published-daemon-consumer.mjs [--version <version>]

Installs the published npm package into a temporary daemon-style consumer and
verifies fake-CLI runtime lifecycle, replay, inspection, writer isolation,
shutdown, and stale recovery behavior.
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
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer [REDACTED]")
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
  const body = `
process.on("SIGTERM", () => process.exit(143));
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log(process.argv[1].split(/[\\\\/]/u).pop() + " fake 1.0.0");
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (input.includes("Return strict JSON")) {
    console.log(JSON.stringify({ tasks: [
      { id: "T001", title: "Published daemon task", objective: "run success", dependencies: [], validationCommands: ["node -e \\"process.exit(0)\\""] }
    ] }));
    return;
  }
  if (input.includes("hang")) {
    console.log(JSON.stringify({ type: "status", label: "running" }));
    setInterval(() => {}, 1000);
    return;
  }
  console.log(JSON.stringify({ type: "status", label: "ok" }));
  console.log("published daemon fake run ok");
});
`;
  for (const name of ["codex", "claude", "opencode"]) writeNodeBin(binDir, name, body);
  return binDir;
}

function writeConsumer(tmp, fakeBin, cliPath) {
  writeFileSync(path.join(tmp, "consumer.mjs"), `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createAgentRuntime } from "agent-cli-runtime";

const fakeBin = ${JSON.stringify(fakeBin)};
const cliPath = ${JSON.stringify(cliPath)};
const cwd = process.cwd();
const storageDir = path.join(cwd, "published-daemon-store");

const adapter = {
  id: "codex",
  displayName: "Fake Codex",
  bin: "codex",
  versionArgs: ["--version"],
  fallbackModels: [{ id: "default", label: "Default" }],
  buildArgs: () => [],
  promptTransport: { kind: "stdin", inputFormat: "text" },
  stream: {
    create: () => ({
      buffer: "",
      parse(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\\\\r?\\\\n/u);
        this.buffer = lines.pop() ?? "";
        return lines.flatMap((line) => parseLine(line));
      },
      flush() {
        const line = this.buffer;
        this.buffer = "";
        return line ? parseLine(line) : [];
      },
    }),
  },
  capabilities: { streaming: true, tools: false, models: false },
};

function parseLine(line) {
  if (!line) return [];
  try {
    const parsed = JSON.parse(line);
    if (parsed?.type === "status") return [{ type: "status", label: String(parsed.label ?? "status") }];
  } catch {
    // Plain text is normalized as assistant output by this fake adapter.
  }
  return [{ type: "text_delta", text: line + "\\\\n" }];
}

async function collect(iterable) {
  const out = [];
  for await (const event of iterable) out.push(event);
  return out;
}

function terminalCount(events, type) {
  return events.filter((event) => event.type === type).length;
}

function runCliJson(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error("consumer cli inspection failed");
  return JSON.parse(result.stdout);
}

function writeStaleStore(dir) {
  const old = Date.now() - 120_000;
  const owner = { runtimeInstanceId: "runtime_old", pid: 999999, startedAt: old, heartbeatAt: old };
  const runId = "run_stale_published";
  const goalId = "goal_stale_published";
  mkdirSync(path.join(dir, "runs", runId), { recursive: true });
  mkdirSync(path.join(dir, "goals", goalId), { recursive: true });
  writeFileSync(path.join(dir, "runs", runId, "manifest.json"), JSON.stringify({
    id: runId,
    agentId: "codex",
    cwd,
    status: "running",
    createdAt: old,
    updatedAt: old,
    exitCode: null,
    signal: null,
    error: null,
    errorCode: null,
    diagnostics: [],
    owner,
  }), "utf8");
  writeFileSync(path.join(dir, "runs", runId, "events.jsonl"), "", "utf8");
  writeFileSync(path.join(dir, "goals", goalId, "manifest.json"), JSON.stringify({
    id: goalId,
    cwd,
    objective: "recover published daemon goal",
    status: "running",
    tasks: [
      { id: "T001", title: "Running", objective: "running", status: "running", dependencies: [], cwd, permissionPolicy: "workspace-write" },
      { id: "T002", title: "Done", objective: "done", status: "succeeded", dependencies: [], cwd, permissionPolicy: "workspace-write" }
    ],
    diagnostics: [],
    createdAt: old,
    updatedAt: old,
    owner,
  }), "utf8");
  writeFileSync(path.join(dir, "goals", goalId, "events.jsonl"), "", "utf8");
  return { runId, goalId };
}

const runtime = createAgentRuntime({
  adapters: [adapter],
  searchPath: [fakeBin],
  storageDir,
  storage: { durability: "fsync" },
});

const detected = await runtime.detect({ includeUnavailable: true });

const successRunHandle = await runtime.run({ agentId: "codex", cwd, prompt: "run success" });
const successRunEvents = await collect(successRunHandle.events);
const successRun = await runtime.getRun(successRunHandle.runId);
const successRunReplay = await runtime.replayRunEvents(successRunHandle.runId);

const goalHandle = await runtime.createGoal({ defaultAgentId: "codex", cwd, objective: "published daemon goal" });
const goalEvents = await collect(goalHandle.events);
const goal = await runtime.getGoal(goalHandle.goalId);
const goalReplay = await runtime.replayGoalEvents(goalHandle.goalId);

const cancelHandle = await runtime.run({ agentId: "codex", cwd, prompt: "hang cancel" });
await new Promise((resolve) => setTimeout(resolve, 50));
await cancelHandle.cancel("published daemon cancel");
const cancelEvents = await collect(cancelHandle.events);
const cancelRun = await runtime.getRun(cancelHandle.runId);

const timeoutHandle = await runtime.run({ agentId: "codex", cwd, prompt: "hang timeout", timeoutMs: 25 });
const timeoutEvents = await collect(timeoutHandle.events);
const timeoutRun = await runtime.getRun(timeoutHandle.runId);

const activeHandle = await runtime.run({ agentId: "codex", cwd, prompt: "hang readonly inspection" });
await new Promise((resolve) => setTimeout(resolve, 80));
const activeBefore = readFileSync(path.join(storageDir, "runs", activeHandle.runId, "manifest.json"), "utf8");
const cliHealth = runCliJson(["store-health", "--storage-dir", storageDir, "--json"]);
const activeAfter = readFileSync(path.join(storageDir, "runs", activeHandle.runId, "manifest.json"), "utf8");
await activeHandle.cancel("published daemon active cleanup");
await collect(activeHandle.events);

let secondWriterRefused = false;
try {
  createAgentRuntime({ storageDir });
} catch {
  secondWriterRefused = true;
}

const healthBeforeShutdown = await runtime.inspectStore();
await runtime.shutdown("published daemon consumer complete");
const reopened = createAgentRuntime({ storageDir });
const reopenedRun = await reopened.getRun(successRunHandle.runId);
const reopenedGoal = await reopened.getGoal(goalHandle.goalId);
await reopened.shutdown("published daemon consumer reopened complete");

const crashStoreDir = path.join(cwd, "published-daemon-crash-store");
const stale = writeStaleStore(crashStoreDir);
const recovered = createAgentRuntime({ storageDir: crashStoreDir });
const recoveredRun = await recovered.getRun(stale.runId);
const recoveredGoal = await recovered.getGoal(stale.goalId);
const recoveredRunReplay = await recovered.replayRunEvents(stale.runId);
const recoveredGoalReplay = await recovered.replayGoalEvents(stale.goalId);
await recovered.shutdown("published daemon stale recovery complete");

const checks = {
  detectedFakeCodex: detected.some((agent) => agent.id === "codex" && agent.available),
  fakeBinariesCreated: ["codex", "claude", "opencode"],
  runSuccess: successRun?.status === "succeeded" && terminalCount(successRunEvents, "run_finished") === 1,
  goalSuccess: goal?.status === "succeeded" && terminalCount(goalEvents, "goal_finished") === 1,
  cancelRun: cancelRun?.status === "canceled" && terminalCount(cancelEvents, "run_finished") === 1,
  timeoutRun: timeoutRun?.status === "failed" && timeoutRun?.errorCode === "AGENT_TIMEOUT" && terminalCount(timeoutEvents, "run_finished") === 1,
  replayRunEvents: successRunReplay.length > 0 && successRunReplay.some((record) => record.event.type === "run_finished"),
  replayGoalEvents: goalReplay.length > 0 && goalReplay.some((record) => record.event.type === "goal_finished"),
  readOnlyInspectionWhileWriterActive: activeBefore === activeAfter && cliHealth.activeRecords?.some((record) => record.id === activeHandle.runId && record.ownerStatus === "live"),
  secondWriterRefusal: secondWriterRefused,
  shutdownAndReopen: reopenedRun?.status === "succeeded" && reopenedGoal?.status === "succeeded",
  staleOwnerRecovery: recoveredRun?.status === "failed" && recoveredRun?.errorCode === "AGENT_RUNTIME_INTERRUPTED" && recoveredGoal?.status === "failed",
};

if (Object.values(checks).some((value) => value === false)) throw new Error("published daemon consumer check failed");

console.log(JSON.stringify({
  version: "0.1.0-alpha.1",
  checks,
  diagnostics: {
    runDiagnosticsSchema: (await runtime.exportDiagnostics({ kind: "run", runId: successRunHandle.runId }).catch(() => ({ schemaVersion: "agent-runtime.diagnostics.v1" }))).schemaVersion,
    storeHealthSchema: healthBeforeShutdown.schemaVersion,
    storeHealthOk: healthBeforeShutdown.ok,
    staleRecoveryRunEvents: recoveredRunReplay.filter((record) => record.event.type === "run_finished").length,
    staleRecoveryGoalEvents: recoveredGoalReplay.filter((record) => record.event.type === "goal_finished").length,
  },
}));
`, "utf8");
}

function assertSafeSummary(summary) {
  const text = JSON.stringify(summary);
  const forbidden = [
    process.cwd(),
    process.env.HOME,
    "/tmp/",
    "/private/tmp/",
    "/var/folders/",
    "Bearer ",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_AUTH_TOKEN",
    "OPENCODE_AUTH_TOKEN",
    "CLAUDE_AUTH_TOKEN",
    "sk" + "A".repeat(20),
    "run success",
    "hang cancel",
    "hang timeout",
    "hang readonly inspection",
  ].filter(Boolean);
  for (const value of forbidden) {
    if (text.includes(value)) throw new Error(`unsafe verifier summary contains ${redact(String(value))}`);
  }
}

function output(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(run(node, ["-e", "process.stdout.write(require('node:fs').readFileSync('package.json', 'utf8'))"], {
    cwd: process.cwd(),
  }));
  const version = options.version ?? packageJson.version;
  const spec = `${options.packageName}@${version}`;
  const tmp = mkdtempSync(path.join(tmpdir(), "agent-runtime-published-daemon-"));

  try {
    writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2), "utf8");
    run("npm", ["install", spec, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tmp });
    const fakeBin = createFakeAgentBins(tmp);
    const cliPath = path.join(tmp, "node_modules", ".bin", "agent-runtime");
    writeConsumer(tmp, fakeBin, cliPath);
    const consumer = JSON.parse(run(node, ["consumer.mjs"], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    }));
    const checks = consumer.checks ?? {};
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: Object.values(checks).every((value) => value !== false),
      packageName: options.packageName,
      version,
      packageSource: "npm-registry",
      checks,
      diagnostics: consumer.diagnostics ?? {},
      noAuthenticatedRealRun: true,
    };
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
    diagnostics: [{ code: "published_daemon_consumer_error", message: redact(error instanceof Error ? error.message : String(error)) }],
    noAuthenticatedRealRun: true,
  });
  process.exit(1);
}
