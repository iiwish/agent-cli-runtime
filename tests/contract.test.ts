import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import path, { delimiter } from "node:path";
import { createAgentRuntime } from "../src/index.js";
import type {
  AgentAdapterDef,
  AgentEvent,
  AgentRuntime,
  CreateGoalRequest,
  DetectOptions,
  DetectedAgent,
  GoalHandle,
  GoalRecord,
  ReplayEvent,
  RunHandle,
  RunRecord,
  RunRequest,
  RuntimeDiagnostic,
  RuntimeOptions,
  SchedulerEvent,
  DiagnosticsBundle,
  ExportDiagnosticsRequest,
  InspectStoreOptions,
  StoreHealth,
  StoreRepairAction,
  StoreRepairReport,
} from "../src/index.js";
import { tempDir, writeExecutable } from "./helpers.js";

const execFileP = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "main.js");

async function execCliJson<T = unknown>(
  args: string[],
  options?: Parameters<typeof execFileP>[2],
): Promise<T> {
  const { stdout } = await execFileP(process.execPath, [cli, ...args], options);
  return JSON.parse(stdout) as T;
}

async function execInstalledCliJson<T = unknown>(
  bin: string,
  args: string[],
  options?: Parameters<typeof execFileP>[2],
): Promise<T> {
  const { stdout } = await execFileP(process.execPath, [bin, ...args], options);
  return JSON.parse(stdout) as T;
}

async function waitForRunId(storageDir: string): Promise<string | undefined> {
  const runsDir = path.join(storageDir, "runs");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const runs = JSON.parse((await execFileP(process.execPath, [cli, "runs", "--storage-dir", storageDir, "--json"])).stdout) as Array<{
        id: string;
        errorCode?: string | null;
        status?: string;
      }>;
      const terminalRun = runs.find((run) => run.status === "failed" || run.errorCode === "AGENT_TIMEOUT");
      if (terminalRun?.id) return terminalRun.id;
      if (runs[0]?.id) return runs[0].id;
    } catch {
      void 0;
    }
    try {
      const runIds = (await readdir(runsDir)).filter((entry) => entry.startsWith("run_"));
      if (runIds[0]) return runIds[0];
    } catch {
      void 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

function isLikelyBinary(buffer: Buffer): boolean {
  const maxScan = Math.min(buffer.length, 4096);
  if (buffer.includes(0)) return true;
  let suspiciousBytes = 0;
  for (let i = 0; i < maxScan; i += 1) {
    const byte = buffer[i];
    const isTextish =
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e) ||
      byte >= 0x80;
    if (!isTextish) {
      suspiciousBytes += 1;
    }
  }
  return maxScan > 0 ? suspiciousBytes / maxScan > 0.2 : false;
}

describe("public contract", () => {
  it("keeps the package root focused on the runtime facade and public types", async () => {
    type PublicApiSmoke = {
      adapter: AgentAdapterDef;
      agent: DetectedAgent;
      detect: DetectOptions;
      runtime: AgentRuntime;
      runtimeOptions: RuntimeOptions;
      runRequest: RunRequest;
      runHandle: RunHandle;
      runRecord: RunRecord;
      goalRequest: CreateGoalRequest;
      goalHandle: GoalHandle;
      goalRecord: GoalRecord;
      agentEvent: AgentEvent;
      schedulerEvent: SchedulerEvent;
      replay: ReplayEvent<AgentEvent>;
      diagnostic: RuntimeDiagnostic;
      inspectStoreOptions: InspectStoreOptions;
      storeHealth: StoreHealth;
      storeRepairAction: StoreRepairAction;
      storeRepairReport: StoreRepairReport;
      diagnosticsRequest: ExportDiagnosticsRequest;
      diagnosticsBundle: DiagnosticsBundle;
    };
    const smoke = undefined as unknown as PublicApiSmoke;
    expect(typeof createAgentRuntime).toBe("function");
    expect(smoke).toBeUndefined();
    expect(Object.keys(await import("../src/index.js"))).toEqual(["createAgentRuntime"]);

    const runtime = createAgentRuntime();
    expect(typeof runtime.replayRunEvents).toBe("function");
    expect(typeof runtime.replayGoalEvents).toBe("function");
  });

  it("prints CLI help with all frozen commands and key flags", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const { stdout } = await execFileP(process.execPath, [cli, "help"]);
    for (const word of [
      "agents",
      "doctor",
      "smoke",
      "conformance",
      "run",
      "goal",
      "runs",
      "run-status",
      "replay-run",
      "goals",
      "goal-status",
      "replay-goal",
      "store-health",
      "store-repair",
      "diagnostics run",
      "diagnostics goal",
      "--json",
      "--jsonl",
      "--out",
      "--stream jsonl",
      "--diagnostics",
      "--storage-dir",
      "--storage-durability",
      "--dry-run",
      "--status",
      "--after",
      "--max-concurrent-tasks",
      "--max-attempts",
      "--retryable-error-codes",
      "--retry-backoff-ms",
      "--allow-real-run",
      "--expect-text",
      "--prompt-file",
    ]) {
      expect(stdout).toContain(word);
    }
  }, 30_000);

  it("runs offline parser fixture smoke through the CLI", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const smoke = JSON.parse((await execFileP(process.execPath, [cli, "smoke", "--mode", "fixtures", "--json"])).stdout);
    expect(smoke).toMatchObject({ ok: true, mode: "fixtures" });
    expect(smoke.fixtures).toHaveLength(24);
  }, 30_000);

  it("runs offline conformance fixtures with stable adapter summaries", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "fixtures",
      "--json",
    ])).stdout);

    expect(conformance).toMatchObject({
      ok: true,
      mode: "fixtures",
      agents: [
        {
          adapter: "codex",
          version: null,
          auth: "not_checked",
          modelsSource: "fixtures",
          runClassification: "success",
          expectedTextMatched: null,
          cwdMutated: null,
          diagnosticsCount: 0,
          skippedReason: null,
        },
        expect.objectContaining({ adapter: "claude", runClassification: "success" }),
        expect.objectContaining({ adapter: "opencode", runClassification: "success" }),
      ],
    });
  }, 30_000);

  it("runs fake conformance through real adapter argv and parsers", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "fake",
      "--json",
    ])).stdout);

    expect(conformance).toMatchObject({
      ok: true,
      mode: "fake",
      agents: [
        expect.objectContaining({
          adapter: "codex",
          version: "codex-cli fake-conformance",
          auth: "unknown",
          modelsSource: "live",
          runClassification: "success",
          expectedTextMatched: true,
          cwdMutated: false,
          skippedReason: null,
        }),
        expect.objectContaining({
          adapter: "claude",
          auth: "ok",
          modelsSource: "fallback",
          runClassification: "success",
          expectedTextMatched: true,
          cwdMutated: false,
        }),
        expect.objectContaining({
          adapter: "opencode",
          modelsSource: "live",
          runClassification: "success",
          expectedTextMatched: true,
          cwdMutated: false,
        }),
      ],
    });
  }, 30_000);

  it("refuses real conformance unless --allow-real-run is explicit", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    await expect(execFileP(process.execPath, [cli, "conformance", "--mode", "real", "--agent", "codex", "--json"])).rejects.toMatchObject({
      stderr: expect.stringContaining("conformance --mode real requires --allow-real-run"),
    });
  }, 30_000);

  it("does not pass real conformance when the selected adapter only skips", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeExecutable(binDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.178 (Claude Code)"); process.exit(0); }
if (args[0] === "-p" && args[1] === "--help") { console.log("--include-partial-messages\\n--add-dir"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }));
  process.exit(0);
}
process.exit(66);
`);
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "real",
      "--agent",
      "claude",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_BIN: path.join(binDir, "claude"),
      },
    })).stdout);

    expect(conformance).toMatchObject({
      ok: false,
      mode: "real",
      agents: [expect.objectContaining({
        adapter: "claude",
        runClassification: "auth_missing",
        skippedReason: "auth_missing",
      })],
    });
  }, 30_000);

  it("keeps all-agent conformance summaries when one adapter skips", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    await writeExecutable(binDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.178 (Claude Code)"); process.exit(0); }
if (args[0] === "-p" && args[1] === "--help") { console.log("--include-partial-messages\\n--add-dir"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }));
  process.exit(0);
}
process.exit(66);
`);
    await writeExecutable(binDir, "opencode", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("opencode test"); process.exit(0); }
if (args[0] === "models") { console.log("openai/gpt-test"); process.exit(0); }
console.log(JSON.stringify({ type: "step_start" }));
`);
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "real",
      "--agent",
      "all",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CODEX_BIN: path.join(binDir, "codex"),
        CLAUDE_BIN: path.join(binDir, "claude"),
        OPENCODE_BIN: path.join(binDir, "opencode"),
      },
    })).stdout);

    expect(conformance.agents).toHaveLength(3);
    expect(conformance.agents.find((agent: { adapter: string }) => agent.adapter === "codex")).toMatchObject({
      runClassification: "success",
      skippedReason: null,
    });
    expect(conformance.agents.find((agent: { adapter: string }) => agent.adapter === "claude")).toMatchObject({
      runClassification: "auth_missing",
      skippedReason: "auth_missing",
    });
    expect(conformance.agents.find((agent: { adapter: string }) => agent.adapter === "opencode")).toMatchObject({
      runClassification: "unexpected_output",
      skippedReason: null,
    });
    expect(conformance.ok).toBe(false);
  }, 30_000);

  it("refuses real smoke unless --allow-real-run is explicit", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    await expect(execFileP(process.execPath, [cli, "smoke", "--mode", "real", "--agent", "codex", "--json"])).rejects.toMatchObject({
      stderr: expect.stringContaining("smoke --mode real requires --allow-real-run"),
    });
  }, 30_000);

  it("runs real smoke with --prompt-file without putting long prompts in argv", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    const promptFile = path.join(await tempDir(), "prompt.txt");
    const longPrompt = `agent-runtime prompt-file smoke ${"x".repeat(64 * 1024)}`;
    await writeFile(promptFile, longPrompt, "utf8");
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli test"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] })); process.exit(0); }
if (args.join("\\n").includes("agent-runtime prompt-file smoke")) {
  console.error("prompt leaked into argv");
  process.exit(64);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (!input.includes("agent-runtime prompt-file smoke")) {
    console.error("prompt missing from stdin");
    process.exit(65);
  }
  console.log(JSON.stringify({ type: "thread.started" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
});
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--prompt-file",
      promptFile,
      "--timeout-ms",
      "5000",
      "--json",
    ], {
      env: {
        ...process.env,
        CODEX_BIN: path.join(binDir, "codex"),
      },
    });

    expect(smoke).toMatchObject({ ok: true, mode: "real", agent: "codex", run: { status: "succeeded" } });
    expect(smoke).toMatchObject({ expectedTextRequired: false, expectedTextMatched: null });
    expect(JSON.stringify(smoke)).not.toContain(longPrompt);
  }, 30_000);

  it("requires default real smoke expected text evidence", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: { ...process.env, CODEX_BIN: path.join(binDir, "codex") },
    });

    expect(smoke).toMatchObject({
      ok: true,
      mode: "real",
      agent: "codex",
      classification: "success",
      expectedText: "agent-runtime codex smoke ok",
      expectedTextRequired: true,
      expectedTextMatched: true,
      observedTextTail: "agent-runtime codex smoke ok",
      cwdMutationChecked: true,
      cwdMutated: false,
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("does not classify status-only real smoke exit 0 as success", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: { ...process.env, CODEX_BIN: path.join(binDir, "codex") },
    });

    expect(smoke).toMatchObject({
      ok: false,
      classification: "unexpected_output",
      expectedTextRequired: true,
      expectedTextMatched: false,
      observedTextDeltaCount: 0,
      observedTextTail: "",
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("classifies wrong real smoke text as unexpected_output", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "not the expected smoke text" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: { ...process.env, CODEX_BIN: path.join(binDir, "codex") },
    });

    expect(smoke).toMatchObject({
      ok: false,
      classification: "unexpected_output",
      expectedTextMatched: false,
      observedTextTail: "not the expected smoke text",
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("classifies default isolated cwd mutation as cwd_mutated", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.cwd(), "smoke-output.txt"), "mutated");
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: { ...process.env, CODEX_BIN: path.join(binDir, "codex") },
    });

    expect(smoke).toMatchObject({
      ok: false,
      classification: "cwd_mutated",
      expectedTextMatched: true,
      cwdMutationChecked: true,
      cwdMutated: true,
      cwdMutationCount: 1,
      cwdMutationSample: [{ path: "smoke-output.txt", action: "created" }],
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("does not require expected text for prompt-file real smoke unless --expect-text is set", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    const promptFile = path.join(await tempDir(), "prompt.txt");
    await writeFile(promptFile, "custom prompt-file smoke", "utf8");
    await writeFakeCodexSmoke(binDir, `
const args = process.argv.slice(2);
if (args.join("\\n").includes("custom prompt-file smoke")) {
  console.error("prompt leaked into argv");
  process.exit(64);
}
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "custom prompt-file response" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--prompt-file",
      promptFile,
      "--json",
    ], {
      env: { ...process.env, CODEX_BIN: path.join(binDir, "codex") },
    });

    expect(smoke).toMatchObject({
      ok: true,
      classification: "success",
      expectedTextRequired: false,
      expectedTextMatched: null,
      observedTextTail: "custom prompt-file response",
      run: { status: "succeeded" },
    });
    expect(JSON.stringify(smoke)).not.toContain("custom prompt-file smoke");
  }, 30_000);

  it("enforces --prompt-file --expect-text real smoke matching", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    const promptFile = path.join(await tempDir(), "prompt.txt");
    await writeFile(promptFile, "custom expect prompt", "utf8");
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "custom expected ok" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--prompt-file",
      promptFile,
      "--expect-text",
      "custom expected ok",
      "--json",
    ], {
      env: { ...process.env, CODEX_BIN: path.join(binDir, "codex") },
    });

    expect(smoke).toMatchObject({
      ok: true,
      classification: "success",
      expectedText: "custom expected ok",
      expectedTextRequired: true,
      expectedTextMatched: true,
    });
  }, 30_000);

  it("redacts observedTextTail, expected text, mutation samples, and cwd in real smoke summaries", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    const privateCwd = await tempDir("private-real-smoke-");
    const secret = `sk${"A".repeat(20)}`;
    await writeFakeCodexSmoke(binDir, `
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.cwd(), "token-sk" + "A".repeat(20) + ".txt"), "secret");
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "wrong token sk" + "A".repeat(20) + " cwd=" + process.cwd() } }));
`);
    const smokeStdout = (await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--cwd",
      privateCwd,
      "--expect-text",
      `expected ${secret}`,
      "--stream",
      "jsonl",
      "--diagnostics",
    ], {
      env: { ...process.env, CODEX_BIN: path.join(binDir, "codex") },
    })).stdout;
    const smoke = smokeStdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line)).at(-1);
    const text = JSON.stringify(smoke);

    expect(smoke).toMatchObject({
      type: "real_smoke_summary",
      classification: "cwd_mutated",
      expectedText: "expected [REDACTED]",
      cwdMutationSample: [{ path: "token-[REDACTED].txt", action: "created" }],
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(privateCwd);
  }, 30_000);

  it("classifies real smoke auth-missing preflight without launching Claude", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeExecutable(binDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.178 (Claude Code)"); process.exit(0); }
if (args[0] === "-p" && args[1] === "--help") { console.log("--include-partial-messages\\n--add-dir"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }));
  process.exit(0);
}
console.error("real run should not launch when auth is missing");
process.exit(66);
`);
    const smoke = JSON.parse((await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "claude",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_BIN: path.join(binDir, "claude"),
      },
    })).stdout);

    expect(smoke).toMatchObject({
      ok: false,
      mode: "real",
      agent: "claude",
      classification: "auth_missing",
      skipped: true,
      detection: { available: true, authStatus: "missing" },
    });
    expect(smoke.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "auth_missing" })]));
  }, 30_000);

  it("classifies real smoke unavailable executables before launch", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const missing = path.join(await tempDir(), "missing-codex");
    const smoke = JSON.parse((await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: "",
        CODEX_BIN: missing,
      },
    })).stdout);

    expect(smoke).toMatchObject({
      ok: false,
      mode: "real",
      agent: "codex",
      classification: "unavailable_executable",
      skipped: true,
      detection: { available: false },
    });
    expect(smoke.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "not_installed" })]));
  }, 30_000);

  it("keeps Claude auth missing as a doctor diagnostic without failing doctor", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    await writeExecutable(binDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("2.1.178 (Claude Code)");
  process.exit(0);
}
if (args[0] === "-p" && args[1] === "--help") {
  console.log("--include-partial-messages\\n--add-dir");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }));
  process.exit(0);
}
process.exit(0);
`);
    const doctor = JSON.parse((await execFileP(process.execPath, [cli, "doctor", "--json"], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_BIN: path.join(binDir, "claude"),
        CODEX_BIN: path.join(binDir, "missing-codex"),
        OPENCODE_BIN: path.join(binDir, "missing-opencode"),
      },
    })).stdout);
    const claude = doctor.agents.find((agent: { id: string }) => agent.id === "claude");
    expect(doctor.ok).toBe(true);
    expect(claude).toMatchObject({ available: true, authStatus: "missing" });
    expect(claude.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "auth_missing" })]));
  }, 30_000);

  it("prints final run records and JSONL diagnostics without requiring a real CLI", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const cwd = await tempDir();
    const jsonRun = JSON.parse((await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      "missing-adapter",
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--json",
    ])).stdout) as RunRecord;
    const jsonl = (await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      "missing-adapter",
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--stream",
      "jsonl",
      "--diagnostics",
    ])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as { type: string; summary?: RunRecord });

    expect(jsonRun).toMatchObject({ agentId: "missing-adapter", status: "failed", errorCode: "AGENT_UNAVAILABLE" });
    expect(jsonl.some((event) => event.type === "run_finished")).toBe(true);
    expect(jsonl.at(-1)).toMatchObject({ type: "run_summary", summary: { status: "failed", errorCode: "AGENT_UNAVAILABLE" } });
  }, 30_000);

  it("redacts concise CLI errors", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const secretCommand = `unknown-${"sk" + "A".repeat(20)}`;
    await expect(execFileP(process.execPath, [cli, secretCommand])).rejects.toMatchObject({
      stderr: expect.stringContaining("[REDACTED]"),
    });
  }, 30_000);

  it("redacts runtime-emitted CLI errors and summaries", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const cwd = await tempDir();
    const secretAgent = `missing-${"sk" + "A".repeat(20)}`;
    const human = await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      secretAgent,
      "--cwd",
      cwd,
      "--prompt",
      "hello",
    ]);
    const json = await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      secretAgent,
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--json",
    ]);
    const jsonl = await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      secretAgent,
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--stream",
      "jsonl",
      "--diagnostics",
    ]);

    for (const output of [`${human.stdout}\n${human.stderr}`, json.stdout, jsonl.stdout]) {
      expect(output).toContain("[REDACTED]");
      expect(output).not.toContain(secretAgent);
    }
  }, 30_000);

  it("writes diagnostics bundles through --out without leaking secrets", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_cli_bundle";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: "/tmp/private-cli-tail",
      status: "failed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: 1,
      signal: null,
      error: "Bearer " + "B".repeat(20),
      errorCode: "AGENT_EXECUTION_FAILED",
      diagnostics: [{ code: "AGENT_EXECUTION_FAILED", message: "ANTHROPIC_AUTH_TOKEN=secret-value" }],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), "", "utf8");
    const outFile = path.join(await tempDir("agent-runtime-out-"), "bundle.json");
    const health = JSON.parse((await execFileP(process.execPath, [
      cli,
      "store-health",
      "--storage-dir",
      storageDir,
      "--json",
    ])).stdout) as StoreHealth;

    const stdout = JSON.parse((await execFileP(process.execPath, [
      cli,
      "diagnostics",
      "run",
      runId,
      "--storage-dir",
      storageDir,
      "--json",
      "--out",
      outFile,
    ])).stdout) as DiagnosticsBundle;
    const writtenText = await readFile(outFile, "utf8");
    const written = JSON.parse(writtenText) as DiagnosticsBundle;
    const leftovers = await readdir(path.dirname(outFile));

    expect(health).toMatchObject({ totals: { runs: 1, goals: 0 } });
    expect(written).toMatchObject({ subject: { kind: "run", id: runId } });
    expect(stdout.subject).toEqual(written.subject);
    expect(leftovers).toEqual(["bundle.json"]);
    expect(writtenText).toContain("[REDACTED]");
    expect(writtenText).not.toContain("Bearer");
    expect(writtenText).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(writtenText).not.toContain("private-cli-tail");
  }, 30_000);

  it("prints redacted store-repair dry-run actions without applying changes", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_cli_repair";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    const eventsFile = path.join(runDir, "events.jsonl");
    const original = `${JSON.stringify({ id: 1, sequence: 1, timestamp: Date.now(), event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp/private-cli-repair", timestamp: Date.now() } })}\n{"id":2,"token":"Bearer ${"B".repeat(20)}","cwd":"/tmp/private-cli-repair"`;
    await writeFile(eventsFile, original, "utf8");

    const repair = JSON.parse((await execFileP(process.execPath, [
      cli,
      "store-repair",
      "--storage-dir",
      storageDir,
      "--dry-run",
      "--json",
    ])).stdout);
    const after = await readFile(eventsFile, "utf8");
    const text = JSON.stringify(repair);

    expect(repair).toMatchObject({
      schemaVersion: "agent-runtime.store-repair.v1",
      dryRun: true,
      applied: false,
      ok: false,
      actions: [expect.objectContaining({ action: "truncate_partial_tail", id: runId, applied: false })],
    });
    expect(after).toBe(original);
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("private-cli-repair");
  }, 30_000);

  it("exports redacted diagnostics for a real smoke timeout run", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const binDir = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    const privateCwd = await tempDir("private-real-smoke-");
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli test"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] })); process.exit(0); }
console.log(JSON.stringify({ type: "thread.started" }));
  require("node:fs").writeSync(2, "network ETIMEDOUT cwd=" + process.cwd() + " token sk" + "A".repeat(20) + "\\n");
setInterval(() => {}, 1000);
`);
    const smoke = JSON.parse((await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--cwd",
      privateCwd,
      "--timeout-ms",
      "300",
      "--storage-dir",
      storageDir,
      "--json",
      "--diagnostics",
    ], {
      env: {
        ...process.env,
        CODEX_BIN: path.join(binDir, "codex"),
      },
      timeout: 10_000,
    })).stdout);
    const runId = smoke.run?.id ?? (await waitForRunId(storageDir));
    if (runId === undefined) {
      throw new Error("Expected a run id from real smoke output or storage scan");
    }
    const bundle = JSON.parse((await execFileP(process.execPath, [
      cli,
      "diagnostics",
      "run",
      runId,
      "--storage-dir",
      storageDir,
      "--json",
    ])).stdout) as DiagnosticsBundle;
    const text = JSON.stringify(bundle);

    expect(smoke).toMatchObject({ ok: false, mode: "real", run: { status: "failed", errorCode: "AGENT_TIMEOUT" } });
    expect(bundle.adapterSummary).toMatchObject({
      kind: "run",
      agentId: "codex",
      status: "failed",
      errorCode: "AGENT_TIMEOUT",
      promptTransport: "stdin:text",
      parsedEventCount: expect.any(Number),
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(privateCwd);
    expect(text).not.toContain(`sk${"A".repeat(20)}`);
  }, 30_000);

  it("keeps reference material out of the npm package dry-run", async () => {
    const { stdout } = await execFileP("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root });
    const packed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = packed.flatMap((entry) => entry.files.map((file) => file.path));
    expect(files).toContain("LICENSE");
    expect(files).toContain("README.md");
    expect(files).toContain("docs/production-readiness.md");
    expect(files).not.toContainEqual(expect.stringMatching(/^\.reference\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^docs\/fixtures\//u));
    expect(stdout).not.toContain(`sk${"A".repeat(20)}`);
  });

  it("supports package install smoke from npm pack tarball", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const tempProject = await tempDir("agent-runtime-install-smoke-");
    const packInfoText = (await execFileP("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tempProject], { cwd: root }))
      .stdout.trim();
    const [packInfo] = JSON.parse(packInfoText) as Array<{ filename: string }>;
    const tarball = path.join(tempProject, packInfo.filename);
    const tarEntries = (await execFileP("tar", ["-tf", packInfo.filename], { cwd: tempProject })).stdout.split(/\r?\n/u);

    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/\.reference\//u));
    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/tests\//u));
    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/tests\/fixtures\//u));
    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/docs\/fixtures\//u));

    await execFileP("npm", ["init", "-y"], { cwd: tempProject });
    await execFileP("npm", ["install", tarball, "--no-save"], { cwd: tempProject });
    const installedFakeBinDir = path.join(tempProject, "fake-bin");
    await mkdir(installedFakeBinDir, { recursive: true });
    await writeFakeCodexSmoke(installedFakeBinDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    await writeExecutable(installedFakeBinDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Claude Code install-smoke"); process.exit(0); }
if (args[0] === "-p" && args[1] === "--help") { console.log("--include-partial-messages\\n--add-dir"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
process.exit(0);
`);
    await writeExecutable(installedFakeBinDir, "opencode", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("opencode install-smoke"); process.exit(0); }
if (args[0] === "models") { console.log("openai/gpt-install-smoke"); process.exit(0); }
process.exit(0);
`);
    const installedEnv = {
      ...process.env,
      PATH: `${installedFakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_BIN: path.join(installedFakeBinDir, "codex"),
      CLAUDE_BIN: path.join(installedFakeBinDir, "claude"),
      OPENCODE_BIN: path.join(installedFakeBinDir, "opencode"),
    };

    const imported = await execFileP(process.execPath, [
      "-e",
      "import('agent-cli-runtime').then((m) => {\n" +
        "if (typeof m.createAgentRuntime !== 'function') process.exit(1);\n" +
        "console.log(typeof m.createAgentRuntime);\n" +
        "}).catch(() => process.exit(1));\n",
    ], {
      cwd: tempProject,
    });
    const installedCli = path.join(tempProject, "node_modules", ".bin", "agent-runtime");
    const agents = await execInstalledCliJson<DetectedAgent[]>(installedCli, ["agents", "--json"], { cwd: tempProject, env: installedEnv });
    const doctor = await execInstalledCliJson<{ ok: boolean }>(installedCli, ["doctor", "--json"], { cwd: tempProject, env: installedEnv });
    const smoke = await execInstalledCliJson<{ ok: true; mode: string }>(installedCli, ["smoke", "--mode", "fixtures", "--json"], {
      cwd: tempProject,
      env: installedEnv,
    });
    const conformance = await execInstalledCliJson<{ ok: true; mode: string }>(installedCli, ["conformance", "--mode", "fixtures", "--json"], {
      cwd: tempProject,
      env: installedEnv,
    });

    expect(imported.stdout.trim()).toBe("function");
    expect(agents.length).toBeGreaterThan(0);
    expect(doctor.ok).toBe(true);
    expect(smoke).toMatchObject({ ok: true, mode: "fixtures" });
    expect(conformance).toMatchObject({ ok: true, mode: "fixtures" });
  }, 60_000);

  it("does not ship docs fixtures with raw auth token patterns", async () => {
    const docsFixtureDir = path.join(root, "docs", "fixtures");
    try {
      await lstat(docsFixtureDir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return;
      throw error;
    }

    const entries = await readdir(docsFixtureDir, { recursive: true });
    const fixtureFiles = entries.filter((entry) => typeof entry === "string");
    for (const entry of fixtureFiles) {
      const full = path.join(docsFixtureDir, entry);
      const stat = await lstat(full);
      if (!stat.isFile()) continue;
      const bytes = await readFile(full);
      if (isLikelyBinary(bytes)) continue;
      const text = bytes.toString("utf8");
      expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
      expect(text).not.toMatch(/\bBearer\s+[A-Za-z0-9+/_-]{10,}\b/gu);
      expect(text).not.toMatch(/\bANTHROPIC_AUTH_TOKEN\b/gu);
      expect(text).not.toMatch(/\bOPENAI_API_KEY\b/gu);
    }
  });
});

async function writeFakeCodexSmoke(binDir: string, runBody: string): Promise<void> {
  await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli test"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") {
  console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] }));
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
${runBody}
});
`);
}
