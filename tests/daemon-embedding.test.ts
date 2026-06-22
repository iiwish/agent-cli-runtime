import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path, { delimiter } from "node:path";
import { promisify } from "node:util";
import { createAgentRuntime } from "../src/index.js";
import { envelopeReplayEvents } from "../src/core/event-contract.js";
import {
  exportDiagnosticsBundle,
  inspectStoreDirectory,
  inspectStoreLock,
  listStoredGoals,
  listStoredRuns,
  replayStoredGoalEvents,
  replayStoredRunEvents,
} from "../src/storage/store-inspection.js";
import { fakeAdapter, fakeCliBody, tempDir, writeExecutable } from "./helpers.js";

const execFileP = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "main.js");

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

function ownerIdentity(manifestOrLock: Record<string, unknown>): Record<string, unknown> | undefined {
  const owner = (manifestOrLock.owner ?? manifestOrLock) as Record<string, unknown> | undefined;
  if (!owner || typeof owner !== "object") return undefined;
  return {
    runtimeInstanceId: owner.runtimeInstanceId,
    pid: owner.pid,
    startedAt: owner.startedAt,
    closedAt: owner.closedAt,
  };
}

function diagnosticCodes(manifest: Record<string, unknown>): string[] {
  const diagnostics = Array.isArray(manifest.diagnostics) ? manifest.diagnostics : [];
  return diagnostics
    .filter((diagnostic): diagnostic is Record<string, unknown> => typeof diagnostic === "object" && diagnostic !== null)
    .map((diagnostic) => diagnostic.code)
    .filter((code): code is string => typeof code === "string");
}

function taskStatuses(manifest: Record<string, unknown>): Array<[string, string]> {
  const tasks = Array.isArray(manifest.tasks) ? manifest.tasks : [];
  return tasks
    .filter((task): task is Record<string, unknown> => typeof task === "object" && task !== null)
    .map((task) => [String(task.id), String(task.status)]);
}

describe("daemon embedding stability gate", () => {
  it("runs the long-lived fake daemon embedding path and reopens terminal records", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-daemon-");
    await writeExecutable(binDir, "fake-agent", fakeCliBody);

    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
      storageDir,
    });

    const detected = await runtime.detect({ includeUnavailable: true });
    const runHandle = await runtime.run({ agentId: "fake", cwd, prompt: "daemon fake task" });
    const runEvents = await collect(runHandle.events);
    const goalHandle = await runtime.createGoal({ cwd, objective: "ship mvp", defaultAgentId: "fake" });
    const goalEvents = await collect(goalHandle.events);
    const runReplay = await runtime.replayRunEvents(runHandle.runId);
    const goalReplay = await runtime.replayGoalEvents(goalHandle.goalId);
    const runEnvelope = envelopeReplayEvents(runReplay).at(-1);
    const goalEnvelope = envelopeReplayEvents(goalReplay).at(-1);
    const health = await runtime.inspectStore();
    const runDiagnostics = await runtime.exportDiagnostics({ kind: "run", runId: runHandle.runId });
    const goalDiagnostics = await runtime.exportDiagnostics({ kind: "goal", goalId: goalHandle.goalId });

    await runtime.shutdown("daemon embedding gate complete");
    const reopened = createAgentRuntime({ storageDir });
    const reopenedRun = await reopened.getRun(runHandle.runId);
    const reopenedGoal = await reopened.getGoal(goalHandle.goalId);
    await reopened.shutdown("daemon embedding gate complete");

    expect(detected).toEqual(expect.arrayContaining([expect.objectContaining({ id: "fake", available: true })]));
    expect(runEvents.at(-1)).toMatchObject({ type: "run_finished", result: "success" });
    expect(goalEvents.at(-1)).toMatchObject({ type: "goal_finished", result: "success" });
    expect(runEnvelope).toMatchObject({
      schemaVersion: "agent-runtime.event.v1",
      scope: { kind: "run", id: runHandle.runId },
      terminal: { result: "success", reason: "success" },
    });
    expect(goalEnvelope).toMatchObject({
      schemaVersion: "agent-runtime.event.v1",
      scope: { kind: "goal", id: goalHandle.goalId },
      terminal: { result: "success", reason: "success" },
    });
    expect(health).toMatchObject({ schemaVersion: "agent-runtime.storeHealth.v1", ok: true });
    expect(runDiagnostics).toMatchObject({ schemaVersion: "agent-runtime.diagnostics.v1", subject: { kind: "run", id: runHandle.runId } });
    expect(goalDiagnostics).toMatchObject({ schemaVersion: "agent-runtime.diagnostics.v1", subject: { kind: "goal", id: goalHandle.goalId } });
    expect(reopenedRun).toMatchObject({ id: runHandle.runId, status: "succeeded" });
    expect(reopenedGoal).toMatchObject({ id: goalHandle.goalId, status: "succeeded" });
  }, 30_000);

  it("keeps read-only inspection from acquiring leases or recovering live-owner records", async () => {
    const storageDir = await tempDir("agent-runtime-daemon-");
    const runtime = createAgentRuntime({ storageDir });
    const owner = inspectStoreLock(storageDir).owner;
    const cwd = await tempDir();
    const runId = "run_live_readonly";
    const goalId = "goal_live_readonly";
    const runDir = path.join(storageDir, "runs", runId);
    const goalDir = path.join(storageDir, "goals", goalId);
    await mkdir(runDir, { recursive: true });
    await mkdir(goalDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
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
      owner,
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: Date.now(),
      runId,
      event: { type: "run_started", runId, agentId: "fake", cwd, timestamp: Date.now() },
    })}\n`, "utf8");
    await writeFile(path.join(goalDir, "manifest.json"), JSON.stringify({
      id: goalId,
      cwd,
      objective: "live goal",
      status: "running",
      tasks: [{ id: "T001", title: "Running", objective: "running", status: "running", dependencies: [], cwd, permissionPolicy: "workspace-write" }],
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      owner,
    }), "utf8");
    await writeFile(path.join(goalDir, "events.jsonl"), `${JSON.stringify({
      id: 1,
      sequence: 1,
      timestamp: Date.now(),
      goalId,
      event: { type: "goal_started", goalId, objective: "live goal", timestamp: Date.now() },
    })}\n`, "utf8");

    const lockPath = path.join(storageDir, "runtime.lock.json");
    const runManifestPath = path.join(runDir, "manifest.json");
    const goalManifestPath = path.join(goalDir, "manifest.json");
    const beforeLock = await readJsonFile(lockPath);
    const beforeRunManifest = await readJsonFile(runManifestPath);
    const beforeGoalManifest = await readJsonFile(goalManifestPath);
    const beforeRunEvents = replayStoredRunEvents(storageDir, runId);
    const beforeGoalEvents = replayStoredGoalEvents(storageDir, goalId);

    const health = inspectStoreDirectory(storageDir);
    const lock = inspectStoreLock(storageDir);
    const runs = listStoredRuns(storageDir, { status: "active" });
    const goals = listStoredGoals(storageDir, { status: "active" });
    const replayedRun = replayStoredRunEvents(storageDir, runId);
    const replayedGoal = replayStoredGoalEvents(storageDir, goalId);
    const runDiagnostics = exportDiagnosticsBundle({ kind: "run", runId }, storageDir);
    const goalDiagnostics = exportDiagnosticsBundle({ kind: "goal", goalId }, storageDir);
    const cliHealth = JSON.parse((await execFileP(process.execPath, [cli, "store-health", "--storage-dir", storageDir, "--json"])).stdout);
    const cliLock = JSON.parse((await execFileP(process.execPath, [cli, "store-lock", "--storage-dir", storageDir, "--json"])).stdout);
    const cliRunReplay = (await execFileP(process.execPath, [cli, "replay-run", runId, "--storage-dir", storageDir, "--jsonl"])).stdout.trim();
    const cliGoalReplay = (await execFileP(process.execPath, [cli, "replay-goal", goalId, "--storage-dir", storageDir, "--jsonl"])).stdout.trim();
    const cliRunDiagnostics = JSON.parse((await execFileP(process.execPath, [cli, "diagnostics", "run", runId, "--storage-dir", storageDir, "--json"])).stdout);

    const afterLock = await readJsonFile(lockPath);
    const afterRunManifest = await readJsonFile(runManifestPath);
    const afterGoalManifest = await readJsonFile(goalManifestPath);
    const afterRunEvents = replayStoredRunEvents(storageDir, runId);
    const afterGoalEvents = replayStoredGoalEvents(storageDir, goalId);

    expect(lock).toMatchObject({ status: "live", owner: expect.objectContaining({ runtimeInstanceId: owner?.runtimeInstanceId }) });
    expect(health.activeRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run", id: runId, ownerStatus: "live" }),
      expect.objectContaining({ kind: "goal", id: goalId, ownerStatus: "live" }),
    ]));
    expect(health.activeInterrupted).toEqual([]);
    expect(runs.map((run) => run.id)).toContain(runId);
    expect(goals.map((goal) => goal.id)).toContain(goalId);
    expect(replayedRun).toHaveLength(1);
    expect(replayedGoal).toHaveLength(1);
    expect(runDiagnostics.supervisorSummary).toMatchObject({ status: "running", terminalEventCount: 0 });
    expect(goalDiagnostics.supervisorSummary).toMatchObject({ status: "running", terminalEventCount: 0 });
    expect(cliHealth.activeRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: runId, ownerStatus: "live" }),
      expect.objectContaining({ id: goalId, ownerStatus: "live" }),
    ]));
    expect(cliLock).toMatchObject({ status: "live" });
    expect(cliRunReplay).toContain("agent-runtime.event.v1");
    expect(cliGoalReplay).toContain("agent-runtime.event.v1");
    expect(cliRunDiagnostics).toMatchObject({ schemaVersion: "agent-runtime.diagnostics.v1" });
    expect(ownerIdentity(afterLock)).toEqual(ownerIdentity(beforeLock));
    expect(ownerIdentity(afterRunManifest)).toEqual(ownerIdentity(beforeRunManifest));
    expect(ownerIdentity(afterGoalManifest)).toEqual(ownerIdentity(beforeGoalManifest));
    expect(afterRunManifest.status).toBe(beforeRunManifest.status);
    expect(afterGoalManifest.status).toBe(beforeGoalManifest.status);
    expect(taskStatuses(afterGoalManifest)).toEqual(taskStatuses(beforeGoalManifest));
    expect(diagnosticCodes(afterRunManifest)).not.toContain("AGENT_RUNTIME_INTERRUPTED");
    expect(diagnosticCodes(afterGoalManifest)).not.toContain("AGENT_RUNTIME_INTERRUPTED");
    expect(afterRunEvents).toHaveLength(beforeRunEvents.length);
    expect(afterGoalEvents).toHaveLength(beforeGoalEvents.length);
    expect(afterRunEvents.filter((record) => record.event.type === "run_finished")).toHaveLength(0);
    expect(afterGoalEvents.filter((record) => record.event.type === "goal_finished")).toHaveLength(0);
    await runtime.shutdown("test complete");
  }, 30_000);

  it("does not mutate live active records when a second writer is refused", async () => {
    const storageDir = await tempDir("agent-runtime-daemon-");
    const runtime = createAgentRuntime({ storageDir });
    const owner = inspectStoreLock(storageDir).owner;
    const cwd = await tempDir();
    const goalId = "goal_live_second_writer";
    const goalDir = path.join(storageDir, "goals", goalId);
    await mkdir(goalDir, { recursive: true });
    await writeFile(path.join(goalDir, "manifest.json"), JSON.stringify({
      id: goalId,
      cwd,
      objective: "live goal",
      status: "running",
      tasks: [{ id: "T001", title: "Running", objective: "running", status: "running", dependencies: [], cwd, permissionPolicy: "workspace-write" }],
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      owner,
    }), "utf8");
    await writeFile(path.join(goalDir, "events.jsonl"), "", "utf8");
    const goalManifestPath = path.join(goalDir, "manifest.json");
    const beforeManifest = await readJsonFile(goalManifestPath);
    const beforeEvents = replayStoredGoalEvents(storageDir, goalId);

    expect(() => createAgentRuntime({ storageDir })).toThrow(/already open for writing/u);

    const afterManifest = await readJsonFile(goalManifestPath);
    const afterEvents = replayStoredGoalEvents(storageDir, goalId);
    const health = inspectStoreDirectory(storageDir);
    expect(ownerIdentity(afterManifest)).toEqual(ownerIdentity(beforeManifest));
    expect(afterManifest.status).toBe(beforeManifest.status);
    expect(taskStatuses(afterManifest)).toEqual(taskStatuses(beforeManifest));
    expect(diagnosticCodes(afterManifest)).not.toContain("AGENT_RUNTIME_INTERRUPTED");
    expect(afterEvents).toHaveLength(beforeEvents.length);
    expect(afterEvents.filter((record) => record.event.type === "goal_finished")).toHaveLength(0);
    expect(health.activeRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "goal", id: goalId, status: "running", ownerStatus: "live" }),
    ]));
    expect(health.activeInterrupted).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "goal", id: goalId }),
    ]));
    await runtime.shutdown("test complete");
  });

  it("keeps shutdown and active recovery terminal events idempotent", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const shutdownStorageDir = await tempDir("agent-runtime-daemon-");
    await writeExecutable(binDir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
      storageDir: shutdownStorageDir,
    });
    const runHandle = await runtime.run({ agentId: "fake", cwd, prompt: "cancel" });
    setTimeout(() => void runtime.shutdown("daemon shutdown"), 25);
    const runEvents = await collect(runHandle.events);
    await runtime.shutdown("daemon shutdown again");
    const shutdownRunReplay = replayStoredRunEvents(shutdownStorageDir, runHandle.runId);

    const recoveryStorageDir = await tempDir("agent-runtime-daemon-");
    const runId = "run_recovery_idempotent";
    const goalId = "goal_recovery_idempotent";
    const runDir = path.join(recoveryStorageDir, "runs", runId);
    const goalDir = path.join(recoveryStorageDir, "goals", goalId);
    const staleOwner = {
      runtimeInstanceId: "runtime_old",
      pid: 999_999,
      startedAt: Date.now() - 120_000,
      heartbeatAt: Date.now() - 120_000,
    };
    await mkdir(runDir, { recursive: true });
    await mkdir(goalDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
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
      owner: staleOwner,
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), "", "utf8");
    await writeFile(path.join(goalDir, "manifest.json"), JSON.stringify({
      id: goalId,
      cwd,
      objective: "recover active goal",
      status: "running",
      tasks: [
        { id: "T001", title: "Running", objective: "running", status: "running", dependencies: [], cwd, permissionPolicy: "workspace-write" },
        { id: "T002", title: "Pending", objective: "pending", status: "pending", dependencies: ["T001"], cwd, permissionPolicy: "workspace-write" },
        { id: "T003", title: "Done", objective: "done", status: "succeeded", dependencies: [], cwd, permissionPolicy: "workspace-write" },
      ],
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      owner: staleOwner,
    }), "utf8");
    await writeFile(path.join(goalDir, "events.jsonl"), "", "utf8");

    const recovered = createAgentRuntime({ storageDir: recoveryStorageDir });
    const recoveredGoal = await recovered.getGoal(goalId);
    await recovered.shutdown("first recovery complete");
    const reopened = createAgentRuntime({ storageDir: recoveryStorageDir });
    const recoveredRunReplay = await reopened.replayRunEvents(runId);
    const recoveredGoalReplay = await reopened.replayGoalEvents(goalId);
    const reopenedGoal = await reopened.getGoal(goalId);
    await reopened.shutdown("second recovery complete");

    expect(runEvents.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(shutdownRunReplay.filter((record) => record.event.type === "run_finished")).toHaveLength(1);
    expect(recoveredRunReplay.filter((record) => record.event.type === "run_finished")).toHaveLength(1);
    expect(recoveredGoalReplay.filter((record) => record.event.type === "goal_finished")).toHaveLength(1);
    expect(recoveredGoal?.tasks.map((task) => [task.id, task.status])).toEqual([
      ["T001", "canceled"],
      ["T002", "canceled"],
      ["T003", "succeeded"],
    ]);
    expect(reopenedGoal?.tasks.map((task) => [task.id, task.status])).toEqual([
      ["T001", "canceled"],
      ["T002", "canceled"],
      ["T003", "succeeded"],
    ]);
  }, 30_000);
});
