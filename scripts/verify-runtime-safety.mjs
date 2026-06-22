#!/usr/bin/env node
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const node = process.execPath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`command failed: ${command} ${args.join(" ")}\n${redact(output)}`);
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

function createFakeSafetyBin(tmp) {
  const binDir = path.join(tmp, "fake-bin");
  writeNodeBin(binDir, "safety-agent", `
process.on("SIGTERM", () => process.exit(143));
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("safety-agent fake 1.0.0");
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (input.includes("Return strict JSON")) {
    if (input.includes("cancel safety goal")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "First cancel", objective: "hang task", dependencies: [] },
        { id: "T002", title: "Second cancel", objective: "hang task", dependencies: [] },
        { id: "T003", title: "Queued cancel", objective: "task ok", dependencies: [] }
      ] }));
      return;
    }
    console.log(JSON.stringify({ tasks: [
      { id: "T001", title: "Safety task", objective: "task ok", dependencies: [], validationCommands: ["node -e \\"process.exit(0)\\""] }
    ] }));
    return;
  }
  if (input.includes("multi-events")) {
    for (let i = 0; i < 60; i += 1) {
      if (i % 2 === 0) console.log(JSON.stringify({ type: "status", label: "step-" + i }));
      else console.log("text event " + i);
    }
    return;
  }
  if (input.includes("noisy-fail")) {
    for (let i = 0; i < 250; i += 1) {
      console.log("stdout " + i + " token sk" + "A".repeat(20) + " cwd=" + process.cwd());
      console.error("stderr " + i + " Bearer " + "B".repeat(20) + " cwd=" + process.cwd());
    }
    process.exit(2);
    return;
  }
  if (input.includes("timeout-close-race")) {
    console.log("started");
    setTimeout(() => process.exit(0), 25);
    return;
  }
  if (input.includes("hang")) {
    setInterval(() => {}, 1000);
    return;
  }
  console.log("ok");
});
`);
  return binDir;
}

function writeConsumer(tmp, fakeBin) {
  writeFileSync(path.join(tmp, "consumer.mjs"), `
import { createAgentRuntime } from "agent-cli-runtime";

const fakeBin = ${JSON.stringify(fakeBin)};
const cwd = process.cwd();
const storageDir = cwd + "/runtime-safety-store";
const adapter = {
  id: "safety-fake",
  displayName: "Safety Fake",
  bin: "safety-agent",
  versionArgs: ["--version"],
  fallbackModels: [{ id: "default", label: "Default" }],
  buildArgs: () => [],
  promptTransport: { kind: "stdin", inputFormat: "text" },
  stream: {
    create: () => ({
      buffer: "",
      parse(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\\r?\\n/u);
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
    if (parsed?.type === "error") return [{ type: "error", code: "AGENT_EXECUTION_FAILED", message: String(parsed.message ?? "error") }];
  } catch {
    // plain text event
  }
  return [{ type: "text_delta", text: line + "\\n" }];
}

async function collect(iterable) {
  const out = [];
  for await (const event of iterable) out.push(event);
  return out;
}

function terminalCount(events, type) {
  return events.filter((event) => event.type === type).length;
}

const runtime = createAgentRuntime({
  adapters: [adapter],
  searchPath: [fakeBin],
  storageDir,
  storage: { durability: "fsync" },
  maxConcurrentTasks: 2,
});

const detected = await runtime.detect({ includeUnavailable: true });
const runIds = [];
const goalIds = [];

for (let i = 0; i < 4; i += 1) {
  const handle = await runtime.run({ agentId: "safety-fake", cwd, prompt: "safety run " + i });
  const events = await collect(handle.events);
  if (terminalCount(events, "run_finished") !== 1) throw new Error("repeated run terminal count drift");
  runIds.push(handle.runId);
}

const slow = await runtime.run({ agentId: "safety-fake", cwd, prompt: "multi-events" });
await new Promise((resolve) => setTimeout(resolve, 200));
const slowEvents = await collect(slow.events);
const slowReplay = await runtime.replayRunEvents(slow.runId);
if (terminalCount(slowEvents, "run_finished") !== 1) throw new Error("slow consumer lost terminal event");
if (slowReplay.filter((record) => record.event.type === "run_finished").length !== 1) throw new Error("slow replay terminal count drift");
runIds.push(slow.runId);

const churn = await Promise.all(Array.from({ length: 4 }, () => runtime.run({ agentId: "safety-fake", cwd, prompt: "hang cancel" })));
await Promise.all(churn.map((handle) => handle.cancel("cancel churn")));
const churnEvents = await Promise.all(churn.map((handle) => collect(handle.events)));
for (const events of churnEvents) {
  if (terminalCount(events, "run_finished") !== 1) throw new Error("cancel churn terminal count drift");
}
runIds.push(...churn.map((handle) => handle.runId));

const race = await runtime.run({ agentId: "safety-fake", cwd, prompt: "timeout-close-race", timeoutMs: 5 });
const raceEvents = await collect(race.events);
if (terminalCount(raceEvents, "run_finished") !== 1) throw new Error("timeout race terminal count drift");
runIds.push(race.runId);

for (let i = 0; i < 2; i += 1) {
  const handle = await runtime.createGoal({ cwd, objective: "runtime safety goal " + i, defaultAgentId: "safety-fake" });
  const events = await collect(handle.events);
  if (terminalCount(events, "goal_finished") !== 1) throw new Error("repeated goal terminal count drift");
  goalIds.push(handle.goalId);
}

const cancelGoal = await runtime.createGoal({ cwd, objective: "cancel safety goal", defaultAgentId: "safety-fake", maxConcurrentTasks: 2 });
const cancelGoalEvents = [];
for await (const event of cancelGoal.events) {
  cancelGoalEvents.push(event);
  if (cancelGoalEvents.filter((candidate) => candidate.type === "task_started").length === 2) {
    void runtime.cancelGoal(cancelGoal.goalId);
    void cancelGoal.cancel("duplicate cancel");
  }
}
if (terminalCount(cancelGoalEvents, "goal_finished") !== 1) throw new Error("goal cancel terminal count drift");
goalIds.push(cancelGoal.goalId);

const noisy = await runtime.run({ agentId: "safety-fake", cwd, prompt: "noisy-fail" });
await collect(noisy.events);
const noisyRun = await runtime.getRun(noisy.runId);
const noisyDiagnostic = noisyRun?.diagnostics?.find((item) => item.code === "AGENT_EXECUTION_FAILED");
if (!noisyDiagnostic) throw new Error("missing noisy failure diagnostic");
if ((noisyDiagnostic.stdoutTail?.length ?? 0) > 4000 || (noisyDiagnostic.stderrTail?.length ?? 0) > 4000) throw new Error("diagnostic tail exceeded bound");
const noisyDiagnosticsBundle = await runtime.exportDiagnostics({ kind: "run", runId: noisy.runId });
runIds.push(noisy.runId);

const activeBeforeShutdown = {
  runs: (await runtime.listRuns({ status: "active" })).length,
  goals: (await runtime.listGoals({ status: "active" })).length,
};
await runtime.shutdown("runtime safety complete");
const terminalBeforeSecondShutdown = await Promise.all(runIds.map(async (runId) => (await runtime.replayRunEvents(runId)).filter((record) => record.event.type === "run_finished").length));
await runtime.shutdown("runtime safety repeated shutdown");
const terminalAfterSecondShutdown = await Promise.all(runIds.map(async (runId) => (await runtime.replayRunEvents(runId)).filter((record) => record.event.type === "run_finished").length));
const health = await runtime.inspectStore();

const reopened = createAgentRuntime({ storageDir });
const reopenedRuns = await Promise.all(runIds.map((runId) => reopened.getRun(runId)));
const reopenedGoals = await Promise.all(goalIds.map((goalId) => reopened.getGoal(goalId)));
const activeAfterReopen = {
  runs: (await reopened.listRuns({ status: "active" })).length,
  goals: (await reopened.listGoals({ status: "active" })).length,
};
await reopened.shutdown("runtime safety reopened complete");

const diagnosticText = JSON.stringify(noisyDiagnostic);
if (diagnosticText.includes(cwd) || diagnosticText.includes("Bearer ") || diagnosticText.includes("sk" + "A".repeat(20))) {
  throw new Error("diagnostic redaction failed");
}
const diagnosticsBundleText = JSON.stringify(noisyDiagnosticsBundle);
if (noisyDiagnosticsBundle.schemaVersion !== "agent-runtime.diagnostics.v1") {
  throw new Error("diagnostics bundle schema drift");
}
if (diagnosticsBundleText.includes(cwd) || diagnosticsBundleText.includes("Bearer ") || diagnosticsBundleText.includes("sk" + "A".repeat(20)) || diagnosticsBundleText.includes("noisy-fail")) {
  throw new Error("diagnostics bundle redaction failed");
}
if (JSON.stringify(terminalBeforeSecondShutdown) !== JSON.stringify(terminalAfterSecondShutdown)) {
  throw new Error("repeated shutdown changed terminal counts");
}

console.log(JSON.stringify({
  detectedAvailable: detected.some((agent) => agent.id === "safety-fake" && agent.available),
  repeatedRuns: 4,
  repeatedGoals: 2,
  slowConsumer: {
    liveEvents: slowEvents.length,
    replayEvents: slowReplay.length,
    terminalEvents: terminalCount(slowEvents, "run_finished"),
  },
  cancelChurn: {
    runs: churn.length,
    terminalEvents: churnEvents.map((events) => terminalCount(events, "run_finished")),
  },
  timeoutRace: {
    terminalEvents: terminalCount(raceEvents, "run_finished"),
  },
  goalCancel: {
    terminalEvents: terminalCount(cancelGoalEvents, "goal_finished"),
    taskStatuses: (await runtime.getGoal(cancelGoal.goalId))?.tasks.map((task) => task.status) ?? [],
  },
  diagnostics: {
    schemaVersion: noisyDiagnosticsBundle.schemaVersion,
    stdoutTailLength: noisyDiagnostic.stdoutTail?.length ?? 0,
    stderrTailLength: noisyDiagnostic.stderrTail?.length ?? 0,
    redacted: diagnosticText.includes("[REDACTED]") && diagnosticsBundleText.includes("[REDACTED]"),
  },
  activeBeforeShutdown,
  activeAfterReopen,
  repeatedShutdownStable: true,
  storeHealth: {
    schemaVersion: health.schemaVersion,
    ok: health.ok,
    lockStatus: health.lock.status,
    totals: health.totals,
  },
  reopened: {
    runStatuses: reopenedRuns.map((run) => run?.status),
    goalStatuses: reopenedGoals.map((goal) => goal?.status),
  },
}));
`, "utf8");
}

function redact(value) {
  const home = process.env.HOME;
  let out = value;
  if (home) out = out.split(home).join("~");
  out = out.replace(new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<repoRoot>");
  out = out.replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]");
  out = out.replace(/sk-?[A-Za-z0-9_-]{20,}/gu, "[REDACTED]");
  out = out.replace(/(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*[^\s"']+/giu, "[REDACTED]");
  out = out.replace(/\/(?:Users|home|tmp|var)\/[^\s"']+/gu, "<path>");
  return out;
}

function assertSafeSummary(summary) {
  const text = JSON.stringify(summary);
  const forbidden = [
    repoRoot,
    process.env.HOME,
    "Bearer ",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_AUTH_TOKEN",
    "OPENCODE_AUTH_TOKEN",
    "CLAUDE_AUTH_TOKEN",
    "sk" + "A".repeat(20),
    "noisy-fail",
    "timeout-close-race",
    "raw corrupt",
  ].filter(Boolean);
  for (const value of forbidden) {
    if (text.includes(value)) throw new Error(`unsafe verifier summary contains ${redact(String(value))}`);
  }
}

function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), "agent-runtime-safety-verify-"));
  const packText = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp]);
  const [packInfo] = JSON.parse(packText);
  const tarball = path.join(tmp, packInfo.filename);
  run("npm", ["init", "-y"], { cwd: tmp });
  run("npm", ["install", tarball, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tmp });
  const fakeBin = createFakeSafetyBin(tmp);
  writeConsumer(tmp, fakeBin);

  const consumer = JSON.parse(run(node, ["consumer.mjs"], {
    cwd: tmp,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  }));
  const summary = {
    schemaVersion: "agent-runtime.runtimeSafety.v1",
    ok: true,
    packageSource: "installed-tarball",
    ...consumer,
  };
  assertSafeSummary(summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(1);
}
