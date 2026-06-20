import type { RuntimeDiagnostic } from "./core/diagnostics.js";

export type RuntimeEnvironment = Record<string, string | undefined>;

export interface InspectStoreOptions {
  storageDir?: string;
}

export interface RuntimeOwner {
  runtimeInstanceId: string;
  pid: number;
  startedAt: number;
  heartbeatAt: number;
  closedAt?: number;
}

export type OwnerStatus = "missing" | "live" | "stale" | "closed" | "invalid";

export interface StorageLockInspection {
  file: string;
  status: OwnerStatus;
  staleMs: number;
  diagnostics: string[];
  owner?: RuntimeOwner;
  ageMs?: number;
  reason?: string;
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
