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
});
