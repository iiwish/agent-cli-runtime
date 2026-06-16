import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path, { delimiter } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentRuntime } from "../src/index.js";
import type { SchedulerEvent } from "../src/core/events.js";
import { GoalStore } from "../src/goals/goal-store.js";
import { dependencyOrder, parsePlannerOutput, validateTaskGraph } from "../src/goals/task-graph.js";
import type { FileStorage } from "../src/storage/storage-types.js";
import { fakeAdapter, fakeCliBody, tempDir, writeExecutable } from "./helpers.js";

const execFileP = promisify(execFile);

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

describe("GoalScheduler", () => {
  it("parses planner JSON and orders dependencies", async () => {
    const output = parsePlannerOutput(JSON.stringify({
      tasks: [
        { id: "T002", title: "Second", objective: "second", dependencies: ["T001"] },
        { id: "T001", title: "First", objective: "first", dependencies: [] },
      ],
    }));
    const tasks = validateTaskGraph(output, { cwd: "/tmp", objective: "x", defaultAgentId: "fake" });
    expect(dependencyOrder(tasks).map((task) => task.id)).toEqual(["T001", "T002"]);
  });

  it("parses planner JSON from a markdown fence or surrounding prose", async () => {
    const output = parsePlannerOutput([
      "Here is the plan:",
      "```json",
      JSON.stringify({ tasks: [{ id: "T001", title: "One", objective: "Do one", dependencies: [] }] }),
      "```",
    ].join("\n"));
    const proseOutput = parsePlannerOutput(`Plan follows:\n${JSON.stringify({ tasks: [{ id: "T002", title: "Two", objective: "Do two", dependencies: [] }] })}\nThanks.`);
    const trailingProseOutput = parsePlannerOutput(`${JSON.stringify({ tasks: [{ id: "T003", title: "Three", objective: "Do three", dependencies: [] }] })}\nDone.`);
    expect(output.tasks[0]?.id).toBe("T001");
    expect(proseOutput.tasks[0]?.id).toBe("T002");
    expect(trailingProseOutput.tasks[0]?.id).toBe("T003");
  });

  it("rejects multiple or malformed planner JSON objects clearly", async () => {
    expect(() => parsePlannerOutput('{"tasks":[]} {"tasks":[]}')).toThrow(/multiple JSON objects|not valid JSON/u);
    expect(() => parsePlannerOutput("Plan: { not valid json")).toThrow(/malformed|not valid JSON/u);
  });

  it("rejects invalid task graph field types during validation", async () => {
    const request = { cwd: "/tmp", objective: "x", defaultAgentId: "fake" };
    expect(() => validateTaskGraph({ tasks: [{ id: "T001", title: "Bad", objective: "bad", dependencies: [123] } as never] }, request)).toThrow(/Task T001 field dependencies\[0\] must be a string/u);
    expect(() => validateTaskGraph({ tasks: [{ id: "T001", title: "Bad", objective: "bad", dependencies: [], allowedFiles: "src" } as never] }, request)).toThrow(/Task T001 field allowedFiles must be a string\[\]/u);
    expect(() => validateTaskGraph({ tasks: [{ id: "T001", title: "Bad", objective: "bad", dependencies: [], validationCommands: [123] } as never] }, request)).toThrow(/Task T001 field validationCommands\[0\] must be a string/u);
    expect(() => validateTaskGraph({ tasks: [{ id: "T001", title: "Bad", objective: "bad", dependencies: [], agentId: 7 } as never] }, request)).toThrow(/Task T001 field agentId must be a string/u);
  });

  it("rejects invalid retryPolicy fields during task graph validation", async () => {
    const request = { cwd: "/tmp", objective: "x", defaultAgentId: "fake" };
    const base = { id: "T001", title: "Retry", objective: "retry", dependencies: [] };
    expect(() => validateTaskGraph({ tasks: [{ ...base, retryPolicy: { maxAttempts: 0, retryableErrorCodes: [], backoffMs: 0 } }] }, request)).toThrow(/Task T001 field retryPolicy.maxAttempts must be a positive integer/u);
    expect(() => validateTaskGraph({ tasks: [{ ...base, retryPolicy: { maxAttempts: 1, retryableErrorCodes: "AGENT_TIMEOUT", backoffMs: 0 } } as never] }, request)).toThrow(/retryPolicy.*retryableErrorCodes must be a string\[\]/u);
    expect(() => validateTaskGraph({ tasks: [{ ...base, retryPolicy: { maxAttempts: 1, retryableErrorCodes: [], backoffMs: -1 } }] }, request)).toThrow(/Task T001 field retryPolicy.backoffMs must be a non-negative number/u);
  });

  it("runs goal planner and tasks end-to-end", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "ship mvp", defaultAgentId: "fake" });
    const events = await collect(handle.events);
    expect(events.filter((event) => event.type === "task_started").map((event) => event.taskId)).toEqual(["T001", "T002"]);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "success" });
  });

  it("runs independent ready tasks concurrently when maxConcurrentTasks is 2", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "parallel-ready", defaultAgentId: "fake", maxConcurrentTasks: 2 });
    const events = await collect(handle.events);

    const t1Started = events.findIndex((event) => event.type === "task_started" && event.taskId === "T001");
    const t2Started = events.findIndex((event) => event.type === "task_started" && event.taskId === "T002");
    const firstFinished = events.findIndex((event) => event.type === "task_finished");
    expect(t1Started).toBeGreaterThanOrEqual(0);
    expect(t2Started).toBeGreaterThanOrEqual(0);
    expect(firstFinished).toBeGreaterThan(Math.max(t1Started, t2Started));
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "success" });
  });

  it("keeps stable serial order when maxConcurrentTasks is 1", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "parallel-ready", defaultAgentId: "fake", maxConcurrentTasks: 1 });
    const events = await collect(handle.events);

    const t1Finished = events.findIndex((event) => event.type === "task_finished" && event.taskId === "T001");
    const t2Started = events.findIndex((event) => event.type === "task_started" && event.taskId === "T002");
    expect(t1Finished).toBeGreaterThanOrEqual(0);
    expect(t2Started).toBeGreaterThan(t1Finished);
    expect(events.filter((event) => event.type === "task_started").map((event) => event.taskId)).toEqual(["T001", "T002"]);
  });

  it("does not start dependent tasks before dependencies finish", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "dependency-wait", defaultAgentId: "fake", maxConcurrentTasks: 2 });
    const events = await collect(handle.events);

    const t1Finished = events.findIndex((event) => event.type === "task_finished" && event.taskId === "T001");
    const t2Started = events.findIndex((event) => event.type === "task_started" && event.taskId === "T002");
    expect(t1Finished).toBeGreaterThanOrEqual(0);
    expect(t2Started).toBeGreaterThan(t1Finished);
  });

  it("marks goal failed when a task fails", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "fail-task", defaultAgentId: "fake" });
    const events = await collect(handle.events);
    expect(events.some((event) => event.type === "task_finished" && event.result === "failed")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "failed" });
  });

  it("blocks dependents when an upstream task fails", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "fail-upstream", defaultAgentId: "fake" });
    await collect(handle.events);
    const goal = await runtime.getGoal(handle.goalId);

    expect(goal?.tasks.find((task) => task.id === "T001")).toMatchObject({ status: "failed" });
    expect(goal?.tasks.find((task) => task.id === "T002")).toMatchObject({ status: "blocked" });
  });

  it("retries retryable task failures and records attempt evidence", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({
      cwd,
      objective: "retry-task",
      defaultAgentId: "fake",
      retryPolicy: { maxAttempts: 2, retryableErrorCodes: ["AGENT_EXECUTION_FAILED"], backoffMs: 1 },
    });
    const events = await collect(handle.events);
    const goal = await runtime.getGoal(handle.goalId);
    const attempts = goal?.tasks[0]?.evidence?.attempts ?? [];

    expect(events.filter((event) => event.type === "task_attempt_started")).toHaveLength(2);
    expect(events.filter((event) => event.type === "task_attempt_finished")).toHaveLength(2);
    expect(attempts).toMatchObject([{ result: "failed" }, { result: "success" }]);
    expect(goal).toMatchObject({ status: "succeeded", result: "success" });
  });

  it("does not retry non-retryable task failures", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({
      cwd,
      objective: "non-retry-task",
      defaultAgentId: "fake",
      retryPolicy: { maxAttempts: 3, retryableErrorCodes: ["AGENT_TIMEOUT"], backoffMs: 1 },
    });
    const events = await collect(handle.events);
    const goal = await runtime.getGoal(handle.goalId);

    expect(events.filter((event) => event.type === "task_attempt_started")).toHaveLength(1);
    expect(goal?.tasks[0]?.evidence?.attempts).toHaveLength(1);
    expect(goal).toMatchObject({ status: "failed", result: "failed" });
  });

  it("marks goal failed when runtime-side validation fails", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "bad-validation", defaultAgentId: "fake" });
    const events = await collect(handle.events);
    expect(events.some((event) => event.type === "task_finished" && event.taskId === "T001" && event.result === "failed")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "failed" });
  });

  it("classifies planner validation failure as scheduler_error and fails the goal", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "invalid-task-graph", defaultAgentId: "fake" });
    const events = await collect(handle.events);
    const goal = await runtime.getGoal(handle.goalId);

    expect(events.some((event) => event.type === "scheduler_error" && event.code === "AGENT_TASK_GRAPH_INVALID" && event.message.includes("Task T001 field validationCommands"))).toBe(true);
    expect(events.some((event) => event.type === "task_started")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "failed" });
    expect(goal).toMatchObject({ status: "failed", result: "failed", diagnostics: [{ code: "AGENT_TASK_GRAPH_INVALID" }] });
  });

  it("cancels the current task run, marks pending tasks canceled, and finishes the goal", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "cancel-first", defaultAgentId: "fake" });
    const events: SchedulerEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (event.type === "task_started" && event.taskId === "T001") {
        setTimeout(() => void handle.cancel(), 25);
      }
    }

    const goal = await runtime.getGoal(handle.goalId);
    expect(goal).toMatchObject({ status: "canceled", result: "cancelled" });
    expect(goal?.tasks.find((task) => task.id === "T001")).toMatchObject({ status: "canceled" });
    expect(goal?.tasks.find((task) => task.id === "T002")).toMatchObject({ status: "canceled" });
    expect(events.some((event) => event.type === "task_finished" && event.taskId === "T001" && event.result === "cancelled")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "cancelled" });
  });

  it("cancelGoal cancels running and queued ready tasks consistently", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "cancel-ready-queue", defaultAgentId: "fake", maxConcurrentTasks: 2 });
    const events: SchedulerEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (events.filter((candidate) => candidate.type === "task_started").length === 2) {
        setTimeout(() => void handle.cancel(), 25);
      }
    }

    const goal = await runtime.getGoal(handle.goalId);
    expect(goal).toMatchObject({ status: "canceled", result: "cancelled" });
    expect(goal?.tasks.map((task) => [task.id, task.status])).toEqual([
      ["T001", "canceled"],
      ["T002", "canceled"],
      ["T003", "canceled"],
    ]);
    expect(events.filter((event) => event.type === "task_finished" && event.result === "cancelled")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "cancelled" });
  });

  it("records task timeout in task evidence and fails the goal", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.createGoal({ cwd, objective: "task-timeout", defaultAgentId: "fake", taskTimeoutMs: 3_000 });
    const events = await collect(handle.events);
    const goal = await runtime.getGoal(handle.goalId);
    const timedOutTask = goal?.tasks.find((task) => task.id === "T002");
    expect(events.some((event) => event.type === "run_event" && event.event.type === "error" && event.event.code === "AGENT_TIMEOUT")).toBe(true);
    expect(timedOutTask).toMatchObject({ status: "failed" });
    expect(timedOutTask?.evidence).toMatchObject({ result: "failed" });
    expect(events.some((event) => event.type === "task_finished" && event.taskId === "T002" && event.result === "failed")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "failed" });
  });

  it("shutdown cancels active goals and clears active state", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.createGoal({ cwd, objective: "cancel-first", defaultAgentId: "fake" });
    const events: SchedulerEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (event.type === "task_started" && event.taskId === "T001") {
        setTimeout(() => void runtime.shutdown("test shutdown"), 25);
      }
    }
    await delay(25);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "cancelled" });
    expect(await runtime.getGoal(handle.goalId)).toMatchObject({ status: "canceled", result: "cancelled" });
    expect(await runtime.listGoals({ status: "active" })).toEqual([]);
    const restarted = createAgentRuntime({ storageDir });
    expect(await restarted.getGoal(handle.goalId)).toMatchObject({ status: "canceled" });
  });

  it("persists goal events, tasks, and redacted validation evidence", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.createGoal({ cwd, objective: "secret-validation", defaultAgentId: "fake" });
    await collect(handle.events);

    const secret = "s" + "k" + "A".repeat(20);
    const bearer = "Bearer " + "B".repeat(20);
    const manifest = await readFile(path.join(storageDir, "goals", handle.goalId, "manifest.json"), "utf8");
    const replayed = await runtime.replayGoalEvents(handle.goalId, { afterEventId: 1 });
    expect(replayed.map((record) => record.sequence)).toEqual(replayed.map((record) => record.id));
    expect(replayed.every((record) => record.goalId === handle.goalId)).toBe(true);
    const goal = await runtime.getGoal(handle.goalId);
    expect(replayed.every((record) => record.id > 1)).toBe(true);
    expect(goal?.tasks[0]?.evidence?.validationResults?.[0]?.stdout).toBe("[REDACTED]\n");
    expect(goal?.tasks[0]?.evidence?.validationResults?.[0]?.stderr).toBe("[REDACTED]\n");
    expect(manifest).not.toContain(secret);
    expect(manifest).not.toContain(bearer);
  });

  it("replays stable attempt events with goal metadata", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.createGoal({
      cwd,
      objective: "retry-task",
      defaultAgentId: "fake",
      retryPolicy: { maxAttempts: 2, retryableErrorCodes: ["AGENT_EXECUTION_FAILED"], backoffMs: 1 },
    });
    await collect(handle.events);
    const restarted = createAgentRuntime({ storageDir });
    const replayed = await restarted.replayGoalEvents(handle.goalId);
    const attemptEvents = replayed.filter((record) => record.event.type === "task_attempt_started" || record.event.type === "task_attempt_finished");

    expect(replayed.map((record) => record.id)).toEqual([...replayed].sort((a, b) => a.sequence - b.sequence).map((record) => record.id));
    expect(attemptEvents).toHaveLength(4);
    expect(attemptEvents.every((record) => record.goalId === handle.goalId && typeof record.sequence === "number" && typeof record.timestamp === "number")).toBe(true);
  });

  it("loads terminal goals from a new runtime using the same storage dir", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.createGoal({ cwd, objective: "ship mvp", defaultAgentId: "fake" });
    await collect(handle.events);

    const restarted = createAgentRuntime({ storageDir });
    expect(await restarted.getGoal(handle.goalId)).toMatchObject({ id: handle.goalId, status: "succeeded" });
    const goals = await restarted.listGoals({ status: "succeeded" });
    expect(goals.map((goal) => goal.id)).toContain(handle.goalId);
  });

  it("marks active goals as failed with a diagnostic event when storage is loaded", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const goalId = "goal_active_test";
    const goalDir = path.join(storageDir, "goals", goalId);
    await mkdir(goalDir, { recursive: true });
    await writeFile(path.join(goalDir, "manifest.json"), JSON.stringify({
      id: goalId,
      cwd: await tempDir(),
      objective: "active",
      status: "running",
      tasks: [],
      diagnostics: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }), "utf8");
    await writeFile(path.join(goalDir, "events.jsonl"), `${JSON.stringify({ id: 1, timestamp: Date.now(), event: { type: "goal_started", goalId, objective: "active", timestamp: Date.now() } })}\n`, "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const goal = await runtime.getGoal(goalId);
    const events = await runtime.replayGoalEvents(goalId);
    expect(goal).toMatchObject({ id: goalId, status: "failed", result: "failed" });
    expect(events.some((record) => record.event.type === "scheduler_error" && record.event.code === "AGENT_RUNTIME_INTERRUPTED")).toBe(true);
    expect(events.at(-1)?.event).toMatchObject({ type: "goal_finished", result: "failed" });
  });

  it("CLI reads persisted runs and goals from storage dir", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const runHandle = await runtime.run({ agentId: "fake", cwd, prompt: "cli-run" });
    await collect(runHandle.events);
    const goalHandle = await runtime.createGoal({ cwd, objective: "ship mvp", defaultAgentId: "fake" });
    await collect(goalHandle.events);

    await execFileP("npm", ["run", "build"], { cwd: path.resolve(import.meta.dirname, "..") });
    const cli = path.resolve(import.meta.dirname, "..", "dist", "cli", "main.js");
    const runs = JSON.parse((await execFileP(process.execPath, [cli, "runs", "--storage-dir", storageDir, "--json"])).stdout);
    const runStatus = JSON.parse((await execFileP(process.execPath, [cli, "run-status", runHandle.runId, "--storage-dir", storageDir, "--json"])).stdout);
    const runEvents = (await execFileP(process.execPath, [cli, "replay-run", runHandle.runId, "--storage-dir", storageDir, "--after", "1", "--jsonl"])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const goals = JSON.parse((await execFileP(process.execPath, [cli, "goals", "--storage-dir", storageDir, "--json"])).stdout);
    const goalStatus = JSON.parse((await execFileP(process.execPath, [cli, "goal-status", goalHandle.goalId, "--storage-dir", storageDir, "--json"])).stdout);
    const goalEvents = (await execFileP(process.execPath, [cli, "replay-goal", goalHandle.goalId, "--storage-dir", storageDir, "--after", "1", "--jsonl"])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const missingCwd = await tempDir();
    const missingJsonl = (await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      "missing-adapter",
      "--cwd",
      missingCwd,
      "--prompt",
      "hello",
      "--stream",
      "jsonl",
      "--diagnostics",
    ])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as { type: string; summary?: { status?: string } });
    const missingJson = JSON.parse((await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      "missing-adapter",
      "--cwd",
      missingCwd,
      "--prompt",
      "hello",
      "--json",
    ])).stdout);
    expect(runs.map((run: { id: string }) => run.id)).toContain(runHandle.runId);
    expect(runStatus).toMatchObject({ id: runHandle.runId, status: "succeeded" });
    expect(runEvents.every((event: { id: number }) => event.id > 1)).toBe(true);
    expect(runEvents.every((event: { sequence: number; runId: string }) => event.sequence === event.id && event.runId === runHandle.runId)).toBe(true);
    expect(goals.map((goal: { id: string }) => goal.id)).toContain(goalHandle.goalId);
    expect(goalStatus).toMatchObject({ id: goalHandle.goalId, status: "succeeded" });
    expect(goalEvents.every((event: { id: number }) => event.id > 1)).toBe(true);
    expect(goalEvents.every((event: { sequence: number; goalId: string }) => event.sequence === event.id && event.goalId === goalHandle.goalId)).toBe(true);
    expect(missingJsonl.some((event) => event.type === "run_finished")).toBe(true);
    expect(missingJsonl.at(-1)).toMatchObject({ type: "run_summary", summary: { status: "failed" } });
    expect(missingJson).toMatchObject({ agentId: "missing-adapter", status: "failed", errorCode: "AGENT_UNAVAILABLE" });
  }, 30_000);

  it("fails a goal and emits diagnostics when event persistence fails", async () => {
    const store = new GoalStore(throwingGoalEventStorage());
    const goal = store.create({ cwd: await tempDir(), objective: "persist goal", defaultAgentId: "fake" });
    const pendingEvents = collect(store.events(goal.id));

    store.emit(goal.id, { type: "goal_started", goalId: goal.id, objective: goal.objective });

    const record = store.get(goal.id);
    const events = await pendingEvents;
    expect(record).toMatchObject({ status: "failed", result: "failed" });
    expect(events.some((event) => event.type === "scheduler_error" && event.code === "AGENT_EVENT_PERSIST_FAILED")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "failed" });
    expect(record).not.toHaveProperty("persistenceFailed");
  });
});

function throwingGoalEventStorage(): FileStorage {
  return {
    listRuns: () => [],
    writeRunManifest: () => undefined,
    appendRunEvent: () => undefined,
    listGoals: () => [],
    writeGoalManifest: () => undefined,
    appendGoalEvent: () => {
      throw new Error("disk full");
    },
  };
}
