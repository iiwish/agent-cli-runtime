import {
  closeSync,
  existsSync,
  fdatasyncSync,
  fsyncSync,
  appendFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import type { ReplayEvent } from "../core/events.js";
import type { AgentEvent, SchedulerEvent } from "../core/events.js";
import { terminalReasonFromDiagnosticCode, terminalReasonFromResult } from "../core/event-contract.js";
import { redactUnknown } from "../core/redaction.js";
import { readJsonl } from "./jsonl-store.js";
import { isRecord, validateGoalManifest, validateRunManifest } from "./manifest-validation.js";
import { inspectOwner, inspectStorageLock, StorageLease, type OwnerStatus, type RuntimeOwner, type StorageLockInspection } from "./storage-lease.js";
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
  backupPath: string | null;
  line?: number;
  retainedEventCount: number;
  removedLineCount: number;
  truncatedBytes: number;
  lastGoodEventId?: number;
  lastGoodSequence?: number;
  reason: string;
  redactedTailPreview?: string;
  diagnostics: RuntimeDiagnostic[];
}

export interface StoreRepairReport {
  schemaVersion: "agent-runtime.storeRepair.v1";
  storageDir: string;
  checkedAt: number;
  dryRun: boolean;
  applied: boolean;
  ok: boolean;
  blockedReason?: string;
  actions: StoreRepairAction[];
  diagnostics: StoreHealthSummary;
}

export interface StoreRepairFaultHooks {
  beforeBackupWrite?: (file: string) => void;
  beforeRepairRewrite?: (file: string) => void;
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
      && storageDiagnostics.every(isNonBlockingStorageDiagnostic),
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
  return inspectStoreRepair(storageDir, { apply: false });
}

export function inspectStoreRepair(storageDir: string, options: { apply?: boolean; faults?: StoreRepairFaultHooks } = {}): StoreRepairReport {
  const health = inspectStoreDirectory(storageDir);
  const dryRun = !options.apply;
  const actions = [
    ...health.partialTails.map((issue) => repairActionFromIssue(storageDir, issue, "truncate_partial_tail", dryRun)),
    ...health.corruptEventLogs
      .filter((issue) => !issue.partialTailDetected)
      .map((issue) => repairActionFromIssue(
        storageDir,
        issue,
        issue.repairRecommendation === "isolate_corrupt_line" ? "isolate_corrupt_line" : "manual_review",
        dryRun,
      )),
    ...health.warnings.map((warning): StoreRepairAction => ({
      kind: warning.kind,
      id: warning.id,
      file: warning.file,
      action: "manual_review",
      dryRun,
      applied: false,
      backupPath: null,
      retainedEventCount: 0,
      removedLineCount: 0,
      truncatedBytes: 0,
      reason: warning.message,
      diagnostics: [{ code: warning.code, message: warning.message, retryable: false }],
    })),
  ];
  let blockedReason: string | undefined;
  const diagnostics = cloneSummary(health.diagnostics);
  let lease: StorageLease | undefined;
  if (options.apply) {
    const liveActiveRecord = health.activeRecords.find((record) => record.ownerStatus === "live");
    const hasRepairableActions = actions.some((action) => action.action === "truncate_partial_tail" || action.action === "isolate_corrupt_line");
    if (health.lock.status === "live") {
      blockedReason = "store has a live writer owner; repair apply is refused";
    } else if (liveActiveRecord) {
      blockedReason = `${liveActiveRecord.kind} ${liveActiveRecord.id} has a live owner; repair apply is refused`;
    } else if (!hasRepairableActions) {
      // Nothing to mutate; keep no-op/manual-review apply from touching the store.
    } else {
      try {
        lease = StorageLease.acquire(storageDir);
        applyRepairActions(storageDir, actions, options.faults);
        persistRepairDiagnostic(storageDir, actions);
      } catch (error) {
        blockedReason = `repair apply failed or could not acquire exclusive store access: ${errorMessage(error)}`;
        persistRepairFailureDiagnostic(storageDir, error);
      } finally {
        lease?.close();
      }
    }
    if (blockedReason) {
      const code = /live (writer )?owner/u.test(blockedReason) ? "AGENT_STORE_REPAIR_REFUSED_LIVE_OWNER" : "AGENT_STORE_REPAIR_FAILED";
      increment(diagnostics.byCode, code);
      diagnostics.total += 1;
    }
  }
  return redactUnknown({
    schemaVersion: "agent-runtime.storeRepair.v1",
    storageDir,
    checkedAt: Date.now(),
    dryRun,
    applied: actions.some((action) => action.applied),
    ok: !blockedReason && (dryRun ? actions.length === 0 : actions.every((action) => action.applied)),
    blockedReason,
    actions,
    diagnostics,
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

function isNonBlockingStorageDiagnostic(diagnostic: RuntimeDiagnostic): boolean {
  return diagnostic.code === "AGENT_STORE_REPAIR_APPLIED";
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

interface JsonlLine {
  line: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

interface JsonlRepairIssue {
  line: number;
  reason: string;
  partialTail: boolean;
  retainedEventCount: number;
  lastGoodEventId?: number;
  lastGoodSequence?: number;
  redactedTailPreview?: string;
  startOffset: number;
}

interface JsonlRepairScan {
  text: string;
  validLines: JsonlLine[];
  issues: JsonlRepairIssue[];
}

function repairActionFromIssue(
  storageDir: string,
  issue: StoreHealthIssue,
  action: StoreRepairAction["action"],
  dryRun: boolean,
): StoreRepairAction {
  const planned = plannedRepairMetrics(storageDir, issue, action);
  return {
    kind: issue.kind,
    id: issue.id,
    file: issue.file,
    action,
    dryRun,
    applied: false,
    backupPath: null,
    line: issue.line,
    retainedEventCount: planned.retainedEventCount ?? issue.retainedEventCount ?? 0,
    removedLineCount: planned.removedLineCount ?? issue.corruptLineCount ?? 0,
    truncatedBytes: planned.truncatedBytes ?? 0,
    lastGoodEventId: issue.lastGoodEventId,
    lastGoodSequence: issue.lastGoodSequence,
    reason: issue.reason,
    redactedTailPreview: issue.redactedTailPreview,
    diagnostics: [],
  };
}

function plannedRepairMetrics(
  storageDir: string,
  issue: StoreHealthIssue,
  action: StoreRepairAction["action"],
): Partial<Pick<StoreRepairAction, "retainedEventCount" | "removedLineCount" | "truncatedBytes">> {
  if (action === "manual_review") return { retainedEventCount: issue.retainedEventCount ?? 0, removedLineCount: 0, truncatedBytes: 0 };
  const absolute = path.join(storageDir, issue.file);
  if (!isInside(storageDir, absolute) || !existsSync(absolute)) return {};
  try {
    const scan = scanJsonlForRepair(absolute);
    const matched = issue.line === undefined ? undefined : scan.issues.find((candidate) => candidate.line === issue.line);
    if (!matched) return {};
    return {
      retainedEventCount: matched.retainedEventCount,
      removedLineCount: 1,
      truncatedBytes: matched.partialTail ? Math.max(0, Buffer.byteLength(scan.text) - Buffer.byteLength(scan.text.slice(0, matched.startOffset))) : 0,
    };
  } catch {
    return {};
  }
}

function applyRepairActions(storageDir: string, actions: StoreRepairAction[], faults: StoreRepairFaultHooks | undefined): void {
  const repairable = actions.filter((action) => action.action === "truncate_partial_tail" || action.action === "isolate_corrupt_line");
  const byFile = new Map<string, StoreRepairAction[]>();
  for (const action of repairable) {
    const actionsForFile = byFile.get(action.file) ?? [];
    actionsForFile.push(action);
    byFile.set(action.file, actionsForFile);
  }
  const backupRoot = path.join("repair-backups", `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`);
  for (const [relative, fileActions] of byFile) {
    const absolute = path.join(storageDir, relative);
    if (!isInside(storageDir, absolute) || !existsSync(absolute)) continue;
    const scan = scanJsonlForRepair(absolute);
    const issueLines = new Set(scan.issues.map((issue) => issue.line));
    const matchingActions = fileActions.filter((action) => action.line !== undefined && issueLines.has(action.line));
    if (matchingActions.length === 0) continue;
    const backupPath = path.join(backupRoot, relative);
    const absoluteBackup = path.join(storageDir, backupPath);
    const diagnostics: RuntimeDiagnostic[] = [];
    mkdirSync(path.dirname(absoluteBackup), { recursive: true });
    faults?.beforeBackupWrite?.(absoluteBackup);
    atomicWriteTextFile(absoluteBackup, scan.text, diagnostics);
    for (const action of matchingActions) {
      action.backupPath = backupPath;
      action.diagnostics = diagnostics;
    }
    const partialOnly = scan.issues.length === 1 && scan.issues[0]?.partialTail === true;
    const repaired = partialOnly
      ? scan.text.slice(0, scan.issues[0]?.startOffset ?? scan.text.length)
      : scan.validLines.map((line) => `${JSON.stringify(JSON.parse(line.text) as unknown)}\n`).join("");
    faults?.beforeRepairRewrite?.(absolute);
    atomicWriteTextFile(absolute, repaired, diagnostics);
    const truncatedBytes = Math.max(0, Buffer.byteLength(scan.text) - Buffer.byteLength(repaired));
    const removedLineCount = scan.issues.length;
    const retainedEventCount = scan.validLines.length;
    for (const action of matchingActions) {
      action.applied = true;
      action.retainedEventCount = retainedEventCount;
      action.removedLineCount = matchingActions.length || removedLineCount;
      action.truncatedBytes = action.action === "truncate_partial_tail" ? truncatedBytes : 0;
      action.diagnostics = diagnostics;
    }
  }
}

function persistRepairFailureDiagnostic(storageDir: string, error: unknown): void {
  const diagnostic = redactUnknown({
    timestamp: Date.now(),
    diagnostic: {
      code: "AGENT_STORE_REPAIR_FAILED",
      message: `Store repair apply failed: ${errorMessage(error)}`,
      retryable: false,
      actionableHints: ["Inspect store-health output, keep repair-backups, and rerun store-repair after fixing the underlying filesystem error."],
    },
  });
  try {
    appendFileSync(path.join(storageDir, "diagnostics.jsonl"), `${JSON.stringify(diagnostic)}\n`, "utf8");
  } catch {
    // Failure diagnostics are best-effort; the repair report still carries blockedReason.
  }
}

function persistRepairDiagnostic(storageDir: string, actions: StoreRepairAction[]): void {
  const appliedActions = actions.filter((action) => action.applied);
  if (appliedActions.length === 0) return;
  const diagnostic = redactUnknown({
    timestamp: Date.now(),
    diagnostic: {
      code: "AGENT_STORE_REPAIR_APPLIED",
      message: `Store repair applied ${appliedActions.length} action(s).`,
      retryable: false,
      actionableHints: appliedActions.map((action) =>
        `${action.kind}:${action.id} ${action.action} file=${action.file} backup=${action.backupPath ?? "<none>"} removed=${action.removedLineCount} truncatedBytes=${action.truncatedBytes}`,
      ),
    },
  });
  try {
    appendFileSync(path.join(storageDir, "diagnostics.jsonl"), `${JSON.stringify(diagnostic)}\n`, "utf8");
  } catch {
    // Repair diagnostics are best-effort; the event-log repair has already completed.
  }
}

function scanJsonlForRepair(file: string): JsonlRepairScan {
  const text = readFileSync(file, "utf8");
  const lines = jsonlLines(text);
  const lastNonEmptyLine = [...lines].reverse().find((line) => line.text.trim())?.line ?? -1;
  const validLines: JsonlLine[] = [];
  const issues: JsonlRepairIssue[] = [];
  for (const line of lines) {
    if (!line.text.trim()) continue;
    try {
      const parsed = JSON.parse(line.text) as unknown;
      if (!isReplayEvent(parsed)) {
        issues.push(repairIssue(line, "line is not a replay event", validLines, false));
        continue;
      }
      validLines.push(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const partialTail = isPartialTailForRepair(text, line.line, lastNonEmptyLine, reason);
      issues.push(repairIssue(line, reason, validLines, partialTail));
      if (partialTail) break;
    }
  }
  return { text, validLines, issues };
}

function repairIssue(line: JsonlLine, reason: string, validLines: JsonlLine[], partialTail: boolean): JsonlRepairIssue {
  let lastGoodEventId: number | undefined;
  let lastGoodSequence: number | undefined;
  const lastGood = validLines.at(-1);
  if (lastGood) {
    try {
      const parsed = JSON.parse(lastGood.text) as { id?: unknown; sequence?: unknown };
      lastGoodEventId = typeof parsed.id === "number" ? parsed.id : undefined;
      lastGoodSequence = typeof parsed.sequence === "number" ? parsed.sequence : lastGoodEventId;
    } catch {
      // Last good line was already parsed above.
    }
  }
  return {
    line: line.line,
    reason,
    partialTail,
    retainedEventCount: validLines.length,
    lastGoodEventId,
    lastGoodSequence,
    redactedTailPreview: redactUnknown(line.text.slice(0, 256)) as string,
    startOffset: line.startOffset,
  };
}

function jsonlLines(text: string): JsonlLine[] {
  const lines: JsonlLine[] = [];
  let start = 0;
  let line = 1;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const endOffset = newline === -1 ? text.length : newline + 1;
    const raw = text.slice(start, endOffset);
    const lineText = raw.endsWith("\n") ? raw.slice(0, raw.endsWith("\r\n") ? -2 : -1) : raw;
    lines.push({ line, startOffset: start, endOffset, text: lineText });
    start = endOffset;
    line += 1;
  }
  return lines;
}

function isPartialTailForRepair(text: string, line: number, lastNonEmptyLine: number, reason: string): boolean {
  return line === lastNonEmptyLine
    && !/\r?\n$/u.test(text)
    && /(end of JSON input|unterminated|string|property name|after|expected|unexpected)/iu.test(reason);
}

function isReplayEvent(value: unknown): value is ReplayEvent<unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.timestamp === "number" && Boolean(record.event);
}

function atomicWriteTextFile(file: string, text: string, diagnostics: RuntimeDiagnostic[]): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(tmp, "w");
  let renamed = false;
  try {
    writeSync(fd, text, undefined, "utf8");
    syncFileDescriptor(fd, diagnostics);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, file);
    renamed = true;
    syncPath(path.dirname(file), diagnostics);
  } finally {
    if (!renamed) {
      try {
        unlinkSync(tmp);
      } catch {
        // Temp cleanup is best-effort; the original target was not replaced.
      }
    }
  }
}

function syncFileDescriptor(fd: number, diagnostics: RuntimeDiagnostic[]): void {
  try {
    fdatasyncSync(fd);
  } catch (fdatasyncError) {
    try {
      fsyncSync(fd);
    } catch (fsyncError) {
      diagnostics.push({
        code: "AGENT_STORAGE_SYNC_FALLBACK",
        message: `repair file sync fallback: fdatasync failed (${errorMessage(fdatasyncError)}); fsync failed (${errorMessage(fsyncError)})`,
        retryable: false,
      });
    }
  }
}

function syncPath(targetPath: string, diagnostics: RuntimeDiagnostic[]): void {
  let fd: number | undefined;
  try {
    const stat = statSync(targetPath);
    fd = openSync(stat.isDirectory() ? targetPath : path.dirname(targetPath), "r");
    fsyncSync(fd);
  } catch (error) {
    diagnostics.push({
      code: "AGENT_STORAGE_SYNC_FALLBACK",
      message: `repair directory sync skipped (${errorMessage(error)})`,
      retryable: false,
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function cloneSummary(summary: StoreHealthSummary): StoreHealthSummary {
  return {
    total: summary.total,
    byCode: { ...summary.byCode },
  };
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
