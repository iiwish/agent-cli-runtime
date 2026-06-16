import { describe, expect, it } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAgentRuntime } from "../src/index.js";
import { JsonFileStorage } from "../src/storage/file-storage.js";
import { tempDir } from "./helpers.js";

describe("durable local store", () => {
  it("creates the store directory tree automatically", async () => {
    const root = path.join(await tempDir(), "nested", "agent-runtime");

    new JsonFileStorage(root);

    await expect(stat(path.join(root, "runs"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(root, "goals"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("keeps a corrupt run manifest queryable and reports a diagnostic", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const goodRunId = "run_good_record";
    const badRunId = "run_bad_record";
    await mkdir(path.join(storageDir, "runs", goodRunId), { recursive: true });
    await mkdir(path.join(storageDir, "runs", badRunId), { recursive: true });
    await writeFile(path.join(storageDir, "runs", goodRunId, "manifest.json"), JSON.stringify({
      id: goodRunId,
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
    await writeFile(path.join(storageDir, "runs", goodRunId, "events.jsonl"), "", "utf8");
    await writeFile(path.join(storageDir, "runs", badRunId, "manifest.json"), "{", "utf8");

    const runtime = createAgentRuntime({ storageDir });

    expect(await runtime.getRun(goodRunId)).toMatchObject({ id: goodRunId, status: "succeeded" });
    expect(await runtime.getRun(badRunId)).toMatchObject({
      id: badRunId,
      status: "failed",
      errorCode: "AGENT_STORE_RECORD_CORRUPT",
    });
    const badRun = await runtime.getRun(badRunId);
    expect(badRun?.diagnostics.some((item) => item.code === "AGENT_STORE_RECORD_CORRUPT")).toBe(true);
  });

  it("keeps a structurally corrupt run manifest from crashing runtime initialization", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const badRunId = "run_bad_shape";
    await mkdir(path.join(storageDir, "runs", badRunId), { recursive: true });
    await writeFile(path.join(storageDir, "runs", badRunId, "manifest.json"), JSON.stringify({}), "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const badRun = await runtime.getRun(badRunId);

    expect(badRun).toMatchObject({
      id: badRunId,
      status: "failed",
      errorCode: "AGENT_STORE_RECORD_CORRUPT",
    });
    expect(badRun?.diagnostics.some((item) => item.code === "AGENT_STORE_RECORD_CORRUPT")).toBe(true);
  });

  it("keeps a corrupt goal manifest queryable and reports a diagnostic", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const goodGoalId = "goal_good_record";
    const badGoalId = "goal_bad_record";
    await mkdir(path.join(storageDir, "goals", goodGoalId), { recursive: true });
    await mkdir(path.join(storageDir, "goals", badGoalId), { recursive: true });
    await writeFile(path.join(storageDir, "goals", goodGoalId, "manifest.json"), JSON.stringify({
      id: goodGoalId,
      cwd: await tempDir(),
      objective: "good",
      status: "succeeded",
      tasks: [],
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: "success",
    }), "utf8");
    await writeFile(path.join(storageDir, "goals", goodGoalId, "events.jsonl"), "", "utf8");
    await writeFile(path.join(storageDir, "goals", badGoalId, "manifest.json"), "{", "utf8");

    const runtime = createAgentRuntime({ storageDir });

    expect(await runtime.getGoal(goodGoalId)).toMatchObject({ id: goodGoalId, status: "succeeded" });
    expect(await runtime.getGoal(badGoalId)).toMatchObject({
      id: badGoalId,
      status: "failed",
    });
    const badGoal = await runtime.getGoal(badGoalId);
    expect(badGoal?.result).toBe("failed");
    expect(badGoal?.diagnostics.some((item) => item.code === "AGENT_STORE_RECORD_CORRUPT")).toBe(true);
  });

  it("keeps a structurally corrupt goal manifest from crashing runtime initialization", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const emptyGoalId = "goal_bad_shape";
    const badTasksGoalId = "goal_bad_tasks";
    const badTaskEntryGoalId = "goal_bad_task_entry";
    await mkdir(path.join(storageDir, "goals", emptyGoalId), { recursive: true });
    await mkdir(path.join(storageDir, "goals", badTasksGoalId), { recursive: true });
    await mkdir(path.join(storageDir, "goals", badTaskEntryGoalId), { recursive: true });
    await writeFile(path.join(storageDir, "goals", emptyGoalId, "manifest.json"), JSON.stringify({}), "utf8");
    await writeFile(path.join(storageDir, "goals", badTasksGoalId, "manifest.json"), JSON.stringify({
      id: badTasksGoalId,
      cwd: await tempDir(),
      objective: "bad tasks",
      status: "running",
      tasks: "not-an-array",
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }), "utf8");
    await writeFile(path.join(storageDir, "goals", badTaskEntryGoalId, "manifest.json"), JSON.stringify({
      id: badTaskEntryGoalId,
      cwd: await tempDir(),
      objective: "bad task entry",
      status: "running",
      tasks: [null],
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }), "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const emptyGoal = await runtime.getGoal(emptyGoalId);
    const badTasksGoal = await runtime.getGoal(badTasksGoalId);
    const badTaskEntryGoal = await runtime.getGoal(badTaskEntryGoalId);

    for (const goal of [emptyGoal, badTasksGoal, badTaskEntryGoal]) {
      expect(goal).toMatchObject({ status: "failed", result: "failed" });
      expect(goal?.diagnostics.some((item) => item.code === "AGENT_STORE_RECORD_CORRUPT")).toBe(true);
    }
  });

  it("redacts secret-looking diagnostics before writing to disk", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });
    const cwd = await tempDir();
    const secret = `sk${"A".repeat(20)}`;

    const handle = await runtime.run({ agentId: `missing-${secret}`, cwd, prompt: "hello" });
    for await (const _event of handle.events) {
      void _event;
    }

    const manifest = await readFile(path.join(storageDir, "runs", handle.runId, "manifest.json"), "utf8");
    const events = await readFile(path.join(storageDir, "runs", handle.runId, "events.jsonl"), "utf8");
    expect(`${manifest}\n${events}`).toContain("[REDACTED]");
    expect(`${manifest}\n${events}`).not.toContain(secret);
  });

  it("replays the valid prefix of a partial run JSONL log and reports a diagnostic", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_partial_jsonl";
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
    await writeFile(
      path.join(runDir, "events.jsonl"),
      `${JSON.stringify({ id: 1, sequence: 1, timestamp: Date.now(), event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: Date.now() } })}\n{"id":2,"sequence":2`,
      "utf8",
    );

    const runtime = createAgentRuntime({ storageDir });
    const run = await runtime.getRun(runId);
    const events = await runtime.replayRunEvents(runId);

    expect(events[0]).toMatchObject({ id: 1, sequence: 1 });
    expect(run?.diagnostics.some((item) => item.code === "AGENT_EVENT_LOG_CORRUPT")).toBe(true);
    expect(events.some((record) => record.event.type === "error" && record.event.code === "AGENT_EVENT_LOG_CORRUPT")).toBe(true);
  });
});
