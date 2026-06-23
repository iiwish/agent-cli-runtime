import type { EventTerminalReason } from "./events.js";

export interface CliSchemaContract {
  schemaVersion: string;
  requiredTopLevelFields: readonly string[];
  classificationFields: readonly string[];
  redactionRules: readonly string[];
}

export const EVENT_TERMINAL_REASONS = [
  "success",
  "failed",
  "timeout",
  "canceled",
  "interrupted",
  "validation_failed",
  "execution_failed",
  "unavailable",
  "auth_missing",
  "task_graph_invalid",
] as const satisfies readonly EventTerminalReason[];

export const SMOKE_CONFORMANCE_CLASSIFICATIONS = [
  "success",
  "real_run_skipped",
  "auth_missing",
  "unavailable_executable",
  "unsupported_flag",
  "needs_verification",
  "unexpected_output",
  "cwd_mutated",
  "timeout",
  "failed",
] as const;

export type SmokeConformanceClassification = (typeof SMOKE_CONFORMANCE_CLASSIFICATIONS)[number];

const commonRedactionRules = [
  "no prompt text",
  "no token values",
  "no Bearer values",
  "no auth environment assignment values",
  "no private absolute cwd paths",
] as const;

export const CLI_SCHEMA_INVENTORY = [
  {
    schemaVersion: "agent-runtime.event.v1",
    requiredTopLevelFields: ["schemaVersion", "id", "sequence", "timestamp", "scope", "event"],
    classificationFields: ["terminal.result", "terminal.reason"],
    redactionRules: ["event payloads must use runtime redaction before CLI emission", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-runtime.diagnostics.v1",
    requiredTopLevelFields: [
      "schemaVersion",
      "exportedAt",
      "subject",
      "manifest",
      "events",
      "diagnostics",
      "storageDiagnostics",
      "consistencyWarnings",
      "supervisorSummary",
      "adapterSummary",
    ],
    classificationFields: ["supervisorSummary.terminalReason", "diagnostics[].code"],
    redactionRules: ["no raw event payload dump", "no raw corrupt JSONL lines", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-runtime.conformance.v1",
    requiredTopLevelFields: ["schemaVersion", "ok", "mode", "agents"],
    classificationFields: ["agents[].runClassification", "agents[].skippedReason", "agents[].failureReason"],
    redactionRules: ["observedTextTail is bounded and redacted", "diagnostics are redacted", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-runtime.publishedAdapters.v1",
    requiredTopLevelFields: [
      "schemaVersion",
      "ok",
      "packageName",
      "version",
      "packageSource",
      "checks",
      "agents",
      "diagnostics",
      "noAuthenticatedRealRun",
    ],
    classificationFields: ["ok", "checks.failureIsolation", "agents[].terminalStatus"],
    redactionRules: ["no temp paths", "no raw stdout/stderr", "no full prompt", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-cli-runtime.publishedVerification.v1",
    requiredTopLevelFields: [
      "schemaVersion",
      "ok",
      "packageName",
      "version",
      "gitSha",
      "checkedAt",
      "packageSource",
      "gates",
      "registry",
      "diagnostics",
      "noAuthenticatedRealRun",
      "noNpmPublish",
      "noNpmToken",
    ],
    classificationFields: ["ok", "gates[].ok", "gates[].schemaVersion", "registry.ok", "diagnostics[].code"],
    redactionRules: ["no raw stdout/stderr", "no temp paths", "no full prompt", "no npm token references", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-runtime.realSmoke.v1",
    requiredTopLevelFields: [
      "schemaVersion",
      "type",
      "ok",
      "mode",
      "adapter",
      "version",
      "auth",
      "modelsSource",
      "runClassification",
      "expectedTextRequired",
      "expectedTextMatched",
      "observedTextDeltaCount",
      "observedTextTail",
      "cwdMutationChecked",
      "cwdMutated",
      "diagnosticsCount",
      "diagnostics",
      "skippedReason",
      "failureReason",
    ],
    classificationFields: ["runClassification", "skippedReason", "failureReason"],
    redactionRules: ["no final run record", "observedTextTail is bounded and redacted", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-runtime.storeHealth.v1",
    requiredTopLevelFields: [
      "schemaVersion",
      "ok",
      "checkedAt",
      "lock",
      "totals",
      "corruptManifests",
      "corruptEventLogs",
      "partialTails",
      "activeRecords",
      "activeInterrupted",
      "warnings",
      "storageDiagnostics",
      "diagnostics",
    ],
    classificationFields: ["ok", "lock.status", "diagnostics.byCode"],
    redactionRules: ["no raw corrupt JSONL lines", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-runtime.storeRepair.v1",
    requiredTopLevelFields: ["schemaVersion", "storageDir", "checkedAt", "dryRun", "applied", "ok", "actions", "diagnostics"],
    classificationFields: ["ok", "blockedReason", "actions[].action", "diagnostics.byCode"],
    redactionRules: ["backup paths are redacted before CLI emission", "no raw corrupt JSONL lines", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-runtime.cliError.v1",
    requiredTopLevelFields: ["schemaVersion", "ok", "error"],
    classificationFields: ["error.code"],
    redactionRules: ["error.message is short and redacted", ...commonRedactionRules],
  },
  {
    schemaVersion: "agent-cli-runtime.releaseVerification.v1",
    requiredTopLevelFields: [
      "schemaVersion",
      "ok",
      "checkedFiles",
      "tarball",
      "diagnostics",
      "artifactNames",
      "gateEvidence",
      "packageName",
      "version",
    ],
    classificationFields: ["ok", "diagnostics[].code"],
    redactionRules: ["diagnostics are redacted", "no private package paths", "no token-looking values", "no npm token references"],
  },
  {
    schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
    requiredTopLevelFields: ["schemaVersion", "generatedAt", "gates", "noAuthenticatedRealRun", "noNpmPublish", "noNpmToken"],
    classificationFields: ["gates[].ok", "gates[].outputSchemaVersion", "gates[].packageSource"],
    redactionRules: ["no authenticated real run output", "no npm token references", "no private temp paths"],
  },
] as const satisfies readonly CliSchemaContract[];
