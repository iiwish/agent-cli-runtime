import { describe, expect, it } from "vitest";
import { GoalStore } from "../src/goals/goal-store.js";
import { RunStore } from "../src/runs/run-store.js";
import { tempDir } from "./helpers.js";

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
});

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
