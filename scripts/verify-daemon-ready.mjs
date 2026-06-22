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

function createFakeDaemonBin(tmp) {
  const binDir = path.join(tmp, "fake-bin");
  writeNodeBin(binDir, "daemon-agent", `
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("daemon-agent fake 1.0.0");
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (input.includes("Return strict JSON")) {
    console.log(JSON.stringify({ tasks: [
      {
        id: "T001",
        title: "Daemon task",
        objective: "daemon fake task",
        dependencies: [],
        validationCommands: ["node -e \\"process.exit(0)\\""]
      }
    ] }));
    return;
  }
  console.log(JSON.stringify({ type: "daemon_status", label: "fake" }));
  console.log("daemon fake run ok");
});
`);
  return binDir;
}

function writeConsumer(tmp, fakeBin) {
  writeFileSync(path.join(tmp, "consumer.mjs"), `
import { createAgentRuntime } from "agent-cli-runtime";

const fakeBin = ${JSON.stringify(fakeBin)};
const cwd = process.cwd();
const storageDir = cwd + "/daemon-store";
const adapter = {
  id: "daemon-fake",
  displayName: "Daemon Fake",
  bin: "daemon-agent",
  versionArgs: ["--version"],
  fallbackModels: [{ id: "default", label: "Default" }],
  buildArgs: () => [],
  promptTransport: { kind: "stdin", inputFormat: "text" },
  stream: {
    create: () => ({
      parse(chunk) {
        return chunk
          .split(/\\r?\\n/u)
          .filter(Boolean)
          .flatMap((line) => {
            try {
              const parsed = JSON.parse(line);
              if (parsed && parsed.type === "daemon_status") return [{ type: "status", label: String(parsed.label ?? "fake") }];
            } catch {
              // Plain text output is the fake assistant body.
            }
            return [{ type: "text_delta", text: line + "\\n" }];
          });
      },
      flush: () => [],
    }),
  },
  capabilities: { streaming: true, tools: false, models: false },
};

async function collect(iterable) {
  const out = [];
  for await (const event of iterable) out.push(event);
  return out;
}

const runtime = createAgentRuntime({
  adapters: [adapter],
  searchPath: [fakeBin],
  storageDir,
  storage: { durability: "fsync" },
});

const detected = await runtime.detect({ includeUnavailable: true });
const runHandle = await runtime.run({ agentId: "daemon-fake", cwd, prompt: "daemon embedding run" });
const runEvents = await collect(runHandle.events);
const run = await runtime.getRun(runHandle.runId);
const runReplay = await runtime.replayRunEvents(runHandle.runId);
const runDiagnostics = await runtime.exportDiagnostics({ kind: "run", runId: runHandle.runId });

const goalHandle = await runtime.createGoal({ defaultAgentId: "daemon-fake", cwd, objective: "daemon embedding goal" });
const goalEvents = await collect(goalHandle.events);
const goal = await runtime.getGoal(goalHandle.goalId);
const goalReplay = await runtime.replayGoalEvents(goalHandle.goalId);
const goalDiagnostics = await runtime.exportDiagnostics({ kind: "goal", goalId: goalHandle.goalId });
const health = await runtime.inspectStore();
await runtime.shutdown("daemon verification complete");

const reopened = createAgentRuntime({ storageDir });
const reopenedRun = await reopened.getRun(runHandle.runId);
const reopenedGoal = await reopened.getGoal(goalHandle.goalId);
await reopened.shutdown("daemon verification reopened complete");

const summary = {
  detectedAvailable: detected.some((agent) => agent.id === "daemon-fake" && agent.available),
  run: {
    id: runHandle.runId,
    status: run?.status,
    terminalEvents: runEvents.filter((event) => event.type === "run_finished").length,
    replayEvents: runReplay.length,
    diagnosticsSchemaVersion: runDiagnostics.schemaVersion,
  },
  goal: {
    id: goalHandle.goalId,
    status: goal?.status,
    terminalEvents: goalEvents.filter((event) => event.type === "goal_finished").length,
    replayEvents: goalReplay.length,
    diagnosticsSchemaVersion: goalDiagnostics.schemaVersion,
  },
  health: {
    schemaVersion: health.schemaVersion,
    ok: health.ok,
    totals: health.totals,
    lockStatus: health.lock.status,
  },
  reopened: {
    runStatus: reopenedRun?.status,
    goalStatus: reopenedGoal?.status,
  },
};

if (!summary.detectedAvailable) throw new Error("fake adapter was not detected");
if (summary.run.status !== "succeeded") throw new Error("fake run did not succeed");
if (summary.goal.status !== "succeeded") throw new Error("fake goal did not succeed");
if (summary.run.terminalEvents !== 1 || summary.goal.terminalEvents !== 1) throw new Error("terminal event count was not idempotent");
if (!summary.health.ok) throw new Error("store health was not ok");
if (summary.reopened.runStatus !== "succeeded" || summary.reopened.goalStatus !== "succeeded") throw new Error("reopened terminal records were not queryable");

console.log(JSON.stringify(summary));
`, "utf8");
}

function redact(value) {
  const home = process.env.HOME;
  let out = value;
  if (home) out = out.split(home).join("~");
  out = out.replace(/Bearer\\s+[^\\s"']+/giu, "Bearer [REDACTED]");
  out = out.replace(/sk-[A-Za-z0-9_-]{20,}/gu, "[REDACTED]");
  out = out.replace(/(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\\s*=\\s*[^\\s"']+/giu, "[REDACTED]");
  return out;
}

function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), "agent-runtime-daemon-verify-"));
  const packText = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp]);
  const [packInfo] = JSON.parse(packText);
  const tarball = path.join(tmp, packInfo.filename);
  run("npm", ["init", "-y"], { cwd: tmp });
  run("npm", ["install", tarball, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tmp });
  const fakeBin = createFakeDaemonBin(tmp);
  writeConsumer(tmp, fakeBin);

  const consumer = JSON.parse(run(node, ["consumer.mjs"], {
    cwd: tmp,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  }));
  const installedCli = path.join(tmp, "node_modules", ".bin", "agent-runtime");
  const conformance = JSON.parse(run(node, [installedCli, "conformance", "--mode", "fake", "--json"], { cwd: tmp }));
  const summary = {
    schemaVersion: "agent-runtime.daemonVerification.v1",
    ok: true,
    packageSource: "installed-tarball",
    detectedAvailable: consumer.detectedAvailable,
    conformance: {
      schemaVersion: conformance.schemaVersion,
      ok: conformance.ok,
      mode: conformance.mode,
      agents: conformance.agents?.length ?? 0,
    },
    run: {
      status: consumer.run.status,
      terminalEvents: consumer.run.terminalEvents,
      replayEvents: consumer.run.replayEvents,
    },
    goal: {
      status: consumer.goal.status,
      terminalEvents: consumer.goal.terminalEvents,
      replayEvents: consumer.goal.replayEvents,
    },
    diagnostics: {
      runSchemaVersion: consumer.run.diagnosticsSchemaVersion,
      goalSchemaVersion: consumer.goal.diagnosticsSchemaVersion,
    },
    storeHealth: consumer.health,
    reopened: consumer.reopened,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(1);
}
