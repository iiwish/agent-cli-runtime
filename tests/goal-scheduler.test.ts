import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { createAgentRuntime } from "../src/index.js";
import { dependencyOrder, parsePlannerOutput, validateTaskGraph } from "../src/goals/task-graph.js";
import { fakeAdapter, fakeCliBody, tempDir, writeExecutable } from "./helpers.js";

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
});
