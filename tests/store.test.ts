import { describe, expect, it } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAgentRuntime } from "../src/index.js";
import { JsonFileStorage } from "../src/storage/file-storage.js";
import { tempDir } from "./helpers.js";

describe("durable local store", () => {
  it("reports an empty store as healthy", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });

    const health = await runtime.inspectStore();

    expect(health).toMatchObject({
      ok: true,
      totals: { runs: 0, goals: 0 },
      corruptManifests: [],
      corruptEventLogs: [],
      partialTails: [],
      warnings: [],
    });
  });

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
    const health = await runtime.inspectStore();
    expect(health.ok).toBe(false);
    expect(health.totals.runs).toBe(2);
    expect(health.corruptManifests).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: badRunId, file: `runs/${badRunId}/manifest.json` }),
    ]));
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
    const health = await runtime.inspectStore();
    expect(health.ok).toBe(false);
    expect(health.totals.goals).toBe(2);
    expect(health.corruptManifests).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "goal", id: badGoalId, file: `goals/${badGoalId}/manifest.json` }),
    ]));
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
      `${JSON.stringify({ id: 1, sequence: 1, timestamp: Date.now(), event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: Date.now() } })}\n{"id":2,"sequence":2,"token":"Bearer ${"B".repeat(20)}","cwd":"/tmp/private-tail"`,
      "utf8",
    );

    const runtime = createAgentRuntime({ storageDir });
    const run = await runtime.getRun(runId);
    const events = await runtime.replayRunEvents(runId);

    expect(events[0]).toMatchObject({ id: 1, sequence: 1 });
    expect(run?.diagnostics.some((item) => item.code === "AGENT_EVENT_LOG_CORRUPT")).toBe(true);
    expect(events.some((record) => record.event.type === "error" && record.event.code === "AGENT_EVENT_LOG_CORRUPT")).toBe(true);
    const health = await runtime.inspectStore();
    const healthText = JSON.stringify(health);
    expect(health.partialTails).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: runId, line: 2, retainedEventCount: 1 }),
    ]));
    expect(healthText).not.toContain("Bearer");
    expect(healthText).not.toContain("private-tail");
  });

  it("warns when a terminal run manifest is missing its terminal event", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_missing_terminal_event";
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
    await writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: Date.now(),
      event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: Date.now() },
    })}\n`, "utf8");

    const health = await createAgentRuntime().inspectStore({ storageDir });

    expect(health.ok).toBe(false);
    expect(health.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: runId, code: "AGENT_STORE_TERMINAL_EVENT_MISSING" }),
    ]));
  });

  it("warns when a run event log is terminal but the manifest is non-terminal", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_terminal_event_active_manifest";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: Date.now(),
      event: { type: "run_finished", result: "success", exitCode: 0, signal: null, timestamp: Date.now() },
    })}\n`, "utf8");

    const health = await createAgentRuntime().inspectStore({ storageDir });

    expect(health.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: runId, code: "AGENT_STORE_TERMINAL_EVENT_MANIFEST_MISMATCH" }),
    ]));
    expect(health.activeInterrupted).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: runId }),
    ]));
  });

  it("exports a redacted run diagnostics bundle with manifest, event summary, and diagnostics", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_bundle";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: "/tmp/private-run-tail",
      status: "failed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: 1,
      signal: null,
      error: "ANTHROPIC_AUTH_TOKEN=secret-value Bearer " + "B".repeat(20),
      errorCode: "AGENT_EXECUTION_FAILED",
      diagnostics: [{
        code: "AGENT_EXECUTION_FAILED",
        message: "token=sk" + "A".repeat(20) + " cwd=/tmp/private-run-tail",
        path: "/tmp/private-run-tail/tool",
      }],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: Date.now(),
      event: { type: "error", code: "AGENT_EXECUTION_FAILED", message: "Bearer " + "C".repeat(20), timestamp: Date.now() },
    })}\n`, "utf8");

    const bundle = await createAgentRuntime({ storageDir }).exportDiagnostics({ kind: "run", runId });
    const text = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      schemaVersion: "agent-runtime.diagnostics.v1",
      subject: { kind: "run", id: runId },
      events: { total: 1, retained: 1, eventTypes: { error: 1 } },
      adapterSummary: { kind: "run", agentId: "fake" },
    });
    expect(bundle.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AGENT_EXECUTION_FAILED" }),
    ]));
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("private-run-tail");
  });

  it("exports a redacted goal diagnostics bundle with task attempt evidence", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const goalId = "goal_bundle";
    const goalDir = path.join(storageDir, "goals", goalId);
    await mkdir(goalDir, { recursive: true });
    await writeFile(path.join(goalDir, "manifest.json"), JSON.stringify({
      id: goalId,
      cwd: "/tmp/private-goal-tail",
      objective: "ship without Bearer " + "B".repeat(20),
      status: "failed",
      result: "failed",
      tasks: [{
        id: "T001",
        title: "First",
        objective: "do first",
        status: "failed",
        dependencies: [],
        agentId: "fake",
        cwd: "/tmp/private-goal-tail",
        permissionPolicy: "workspace-write",
        evidence: {
          runId: "run_attempt",
          result: "failed",
          attempts: [{
            attemptId: "T001:attempt:1",
            runId: "run_attempt",
            startedAt: Date.now(),
            finishedAt: Date.now(),
            result: "failed",
            diagnostics: [{ code: "AGENT_EXECUTION_FAILED", message: "ANTHROPIC_AUTH_TOKEN=secret-value" }],
          }],
          validationCommands: ["npm test"],
          validationResults: [{
            command: "npm test",
            exitCode: 1,
            stdout: "token=sk" + "A".repeat(20),
            stderr: "Bearer " + "C".repeat(20),
            durationMs: 1,
            passed: false,
          }],
          summary: "failed",
        },
      }],
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }), "utf8");
    await writeFile(path.join(goalDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: Date.now(),
      event: { type: "goal_finished", goalId, result: "failed", timestamp: Date.now() },
    })}\n`, "utf8");

    const bundle = await createAgentRuntime({ storageDir }).exportDiagnostics({ kind: "goal", goalId });
    const text = JSON.stringify(bundle);

    expect(bundle.attemptEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "T001", attempt: expect.objectContaining({ runId: "run_attempt" }) }),
    ]));
    expect(bundle.adapterSummary).toMatchObject({ kind: "goal", taskAgentIds: ["fake"] });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("private-goal-tail");
  });
});
