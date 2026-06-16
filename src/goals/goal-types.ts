import type { SchedulerEvent } from "../core/events.js";
import type { AgentId, PermissionPolicy } from "../adapters/adapter-types.js";
import type { RuntimeContextBlock } from "../runs/run-types.js";
import type { RunResult } from "../runs/run-result.js";

export interface CreateGoalRequest {
  cwd: string;
  objective: string;
  defaultAgentId: AgentId;
  plannerAgentId?: AgentId;
  permissionPolicy?: PermissionPolicy;
  model?: string;
  reasoning?: string;
  contextBlocks?: RuntimeContextBlock[];
  env?: Record<string, string>;
  timeoutMs?: number;
  taskTimeoutMs?: number;
  validationTimeoutMs?: number;
  continueOnFailure?: boolean;
}

export interface GoalHandle {
  goalId: string;
  events: AsyncIterable<SchedulerEvent>;
  cancel(reason?: string): Promise<void>;
}

export interface PlannerOutput {
  tasks: PlannerTask[];
}

export interface PlannerTask {
  id: string;
  title: string;
  objective: string;
  dependencies: string[];
  allowedFiles?: string[];
  validationCommands?: string[];
  agentId?: AgentId;
}

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled" | "blocked";

export interface TaskEvidence {
  runId?: string;
  result?: RunResult;
  validationCommands: string[];
  validationResults?: ValidationCommandResult[];
  summary: string;
}

export interface ValidationCommandResult {
  command: string;
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

export interface ScheduledTask {
  id: string;
  title: string;
  objective: string;
  status: TaskStatus;
  dependencies: string[];
  agentId?: AgentId;
  cwd: string;
  permissionPolicy: PermissionPolicy;
  allowedFiles?: string[];
  validationCommands?: string[];
  evidence?: TaskEvidence;
}

export interface GoalRecord {
  id: string;
  cwd: string;
  objective: string;
  status: "planning" | "running" | "succeeded" | "failed" | "canceled";
  tasks: ScheduledTask[];
  createdAt: number;
  updatedAt: number;
  result?: RunResult;
}
