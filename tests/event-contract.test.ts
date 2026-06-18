import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path, { delimiter } from "node:path";
import { createAgentRuntime } from "../src/index.js";
import {
  envelopeReplayEvent,
  envelopeStreamEvent,
  terminalContractFromEvent,
} from "../src/core/event-contract.js";
import { GoalStore } from "../src/goals/goal-store.js";
import { RunStore } from "../src/runs/run-store.js";
import { tempDir, writeExecutable } from "./helpers.js";

const execFileP = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "main.js");

describe("event contract", () => {
  it("keeps run replay events ordered with stable scope metadata", async () => {
    const store = new RunStore();
    const cwd = await tempDir();
    const run = store.create({ agentId: "fake", cwd });

    store.append(run.id, { type: "run_started", runId: run.id, agentId: "fake", cwd, timestamp: 100 });
    store.append(run.id, { type: "text_delta", text: "hello\n", timestamp: 101 });
    store.append(run.id, { type: "file_event", path: "README.md", action: "updated", timestamp: 102 });
    store.append(run.id, { type: "error", code: "AGENT_EXECUTION_FAILED", message: "failed", retryable: false, timestamp: 103 });
    store.append(run.id, { type: "run_finished", result: "failed", exitCode: 1, signal: null, timestamp: 104 });

    expect(store.replay(run.id).map((event) => event.id)).toEqual([1, 2, 3, 4, 5]);
    expect(normalize(store.replay(run.id), { runId: run.id, cwd })).toMatchInlineSnapshot(`
      [
        {
          "event": {
            "agentId": "fake",
            "cwd": "<cwd>",
            "runId": "<runId>",
            "timestamp": 0,
            "type": "run_started",
          },
          "id": 1,
          "runId": "<runId>",
          "sequence": 1,
          "timestamp": 0,
        },
        {
          "event": {
            "text": "hello
      ",
            "timestamp": 0,
            "type": "text_delta",
          },
          "id": 2,
          "runId": "<runId>",
          "sequence": 2,
          "timestamp": 0,
        },
        {
          "event": {
            "action": "updated",
            "path": "README.md",
            "timestamp": 0,
            "type": "file_event",
          },
          "id": 3,
          "runId": "<runId>",
          "sequence": 3,
          "timestamp": 0,
        },
        {
          "event": {
            "code": "AGENT_EXECUTION_FAILED",
            "message": "failed",
            "retryable": false,
            "timestamp": 0,
            "type": "error",
          },
          "id": 4,
          "runId": "<runId>",
          "sequence": 4,
          "timestamp": 0,
        },
        {
          "event": {
            "exitCode": 1,
            "result": "failed",
            "signal": null,
            "timestamp": 0,
            "type": "run_finished",
          },
          "id": 5,
          "runId": "<runId>",
          "sequence": 5,
          "timestamp": 0,
        },
      ]
    `);
  });

  it("creates a versioned run replay envelope without changing the old replay API", async () => {
    const store = new RunStore();
    const cwd = await tempDir();
    const run = store.create({ agentId: "fake", cwd });

    store.append(run.id, { type: "run_started", runId: run.id, agentId: "fake", cwd, timestamp: 100 });
    store.append(run.id, { type: "run_finished", result: "success", exitCode: 0, signal: null, timestamp: 101 });

    const replayed = store.replay(run.id);
    const envelope = envelopeReplayEvent(replayed.at(-1)!);

    expect(replayed.at(-1)).not.toHaveProperty("schemaVersion");
    expect(envelope).toMatchObject({
      schemaVersion: "agent-runtime.event.v1",
      id: 2,
      sequence: 2,
      timestamp: expect.any(Number),
      scope: { kind: "run", id: run.id },
      event: { type: "run_finished", result: "success" },
      terminal: { result: "success", reason: "success" },
    });
  });

  it("creates a versioned run failure and timeout envelope with stable terminal reasons", async () => {
    const failed = envelopeStreamEvent(
      { type: "run_finished", result: "failed", exitCode: 1, signal: null, timestamp: 100 },
      { kind: "run", id: "run_failed" },
      1,
      "AGENT_EXECUTION_FAILED",
    );
    const timeout = envelopeStreamEvent(
      { type: "run_finished", result: "failed", exitCode: null, signal: "SIGTERM", timestamp: 101 },
      { kind: "run", id: "run_timeout" },
      2,
      "AGENT_TIMEOUT",
    );
    const canceled = envelopeStreamEvent(
      { type: "run_finished", result: "cancelled", exitCode: null, signal: "SIGTERM", timestamp: 102 },
      { kind: "run", id: "run_canceled" },
      3,
      "AGENT_CANCELLED",
    );
    const interrupted = envelopeStreamEvent(
      { type: "run_finished", result: "failed", exitCode: null, signal: "RUNTIME_RESTART", timestamp: 103 },
      { kind: "run", id: "run_interrupted" },
      4,
      "AGENT_RUNTIME_INTERRUPTED",
    );

    expect(failed.terminal).toEqual({ result: "failed", reason: "execution_failed" });
    expect(timeout.terminal).toEqual({ result: "failed", reason: "timeout" });
    expect(canceled.terminal).toEqual({ result: "cancelled", reason: "canceled" });
    expect(interrupted.terminal).toEqual({ result: "failed", reason: "interrupted" });
  });

  it("keeps goal replay events ordered with stable scope metadata", async () => {
    const store = new GoalStore();
    const cwd = await tempDir();
    const goal = store.create({ cwd, objective: "ship", defaultAgentId: "fake" });
    const task = {
      id: "T001",
      title: "Task",
      objective: "do it",
      status: "pending" as const,
      dependencies: [],
      agentId: "fake",
      cwd,
      permissionPolicy: "agent-default" as const,
    };

    store.emit(goal.id, { type: "goal_started", goalId: goal.id, objective: "ship" });
    store.emit(goal.id, { type: "task_created", goalId: goal.id, task });
    store.emit(goal.id, { type: "task_started", goalId: goal.id, taskId: task.id, runId: "run_task" });
    store.emit(goal.id, {
      type: "run_event",
      goalId: goal.id,
      taskId: task.id,
      runId: "run_task",
      event: { type: "text_delta", text: "parsed output\n", timestamp: 103 },
    });
    store.emit(goal.id, { type: "task_finished", goalId: goal.id, taskId: task.id, result: "success" });
    store.emit(goal.id, { type: "goal_finished", goalId: goal.id, result: "success" });

    expect(store.replay(goal.id).map((event) => event.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(normalize(store.replay(goal.id), { goalId: goal.id, cwd })).toMatchInlineSnapshot(`
      [
        {
          "event": {
            "goalId": "<goalId>",
            "objective": "ship",
            "timestamp": 0,
            "type": "goal_started",
          },
          "goalId": "<goalId>",
          "id": 1,
          "sequence": 1,
          "timestamp": 0,
        },
        {
          "event": {
            "goalId": "<goalId>",
            "task": {
              "agentId": "fake",
              "cwd": "<cwd>",
              "dependencies": [],
              "id": "T001",
              "objective": "do it",
              "permissionPolicy": "agent-default",
              "status": "pending",
              "title": "Task",
            },
            "timestamp": 0,
            "type": "task_created",
          },
          "goalId": "<goalId>",
          "id": 2,
          "sequence": 2,
          "timestamp": 0,
        },
        {
          "event": {
            "goalId": "<goalId>",
            "runId": "run_task",
            "taskId": "T001",
            "timestamp": 0,
            "type": "task_started",
          },
          "goalId": "<goalId>",
          "id": 3,
          "sequence": 3,
          "timestamp": 0,
        },
        {
          "event": {
            "event": {
              "text": "parsed output
      ",
              "timestamp": 0,
              "type": "text_delta",
            },
            "goalId": "<goalId>",
            "runId": "run_task",
            "taskId": "T001",
            "timestamp": 0,
            "type": "run_event",
          },
          "goalId": "<goalId>",
          "id": 4,
          "sequence": 4,
          "timestamp": 0,
        },
        {
          "event": {
            "goalId": "<goalId>",
            "result": "success",
            "taskId": "T001",
            "timestamp": 0,
            "type": "task_finished",
          },
          "goalId": "<goalId>",
          "id": 5,
          "sequence": 5,
          "timestamp": 0,
        },
        {
          "event": {
            "goalId": "<goalId>",
            "result": "success",
            "timestamp": 0,
            "type": "goal_finished",
          },
          "goalId": "<goalId>",
          "id": 6,
          "sequence": 6,
          "timestamp": 0,
        },
      ]
    `);
  });

  it("creates versioned goal success and validation/task-graph failure envelopes", async () => {
    const success = envelopeStreamEvent(
      { type: "goal_finished", goalId: "goal_ok", result: "success", timestamp: 100 },
      { kind: "goal", id: "goal_ok" },
      1,
    );
    const validationFailed = envelopeStreamEvent(
      { type: "task_finished", goalId: "goal_bad", taskId: "T001", result: "failed", timestamp: 101 },
      { kind: "goal", id: "goal_bad" },
      2,
      "AGENT_VALIDATION_FAILED",
    );
    const taskGraphInvalid = envelopeStreamEvent(
      {
        type: "scheduler_error",
        code: "AGENT_TASK_GRAPH_INVALID",
        message: "Task T001 field validationCommands must be a string[]",
        timestamp: 102,
      },
      { kind: "goal", id: "goal_invalid" },
      3,
    );

    expect(success.terminal).toEqual({ result: "success", reason: "success" });
    expect(validationFailed.terminal).toEqual({ result: "failed", reason: "validation_failed" });
    expect(terminalContractFromEvent(taskGraphInvalid.event)).toEqual({ result: "failed", reason: "task_graph_invalid" });
  });

  it("prints compatible versioned envelopes for run stream jsonl and replay-run jsonl", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeCodexFixture(binDir, "run");

    const stream = (await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      "codex",
      "--cwd",
      cwd,
      "--prompt",
      "persist-run",
      "--stream",
      "jsonl",
      "--storage-dir",
      storageDir,
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CODEX_BIN: path.join(binDir, "codex"),
      },
    })).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const runId = stream[0].scope.id;
    const replay = (await execFileP(process.execPath, [
      cli,
      "replay-run",
      runId,
      "--storage-dir",
      storageDir,
      "--jsonl",
    ])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));

    expect(stream[0]).toMatchObject({
      schemaVersion: "agent-runtime.event.v1",
      id: 1,
      sequence: 1,
      scope: { kind: "run", id: runId },
      event: { type: "run_started" },
    });
    expect(replay.map((event) => event.sequence)).toEqual(stream.map((event) => event.sequence));
    expect(replay.map((event) => event.scope)).toEqual(stream.map((event) => event.scope));
    expect(replay.at(-1)).toMatchObject({ terminal: { result: "success", reason: "success" } });
  }, 30_000);

  it("prints compatible versioned envelopes for goal stream jsonl and replay-goal jsonl", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeCodexFixture(binDir, "goal");

    const stream = (await execFileP(process.execPath, [
      cli,
      "goal",
      "--agent",
      "codex",
      "--cwd",
      cwd,
      "--prompt",
      "ship mvp",
      "--stream",
      "jsonl",
      "--storage-dir",
      storageDir,
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CODEX_BIN: path.join(binDir, "codex"),
      },
    })).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const goalId = stream[0].scope.id;
    const replay = (await execFileP(process.execPath, [
      cli,
      "replay-goal",
      goalId,
      "--storage-dir",
      storageDir,
      "--jsonl",
    ])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));

    expect(stream[0]).toMatchObject({
      schemaVersion: "agent-runtime.event.v1",
      id: 1,
      sequence: 1,
      scope: { kind: "goal", id: goalId },
      event: { type: "goal_started" },
    });
    expect(replay.map((event) => event.sequence)).toEqual(stream.map((event) => event.sequence));
    expect(replay.map((event) => event.scope)).toEqual(stream.map((event) => event.scope));
    expect(replay.at(-1)).toMatchObject({ terminal: { result: "success", reason: "success" } });
  }, 30_000);

  it("prints validation_failed terminal reasons for real goal validation failures", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeCodexFixture(binDir, "goal-validation");

    const stream = (await execFileP(process.execPath, [
      cli,
      "goal",
      "--agent",
      "codex",
      "--cwd",
      cwd,
      "--prompt",
      "ship mvp",
      "--stream",
      "jsonl",
      "--storage-dir",
      storageDir,
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CODEX_BIN: path.join(binDir, "codex"),
      },
    })).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const goalId = stream[0].scope.id;
    const replay = (await execFileP(process.execPath, [
      cli,
      "replay-goal",
      goalId,
      "--storage-dir",
      storageDir,
      "--jsonl",
    ])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));

    expect(stream.find((event) => event.event.type === "task_finished")).toMatchObject({
      terminal: { result: "failed", reason: "validation_failed" },
    });
    expect(stream.at(-1)).toMatchObject({
      event: { type: "goal_finished", result: "failed", reason: "validation_failed" },
      terminal: { result: "failed", reason: "validation_failed" },
    });
    expect(replay.at(-1)).toMatchObject({
      event: { type: "goal_finished", result: "failed", reason: "validation_failed" },
      terminal: { result: "failed", reason: "validation_failed" },
    });
  }, 30_000);
});

describe("diagnostics and conformance schema contract", () => {
  it("keeps diagnostics bundle v1 fields redacted", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_diagnostics_contract";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: "/tmp/private-contract-path",
      status: "failed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: null,
      signal: null,
      error: "Bearer " + "B".repeat(20),
      errorCode: "AGENT_TIMEOUT",
      diagnostics: [{
        code: "AGENT_TIMEOUT",
        message: "ANTHROPIC_AUTH_TOKEN=secret-value cwd=/tmp/private-contract-path",
        stdoutTail: "token sk" + "A".repeat(20),
      }],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: Date.now(),
      event: { type: "run_finished", result: "failed", exitCode: null, signal: null, timestamp: Date.now() },
    })}\n`, "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const bundle = await runtime.exportDiagnostics({ kind: "run", runId });
    await runtime.shutdown("test complete");
    const text = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      schemaVersion: "agent-runtime.diagnostics.v1",
      subject: { kind: "run", id: runId },
      events: { total: 1, retained: 1, terminalEvent: true, eventTypes: { run_finished: 1 } },
      diagnostics: [expect.objectContaining({ code: "AGENT_TIMEOUT" })],
      storageDiagnostics: [],
      consistencyWarnings: [],
      supervisorSummary: { kind: "run", status: "failed", terminalReason: "timeout" },
      adapterSummary: { kind: "run", agentId: "fake" },
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("private-contract-path");
    expect(text).not.toContain(`sk${"A".repeat(20)}`);
  });

  it("prints a versioned conformance summary with stable adapter fields", async () => {
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "fixtures",
      "--json",
    ])).stdout);

    expect(conformance).toMatchObject({
      schemaVersion: "agent-runtime.conformance.v1",
      ok: true,
      mode: "fixtures",
      agents: expect.arrayContaining([
        expect.objectContaining({
          adapter: "codex",
          version: null,
          resolvedExecutable: null,
          auth: "not_checked",
          modelsSource: "fixtures",
          capabilities: expect.objectContaining({ streaming: true, prompt: ["stdin"] }),
          argvProfile: expect.objectContaining({
            defaultArgs: expect.arrayContaining(["exec", "--json", "-C", "<cwd>"]),
            knownFlags: expect.arrayContaining([expect.objectContaining({ flag: "--json", status: "known" })]),
            needsVerification: expect.arrayContaining([expect.objectContaining({ mapsTo: "session" })]),
          }),
          promptTransport: "stdin:text",
          parserMode: "codex-json",
          runClassification: "success",
          expectedTextMatched: null,
          observedTextTail: null,
          cwdMutated: null,
          diagnosticsCount: 0,
          diagnostics: [],
          skippedReason: null,
          failureReason: null,
        }),
      ]),
    });
  }, 30_000);
});

async function writeCodexFixture(binDir: string, mode: "run" | "goal" | "goal-validation"): Promise<void> {
  const taskGraph = JSON.stringify({
    tasks: [
      {
        id: "T001",
        title: "First",
        objective: "Reply with task ok",
        dependencies: [],
        validationCommands: [mode === "goal-validation" ? "node -e \"process.exit(7)\"" : "node -e \"process.exit(0)\""],
      },
    ],
  });
  await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli event-contract"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-contract", display_name: "GPT Contract" }] })); process.exit(0); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started" }));
  if (${JSON.stringify(mode)} !== "run" && input.includes("Return strict JSON")) {
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ${JSON.stringify(taskGraph)} } }));
    return;
  }
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime event contract ok" } }));
});
`);
}

function normalize(value: unknown, ids: { runId?: string; goalId?: string; cwd: string }): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, ids));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "timestamp") {
      out[key] = 0;
    } else if (typeof child === "string" && ids.runId && child === ids.runId) {
      out[key] = "<runId>";
    } else if (typeof child === "string" && ids.goalId && child === ids.goalId) {
      out[key] = "<goalId>";
    } else if (typeof child === "string" && child === ids.cwd) {
      out[key] = "<cwd>";
    } else {
      out[key] = normalize(child, ids);
    }
  }
  return out;
}
