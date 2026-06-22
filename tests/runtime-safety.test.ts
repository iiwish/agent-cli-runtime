import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentRuntime } from "../src/index.js";
import { inspectStoreLock } from "../src/storage/store-inspection.js";
import type { AgentEvent, SchedulerEvent } from "../src/core/events.js";
import { fakeAdapter, fakeCliBody, tempDir, writeExecutable } from "./helpers.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

function terminalRuns(events: AgentEvent[]): AgentEvent[] {
  return events.filter((event) => event.type === "run_finished");
}

function terminalGoals(events: SchedulerEvent[]): SchedulerEvent[] {
  return events.filter((event) => event.type === "goal_finished");
}

describe("long-lived runtime resource safety", () => {
  it("runs repeated fake runs and goals under one durable runtime without active-state leaks", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-safety-");
    await writeExecutable(binDir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
      storageDir,
    });
    const runIds: string[] = [];
    const goalIds: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const handle = await runtime.run({ agentId: "fake", cwd, prompt: `safety run ${index}` });
      const events = await collect(handle.events);
      runIds.push(handle.runId);
      expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "success" });
      expect(terminalRuns(events)).toHaveLength(1);
      expect(await runtime.listRuns({ status: "active" })).toEqual([]);
    }

    for (let index = 0; index < 3; index += 1) {
      const handle = await runtime.createGoal({ cwd, objective: `ship mvp safety ${index}`, defaultAgentId: "fake" });
      const events = await collect(handle.events);
      goalIds.push(handle.goalId);
      expect(events.at(-1)).toMatchObject({ type: "goal_finished", result: "success" });
      expect(terminalGoals(events)).toHaveLength(1);
      expect(await runtime.listGoals({ status: "active" })).toEqual([]);
      expect(await runtime.listRuns({ status: "active" })).toEqual([]);
    }

    for (const runId of runIds) {
      expect((await runtime.replayRunEvents(runId)).filter((record) => record.event.type === "run_finished")).toHaveLength(1);
    }
    for (const goalId of goalIds) {
      expect((await runtime.replayGoalEvents(goalId)).filter((record) => record.event.type === "goal_finished")).toHaveLength(1);
    }

    await runtime.shutdown("resource safety first shutdown");
    await runtime.shutdown("resource safety second shutdown");
    expect(inspectStoreLock(storageDir)).toMatchObject({ status: "closed" });

    const reopened = createAgentRuntime({ storageDir });
    expect(await reopened.listRuns({ status: "active" })).toEqual([]);
    expect(await reopened.listGoals({ status: "active" })).toEqual([]);
    for (const runId of runIds) expect(await reopened.getRun(runId)).toMatchObject({ status: "succeeded" });
    for (const goalId of goalIds) expect(await reopened.getGoal(goalId)).toMatchObject({ status: "succeeded" });
    await reopened.shutdown("resource safety reopened shutdown");
  }, 30_000);

  it("closes run and goal event iterators naturally after terminal events", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(binDir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
    });

    const run = await runtime.run({ agentId: "fake", cwd, prompt: "iterator close run" });
    const runIterator = run.events[Symbol.asyncIterator]();
    let lastRun: IteratorResult<AgentEvent> | undefined;
    do {
      lastRun = await runIterator.next();
    } while (!lastRun.done && lastRun.value.type !== "run_finished");
    expect(lastRun.done).toBe(false);
    expect(await runIterator.next()).toEqual({ value: undefined, done: true });
    await run.cancel("terminal cancel is idempotent");

    const goal = await runtime.createGoal({ cwd, objective: "iterator close goal", defaultAgentId: "fake" });
    const goalIterator = goal.events[Symbol.asyncIterator]();
    let lastGoal: IteratorResult<SchedulerEvent> | undefined;
    do {
      lastGoal = await goalIterator.next();
    } while (!lastGoal.done && lastGoal.value.type !== "goal_finished");
    expect(lastGoal.done).toBe(false);
    expect(await goalIterator.next()).toEqual({ value: undefined, done: true });
    await goal.cancel("terminal cancel is idempotent");
    await runtime.shutdown("iterator close complete");
  });

  it("keeps terminal events available for slow consumers and stable replay", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-safety-");
    await writeExecutable(binDir, "fake-agent", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("fake 1.0.0"); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  for (let i = 0; i < 40; i += 1) {
    if (i % 2 === 0) console.log(JSON.stringify({ type: "status", label: "step-" + i }));
    else console.log("text event " + i);
  }
});
`);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
      storageDir,
    });

    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "slow consumer" });
    await delay(250);
    const events = await collect(handle.events);
    const replay = await runtime.replayRunEvents(handle.runId);

    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "success" });
    expect(terminalRuns(events)).toHaveLength(1);
    expect(replay.filter((record) => record.event.type === "run_finished")).toHaveLength(1);
    expect(replay).toHaveLength(events.length);
    await runtime.shutdown("slow consumer complete");
  });

  it("keeps diagnostic tails bounded and redacted under noisy failure output", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const secret = `sk${"A".repeat(20)}`;
    await writeExecutable(binDir, "fake-agent", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("fake 1.0.0"); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  for (let i = 0; i < 250; i += 1) {
    console.log("stdout-line-" + i + " token ${secret} cwd=" + process.cwd());
    console.error("stderr-line-" + i + " Bearer " + "B".repeat(20) + " cwd=" + process.cwd());
  }
  process.exit(2);
});
`);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
    });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "noisy failure" });
    await collect(handle.events);
    const run = await runtime.getRun(handle.runId);
    const diagnostic = run?.diagnostics.find((item) => item.code === "AGENT_EXECUTION_FAILED");
    const text = JSON.stringify(diagnostic);

    expect(diagnostic?.stdoutTail?.length).toBeLessThanOrEqual(4_000);
    expect(diagnostic?.stderrTail?.length).toBeLessThanOrEqual(4_000);
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(cwd);
    await runtime.shutdown("diagnostics complete");
  });

  it("handles cancel and timeout churn with one terminal event per run", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-safety-");
    await writeExecutable(binDir, "fake-agent", `
process.on("SIGTERM", () => process.exit(143));
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("fake 1.0.0"); process.exit(0); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (input.includes("timeout-close-race")) {
    console.log("started");
    setTimeout(() => process.exit(0), 25);
    return;
  }
  setInterval(() => {}, 1000);
});
`);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
      storageDir,
    });
    const handles = await Promise.all(Array.from({ length: 6 }, () => runtime.run({ agentId: "fake", cwd, prompt: "cancel churn" })));
    await Promise.all(handles.map((handle) => handle.cancel("cancel churn")));
    const eventSets = await Promise.all(handles.map((handle) => collect(handle.events)));

    for (const events of eventSets) {
      expect(terminalRuns(events)).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "cancelled" });
    }

    const race = await runtime.run({ agentId: "fake", cwd, prompt: "timeout-close-race", timeoutMs: 5 });
    const raceEvents = await collect(race.events);
    expect(terminalRuns(raceEvents)).toHaveLength(1);
    expect(raceEvents.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });

    await runtime.shutdown("churn complete");
    const beforeReplayCounts = await Promise.all([...handles.map((handle) => handle.runId), race.runId].map(async (runId) =>
      (await runtime.replayRunEvents(runId)).filter((record) => record.event.type === "run_finished").length,
    ));
    await runtime.shutdown("churn complete again");
    const afterReplayCounts = await Promise.all([...handles.map((handle) => handle.runId), race.runId].map(async (runId) =>
      (await runtime.replayRunEvents(runId)).filter((record) => record.event.type === "run_finished").length,
    ));
    expect(afterReplayCounts).toEqual(beforeReplayCounts);
    expect(afterReplayCounts.every((count) => count === 1)).toBe(true);
    expect(await runtime.listRuns({ status: "active" })).toEqual([]);

    const reopened = createAgentRuntime({ storageDir });
    expect(await reopened.listRuns({ status: "active" })).toEqual([]);
    await reopened.shutdown("churn reopened complete");
  }, 30_000);

  it("keeps goal cancel churn task states stable and shutdown idempotent", async () => {
    const binDir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-safety-");
    await writeExecutable(binDir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [binDir],
      storageDir,
    });
    const handle = await runtime.createGoal({
      cwd,
      objective: "cancel-ready-queue",
      defaultAgentId: "fake",
      maxConcurrentTasks: 2,
    });
    const events: SchedulerEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (events.filter((candidate) => candidate.type === "task_started").length === 2) {
        void runtime.cancelGoal(handle.goalId);
        void handle.cancel("duplicate cancel");
      }
    }
    const goal = await runtime.getGoal(handle.goalId);
    const replayBeforeShutdown = await runtime.replayGoalEvents(handle.goalId);
    await runtime.shutdown("goal churn complete");
    await runtime.shutdown("goal churn complete again");
    const replayAfterShutdown = await runtime.replayGoalEvents(handle.goalId);

    expect(terminalGoals(events)).toHaveLength(1);
    expect(goal).toMatchObject({ status: "canceled", result: "cancelled" });
    expect(goal?.tasks.map((task) => [task.id, task.status])).toEqual([
      ["T001", "canceled"],
      ["T002", "canceled"],
      ["T003", "canceled"],
    ]);
    expect(replayBeforeShutdown.filter((record) => record.event.type === "goal_finished")).toHaveLength(1);
    expect(replayAfterShutdown.filter((record) => record.event.type === "goal_finished")).toHaveLength(1);
    expect(await runtime.listGoals({ status: "active" })).toEqual([]);

    const reopened = createAgentRuntime({ storageDir });
    expect(await reopened.listGoals({ status: "active" })).toEqual([]);
    expect(await reopened.getGoal(handle.goalId)).toMatchObject({ status: "canceled" });
    await reopened.shutdown("goal churn reopened complete");
  }, 30_000);
});
