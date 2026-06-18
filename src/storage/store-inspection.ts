import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import type { ReplayEvent } from "../core/events.js";
import type { AgentEvent, SchedulerEvent } from "../core/events.js";
import { terminalReasonFromDiagnosticCode, terminalReasonFromResult } from "../core/event-contract.js";
import { redactUnknown } from "../core/redaction.js";
import { readJsonl } from "./jsonl-store.js";
import { isRecord, validateGoalManifest, validateRunManifest } from "./manifest-validation.js";
import { inspectOwner, inspectStorageLock, type OwnerStatus, type RuntimeOwner, type StorageLockInspection } from "./storage-lease.js";
import type { RunRecord } from "../runs/run-types.js";
import type { GoalRecord } from "../goals/goal-types.js";
import { isTerminal } from "../runs/run-store.js";
import { isTerminalGoal } from "../goals/goal-store.js";

export interface InspectStoreOptions {
  storageDir?: string;
}

export interface StoreHealthIssue {
  kind: "run" | "goal";
  id: string;
  file: string;
  line?: number;
  reason: string;
  retainedEventCount?: number;
  corruptLineCount?: number;
  partialTailDetected?: boolean;
  lastGoodEventId?: number;
  lastGoodSequence?: number;
  repairRecommendation?: "none" | "truncate_partial_tail" | "isolate_corrupt_line" | "manual_review";
  redactedTailPreview?: string;
}

export interface StoreHealthWarning {
  kind: "run" | "goal";
  id: string;
  code: string;
  message: string;
  file: string;
}

export interface StoreHealthSummary {
  total: number;
  byCode: Record<string, number>;
}

export interface StoreActiveRecord {
  kind: "run" | "goal";
  id: string;
  status: string;
  file: string;
  ownerStatus: OwnerStatus;
  owner?: RuntimeOwner;
  ownerAgeMs?: number;
  reason?: string;
}

export interface StoreHealth {
  ok: boolean;
  storageDir?: string;
  checkedAt: number;
  lock: StorageLockInspection;
  totals: {
    runs: number;
    goals: number;
    corruptEventLogLines: number;
    partialEventLogTails: number;
    activeRecords: number;
  };
  corruptManifests: StoreHealthIssue[];
  corruptEventLogs: StoreHealthIssue[];
  partialTails: StoreHealthIssue[];
  activeRecords: StoreActiveRecord[];
  activeInterrupted: StoreHealthIssue[];
  warnings: StoreHealthWarning[];
  storageDiagnostics: RuntimeDiagnostic[];
  diagnostics: StoreHealthSummary;
}

export interface StoreRepairAction {
  kind: "run" | "goal";
  id: string;
  file: string;
  action: "truncate_partial_tail" | "isolate_corrupt_line" | "manual_review";
  dryRun: boolean;
  applied: boolean;
  line?: number;
  retainedEventCount?: number;
  lastGoodEventId?: number;
  lastGoodSequence?: number;
  reason: string;
  redactedTailPreview?: string;
}

export interface StoreRepairReport {
  schemaVersion: "agent-runtime.store-repair.v1";
  storageDir: string;
  checkedAt: number;
  dryRun: boolean;
  applied: boolean;
  ok: boolean;
  actions: StoreRepairAction[];
  diagnostics: StoreHealthSummary;
}

export type ExportDiagnosticsRequest =
  | { kind: "run"; runId: string; storageDir?: string }
  | { kind: "goal"; goalId: string; storageDir?: string };

export interface DiagnosticsBundle {
  schemaVersion: "agent-runtime.diagnostics.v1";
  exportedAt: number;
  storageDir?: string;
  subject: {
    kind: "run" | "goal";
    id: string;
  };
  manifest: unknown | null;
  events: {
    total: number;
    retained: number;
    firstEventId?: number;
    lastEventId?: number;
    terminalEvent: boolean;
    eventTypes: Record<string, number>;
    corrupt?: StoreHealthIssue;
    partialTail?: StoreHealthIssue;
  };
  diagnostics: RuntimeDiagnostic[];
  storageDiagnostics: RuntimeDiagnostic[];
  consistencyWarnings: StoreHealthWarning[];
  attemptEvidence?: unknown[];
  supervisorSummary: Record<string, unknown>;
  adapterSummary: Record<string, unknown>;
}

interface ScannedRecord {
  kind: "run" | "goal";
  id: string;
  manifest: Record<string, unknown> | null;
  manifestIssue?: StoreHealthIssue;
  eventIssue?: StoreHealthIssue;
  eventIssues: StoreHealthIssue[];
  partialTail?: StoreHealthIssue;
  events: Array<ReplayEvent<AgentEvent | SchedulerEvent>>;
  warnings: StoreHealthWarning[];
  activeInterrupted?: StoreHealthIssue;
}

export function inspectStoreDirectory(storageDir: string): StoreHealth {
  const records = scanStore(storageDir);
  const lock = inspectStorageLock(storageDir);
  const storageDiagnostics = readStoreDiagnostics(storageDir);
  const corruptManifests = records.flatMap((record) => record.manifestIssue ? [record.manifestIssue] : []);
  const corruptEventLogs = records.flatMap((record) => record.eventIssues);
  const partialTails = records.flatMap((record) => record.partialTail ? [record.partialTail] : []);
  const activeRecords = records.flatMap((record) => activeRecord(record, storageDir));
  const activeInterrupted = records.flatMap((record) => record.activeInterrupted ? [record.activeInterrupted] : []);
  const warnings = records.flatMap((record) => record.warnings);
  const health: StoreHealth = {
    ok: corruptManifests.length === 0
      && corruptEventLogs.length === 0
      && warnings.length === 0
      && activeInterrupted.length === 0
      && lock.status !== "invalid"
      && storageDiagnostics.length === 0,
    storageDir,
    checkedAt: Date.now(),
    lock,
    totals: {
      runs: records.filter((record) => record.kind === "run").length,
      goals: records.filter((record) => record.kind === "goal").length,
      corruptEventLogLines: corruptEventLogs.reduce((sum, issue) => sum + (issue.corruptLineCount ?? 1), 0),
      partialEventLogTails: partialTails.length,
      activeRecords: activeRecords.length,
    },
    corruptManifests,
    corruptEventLogs,
    partialTails,
    activeRecords,
    activeInterrupted,
    warnings,
    storageDiagnostics,
    diagnostics: summarizeDiagnostics(records, storageDiagnostics),
  };
  return redactUnknown(health);
}

export function inspectStoreLock(storageDir: string): StorageLockInspection {
  return redactUnknown(inspectStorageLock(storageDir));
}

export function listStoredRuns(storageDir: string, options: { status?: "active" | RunRecord["status"] } = {}): RunRecord[] {
  return scanStore(storageDir)
    .filter((record) => record.kind === "run")
    .flatMap((record) => {
      const run = recordToRun(record);
      return run ? [run] : [];
    })
    .filter((run) => {
      if (!options.status) return true;
      if (options.status === "active") return !isTerminal(run.status);
      return run.status === options.status;
    });
}

export function getStoredRun(storageDir: string, runId: string): RunRecord | null {
  const record = scanRecord(storageDir, "run", runId);
  return recordToRun(record);
}

export function replayStoredRunEvents(storageDir: string, runId: string, afterEventId = 0): Array<ReplayEvent<AgentEvent>> {
  const record = scanRecord(storageDir, "run", runId);
  return record.events
    .filter((event) => event.id > afterEventId)
    .sort(compareReplayEvents) as Array<ReplayEvent<AgentEvent>>;
}

export function listStoredGoals(storageDir: string, options: { status?: "active" | GoalRecord["status"] } = {}): GoalRecord[] {
  return scanStore(storageDir)
    .filter((record) => record.kind === "goal")
    .flatMap((record) => {
      const goal = recordToGoal(record);
      return goal ? [goal] : [];
    })
    .filter((goal) => {
      if (!options.status) return true;
      if (options.status === "active") return !isTerminalGoal(goal.status);
      return goal.status === options.status;
    });
}

export function getStoredGoal(storageDir: string, goalId: string): GoalRecord | null {
  const record = scanRecord(storageDir, "goal", goalId);
  return recordToGoal(record);
}

export function replayStoredGoalEvents(storageDir: string, goalId: string, afterEventId = 0): Array<ReplayEvent<SchedulerEvent>> {
  const record = scanRecord(storageDir, "goal", goalId);
  return record.events
    .filter((event) => event.id > afterEventId)
    .sort(compareReplayEvents) as Array<ReplayEvent<SchedulerEvent>>;
}

export function inspectStoreRepairDryRun(storageDir: string): StoreRepairReport {
  const health = inspectStoreDirectory(storageDir);
  const actions = [
    ...health.partialTails.map((issue): StoreRepairAction => ({
      kind: issue.kind,
      id: issue.id,
      file: issue.file,
      action: "truncate_partial_tail",
      dryRun: true,
      applied: false,
      line: issue.line,
      retainedEventCount: issue.retainedEventCount,
      lastGoodEventId: issue.lastGoodEventId,
      lastGoodSequence: issue.lastGoodSequence,
      reason: issue.reason,
      redactedTailPreview: issue.redactedTailPreview,
    })),
    ...health.corruptEventLogs
      .filter((issue) => !issue.partialTailDetected)
      .map((issue): StoreRepairAction => ({
        kind: issue.kind,
        id: issue.id,
        file: issue.file,
        action: issue.repairRecommendation === "isolate_corrupt_line" ? "isolate_corrupt_line" : "manual_review",
        dryRun: true,
        applied: false,
        line: issue.line,
        retainedEventCount: issue.retainedEventCount,
        lastGoodEventId: issue.lastGoodEventId,
        lastGoodSequence: issue.lastGoodSequence,
        reason: issue.reason,
        redactedTailPreview: issue.redactedTailPreview,
      })),
  ];
  return redactUnknown({
    schemaVersion: "agent-runtime.store-repair.v1",
    storageDir,
    checkedAt: Date.now(),
    dryRun: true,
    applied: false,
    ok: actions.length === 0,
    actions,
    diagnostics: health.diagnostics,
  });
}

export function exportDiagnosticsBundle(request: ExportDiagnosticsRequest, storageDir: string): DiagnosticsBundle {
  const kind = request.kind;
  const id = kind === "run" ? request.runId : request.goalId;
  const record = scanRecord(storageDir, kind, id);
  const storageDiagnostics = readStoreDiagnostics(storageDir);
  const eventTypes: Record<string, number> = {};
  for (const event of record.events) {
    const type = eventType(event.event);
    eventTypes[type] = (eventTypes[type] ?? 0) + 1;
  }
  const diagnostics = diagnosticsForRecord(record);
  const manifest = record.manifest;
  const bundle: DiagnosticsBundle = {
    schemaVersion: "agent-runtime.diagnostics.v1",
    exportedAt: Date.now(),
    storageDir,
    subject: { kind, id },
    manifest,
    events: {
      total: record.events.length,
      retained: record.events.length,
      firstEventId: record.events[0]?.id,
      lastEventId: record.events.at(-1)?.id,
      terminalEvent: hasTerminalEvent(kind, record.events),
      eventTypes,
      corrupt: record.eventIssue,
      partialTail: record.partialTail,
    },
    diagnostics,
    storageDiagnostics,
    consistencyWarnings: record.warnings,
    attemptEvidence: kind === "goal" ? attemptEvidenceFromGoalManifest(manifest) : undefined,
    supervisorSummary: supervisorSummary(record),
    adapterSummary: adapterSummary(record),
  };
  return redactUnknown(bundle);
}

export function atomicWriteJsonFile(file: string, value: unknown): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(redactUnknown(value), null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function scanStore(storageDir: string): ScannedRecord[] {
  return [
    ...scanKind(storageDir, "run"),
    ...scanKind(storageDir, "goal"),
  ];
}

function scanKind(storageDir: string, kind: "run" | "goal"): ScannedRecord[] {
  const parent = path.join(storageDir, kind === "run" ? "runs" : "goals");
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => scanRecord(storageDir, kind, entry.name));
}

function scanRecord(storageDir: string, kind: "run" | "goal", id: string): ScannedRecord {
  const recordDir = path.join(storageDir, kind === "run" ? "runs" : "goals", id);
  const manifestPath = path.join(recordDir, "manifest.json");
  const eventsPath = path.join(recordDir, "events.jsonl");
  const manifest = readManifest(storageDir, manifestPath, kind, id);
  const events = readJsonl<AgentEvent | SchedulerEvent>(eventsPath);
  const eventIssues = events.issues.map((issue): StoreHealthIssue => ({
    kind,
    id,
    file: relativeFile(storageDir, eventsPath),
    line: issue.line,
    reason: issue.reason,
    retainedEventCount: issue.retainedEventCount,
    corruptLineCount: issue.corruptLineCount,
    partialTailDetected: issue.partialTailDetected,
    lastGoodEventId: issue.lastGoodEventId,
    lastGoodSequence: issue.lastGoodSequence,
    repairRecommendation: issue.repairRecommendation,
    redactedTailPreview: issue.redactedTailPreview,
  }));
  const eventIssue = eventIssues[0];
  const record: ScannedRecord = {
    kind,
    id,
    manifest: manifest.value,
    manifestIssue: manifest.issue,
    events: events.records,
    eventIssue,
    eventIssues,
    partialTail: eventIssues.find((issue) => issue.partialTailDetected),
    warnings: [],
  };
  record.activeInterrupted = activeInterruptedIssue(record, storageDir, manifestPath);
  record.warnings = consistencyWarnings(record, storageDir, manifestPath);
  return record;
}

function readManifest(
  storageDir: string,
  file: string,
  kind: "run" | "goal",
  id: string,
): { value: Record<string, unknown> | null; issue?: StoreHealthIssue } {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const validated = kind === "run" ? validateRunManifest(parsed, id) : validateGoalManifest(parsed, id);
    if (validated.error) return { value: null, issue: manifestIssue(storageDir, file, kind, id, validated.error.message) };
    return { value: validated.value as unknown as Record<string, unknown> };
  } catch (error) {
    return {
      value: null,
      issue: manifestIssue(storageDir, file, kind, id, error instanceof Error ? error.message : String(error)),
    };
  }
}

function recordToRun(record: ScannedRecord): RunRecord | null {
  if (record.kind !== "run") return null;
  if (record.manifest) return record.manifest as unknown as RunRecord;
  if (!record.manifestIssue) return null;
  const now = Date.now();
  return {
    id: record.id,
    agentId: "unknown",
    cwd: "<unknown>",
    status: "failed",
    createdAt: now,
    updatedAt: now,
    exitCode: null,
    signal: null,
    error: record.manifestIssue.reason,
    errorCode: "AGENT_STORE_RECORD_CORRUPT",
    diagnostics: [{
      code: "AGENT_STORE_RECORD_CORRUPT",
      message: record.manifestIssue.reason,
      retryable: false,
    }],
  };
}

function recordToGoal(record: ScannedRecord): GoalRecord | null {
  if (record.kind !== "goal") return null;
  if (record.manifest) return record.manifest as unknown as GoalRecord;
  if (!record.manifestIssue) return null;
  const now = Date.now();
  return {
    id: record.id,
    cwd: "<unknown>",
    objective: "<unknown>",
    status: "failed",
    result: "failed",
    tasks: [],
    diagnostics: [{
      code: "AGENT_STORE_RECORD_CORRUPT",
      message: record.manifestIssue.reason,
      retryable: false,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

function manifestIssue(storageDir: string, file: string, kind: "run" | "goal", id: string, reason: string): StoreHealthIssue {
  return {
    kind,
    id,
    file: relativeFile(storageDir, file),
    reason,
  };
}

function consistencyWarnings(record: ScannedRecord, storageDir: string, manifestPath: string): StoreHealthWarning[] {
  if (!record.manifest) return [];
  const terminalManifest = isTerminalManifest(record.kind, record.manifest.status);
  const terminalEvent = hasTerminalEvent(record.kind, record.events);
  if (terminalManifest && !terminalEvent) {
    return [{
      kind: record.kind,
      id: record.id,
      code: "AGENT_STORE_TERMINAL_EVENT_MISSING",
      message: "Terminal manifest has no matching terminal event in events.jsonl.",
      file: relativeFile(storageDir, manifestPath),
    }];
  }
  if (!terminalManifest && terminalEvent) {
    return [{
      kind: record.kind,
      id: record.id,
      code: "AGENT_STORE_TERMINAL_EVENT_MANIFEST_MISMATCH",
      message: "Event log has a terminal event but manifest status is not terminal.",
      file: relativeFile(storageDir, manifestPath),
    }];
  }
  return [];
}

function activeInterruptedIssue(record: ScannedRecord, storageDir: string, manifestPath: string): StoreHealthIssue | undefined {
  if (!record.manifest) return undefined;
  const manifestDiagnostics = Array.isArray(record.manifest.diagnostics) ? record.manifest.diagnostics : [];
  const hasInterruptedDiagnostic = manifestDiagnostics.some((item) => isRecord(item) && item.code === "AGENT_RUNTIME_INTERRUPTED")
    || record.events.some((event) => eventDiagnosticCode(event.event) === "AGENT_RUNTIME_INTERRUPTED");
  const owner = recordOwner(record.manifest);
  const ownerInspection = inspectOwner(owner);
  const activeNeedsRecovery = !isTerminalManifest(record.kind, record.manifest.status) && ownerInspection.status !== "live";
  if (hasInterruptedDiagnostic || activeNeedsRecovery) {
    return {
      kind: record.kind,
      id: record.id,
      file: relativeFile(storageDir, manifestPath),
      reason: hasInterruptedDiagnostic
        ? "record was interrupted by runtime load and cannot be resumed"
        : "record is non-terminal in storage and cannot be resumed by a new runtime",
    };
  }
  return undefined;
}

function activeRecord(record: ScannedRecord, storageDir: string): StoreActiveRecord[] {
  if (!record.manifest || isTerminalManifest(record.kind, record.manifest.status)) return [];
  const manifestPath = path.join(storageDir, record.kind === "run" ? "runs" : "goals", record.id, "manifest.json");
  const ownerInspection = inspectOwner(recordOwner(record.manifest));
  return [redactUnknown({
    kind: record.kind,
    id: record.id,
    status: String(record.manifest.status),
    file: relativeFile(storageDir, manifestPath),
    ownerStatus: ownerInspection.status,
    owner: ownerInspection.owner,
    ownerAgeMs: ownerInspection.ageMs,
    reason: ownerInspection.reason,
  })];
}

function summarizeDiagnostics(records: ScannedRecord[], storageDiagnostics: RuntimeDiagnostic[] = []): StoreHealthSummary {
  const byCode: Record<string, number> = {};
  for (const diagnostic of storageDiagnostics) increment(byCode, String(diagnostic.code));
  for (const record of records) {
    if (record.manifestIssue) increment(byCode, "AGENT_STORE_RECORD_CORRUPT");
    for (const _issue of record.eventIssues) increment(byCode, "AGENT_EVENT_LOG_CORRUPT");
    if (record.activeInterrupted) increment(byCode, "AGENT_RUNTIME_INTERRUPTED");
    for (const warning of record.warnings) increment(byCode, warning.code);
    for (const diagnostic of manifestDiagnostics(record.manifest)) increment(byCode, String(diagnostic.code));
    for (const event of record.events) {
      const code = eventDiagnosticCode(event.event);
      if (code) increment(byCode, code);
    }
  }
  return {
    total: Object.values(byCode).reduce((sum, count) => sum + count, 0),
    byCode,
  };
}

function readStoreDiagnostics(storageDir: string): RuntimeDiagnostic[] {
  const file = path.join(storageDir, "diagnostics.jsonl");
  if (!existsSync(file)) return [];
  const diagnostics: RuntimeDiagnostic[] = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && isRuntimeDiagnostic(parsed.diagnostic)) {
        diagnostics.push(parsed.diagnostic);
      } else if (isRuntimeDiagnostic(parsed)) {
        diagnostics.push(parsed);
      } else {
        diagnostics.push({
          code: "AGENT_STORE_RECORD_CORRUPT",
          message: `diagnostics.jsonl:${index + 1} is not a runtime diagnostic`,
          retryable: false,
        });
      }
    } catch (error) {
      diagnostics.push({
        code: "AGENT_STORE_RECORD_CORRUPT",
        message: `diagnostics.jsonl:${index + 1} ${error instanceof Error ? error.message : String(error)}`,
        retryable: false,
      });
    }
  }
  return diagnostics;
}

function diagnosticsForRecord(record: ScannedRecord): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [...manifestDiagnostics(record.manifest)];
  if (record.manifestIssue) diagnostics.push({ code: "AGENT_STORE_RECORD_CORRUPT", message: record.manifestIssue.reason, retryable: false });
  for (const issue of record.eventIssues) {
    diagnostics.push({ code: "AGENT_EVENT_LOG_CORRUPT", message: issue.reason, retryable: false });
  }
  for (const warning of record.warnings) diagnostics.push({ code: warning.code, message: warning.message, retryable: false });
  for (const event of record.events) {
    const code = eventDiagnosticCode(event.event);
    if (code) diagnostics.push({ code, message: eventDiagnosticMessage(event.event), retryable: false });
  }
  return diagnostics;
}

function manifestDiagnostics(manifest: Record<string, unknown> | null): RuntimeDiagnostic[] {
  if (!manifest || !Array.isArray(manifest.diagnostics)) return [];
  return manifest.diagnostics.filter(isRuntimeDiagnostic);
}

function attemptEvidenceFromGoalManifest(manifest: Record<string, unknown> | null): unknown[] {
  if (!manifest || !Array.isArray(manifest.tasks)) return [];
  return manifest.tasks
    .filter(isRecord)
    .flatMap((task) => {
      const evidence = isRecord(task.evidence) ? task.evidence : undefined;
      const attempts = Array.isArray(evidence?.attempts) ? evidence.attempts : [];
      return attempts.map((attempt) => ({
        taskId: task.id,
        title: task.title,
        attempt,
      }));
    });
}

function adapterSummary(record: ScannedRecord): Record<string, unknown> {
  if (!record.manifest) return { kind: record.kind, id: record.id, available: false };
  if (record.kind === "run") {
    const diagnostic = manifestDiagnostics(record.manifest).find((item) =>
      item.promptTransport || item.streamFormat || item.parsedEventCount !== undefined || item.argv,
    );
    return {
      kind: "run",
      agentId: record.manifest.agentId,
      status: record.manifest.status,
      errorCode: record.manifest.errorCode,
      exitCode: record.manifest.exitCode,
      signal: record.manifest.signal,
      argv: diagnostic?.argv,
      promptTransport: diagnostic?.promptTransport,
      streamFormat: diagnostic?.streamFormat,
      parsedEventCount: diagnostic?.parsedEventCount,
      actionableHints: diagnostic?.actionableHints,
    };
  }
  const taskAgentIds = Array.isArray(record.manifest.tasks)
    ? [...new Set(record.manifest.tasks.filter(isRecord).map((task) => task.agentId).filter((agentId) => typeof agentId === "string"))]
    : [];
  return {
    kind: "goal",
    status: record.manifest.status,
    result: record.manifest.result,
    taskAgentIds,
  };
}

function supervisorSummary(record: ScannedRecord): Record<string, unknown> {
  const terminalEvents = record.events.filter((event) =>
    record.kind === "run" ? event.event.type === "run_finished" : event.event.type === "goal_finished",
  );
  if (!record.manifest) {
    return {
      kind: record.kind,
      id: record.id,
      status: "unknown",
      terminalEventCount: terminalEvents.length,
      terminalReason: "manifest_unavailable",
    };
  }
  const ownerInspection = inspectOwner(recordOwner(record.manifest));
  const ownerSummary = {
    ownerStatus: ownerInspection.status,
    owner: ownerInspection.owner,
    ownerAgeMs: ownerInspection.ageMs,
    ownerReason: ownerInspection.reason,
  };
  if (record.kind === "run") {
    return {
      kind: "run",
      id: record.id,
      status: record.manifest.status,
      result: runResultFromStatus(record.manifest.status),
      errorCode: record.manifest.errorCode,
      signal: record.manifest.signal,
      terminalReason: terminalEventReason(terminalEvents) ?? terminalReason(record.manifest),
      terminalEventCount: terminalEvents.length,
      activeReloadRecovered: hasDiagnostic(record, "AGENT_RUNTIME_INTERRUPTED"),
      lease: ownerSummary,
    };
  }
  const tasks = Array.isArray(record.manifest.tasks) ? record.manifest.tasks.filter(isRecord) : [];
  const taskStatusCounts: Record<string, number> = {};
  for (const task of tasks) {
    if (typeof task.status === "string") increment(taskStatusCounts, task.status);
  }
  return {
    kind: "goal",
    id: record.id,
    status: record.manifest.status,
    result: record.manifest.result,
    terminalReason: terminalEventReason(terminalEvents) ?? terminalReason(record.manifest),
    terminalEventCount: terminalEvents.length,
    activeReloadRecovered: hasDiagnostic(record, "AGENT_RUNTIME_INTERRUPTED"),
    taskStatusCounts,
    lease: ownerSummary,
  };
}

function runResultFromStatus(status: unknown): string | undefined {
  if (status === "succeeded") return "success";
  if (status === "canceled") return "cancelled";
  if (status === "failed") return "failed";
  return undefined;
}

function terminalReason(manifest: Record<string, unknown>): string {
  const errorCode = typeof manifest.errorCode === "string" ? manifest.errorCode : undefined;
  const signal = typeof manifest.signal === "string" ? manifest.signal : undefined;
  if (manifest.status === "succeeded") return terminalReasonFromResult("success", errorCode, signal);
  if (manifest.status === "canceled") return terminalReasonFromResult("cancelled", errorCode, signal);
  if (manifest.status === "failed") return terminalReasonFromResult("failed", errorCode, signal);
  return "active";
}

function terminalEventReason(events: Array<ReplayEvent<AgentEvent | SchedulerEvent>>): string | undefined {
  const event = events.at(-1)?.event;
  if (event && "reason" in event && typeof event.reason === "string") return event.reason;
  return undefined;
}

function hasDiagnostic(record: ScannedRecord, code: string): boolean {
  return manifestDiagnostics(record.manifest).some((item) => item.code === code)
    || record.events.some((event) => eventDiagnosticCode(event.event) === code);
}

function isTerminalManifest(kind: "run" | "goal", status: unknown): boolean {
  if (kind === "run") return status === "succeeded" || status === "failed" || status === "canceled";
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function hasTerminalEvent(kind: "run" | "goal", events: Array<ReplayEvent<AgentEvent | SchedulerEvent>>): boolean {
  return events.some((record) => kind === "run" ? record.event.type === "run_finished" : record.event.type === "goal_finished");
}

function eventType(event: AgentEvent | SchedulerEvent): string {
  return typeof event.type === "string" ? event.type : "unknown";
}

function eventDiagnosticCode(event: AgentEvent | SchedulerEvent): string | undefined {
  if ((event.type === "error" || event.type === "scheduler_error") && typeof event.code === "string") return event.code;
  return undefined;
}

function eventDiagnosticMessage(event: AgentEvent | SchedulerEvent): string {
  if ((event.type === "error" || event.type === "scheduler_error") && typeof event.message === "string") return event.message;
  return "Event diagnostic";
}

function increment(counts: Record<string, number>, code: string): void {
  counts[code] = (counts[code] ?? 0) + 1;
}

function recordOwner(manifest: Record<string, unknown>): RuntimeOwner | undefined {
  const owner = manifest.owner;
  if (!isRecord(owner)) return undefined;
  if (typeof owner.runtimeInstanceId !== "string") return undefined;
  if (typeof owner.pid !== "number" || typeof owner.startedAt !== "number" || typeof owner.heartbeatAt !== "number") return undefined;
  return {
    runtimeInstanceId: owner.runtimeInstanceId,
    pid: owner.pid,
    startedAt: owner.startedAt,
    heartbeatAt: owner.heartbeatAt,
    closedAt: typeof owner.closedAt === "number" ? owner.closedAt : undefined,
  };
}

function compareReplayEvents(left: ReplayEvent<unknown>, right: ReplayEvent<unknown>): number {
  return (left.sequence - right.sequence) || (left.id - right.id) || (left.timestamp - right.timestamp);
}

function relativeFile(storageDir: string, file: string): string {
  return path.relative(storageDir, file).split(path.sep).join("/");
}

function isRuntimeDiagnostic(value: unknown): value is RuntimeDiagnostic {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}
