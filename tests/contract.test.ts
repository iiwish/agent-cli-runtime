import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
} from "../src/index.js";
import { tempDir, writeExecutable } from "./helpers.js";

const execFileP = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "main.js");

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
      "run",
      "goal",
      "runs",
      "run-status",
      "replay-run",
      "goals",
      "goal-status",
      "replay-goal",
      "--json",
      "--jsonl",
      "--stream jsonl",
      "--diagnostics",
      "--storage-dir",
      "--status",
      "--after",
      "--max-concurrent-tasks",
      "--max-attempts",
      "--retryable-error-codes",
      "--retry-backoff-ms",
      "--allow-real-run",
    ]) {
      expect(stdout).toContain(word);
    }
  }, 30_000);

  it("runs offline parser fixture smoke through the CLI", async () => {
    await execFileP("npm", ["run", "build"], { cwd: root });
    const smoke = JSON.parse((await execFileP(process.execPath, [cli, "smoke", "--mode", "fixtures", "--json"])).stdout);
    expect(smoke).toMatchObject({ ok: true, mode: "fixtures" });
    expect(smoke.fixtures).toHaveLength(18);
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

  it("keeps reference material out of the npm package dry-run", async () => {
    const { stdout } = await execFileP("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root });
    const packed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = packed.flatMap((entry) => entry.files.map((file) => file.path));
    expect(files).toContain("LICENSE");
    expect(files).toContain("README.md");
    expect(files).not.toContainEqual(expect.stringMatching(/^\.reference\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\//u));
    expect(stdout).not.toContain(`sk${"A".repeat(20)}`);
  });
});
