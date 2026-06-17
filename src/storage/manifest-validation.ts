import type { GoalRecord } from "../goals/goal-types.js";
import type { RunRecord } from "../runs/run-types.js";

export function validateRunManifest(value: unknown, runId: string): { value?: RunRecord; error?: Error } {
  if (!isRecord(value)) return invalidManifest("run", "manifest is not an object");
  if (value.id !== runId) return invalidManifest("run", "id does not match storage directory");
  if (typeof value.agentId !== "string") return invalidManifest("run", "agentId must be a string");
  if (typeof value.cwd !== "string") return invalidManifest("run", "cwd must be a string");
  if (!isRunStatus(value.status)) return invalidManifest("run", "status is invalid");
  if (typeof value.createdAt !== "number" || typeof value.updatedAt !== "number") {
    return invalidManifest("run", "createdAt and updatedAt must be numbers");
  }
  if ("diagnostics" in value && !Array.isArray(value.diagnostics)) return invalidManifest("run", "diagnostics must be an array");
  return {
    value: {
      id: value.id,
      agentId: value.agentId,
      cwd: value.cwd,
      status: value.status,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      exitCode: typeof value.exitCode === "number" || value.exitCode === null ? value.exitCode : null,
      signal: typeof value.signal === "string" || value.signal === null ? value.signal : null,
      error: typeof value.error === "string" || value.error === null ? value.error : null,
      errorCode: typeof value.errorCode === "string" || value.errorCode === null ? value.errorCode : null,
      diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : [],
    },
  };
}

export function validateGoalManifest(value: unknown, goalId: string): { value?: GoalRecord; error?: Error } {
  if (!isRecord(value)) return invalidManifest("goal", "manifest is not an object");
  if (value.id !== goalId) return invalidManifest("goal", "id does not match storage directory");
  if (typeof value.cwd !== "string") return invalidManifest("goal", "cwd must be a string");
  if (typeof value.objective !== "string") return invalidManifest("goal", "objective must be a string");
  if (!isGoalStatus(value.status)) return invalidManifest("goal", "status is invalid");
  if (!Array.isArray(value.tasks)) return invalidManifest("goal", "tasks must be an array");
  if (!value.tasks.every(isStoredTask)) return invalidManifest("goal", "tasks entries are invalid");
  if (typeof value.createdAt !== "number" || typeof value.updatedAt !== "number") {
    return invalidManifest("goal", "createdAt and updatedAt must be numbers");
  }
  if ("diagnostics" in value && !Array.isArray(value.diagnostics)) return invalidManifest("goal", "diagnostics must be an array");
  if ("result" in value && value.result !== undefined && !isRunResult(value.result)) return invalidManifest("goal", "result is invalid");
  return {
    value: {
      id: value.id,
      cwd: value.cwd,
      objective: value.objective,
      status: value.status,
      tasks: value.tasks as GoalRecord["tasks"],
      diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : [],
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      result: value.result as GoalRecord["result"],
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidManifest(kind: "run" | "goal", reason: string): { error: Error } {
  return { error: new Error(`${kind} manifest is corrupt: ${reason}`) };
}

function isRunStatus(value: unknown): value is RunRecord["status"] {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "canceled";
}

function isGoalStatus(value: unknown): value is GoalRecord["status"] {
  return value === "planning" || value === "running" || value === "succeeded" || value === "failed" || value === "canceled";
}

function isRunResult(value: unknown): value is NonNullable<GoalRecord["result"]> {
  return value === "success" || value === "failed" || value === "cancelled";
}

function isStoredTask(value: unknown): value is GoalRecord["tasks"][number] {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.objective === "string"
    && isTaskStatus(value.status)
    && Array.isArray(value.dependencies)
    && value.dependencies.every((dependency) => typeof dependency === "string")
    && typeof value.cwd === "string"
    && typeof value.permissionPolicy === "string";
}

function isTaskStatus(value: unknown): boolean {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "canceled" || value === "blocked";
}
