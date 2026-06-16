import { AsyncQueue } from "../core/async-queue.js";
import { createId } from "../core/ids.js";
import type { SchedulerEvent, SchedulerEventInput } from "../core/events.js";
import { withTimestamp } from "../core/events.js";
import type { CreateGoalRequest, GoalRecord, ScheduledTask } from "./goal-types.js";
import type { RunResult } from "../runs/run-result.js";

interface StoredGoal extends GoalRecord {
  subscribers: Set<AsyncQueue<SchedulerEvent>>;
  events: SchedulerEvent[];
}

export class GoalStore {
  private readonly goals = new Map<string, StoredGoal>();

  create(request: CreateGoalRequest): GoalRecord {
    const now = Date.now();
    const goal: StoredGoal = {
      id: createId("goal"),
      cwd: request.cwd,
      objective: request.objective,
      status: "planning",
      tasks: [],
      createdAt: now,
      updatedAt: now,
      events: [],
      subscribers: new Set(),
    };
    this.goals.set(goal.id, goal);
    return this.publicRecord(goal);
  }

  get(goalId: string): GoalRecord | null {
    const goal = this.goals.get(goalId);
    return goal ? this.publicRecord(goal) : null;
  }

  setTasks(goalId: string, tasks: ScheduledTask[]): void {
    const goal = this.mustGet(goalId);
    goal.tasks = tasks;
    goal.updatedAt = Date.now();
  }

  updateTask(goalId: string, task: ScheduledTask): void {
    const goal = this.mustGet(goalId);
    const index = goal.tasks.findIndex((candidate) => candidate.id === task.id);
    if (index >= 0) goal.tasks[index] = task;
    goal.updatedAt = Date.now();
  }

  setStatus(goalId: string, status: GoalRecord["status"], result?: RunResult): void {
    const goal = this.mustGet(goalId);
    goal.status = status;
    goal.result = result;
    goal.updatedAt = Date.now();
  }

  emit(goalId: string, event: SchedulerEventInput): void {
    const goal = this.mustGet(goalId);
    const stamped = withTimestamp<SchedulerEvent>(event);
    goal.events.push(stamped);
    for (const subscriber of goal.subscribers) subscriber.push(stamped);
    if (event.type === "goal_finished") {
      for (const subscriber of goal.subscribers) subscriber.end();
      goal.subscribers.clear();
    }
  }

  events(goalId: string): AsyncIterable<SchedulerEvent> {
    const goal = this.mustGet(goalId);
    const queue = new AsyncQueue<SchedulerEvent>();
    for (const event of goal.events) queue.push(event);
    if (goal.status === "succeeded" || goal.status === "failed" || goal.status === "canceled") {
      queue.end();
      return queue;
    }
    goal.subscribers.add(queue);
    return queue;
  }

  private mustGet(goalId: string): StoredGoal {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Unknown goal: ${goalId}`);
    return goal;
  }

  private publicRecord(goal: StoredGoal): GoalRecord {
    const { subscribers, events, ...record } = goal;
    void subscribers;
    void events;
    return { ...record, tasks: record.tasks.map((task) => ({ ...task })) };
  }
}
