import type { RuntimeErrorCode } from "./diagnostics.js";
import type { RunResult } from "../runs/run-result.js";
import type { ScheduledTask } from "../goals/goal-types.js";

export interface RuntimeUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export type AgentEvent =
  | { type: "run_started"; runId: string; agentId: string; cwd: string; model?: string; timestamp: number }
  | { type: "status"; label: string; detail?: string; timestamp: number }
  | { type: "text_delta"; text: string; timestamp: number }
  | { type: "thinking_delta"; text: string; timestamp: number }
  | { type: "tool_call"; id: string; name: string; input?: unknown; timestamp: number }
  | { type: "tool_result"; id: string; output?: unknown; isError?: boolean; timestamp: number }
  | { type: "file_event"; path: string; action: "created" | "updated" | "deleted" | "unknown"; timestamp: number }
  | { type: "usage"; usage: RuntimeUsage; costUsd?: number; timestamp: number }
  | { type: "error"; code: RuntimeErrorCode; message: string; retryable?: boolean; detail?: unknown; timestamp: number }
  | { type: "run_finished"; result: RunResult; exitCode?: number | null; signal?: string | null; timestamp: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type AgentEventInput = DistributiveOmit<AgentEvent, "timestamp">;

export interface ReplayEvent<T> {
  id: number;
  event: T;
  timestamp: number;
}

export type SchedulerEvent =
  | { type: "goal_started"; goalId: string; objective: string; timestamp: number }
  | { type: "task_created"; goalId: string; task: ScheduledTask; timestamp: number }
  | { type: "task_started"; goalId: string; taskId: string; runId: string; timestamp: number }
  | { type: "run_event"; goalId?: string; taskId?: string; runId: string; event: AgentEvent; timestamp: number }
  | { type: "task_finished"; goalId: string; taskId: string; result: RunResult; timestamp: number }
  | { type: "goal_finished"; goalId: string; result: RunResult; timestamp: number }
  | { type: "scheduler_error"; code: RuntimeErrorCode; message: string; retryable?: boolean; timestamp: number };

export type SchedulerEventInput = DistributiveOmit<SchedulerEvent, "timestamp">;

export function withTimestamp<T extends { timestamp?: number }>(event: Omit<T, "timestamp">): T {
  return { ...event, timestamp: Date.now() } as T;
}
