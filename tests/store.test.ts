import { describe, expect, it } from "vitest";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { createAgentRuntime } from "../src/index.js";
import { RunStore } from "../src/runs/run-store.js";
import { JsonFileStorage } from "../src/storage/file-storage.js";
import {
  getStoredGoal,
  getStoredRun,
  exportDiagnosticsBundle,
  inspectStoreDirectory,
  inspectStoreLock,
  inspectStoreRepair,
  inspectStoreRepairDryRun,
  listStoredGoals,
  listStoredRuns,
  replayStoredRunEvents,
} from "../src/storage/store-inspection.js";
import { StorageLease } from "../src/storage/storage-lease.js";
import { tempDir } from "./helpers.js";

const execFileP = promisify(execFile);
const cli = path.resolve(import.meta.dirname, "..", "dist", "cli", "main.js");

describe("durable local store", () => {
  it("blocks two writer runtimes from opening the same storage dir", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });

    expect(() => createAgentRuntime({ storageDir })).toThrow(/already open for writing/u);

    const health = await runtime.inspectStore();
    expect(health.lock).toMatchObject({ status: "live", owner: expect.objectContaining({ pid: process.pid }) });
    await runtime.shutdown("test complete");
  });

  it("takes over a stale storage lock and records a redacted diagnostic", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeFile(path.join(storageDir, "runtime.lock.json"), JSON.stringify({
      runtimeInstanceId: "runtime_stale",
      pid: 999_999,
      startedAt: Date.now() - 120_000,
      heartbeatAt: Date.now() - 120_000,
    }), "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const health = await runtime.inspectStore();
    const text = JSON.stringify(health);

    expect(health.lock).toMatchObject({ status: "live", owner: expect.objectContaining({ pid: process.pid }) });
    expect(health.storageDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AGENT_STORAGE_LEASE_TAKEOVER" }),
    ]));
    expect(text).not.toContain(storageDir);
    expect(text).not.toContain("AUTH_TOKEN");
    await runtime.shutdown("test complete");
  });

  it("does not let an old lease overwrite a new lock owner after takeover", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const oldLease = StorageLease.acquire(storageDir);
    const newOwner = {
      runtimeInstanceId: "runtime_new_owner",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    await writeFile(path.join(storageDir, "runtime.lock.json"), JSON.stringify(newOwner), "utf8");
    const guardedStorage = new JsonFileStorage(storageDir, { canWrite: () => oldLease.ownsCurrentLock() });
    const cwd = await tempDir();

    expect(oldLease.heartbeat()).toBeUndefined();
    expect(oldLease.close()).toBeUndefined();
    expect(() => guardedStorage.writeRunManifest({
      id: "run_lost_lease",
      agentId: "fake",
      cwd,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    })).toThrow(/storage lease is no longer held/u);
    const lock = JSON.parse(await readFile(path.join(storageDir, "runtime.lock.json"), "utf8"));
    expect(lock).toMatchObject(newOwner);
  });

  it("exposes test-only storage lease fault hooks for acquire and close", async () => {
    const acquireDir = await tempDir("agent-runtime-storage-");
    expect(() => StorageLease.acquire(acquireDir, {
      faults: {
        beforeAcquire: () => {
          throw new Error("lock acquire fault");
        },
      },
    })).toThrow(/lock acquire fault/u);
    await expect(stat(path.join(acquireDir, "runtime.lock.json"))).rejects.toThrow();

    const closeDir = await tempDir("agent-runtime-storage-");
    const lease = StorageLease.acquire(closeDir, {
      faults: {
        beforeClose: () => {
          throw new Error("lock close fault");
        },
      },
    });
    expect(() => lease.close()).toThrow(/lock close fault/u);
    expect(inspectStoreLock(closeDir)).toMatchObject({ status: "live" });
  });

  it("lets read-only inspection commands inspect a live owner without taking the writer lock", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });

    const lock = inspectStoreLock(storageDir);
    const health = inspectStoreDirectory(storageDir);
    const runs = listStoredRuns(storageDir);

    expect(lock).toMatchObject({ status: "live", owner: expect.objectContaining({ pid: process.pid }) });
    expect(health.lock.status).toBe("live");
    expect(runs).toEqual([]);
    await runtime.shutdown("test complete");
  });

  it("marks the lock closed on shutdown", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });

    await runtime.shutdown("test shutdown");

    expect(inspectStoreLock(storageDir)).toMatchObject({ status: "closed", owner: expect.objectContaining({ closedAt: expect.any(Number) }) });
  });

  it("does not interrupt live-owner active records when a second writer is refused", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });
    const owner = inspectStoreLock(storageDir).owner;
    const runId = "run_live_owner";
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
      owner,
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), "", "utf8");

    expect(() => createAgentRuntime({ storageDir })).toThrow(/already open for writing/u);
    const manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json"), "utf8"));
    const health = inspectStoreDirectory(storageDir);

    expect(manifest).toMatchObject({ status: "running", errorCode: null });
    expect(health.activeRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: runId, ownerStatus: "live" }),
    ]));
    expect(health.activeInterrupted).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: runId }),
    ]));
    await runtime.shutdown("test complete");
  });

  it("recovers a stale-owner active run as interrupted", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_stale_owner";
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
      owner: {
        runtimeInstanceId: "runtime_old",
        pid: 999_999,
        startedAt: Date.now() - 120_000,
        heartbeatAt: Date.now() - 120_000,
      },
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), "", "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const run = await runtime.getRun(runId);

    expect(run).toMatchObject({ status: "failed", errorCode: "AGENT_RUNTIME_INTERRUPTED", signal: "RUNTIME_RESTART" });
    expect(run?.owner).toMatchObject({ pid: process.pid });
    await runtime.shutdown("test complete");
  });

  it("reports an empty store as healthy", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });

    const health = await runtime.inspectStore();

    expect(health).toMatchObject({
      schemaVersion: "agent-runtime.storeHealth.v1",
      ok: true,
      lock: { status: "live" },
      totals: { runs: 0, goals: 0 },
      corruptManifests: [],
      corruptEventLogs: [],
      partialTails: [],
      warnings: [],
    });
    await runtime.shutdown("test complete");
  });

  it("creates the store directory tree automatically", async () => {
    const root = path.join(await tempDir(), "nested", "agent-runtime");

    new JsonFileStorage(root);

    await expect(stat(path.join(root, "runs"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(root, "goals"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it("keeps the old manifest readable when an atomic rename fails", async () => {
    const root = await tempDir("agent-runtime-storage-");
    const cwd = await tempDir();
    const now = Date.now();
    const storage = new JsonFileStorage(root);
    storage.writeRunManifest({
      id: "run_atomic_rename",
      agentId: "fake",
      cwd,
      status: "running",
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    });
    const failingStorage = new JsonFileStorage(root, {
      faults: {
        beforeManifestRename: () => {
          throw new Error("rename interrupted token=sk" + "A".repeat(20));
        },
      },
    });

    expect(() => failingStorage.writeRunManifest({
      id: "run_atomic_rename",
      agentId: "fake",
      cwd,
      status: "succeeded",
      createdAt: now,
      updatedAt: now + 1,
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    })).toThrow(/rename interrupted/u);

    const manifest = JSON.parse(await readFile(path.join(root, "runs", "run_atomic_rename", "manifest.json"), "utf8"));
    const leftovers = await readdir(path.join(root, "runs", "run_atomic_rename"));
    expect(manifest).toMatchObject({ status: "running", exitCode: null });
    expect(leftovers.filter((file) => file.includes(".manifest.") && file.endsWith(".tmp"))).toEqual([]);
  });

  it("persists a failed manifest diagnostic when JSONL append fails", async () => {
    const root = await tempDir("agent-runtime-storage-");
    const cwd = await tempDir();
    const storage = new JsonFileStorage(root, {
      faults: {
        beforeJsonlAppend: () => {
          throw new Error("append failed Bearer " + "B".repeat(20) + " cwd=/tmp/private-append");
        },
      },
    });
    const store = new RunStore(2_000, storage);
    const run = store.create({ agentId: "fake", cwd });
    const pendingEvents = collectRunEvents(store.events(run.id));

    store.append(run.id, { type: "status", label: "must fail persist", timestamp: Date.now() });

    const record = store.get(run.id);
    const manifestText = await readFile(path.join(root, "runs", run.id, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    const delivered = await pendingEvents;
    expect(record).toMatchObject({ status: "failed", errorCode: "AGENT_EVENT_PERSIST_FAILED" });
    expect(manifest).toMatchObject({ status: "failed", errorCode: "AGENT_EVENT_PERSIST_FAILED" });
    expect(delivered.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
    expect(manifestText).toContain("[REDACTED]");
    expect(manifestText).not.toContain("Bearer");
    expect(manifestText).not.toContain("private-append");
  });

  it("uses fsync durability hooks for manifest atomic writes and JSONL appends", async () => {
    const root = await tempDir("agent-runtime-storage-");
    const calls: string[] = [];
    const storage = new JsonFileStorage(root, {
      durability: "fsync",
      sync: {
        fdatasyncSync: () => calls.push("fdatasync"),
        fsyncSync: () => calls.push("fsync"),
      },
    });
    const now = Date.now();

    storage.writeRunManifest({
      id: "run_fsync",
      agentId: "fake",
      cwd: await tempDir(),
      status: "running",
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    });
    storage.appendRunEvent("run_fsync", {
      id: 1,
      sequence: 1,
      runId: "run_fsync",
      timestamp: now,
      event: { type: "status", label: "synced", timestamp: now },
    });

    expect(calls.filter((call) => call === "fdatasync")).toHaveLength(2);
    expect(calls).toContain("fsync");
  });

  it("falls back gracefully when fsync durability hooks are unavailable", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const storage = new JsonFileStorage(storageDir, {
      durability: "fsync",
      sync: {
        fdatasyncSync: () => {
          throw new Error("fdatasync unsupported");
        },
        fsyncSync: () => {
          throw new Error("fsync unsupported");
        },
      },
    });
    const now = Date.now();

    expect(() => storage.writeRunManifest({
      id: "run_fsync_fallback",
      agentId: "fake",
      cwd: "/tmp/private-fsync-fallback",
      status: "running",
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    })).not.toThrow();

    expect(storage.getDurabilityDiagnostics().join("\n")).toContain("Storage manifest sync fallback");
    expect(storage.getDurabilityDiagnostics().join("\n")).not.toContain("private-fsync-fallback");
    const health = await createAgentRuntime().inspectStore({ storageDir });
    const healthText = JSON.stringify(health);
    expect(health.ok).toBe(false);
    expect(health.storageDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AGENT_STORAGE_SYNC_FALLBACK", message: expect.stringContaining("Storage manifest sync fallback") }),
    ]));
    expect(health.diagnostics.byCode.AGENT_STORAGE_SYNC_FALLBACK).toBeGreaterThanOrEqual(1);
    expect(healthText).not.toContain("private-fsync-fallback");
    const bundle = await createAgentRuntime().exportDiagnostics({ kind: "run", runId: "run_fsync_fallback", storageDir });
    expect(bundle.storageDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AGENT_STORAGE_SYNC_FALLBACK" }),
    ]));
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

  it("uses the same strict run manifest validation for runtime load and health scan", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const badRunId = "run_superficially_valid_bad_shape";
    await mkdir(path.join(storageDir, "runs", badRunId), { recursive: true });
    await writeFile(path.join(storageDir, "runs", badRunId, "manifest.json"), JSON.stringify({
      id: badRunId,
      status: "succeeded",
    }), "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const badRun = await runtime.getRun(badRunId);
    const health = await runtime.inspectStore();

    expect(badRun).toMatchObject({ id: badRunId, status: "failed", errorCode: "AGENT_STORE_RECORD_CORRUPT" });
    expect(health.ok).toBe(false);
    expect(health.corruptManifests).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: badRunId, reason: expect.stringContaining("agentId must be a string") }),
    ]));
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

  it("uses the same strict goal manifest validation for runtime load and health scan", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const badGoalId = "goal_superficially_valid_bad_shape";
    await mkdir(path.join(storageDir, "goals", badGoalId), { recursive: true });
    await writeFile(path.join(storageDir, "goals", badGoalId, "manifest.json"), JSON.stringify({
      id: badGoalId,
      status: "succeeded",
      tasks: [],
    }), "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const badGoal = await runtime.getGoal(badGoalId);
    const health = await runtime.inspectStore();

    expect(badGoal).toMatchObject({ id: badGoalId, status: "failed", result: "failed" });
    expect(health.ok).toBe(false);
    expect(health.corruptManifests).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "goal", id: badGoalId, reason: expect.stringContaining("cwd must be a string") }),
    ]));
  });

  it("returns corrupt manifest placeholders from read-only status and list helpers", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const badRunId = "run_readonly_bad_manifest";
    const badGoalId = "goal_readonly_bad_manifest";
    await mkdir(path.join(storageDir, "runs", badRunId), { recursive: true });
    await mkdir(path.join(storageDir, "goals", badGoalId), { recursive: true });
    await writeFile(path.join(storageDir, "runs", badRunId, "manifest.json"), "{", "utf8");
    await writeFile(path.join(storageDir, "goals", badGoalId, "manifest.json"), "{", "utf8");

    expect(getStoredRun(storageDir, badRunId)).toMatchObject({
      id: badRunId,
      status: "failed",
      errorCode: "AGENT_STORE_RECORD_CORRUPT",
      diagnostics: [expect.objectContaining({ code: "AGENT_STORE_RECORD_CORRUPT" })],
    });
    expect(listStoredRuns(storageDir, { status: "failed" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: badRunId, errorCode: "AGENT_STORE_RECORD_CORRUPT" }),
    ]));
    expect(getStoredGoal(storageDir, badGoalId)).toMatchObject({
      id: badGoalId,
      status: "failed",
      result: "failed",
      diagnostics: [expect.objectContaining({ code: "AGENT_STORE_RECORD_CORRUPT" })],
    });
    expect(listStoredGoals(storageDir, { status: "failed" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: badGoalId, result: "failed" }),
    ]));
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
      expect.objectContaining({
        kind: "run",
        id: runId,
        line: 2,
        retainedEventCount: 1,
        corruptLineCount: 1,
        partialTailDetected: true,
        lastGoodEventId: 1,
        lastGoodSequence: 1,
        repairRecommendation: "truncate_partial_tail",
        redactedTailPreview: expect.stringContaining("[REDACTED]"),
      }),
    ]));
    expect(health.totals).toMatchObject({ corruptEventLogLines: 1, partialEventLogTails: 1 });
    expect(healthText).not.toContain("Bearer");
    expect(healthText).not.toContain("private-tail");
  });

  it("continues past corrupt middle JSONL lines and reports health diagnostics", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_middle_corrupt_jsonl";
    const runDir = path.join(storageDir, "runs", runId);
    const now = Date.now();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    await writeFile(
      path.join(runDir, "events.jsonl"),
      [
        JSON.stringify({ id: 1, sequence: 1, timestamp: now, event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: now } }),
        `{"id":2,"sequence":2,"token":"sk${"A".repeat(20)}"}`,
        JSON.stringify({ id: 3, sequence: 3, timestamp: now, event: { type: "run_finished", result: "success", exitCode: 0, signal: null, timestamp: now } }),
        "",
      ].join("\n"),
      "utf8",
    );

    const runtime = createAgentRuntime({ storageDir });
    const events = await runtime.replayRunEvents(runId);
    const health = await runtime.inspectStore();
    const text = JSON.stringify(health);

    expect(events.map((record) => record.id)).toEqual([1, 3, 4]);
    expect(events.at(-1)?.event).toMatchObject({ type: "error", code: "AGENT_EVENT_LOG_CORRUPT" });
    expect(health.corruptEventLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: runId,
        line: 2,
        partialTailDetected: false,
        lastGoodEventId: 1,
        lastGoodSequence: 1,
        repairRecommendation: "isolate_corrupt_line",
      }),
    ]));
    expect(text).not.toContain(`sk${"A".repeat(20)}`);
  });

  it("reports redacted repair dry-run actions without modifying corrupt tails", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_repair_dry_run";
    const runDir = path.join(storageDir, "runs", runId);
    const now = Date.now();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    const eventsFile = path.join(runDir, "events.jsonl");
    const original = `${JSON.stringify({ id: 1, sequence: 1, timestamp: now, event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp/private-repair", timestamp: now } })}\n{"id":2,"token":"Bearer ${"B".repeat(20)}","cwd":"/tmp/private-repair"`;
    await writeFile(eventsFile, original, "utf8");

    const report = inspectStoreRepairDryRun(storageDir);
    const after = await readFile(eventsFile, "utf8");
    const text = JSON.stringify(report);

    expect(report).toMatchObject({
      schemaVersion: "agent-runtime.storeRepair.v1",
      dryRun: true,
      applied: false,
      ok: false,
      actions: expect.arrayContaining([expect.objectContaining({
        kind: "run",
        id: runId,
        action: "truncate_partial_tail",
        line: 2,
        retainedEventCount: 1,
        removedLineCount: 1,
        truncatedBytes: expect.any(Number),
        lastGoodEventId: 1,
        applied: false,
        backupPath: null,
        diagnostics: [],
      })]),
    });
    expect(after).toBe(original);
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("private-repair");
  });

  it("applies partial tail repair with a backup and leaves replay prefix usable", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_apply_partial_tail";
    const runDir = path.join(storageDir, "runs", runId);
    const now = Date.now();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    const eventsFile = path.join(runDir, "events.jsonl");
    const first = JSON.stringify({ id: 1, sequence: 1, timestamp: now, event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp/private-apply", timestamp: now } });
    const second = JSON.stringify({ id: 2, sequence: 2, timestamp: now, event: { type: "run_finished", result: "success", exitCode: 0, signal: null, timestamp: now } });
    const original = `${first}\n${second}\n{"id":3,"token":"Bearer ${"B".repeat(20)}","cwd":"/tmp/private-apply"`;
    await writeFile(eventsFile, original, "utf8");

    const report = inspectStoreRepair(storageDir, { apply: true });
    const repaired = await readFile(eventsFile, "utf8");
    const backupText = await readFile(path.join(storageDir, report.actions[0]?.backupPath ?? ""), "utf8");
    const health = inspectStoreDirectory(storageDir);
    const replay = replayStoredRunEvents(storageDir, runId);
    const bundle = exportDiagnosticsBundle({ kind: "run", runId }, storageDir);
    const text = JSON.stringify(report);

    expect(report).toMatchObject({
      schemaVersion: "agent-runtime.storeRepair.v1",
      dryRun: false,
      applied: true,
      ok: true,
      actions: [expect.objectContaining({
        action: "truncate_partial_tail",
        applied: true,
        backupPath: expect.stringContaining("repair-backups/"),
        retainedEventCount: 2,
        removedLineCount: 1,
        truncatedBytes: expect.any(Number),
      })],
    });
    expect(repaired).toBe(`${first}\n${second}\n`);
    expect(backupText).toBe(original);
    expect(health.partialTails).toEqual([]);
    expect(health.ok).toBe(true);
    expect(replay.map((event) => event.id)).toEqual([1, 2]);
    expect(bundle.storageDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AGENT_STORE_REPAIR_APPLIED" }),
    ]));
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("private-apply");
  });

  it("applies middle corrupt line repair, keeps later legal events, and is idempotent", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_apply_middle_corrupt";
    const runDir = path.join(storageDir, "runs", runId);
    const now = Date.now();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    const eventsFile = path.join(runDir, "events.jsonl");
    await writeFile(eventsFile, [
      JSON.stringify({ id: 1, sequence: 1, timestamp: now, event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: now } }),
      `{"id":2,"sequence":2,"token":"sk${"A".repeat(20)}"}`,
      JSON.stringify({ id: 3, sequence: 3, timestamp: now, event: { type: "run_finished", result: "success", exitCode: 0, signal: null, timestamp: now } }),
      "",
    ].join("\n"), "utf8");

    const first = inspectStoreRepair(storageDir, { apply: true });
    const lockAfterFirst = await readFile(path.join(storageDir, "runtime.lock.json"), "utf8");
    const second = inspectStoreRepair(storageDir, { apply: true });
    const lockAfterSecond = await readFile(path.join(storageDir, "runtime.lock.json"), "utf8");
    const repaired = await readFile(eventsFile, "utf8");
    const replayAfterOne = replayStoredRunEvents(storageDir, runId, 1);

    expect(first).toMatchObject({
      applied: true,
      ok: true,
      actions: [expect.objectContaining({
        action: "isolate_corrupt_line",
        applied: true,
        removedLineCount: 1,
        retainedEventCount: 2,
      })],
    });
    expect(repaired).not.toContain(`sk${"A".repeat(20)}`);
    expect(replayAfterOne.map((event) => event.id)).toEqual([3]);
    expect(second).toMatchObject({ applied: false, ok: true, actions: [] });
    expect(lockAfterSecond).toBe(lockAfterFirst);
  });

  it("refuses repair apply while a live writer owner exists", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runtime = createAgentRuntime({ storageDir });
    const runId = "run_live_repair_refused";
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
    const original = `${JSON.stringify({ id: 1, sequence: 1, timestamp: Date.now(), event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: Date.now() } })}\n{"id":2`;
    await writeFile(eventsFile, original, "utf8");

    const report = inspectStoreRepair(storageDir, { apply: true });
    const after = await readFile(eventsFile, "utf8");

    expect(report).toMatchObject({
      applied: false,
      ok: false,
      blockedReason: expect.stringContaining("live writer owner"),
      actions: expect.arrayContaining([expect.objectContaining({ applied: false })]),
    });
    expect(report.actions[0]?.backupPath).toBeNull();
    expect(report.diagnostics.byCode.AGENT_STORE_REPAIR_REFUSED_LIVE_OWNER).toBe(1);
    expect(after).toBe(original);
    await runtime.shutdown("test complete");
  });

  it("does not modify the event log or mark applied when repair backup writing fails", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_backup_failure";
    const runDir = path.join(storageDir, "runs", runId);
    const now = Date.now();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    const eventsFile = path.join(runDir, "events.jsonl");
    const original = `${JSON.stringify({ id: 1, sequence: 1, timestamp: now, event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp/private-backup-fail", timestamp: now } })}\n{"id":2,"token":"Bearer ${"B".repeat(20)}"`;
    await writeFile(eventsFile, original, "utf8");

    const report = inspectStoreRepair(storageDir, {
      apply: true,
      faults: {
        beforeBackupWrite: () => {
          throw new Error("backup write failed Bearer " + "C".repeat(20) + " cwd=/tmp/private-backup-fail");
        },
      },
    });
    const after = await readFile(eventsFile, "utf8");
    const health = inspectStoreDirectory(storageDir);
    const text = JSON.stringify({ report, health });

    expect(report).toMatchObject({
      applied: false,
      ok: false,
      blockedReason: expect.stringContaining("repair apply failed"),
      actions: expect.arrayContaining([expect.objectContaining({ applied: false, backupPath: null })]),
    });
    expect(after).toBe(original);
    expect(health.corruptEventLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: runId }),
    ]));
    expect(health.storageDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AGENT_STORE_REPAIR_FAILED" }),
    ]));
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("private-backup-fail");
  });

  it("keeps backup and original log readable when repair rewrite fails", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_rewrite_failure";
    const runDir = path.join(storageDir, "runs", runId);
    const now = Date.now();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    const eventsFile = path.join(runDir, "events.jsonl");
    const original = `${JSON.stringify({ id: 1, sequence: 1, timestamp: now, event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: now } })}\n{"id":2`;
    await writeFile(eventsFile, original, "utf8");

    const report = inspectStoreRepair(storageDir, {
      apply: true,
      faults: {
        beforeRepairRewrite: () => {
          throw new Error("rewrite failed token=sk" + "A".repeat(20));
        },
      },
    });
    const after = await readFile(eventsFile, "utf8");
    const backupPath = report.actions[0]?.backupPath;
    const health = inspectStoreDirectory(storageDir);
    const text = JSON.stringify({ report, health });

    expect(report).toMatchObject({
      applied: false,
      ok: false,
      actions: expect.arrayContaining([expect.objectContaining({ applied: false, backupPath: expect.stringContaining("repair-backups/") })]),
    });
    expect(backupPath).toBeTruthy();
    await expect(readFile(path.join(storageDir, backupPath ?? ""), "utf8")).resolves.toBe(original);
    expect(after).toBe(original);
    expect(health.corruptEventLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: runId }),
    ]));
    expect(health.storageDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AGENT_STORE_REPAIR_FAILED" }),
    ]));
    expect(text).not.toContain(`sk${"A".repeat(20)}`);
  });

  it("covers goal event log repair and redacts raw corrupt diagnostics", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const goalId = "goal_apply_middle_corrupt";
    const goalDir = path.join(storageDir, "goals", goalId);
    const now = Date.now();
    const rawCorrupt = `{"id":2,"sequence":2,"ANTHROPIC_AUTH_TOKEN":"Bearer ${"C".repeat(20)}","cwd":"/tmp/private-goal-repair"}`;
    await mkdir(goalDir, { recursive: true });
    await writeFile(path.join(goalDir, "manifest.json"), JSON.stringify({
      id: goalId,
      cwd: await tempDir(),
      objective: "repair goal",
      status: "succeeded",
      result: "success",
      tasks: [],
      diagnostics: [],
      createdAt: now,
      updatedAt: now,
    }), "utf8");
    const eventsFile = path.join(goalDir, "events.jsonl");
    await writeFile(eventsFile, [
      JSON.stringify({ id: 1, sequence: 1, timestamp: now, event: { type: "goal_started", goalId, objective: "repair", timestamp: now } }),
      rawCorrupt,
      JSON.stringify({ id: 3, sequence: 3, timestamp: now, event: { type: "goal_finished", goalId, result: "success", timestamp: now } }),
      "",
    ].join("\n"), "utf8");

    const report = inspectStoreRepair(storageDir, { apply: true });
    const repaired = await readFile(eventsFile, "utf8");
    const text = JSON.stringify(report);

    expect(report.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "goal", id: goalId, action: "isolate_corrupt_line", applied: true }),
    ]));
    expect(repaired).not.toContain(rawCorrupt);
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("private-goal-repair");
    expect(text).not.toContain(rawCorrupt);
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

  it("marks health not ok when storage has an active historical record even without consistency warnings", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_active_without_terminal";
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
      event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: Date.now() },
    })}\n`, "utf8");

    const health = await createAgentRuntime().inspectStore({ storageDir });

    expect(health.ok).toBe(false);
    expect(health.warnings).toEqual([]);
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
      supervisorSummary: { kind: "run", status: "failed", terminalReason: "execution_failed", terminalEventCount: 0, lease: { ownerStatus: "missing" } },
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
    expect(bundle.supervisorSummary).toMatchObject({
      kind: "goal",
      status: "failed",
      result: "failed",
      terminalReason: "failed",
      terminalEventCount: 1,
      taskStatusCounts: { failed: 1 },
      lease: { ownerStatus: "missing" },
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("private-goal-tail");
  });

  it("does not let a corrupt lock file block read-only health or diagnostics CLI output", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_corrupt_lock_cli";
    const runDir = path.join(storageDir, "runs", runId);
    const now = Date.now();
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(storageDir, "runtime.lock.json"), "{ not-json Bearer " + "B".repeat(20), "utf8");
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: "/tmp/private-corrupt-lock",
      status: "failed",
      createdAt: now,
      updatedAt: now,
      exitCode: 1,
      signal: null,
      error: "prompt: secret prompt Bearer " + "C".repeat(20),
      errorCode: "AGENT_EXECUTION_FAILED",
      diagnostics: [{
        code: "AGENT_EXECUTION_FAILED",
        message: "ANTHROPIC_AUTH_TOKEN=secret-value prompt=do-not-leak cwd=/tmp/private-corrupt-lock",
        retryable: false,
      }],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: now,
      event: { type: "error", code: "AGENT_EXECUTION_FAILED", message: "raw corrupt line must not appear", timestamp: now },
    })}\n`, "utf8");

    const healthResult = await execFileP(process.execPath, [cli, "store-health", "--storage-dir", storageDir, "--json"]);
    const bundleResult = await execFileP(process.execPath, [cli, "diagnostics", "run", runId, "--storage-dir", storageDir, "--json"]);
    const health = JSON.parse(healthResult.stdout);
    const bundle = JSON.parse(bundleResult.stdout);
    const text = `${healthResult.stdout}\n${bundleResult.stdout}`;

    expect(healthResult.stderr).toBe("");
    expect(bundleResult.stderr).toBe("");
    expect(health).toMatchObject({ schemaVersion: "agent-runtime.storeHealth.v1" });
    expect(health.lock.status).toBe("invalid");
    expect(bundle).toMatchObject({ schemaVersion: "agent-runtime.diagnostics.v1", subject: { kind: "run", id: runId } });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("secret prompt");
    expect(text).not.toContain("do-not-leak");
    expect(text).not.toContain("private-corrupt-lock");
    expect(text).not.toContain(storageDir);
  });
});

async function collectRunEvents<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}
