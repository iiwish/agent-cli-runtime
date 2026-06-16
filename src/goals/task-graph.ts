import type { CreateGoalRequest, PlannerOutput, ScheduledTask } from "./goal-types.js";
import type { RuntimeErrorCode } from "../core/diagnostics.js";

const MAX_PLANNER_DIAGNOSTIC_BYTES = 32_000;

export class TaskGraphError extends Error {
  readonly code: RuntimeErrorCode = "AGENT_TASK_GRAPH_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TaskGraphError";
  }
}

export function parsePlannerOutput(text: string): PlannerOutput {
  const json = extractJson(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new TaskGraphError(`Planner output is not valid JSON: ${jsonErrorMessage(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    throw new TaskGraphError("Planner output field tasks must be an array");
  }
  return { tasks: (parsed as PlannerOutput).tasks };
}

export function validateTaskGraph(output: PlannerOutput, request: CreateGoalRequest): ScheduledTask[] {
  const ids = new Set<string>();
  const tasks: ScheduledTask[] = [];
  for (const [index, task] of output.tasks.entries()) {
    if (!isRecord(task)) throw new TaskGraphError(`Task <task:${index}> must be an object`);
    const label = taskLabel(task, index);
    const id = requireString(task, "id", label);
    const title = requireString(task, "title", label);
    const objective = requireString(task, "objective", label);
    const dependencies = requireStringArray(task, "dependencies", label);
    if (!id) throw new TaskGraphError(`Task ${label} field id must be a non-empty string`);
    if (ids.has(id)) throw new TaskGraphError(`Task ${id} field id must be unique`);
    if (!title) throw new TaskGraphError(`Task ${id} field title must be a non-empty string`);
    if (!objective) throw new TaskGraphError(`Task ${id} field objective must be a non-empty string`);
    const allowedFiles = optionalStringArray(task, "allowedFiles", id);
    const validationCommands = optionalStringArray(task, "validationCommands", id);
    const agentId = optionalString(task, "agentId", id);
    const retryPolicy = validateRetryPolicy(task.retryPolicy, id);
    ids.add(id);
    tasks.push({
      id,
      title,
      objective,
      status: "pending",
      dependencies,
      agentId,
      cwd: request.cwd,
      permissionPolicy: request.permissionPolicy ?? "agent-default",
      allowedFiles,
      validationCommands,
      retryPolicy,
    });
  }
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) throw new TaskGraphError(`Task ${task.id} field dependencies contains unknown task ${dep}`);
    }
  }
  assertAcyclic(tasks);
  return tasks;
}

export function dependencyOrder(tasks: ScheduledTask[]): ScheduledTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set<string>();
  const ordered: ScheduledTask[] = [];
  while (ordered.length < tasks.length) {
    const ready = tasks.find((task) => !done.has(task.id) && task.dependencies.every((dep) => done.has(dep)));
    if (!ready) throw new Error("Task graph has no ready task");
    ordered.push(ready);
    done.add(ready.id);
  }
  return ordered.map((task) => byId.get(task.id) as ScheduledTask);
}

function assertAcyclic(tasks: ScheduledTask[]): void {
  try {
    dependencyOrder(tasks);
  } catch {
    throw new TaskGraphError("Task graph field dependencies must be acyclic");
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new TaskGraphError("Planner output did not contain JSON");
  if (trimmed.length > MAX_PLANNER_DIAGNOSTIC_BYTES && !trimmed.includes("{")) {
    throw new TaskGraphError(`Planner output is too large (${trimmed.length} bytes) and did not contain JSON`);
  }
  if (trimmed.startsWith("{") && isCompleteJsonObject(trimmed)) return trimmed;

  const fenced = [...trimmed.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/gu)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((body) => body.startsWith("{") || body.includes("{"));
  if (fenced.length > 1) throw new TaskGraphError("Planner output contained multiple fenced JSON blocks; expected exactly one task graph");
  if (fenced.length === 1) return fenced[0];

  const candidates = findJsonObjectCandidates(trimmed);
  if (candidates.length > 1) throw new TaskGraphError("Planner output contained multiple JSON objects; expected exactly one task graph");
  if (candidates.length === 1) return candidates[0];
  if (trimmed.includes("{") || trimmed.includes("}")) throw new TaskGraphError("Planner output JSON is malformed; expected one complete JSON object");
  throw new TaskGraphError("Planner output did not contain JSON");
}

function isCompleteJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed);
  } catch {
    return false;
  }
}

function findJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function requireString(task: Record<string, unknown>, field: string, taskId: string): string {
  const value = task[field];
  if (typeof value !== "string") throw new TaskGraphError(`Task ${taskId} field ${field} must be a string`);
  return value;
}

function optionalString(task: Record<string, unknown>, field: string, taskId: string): string | undefined {
  const value = task[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TaskGraphError(`Task ${taskId} field ${field} must be a string`);
  return value;
}

function requireStringArray(task: Record<string, unknown>, field: string, taskId: string): string[] {
  const value = task[field];
  if (!Array.isArray(value)) throw new TaskGraphError(`Task ${taskId} field ${field} must be a string[]`);
  const invalidIndex = value.findIndex((item) => typeof item !== "string");
  if (invalidIndex >= 0) throw new TaskGraphError(`Task ${taskId} field ${field}[${invalidIndex}] must be a string`);
  return [...value] as string[];
}

function optionalStringArray(task: Record<string, unknown>, field: string, taskId: string): string[] | undefined {
  const value = task[field];
  if (value === undefined) return undefined;
  return requireStringArray(task, field, taskId);
}

function validateRetryPolicy(value: unknown, taskId: string) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TaskGraphError(`Task ${taskId} field retryPolicy must be an object`);
  const maxAttempts = value.maxAttempts;
  if (!Number.isInteger(maxAttempts) || typeof maxAttempts !== "number" || maxAttempts <= 0) {
    throw new TaskGraphError(`Task ${taskId} field retryPolicy.maxAttempts must be a positive integer`);
  }
  const retryableErrorCodes = requireStringArray(value, "retryableErrorCodes", taskIdForNested(taskId, "retryPolicy"));
  const backoffMs = value.backoffMs;
  if (typeof backoffMs !== "number" || !Number.isFinite(backoffMs) || backoffMs < 0) {
    throw new TaskGraphError(`Task ${taskId} field retryPolicy.backoffMs must be a non-negative number`);
  }
  return {
    maxAttempts,
    retryableErrorCodes,
    backoffMs,
  };
}

function taskIdForNested(taskId: string, field: string): string {
  return `${taskId} field ${field}`;
}

function taskLabel(task: Record<string, unknown>, index: number): string {
  return typeof task.id === "string" && task.id ? task.id : `<task:${index}>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message.replace(/\s+at position \d+.*/u, "");
}
