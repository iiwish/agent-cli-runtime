import type { ReplayEvent } from "../core/events.js";
import type { GoalRecord } from "../goals/goal-types.js";
import type { RunRecord } from "../runs/run-types.js";
import type { AgentEvent, SchedulerEvent } from "../core/events.js";

export interface JsonlReadResult<T> {
  records: Array<ReplayEvent<T>>;
  error?: Error;
}

export interface StoredRunSnapshot {
  manifest: RunRecord;
  events: Array<ReplayEvent<AgentEvent>>;
  eventsError?: Error;
}

export interface StoredGoalSnapshot {
  manifest: GoalRecord;
  events: Array<ReplayEvent<SchedulerEvent>>;
  eventsError?: Error;
}

export interface FileStorage {
  listRuns(): StoredRunSnapshot[];
  writeRunManifest(record: RunRecord): void;
  appendRunEvent(runId: string, event: ReplayEvent<AgentEvent>): void;
  listGoals(): StoredGoalSnapshot[];
  writeGoalManifest(record: GoalRecord): void;
  appendGoalEvent(goalId: string, event: ReplayEvent<SchedulerEvent>): void;
}
