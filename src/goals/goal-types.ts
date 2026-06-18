import type { SchedulerEvent } from "../core/events.js";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
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
  maxConcurrentTasks?: number;
  retryPolicy?: TaskRetryPolicy;
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
  retryPolicy?: TaskRetryPolicy;
}

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled" | "blocked";

export interface TaskEvidence {
  runId?: string;
  result?: RunResult;
  attempts?: TaskAttemptEvidence[];
  validationCommands: string[];
  validationResults?: ValidationCommandResult[];
  summary: string;
}

export interface TaskRetryPolicy {
  maxAttempts?: number;
  retryableErrorCodes?: string[];
  backoffMs?: number;
}

export interface TaskAttemptEvidence {
  attemptId: string;
  runId: string;
  startedAt: number;
  finishedAt?: number;
  result?: RunResult;
  diagnostics: RuntimeDiagnostic[];
}

export interface ValidationCommandResult {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
  classification: "success" | "failed" | "timeout" | "spawn_error";
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
  retryPolicy?: TaskRetryPolicy;
  evidence?: TaskEvidence;
}

export type GoalStatus = "planning" | "running" | "succeeded" | "failed" | "canceled";

export interface GoalRecord {
  id: string;
  cwd: string;
  objective: string;
  status: GoalStatus;
  tasks: ScheduledTask[];
  diagnostics: RuntimeDiagnostic[];
  createdAt: number;
  updatedAt: number;
  result?: RunResult;
}
