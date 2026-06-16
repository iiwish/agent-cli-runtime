import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import type { ReplayEvent } from "../core/events.js";
import type { AgentEvent, SchedulerEvent } from "../core/events.js";
import { redactUnknown } from "../core/redaction.js";
import { readJsonl } from "./jsonl-store.js";

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

export interface StoreHealth {
  ok: boolean;
  storageDir?: string;
  checkedAt: number;
  totals: {
    runs: number;
    goals: number;
  };
  corruptManifests: StoreHealthIssue[];
  corruptEventLogs: StoreHealthIssue[];
  partialTails: StoreHealthIssue[];
  activeInterrupted: StoreHealthIssue[];
  warnings: StoreHealthWarning[];
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
  consistencyWarnings: StoreHealthWarning[];
  attemptEvidence?: unknown[];
  adapterSummary: Record<string, unknown>;
}

interface ScannedRecord {
  kind: "run" | "goal";
  id: string;
  manifest: Record<string, unknown> | null;
  manifestIssue?: StoreHealthIssue;
  eventIssue?: StoreHealthIssue;
  partialTail?: StoreHealthIssue;
  events: Array<ReplayEvent<AgentEvent | SchedulerEvent>>;
  warnings: StoreHealthWarning[];
  activeInterrupted?: StoreHealthIssue;
}

export function inspectStoreDirectory(storageDir: string): StoreHealth {
  const records = scanStore(storageDir);
  const corruptManifests = records.flatMap((record) => record.manifestIssue ? [record.manifestIssue] : []);
  const corruptEventLogs = records.flatMap((record) => record.eventIssue ? [record.eventIssue] : []);
  const partialTails = records.flatMap((record) => record.partialTail ? [record.partialTail] : []);
  const activeInterrupted = records.flatMap((record) => record.activeInterrupted ? [record.activeInterrupted] : []);
  const warnings = records.flatMap((record) => record.warnings);
  const health: StoreHealth = {
    ok: corruptManifests.length === 0 && corruptEventLogs.length === 0 && warnings.length === 0,
    storageDir,
    checkedAt: Date.now(),
    totals: {
      runs: records.filter((record) => record.kind === "run").length,
      goals: records.filter((record) => record.kind === "goal").length,
    },
    corruptManifests,
    corruptEventLogs,
    partialTails,
    activeInterrupted,
    warnings,
    diagnostics: summarizeDiagnostics(records),
  };
  return redactUnknown(health);
}

export function exportDiagnosticsBundle(request: ExportDiagnosticsRequest, storageDir: string): DiagnosticsBundle {
  const kind = request.kind;
  const id = kind === "run" ? request.runId : request.goalId;
  const record = scanRecord(storageDir, kind, id);
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
    consistencyWarnings: record.warnings,
    attemptEvidence: kind === "goal" ? attemptEvidenceFromGoalManifest(manifest) : undefined,
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
  const eventIssue = events.issue ? {
    kind,
    id,
    file: relativeFile(storageDir, eventsPath),
    line: events.issue.line,
    reason: events.issue.reason,
    retainedEventCount: events.issue.retainedEventCount,
  } : undefined;
  const record: ScannedRecord = {
    kind,
    id,
    manifest: manifest.value,
    manifestIssue: manifest.issue,
    events: events.records,
    eventIssue,
    partialTail: events.issue?.partialTail ? eventIssue : undefined,
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
    if (!isRecord(parsed)) return { value: null, issue: manifestIssue(storageDir, file, kind, id, "manifest is not an object") };
    if (parsed.id !== id) return { value: null, issue: manifestIssue(storageDir, file, kind, id, "id does not match storage directory") };
    if (typeof parsed.status !== "string") return { value: null, issue: manifestIssue(storageDir, file, kind, id, "status is missing or invalid") };
    if (kind === "goal" && !Array.isArray(parsed.tasks)) return { value: null, issue: manifestIssue(storageDir, file, kind, id, "tasks is missing or invalid") };
    return { value: parsed };
  } catch (error) {
    return {
      value: null,
      issue: manifestIssue(storageDir, file, kind, id, error instanceof Error ? error.message : String(error)),
    };
  }
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
  if (hasInterruptedDiagnostic || !isTerminalManifest(record.kind, record.manifest.status)) {
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

function summarizeDiagnostics(records: ScannedRecord[]): StoreHealthSummary {
  const byCode: Record<string, number> = {};
  for (const record of records) {
    if (record.manifestIssue) increment(byCode, "AGENT_STORE_RECORD_CORRUPT");
    if (record.eventIssue) increment(byCode, "AGENT_EVENT_LOG_CORRUPT");
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

function diagnosticsForRecord(record: ScannedRecord): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [...manifestDiagnostics(record.manifest)];
  if (record.manifestIssue) diagnostics.push({ code: "AGENT_STORE_RECORD_CORRUPT", message: record.manifestIssue.reason, retryable: false });
  if (record.eventIssue) diagnostics.push({ code: "AGENT_EVENT_LOG_CORRUPT", message: record.eventIssue.reason, retryable: false });
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
    return {
      kind: "run",
      agentId: record.manifest.agentId,
      status: record.manifest.status,
      errorCode: record.manifest.errorCode,
      exitCode: record.manifest.exitCode,
      signal: record.manifest.signal,
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

function relativeFile(storageDir: string, file: string): string {
  return path.relative(storageDir, file).split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeDiagnostic(value: unknown): value is RuntimeDiagnostic {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}
