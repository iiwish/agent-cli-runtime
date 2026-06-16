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
      const manifest = readJson<RunRecord>(path.join(dir, "manifest.json"));
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
      const manifest = readJson<GoalRecord>(path.join(dir, "manifest.json"));
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

function readJson<T>(file: string): { value?: T; error?: Error } {
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")) as T };
  } catch (error) {
    return { error: new Error(`${path.basename(file)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`) };
  }
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
