import { AsyncQueue } from "../core/async-queue.js";
import { createId } from "../core/ids.js";
import type { ReplayEvent, SchedulerEvent, SchedulerEventInput } from "../core/events.js";
import { withTimestamp } from "../core/events.js";
import { diagnostic } from "../core/diagnostics.js";
import type { CreateGoalRequest, GoalRecord, ScheduledTask } from "./goal-types.js";
import type { RunResult } from "../runs/run-result.js";
import type { FileStorage } from "../storage/storage-types.js";

interface StoredGoal extends GoalRecord {
  subscribers: Set<AsyncQueue<SchedulerEvent>>;
  events: Array<ReplayEvent<SchedulerEvent>>;
  nextEventId: number;
  persistenceFailed?: boolean;
}

export class GoalStore {
  private readonly goals = new Map<string, StoredGoal>();

  constructor(private readonly storage?: FileStorage) {
    this.loadFromStorage();
  }

  create(request: CreateGoalRequest): GoalRecord {
    const now = Date.now();
    const goal: StoredGoal = {
      id: createId("goal"),
      cwd: request.cwd,
      objective: request.objective,
      status: "planning",
      tasks: [],
      diagnostics: [],
      createdAt: now,
      updatedAt: now,
      events: [],
      nextEventId: 1,
      subscribers: new Set(),
    };
    this.goals.set(goal.id, goal);
    this.tryPersistManifest(goal);
    return this.publicRecord(goal);
  }

  get(goalId: string): GoalRecord | null {
    const goal = this.goals.get(goalId);
    return goal ? this.publicRecord(goal) : null;
  }

  list(options: { status?: "active" | GoalRecord["status"] } = {}): GoalRecord[] {
    const goals = [...this.goals.values()].map((goal) => this.publicRecord(goal));
    if (!options.status) return goals;
    if (options.status === "active") return goals.filter((goal) => !isTerminalGoal(goal.status));
    return goals.filter((goal) => goal.status === options.status);
  }

  setTasks(goalId: string, tasks: ScheduledTask[]): void {
    const goal = this.mustGet(goalId);
    if (goal.persistenceFailed) return;
    goal.tasks = tasks;
    goal.updatedAt = Date.now();
    this.tryPersistManifest(goal);
  }

  updateTask(goalId: string, task: ScheduledTask): void {
    const goal = this.mustGet(goalId);
    if (goal.persistenceFailed) return;
    const index = goal.tasks.findIndex((candidate) => candidate.id === task.id);
    if (index >= 0) goal.tasks[index] = task;
    goal.updatedAt = Date.now();
    this.tryPersistManifest(goal);
  }

  setStatus(goalId: string, status: GoalRecord["status"], result?: RunResult): void {
    const goal = this.mustGet(goalId);
    if (goal.persistenceFailed) return;
    goal.status = status;
    goal.result = result;
    goal.updatedAt = Date.now();
    this.tryPersistManifest(goal);
  }

  emit(goalId: string, event: SchedulerEventInput): ReplayEvent<SchedulerEvent> {
    const goal = this.mustGet(goalId);
    const stamped = withTimestamp<SchedulerEvent>(event);
    if (goal.persistenceFailed) return goalReplayRecord(goal, stamped);
    if (event.type === "scheduler_error") {
      goal.diagnostics.push(diagnostic(event.code, event.message, { retryable: event.retryable }));
      goal.updatedAt = Date.now();
    }
    const record = goalReplayRecord(goal, stamped);
    goal.nextEventId += 1;
    goal.events.push(record);
    if (!this.tryPersistEvent(goal, record) || !this.tryPersistManifest(goal)) return record;
    for (const subscriber of goal.subscribers) subscriber.push(stamped);
    if (event.type === "goal_finished") {
      for (const subscriber of goal.subscribers) subscriber.end();
      goal.subscribers.clear();
    }
    return record;
  }

  replay(goalId: string, afterEventId = 0): Array<ReplayEvent<SchedulerEvent>> {
    const goal = this.mustGet(goalId);
    return goal.events
      .filter((event) => event.id > afterEventId)
      .sort(compareReplayEvents);
  }

  events(goalId: string, afterEventId = 0): AsyncIterable<SchedulerEvent> {
    const goal = this.mustGet(goalId);
    const queue = new AsyncQueue<SchedulerEvent>();
    for (const event of goal.events) {
      if (event.id > afterEventId) queue.push(event.event);
    }
    if (isTerminalGoal(goal.status)) {
      queue.end();
      return queue;
    }
    goal.subscribers.add(queue);
    return queue;
  }

  isTerminal(goalId: string): boolean {
    const goal = this.goals.get(goalId);
    return goal ? isTerminalGoal(goal.status) : true;
  }

  private mustGet(goalId: string): StoredGoal {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Unknown goal: ${goalId}`);
    return goal;
  }

  private publicRecord(goal: StoredGoal): GoalRecord {
    const { subscribers, events, nextEventId, persistenceFailed, ...record } = goal;
    void subscribers;
    void events;
    void nextEventId;
    void persistenceFailed;
    return { ...record, tasks: record.tasks.map((task) => ({ ...task })), diagnostics: [...record.diagnostics] };
  }

  private loadFromStorage(): void {
    if (!this.storage) return;
    for (const snapshot of this.storage.listGoals()) {
      const goal: StoredGoal = {
        ...snapshot.manifest,
        tasks: snapshot.manifest.tasks.map((task) => ({ ...task })),
        diagnostics: [...(snapshot.manifest.diagnostics ?? [])],
        subscribers: new Set(),
        events: snapshot.events,
        nextEventId: nextEventId(snapshot.events),
      };
      this.goals.set(goal.id, goal);
      if (snapshot.manifestError) {
        if (!goal.diagnostics.some((item) => item.code === "AGENT_STORE_RECORD_CORRUPT")) {
          goal.diagnostics.push(diagnostic("AGENT_STORE_RECORD_CORRUPT", snapshot.manifestError.message));
        }
      }
      if (snapshot.eventsError) {
        this.emit(goal.id, {
          type: "scheduler_error",
          code: "AGENT_EVENT_LOG_CORRUPT",
          message: snapshot.eventsError.message,
        });
      }
      if (!isTerminalGoal(goal.status)) this.markInterrupted(goal);
      else if (!snapshot.manifestError) this.tryPersistManifest(goal);
    }
  }

  private markInterrupted(goal: StoredGoal): void {
    goal.status = "failed";
    goal.result = "failed";
    goal.updatedAt = Date.now();
    for (const task of goal.tasks) {
      if (task.status === "pending" || task.status === "running") task.status = "canceled";
    }
    this.tryPersistManifest(goal);
    this.emit(goal.id, {
      type: "scheduler_error",
      code: "AGENT_RUNTIME_INTERRUPTED",
      message: "Goal was active when storage was loaded and cannot be resumed.",
      retryable: false,
    });
    this.emit(goal.id, { type: "goal_finished", goalId: goal.id, result: "failed" });
  }

  private markPersistenceFailed(goal: StoredGoal, error?: unknown): void {
    if (goal.persistenceFailed) return;
    goal.persistenceFailed = true;
    const message = `Goal event persistence failed: ${errorMessage(error)}`;
    goal.status = "failed";
    goal.result = "failed";
    goal.updatedAt = Date.now();
    const errorEvent: ReplayEvent<SchedulerEvent> = {
      id: goal.nextEventId++,
      sequence: goal.nextEventId - 1,
      goalId: goal.id,
      timestamp: Date.now(),
      event: { type: "scheduler_error", code: "AGENT_EVENT_PERSIST_FAILED", message, retryable: false, timestamp: Date.now() },
    };
    const finishedEvent: ReplayEvent<SchedulerEvent> = {
      id: goal.nextEventId++,
      sequence: goal.nextEventId - 1,
      goalId: goal.id,
      timestamp: Date.now(),
      event: { type: "goal_finished", goalId: goal.id, result: "failed", timestamp: Date.now() },
    };
    goal.events.push(errorEvent, finishedEvent);
    for (const subscriber of goal.subscribers) {
      subscriber.push(errorEvent.event);
      subscriber.push(finishedEvent.event);
      subscriber.end();
    }
    goal.subscribers.clear();
  }

  private tryPersistManifest(goal: StoredGoal): boolean {
    if (!this.storage || goal.persistenceFailed) return true;
    try {
      this.storage.writeGoalManifest(this.publicRecord(goal));
      return true;
    } catch (error) {
      this.markPersistenceFailed(goal, error);
      return false;
    }
  }

  private tryPersistEvent(goal: StoredGoal, event: ReplayEvent<SchedulerEvent>): boolean {
    if (!this.storage || goal.persistenceFailed) return true;
    try {
      this.storage.appendGoalEvent(goal.id, event);
      return true;
    } catch (error) {
      this.markPersistenceFailed(goal, error);
      return false;
    }
  }
}

export function isTerminalGoal(status: GoalRecord["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function nextEventId(events: Array<ReplayEvent<SchedulerEvent>>): number {
  return events.reduce((max, event) => Math.max(max, event.id), 0) + 1;
}

function goalReplayRecord(goal: StoredGoal, event: SchedulerEvent): ReplayEvent<SchedulerEvent> {
  return {
    id: goal.nextEventId,
    sequence: goal.nextEventId,
    goalId: goal.id,
    event,
    timestamp: Date.now(),
  };
}

function compareReplayEvents(left: ReplayEvent<unknown>, right: ReplayEvent<unknown>): number {
  return (left.sequence - right.sequence) || (left.id - right.id) || (left.timestamp - right.timestamp);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
