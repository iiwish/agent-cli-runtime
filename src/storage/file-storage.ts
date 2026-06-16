import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent, ReplayEvent, SchedulerEvent } from "../core/events.js";
import { redactText, redactValue } from "../core/redaction.js";
import type { GoalRecord } from "../goals/goal-types.js";
import type { RunRecord } from "../runs/run-types.js";
import { appendJsonl, readJsonl } from "./jsonl-store.js";
import type { FileStorage, StoredGoalSnapshot, StoredRunSnapshot } from "./storage-types.js";

export class JsonFileStorage implements FileStorage {
  constructor(private readonly rootDir: string) {
    mkdirSync(this.runsDir, { recursive: true });
    mkdirSync(this.goalsDir, { recursive: true });
  }

  listRuns(): StoredRunSnapshot[] {
    return listManifestDirs(this.runsDir).map((dir) => {
      const runId = path.basename(dir);
      const manifest = readRunManifest(path.join(dir, "manifest.json"), runId);
      const events = readJsonl<AgentEvent>(path.join(dir, "events.jsonl"));
      return {
        manifest: manifest.value ?? corruptRunManifest(runId, manifest.error),
        manifestError: manifest.error,
        events: events.records.map((record) => normalizeReplayEvent(record, { runId })),
        eventsError: events.error,
      };
    });
  }

  writeRunManifest(record: RunRecord): void {
    atomicWriteJson(this.runManifestPath(record.id), sanitizeForStorage(record));
  }

  appendRunEvent(runId: string, event: ReplayEvent<AgentEvent>): void {
    this.ensureRunDir(runId);
    appendJsonl(this.runEventsPath(runId), sanitizeForStorage(event));
  }

  listGoals(): StoredGoalSnapshot[] {
    return listManifestDirs(this.goalsDir).map((dir) => {
      const goalId = path.basename(dir);
      const manifest = readGoalManifest(path.join(dir, "manifest.json"), goalId);
      const events = readJsonl<SchedulerEvent>(path.join(dir, "events.jsonl"));
      return {
        manifest: manifest.value ?? corruptGoalManifest(goalId, manifest.error),
        manifestError: manifest.error,
        events: events.records.map((record) => normalizeReplayEvent(record, { goalId })),
        eventsError: events.error,
      };
    });
  }

  writeGoalManifest(record: GoalRecord): void {
    atomicWriteJson(this.goalManifestPath(record.id), sanitizeForStorage(record));
  }

  appendGoalEvent(goalId: string, event: ReplayEvent<SchedulerEvent>): void {
    this.ensureGoalDir(goalId);
    appendJsonl(this.goalEventsPath(goalId), sanitizeForStorage(event));
  }

  private get runsDir(): string {
    return path.join(this.rootDir, "runs");
  }

  private get goalsDir(): string {
    return path.join(this.rootDir, "goals");
  }

  private ensureRunDir(runId: string): void {
    mkdirSync(path.join(this.runsDir, runId), { recursive: true });
  }

  private ensureGoalDir(goalId: string): void {
    mkdirSync(path.join(this.goalsDir, goalId), { recursive: true });
  }

  private runManifestPath(runId: string): string {
    this.ensureRunDir(runId);
    return path.join(this.runsDir, runId, "manifest.json");
  }

  private runEventsPath(runId: string): string {
    return path.join(this.runsDir, runId, "events.jsonl");
  }

  private goalManifestPath(goalId: string): string {
    this.ensureGoalDir(goalId);
    return path.join(this.goalsDir, goalId, "manifest.json");
  }

  private goalEventsPath(goalId: string): string {
    return path.join(this.goalsDir, goalId, "events.jsonl");
  }
}

function listManifestDirs(parent: string): string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(parent, entry.name, "manifest.json")))
    .map((entry) => path.join(parent, entry.name));
}

function readRunManifest(file: string, runId: string): { value?: RunRecord; error?: Error } {
  const parsed = readJson(file);
  if (parsed.error) return { error: parsed.error };
  return validateRunManifest(parsed.value, runId);
}

function readGoalManifest(file: string, goalId: string): { value?: GoalRecord; error?: Error } {
  const parsed = readJson(file);
  if (parsed.error) return { error: parsed.error };
  return validateGoalManifest(parsed.value, goalId);
}

function readJson(file: string): { value?: unknown; error?: Error } {
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: new Error(`${path.basename(file)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`) };
  }
}

function validateRunManifest(value: unknown, runId: string): { value?: RunRecord; error?: Error } {
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

function validateGoalManifest(value: unknown, goalId: string): { value?: GoalRecord; error?: Error } {
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

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.manifest.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function sanitizeForStorage<T>(value: T): T {
  return sanitizeUnknown(value) as T;
}

function sanitizeUnknown(value: unknown, key = ""): unknown {
  if (typeof value === "string") return redactValue(key, redactText(value));
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, key));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = sanitizeUnknown(childValue, childKey);
  }
  return out;
}

function normalizeReplayEvent<T>(record: ReplayEvent<T>, scope: { runId?: string; goalId?: string }): ReplayEvent<T> {
  const sequence = typeof record.sequence === "number" ? record.sequence : record.id;
  return {
    ...record,
    ...scope,
    sequence,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

function corruptRunManifest(runId: string, error: Error | undefined): RunRecord {
  const now = Date.now();
  return {
    id: runId,
    agentId: "unknown",
    cwd: "<unknown>",
    status: "failed",
    createdAt: now,
    updatedAt: now,
    exitCode: null,
    signal: null,
    error: error?.message ?? "Run manifest is corrupt.",
    errorCode: "AGENT_STORE_RECORD_CORRUPT",
    diagnostics: [{
      code: "AGENT_STORE_RECORD_CORRUPT",
      message: error?.message ?? "Run manifest is corrupt.",
      retryable: false,
    }],
  };
}

function corruptGoalManifest(goalId: string, error: Error | undefined): GoalRecord {
  const now = Date.now();
  return {
    id: goalId,
    cwd: "<unknown>",
    objective: "<unknown>",
    status: "failed",
    result: "failed",
    tasks: [],
    diagnostics: [{
      code: "AGENT_STORE_RECORD_CORRUPT",
      message: error?.message ?? "Goal manifest is corrupt.",
      retryable: false,
    }],
    createdAt: now,
    updatedAt: now,
  };
}
