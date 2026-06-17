import {
  closeSync,
  existsSync,
  fdatasyncSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  appendFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent, ReplayEvent, SchedulerEvent } from "../core/events.js";
import { redactUnknown } from "../core/redaction.js";
import type { GoalRecord } from "../goals/goal-types.js";
import type { RunRecord } from "../runs/run-types.js";
import { appendJsonl, readJsonl } from "./jsonl-store.js";
import { validateGoalManifest, validateRunManifest } from "./manifest-validation.js";
import type { FileStorage, StorageDurability, StorageSyncHooks, StoredGoalSnapshot, StoredRunSnapshot } from "./storage-types.js";

export interface JsonFileStorageOptions {
  durability?: StorageDurability;
  sync?: StorageSyncHooks;
}

export class JsonFileStorage implements FileStorage {
  private readonly diagnostics: string[] = [];
  private readonly durability: StorageDurability;

  constructor(
    private readonly rootDir: string,
    private readonly options: JsonFileStorageOptions = {},
  ) {
    this.durability = options.durability ?? "relaxed";
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
        eventsIssue: events.issue,
      };
    });
  }

  writeRunManifest(record: RunRecord): void {
    atomicWriteJson(this.runManifestPath(record.id), sanitizeForStorage(record), this.writeOptions("manifest"));
  }

  appendRunEvent(runId: string, event: ReplayEvent<AgentEvent>): void {
    this.ensureRunDir(runId);
    appendJsonl(this.runEventsPath(runId), sanitizeForStorage(event), this.writeOptions("event"));
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
        eventsIssue: events.issue,
      };
    });
  }

  writeGoalManifest(record: GoalRecord): void {
    atomicWriteJson(this.goalManifestPath(record.id), sanitizeForStorage(record), this.writeOptions("manifest"));
  }

  appendGoalEvent(goalId: string, event: ReplayEvent<SchedulerEvent>): void {
    this.ensureGoalDir(goalId);
    appendJsonl(this.goalEventsPath(goalId), sanitizeForStorage(event), this.writeOptions("event"));
  }

  getDurabilityDiagnostics(): string[] {
    return [...this.diagnostics];
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

  private writeOptions(operation: "event" | "manifest"): JsonFileStorageOptions & { onSyncDiagnostic: (message: string) => void } {
    return {
      durability: this.durability,
      sync: this.options.sync,
      onSyncDiagnostic: (message) => {
        this.recordDurabilityDiagnostic(`Storage ${operation} sync fallback: ${message}`);
      },
    };
  }

  private recordDurabilityDiagnostic(message: string): void {
    const safeMessage = redactUnknown(message);
    this.diagnostics.push(safeMessage);
    try {
      appendFileSync(path.join(this.rootDir, "diagnostics.jsonl"), `${JSON.stringify({
        timestamp: Date.now(),
        diagnostic: {
          code: "AGENT_STORAGE_SYNC_FALLBACK",
          message: safeMessage,
          retryable: false,
        },
      })}\n`, "utf8");
    } catch {
      // Sync fallback diagnostics are best-effort and must not make the primary write fail.
    }
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

function atomicWriteJson(
  file: string,
  value: unknown,
  options: JsonFileStorageOptions & { onSyncDiagnostic?: (message: string) => void } = {},
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.manifest.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`, undefined, "utf8");
    syncFileDescriptor(fd, options);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  syncDirectory(path.dirname(file), options);
}

function sanitizeForStorage<T>(value: T): T {
  return redactUnknown(value);
}

function normalizeReplayEvent<T>(record: ReplayEvent<T>, scope: { runId?: string; goalId?: string }): ReplayEvent<T> {
  const sequence = typeof record.sequence === "number" ? record.sequence : record.id;
  return {
    ...record,
    ...scope,
    sequence,
  };
}

function syncFileDescriptor(
  fd: number,
  options: JsonFileStorageOptions & { onSyncDiagnostic?: (message: string) => void },
): void {
  if (options.durability !== "fsync") return;
  try {
    const fdatasync = options.sync?.fdatasyncSync ?? fdatasyncSync;
    fdatasync(fd);
  } catch (fdatasyncError) {
    try {
      const fsync = options.sync?.fsyncSync ?? fsyncSync;
      fsync(fd);
    } catch (fsyncError) {
      options.onSyncDiagnostic?.(
        `fdatasync failed (${errorMessage(fdatasyncError)}); fsync fallback failed (${errorMessage(fsyncError)}); continuing with relaxed durability`,
      );
    }
  }
}

function syncDirectory(dir: string, options: JsonFileStorageOptions & { onSyncDiagnostic?: (message: string) => void }): void {
  if (options.durability !== "fsync") return;
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    const fsync = options.sync?.fsyncSync ?? fsyncSync;
    fsync(fd);
  } catch (error) {
    options.onSyncDiagnostic?.(`directory fsync skipped (${errorMessage(error)}); continuing with file-level durability`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
