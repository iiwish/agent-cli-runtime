# API And CLI Schema Contract

Status: P3-7 API / CLI Schema Freeze & Versioning Policy
Last updated: 2026-06-22

This document is the public contract index for the pre-alpha daemon-ready runtime surface. It freezes the package-root API boundary, CLI JSON schema inventory, schema versioning policy, redaction requirements, and failure taxonomy used by embedders and release gates.

It does not add a daemon, HTTP/RPC API, database, WAL, remote worker, UI, telemetry, npm publication, npm token, trusted publishing setup, or authenticated real-agent gate.

## Public Root Boundary

The package root value export is intentionally limited to:

- `createAgentRuntime`

The package root TypeScript type exports are the supported source-compatible import boundary for pre-alpha consumers:

- runtime facade and options: `AgentRuntime`, `RuntimeOptions`, `DetectOptions`, `DetectedAgent`, `RuntimeEnvironment`
- run API and records: `RunRequest`, `RunHandle`, `RunRecord`, `RunStatus`, `RunResult`, `RuntimeContextBlock`, `RuntimeSessionRef`
- goal API and records: `CreateGoalRequest`, `GoalHandle`, `GoalRecord`, `GoalStatus`, `PlannerOutput`, `PlannerTask`, `ScheduledTask`, `TaskEvidence`, `TaskAttemptEvidence`, `TaskRetryPolicy`, `TaskStatus`, `ValidationCommandResult`
- event and replay contracts: `AgentEvent`, `SchedulerEvent`, `ReplayEvent`, `VersionedEventEnvelope`, `EventScope`, `EventTerminalContract`, `EventTerminalReason`, `RuntimeUsage`
- diagnostics and store inspection: `RuntimeDiagnostic`, `RuntimeErrorCode`, `DiagnosticsBundle`, `ExportDiagnosticsRequest`, `InspectStoreOptions`, `StoreHealth`, `StoreHealthSummary`, `StoreHealthIssue`, `StoreHealthWarning`, `StoreActiveRecord`, `StorageLockInspection`, `RuntimeOwner`, `OwnerStatus`, `StoreRepairReport`, `StoreRepairAction`
- adapter authoring types: `AgentAdapterDef`, `AgentCapabilities`, `AdapterCompatibilityProfile`, `AgentId`, `BuildArgsInput`, `PermissionPolicy`, `PromptTransport`, `RuntimeModelOption`, `StreamParser`

Internal but packaged files under `dist/**` may exist in the npm tarball because TypeScript declarations and the CLI need them. Their presence is not a subpath-import promise. Built-in adapter values, parser helpers, executable-resolution helpers, stores, schedulers, task-graph helpers, and storage implementation modules remain internal implementation details.

`getAdapter(id)` and `RuntimeOptions.adapters` remain pre-alpha adapter-extension points. Their root type imports are documented for adapter experimentation, but internal built-in adapters are not root value exports.

## Schema Versioning Policy

- Adding optional fields is allowed within the same schema version.
- Removing a field, renaming a field, changing a field type, or changing field semantics requires a schema version bump.
- Changing redaction guarantees requires a schema version bump and migration note.
- Changing terminal reason or classification vocabulary requires docs, tests, and a migration note.
- Removing a CLI command, removing a flag, or changing flag semantics requires a pre-alpha breaking-change note.
- CLI and daemon callers should branch on `schemaVersion` and ignore unknown optional fields.

## CLI JSON Schema Inventory

| Schema | Required top-level fields | Classification fields | Redaction rules |
| --- | --- | --- | --- |
| `agent-runtime.event.v1` | `schemaVersion`, `id`, `sequence`, `timestamp`, `scope`, `event` | `terminal.result`, `terminal.reason` | Runtime redaction before CLI emission; no prompts, tokens, Bearer values, auth env values, or private cwd paths. |
| `agent-runtime.diagnostics.v1` | `schemaVersion`, `exportedAt`, `subject`, `manifest`, `events`, `diagnostics`, `storageDiagnostics`, `consistencyWarnings`, `supervisorSummary`, `adapterSummary` | `supervisorSummary.terminalReason`, `diagnostics[].code` | No raw event payload dump, raw corrupt JSONL line, prompt, token, Bearer value, auth env value, or private path. |
| `agent-runtime.conformance.v1` | `schemaVersion`, `ok`, `mode`, `agents` | `agents[].runClassification`, `agents[].skippedReason`, `agents[].failureReason` | `observedTextTail` and diagnostics are bounded and redacted; no prompt, token, raw stdout/stderr, or private cwd. |
| `agent-runtime.publishedAdapters.v1` | `schemaVersion`, `ok`, `packageName`, `version`, `packageSource`, `checks`, `agents`, `diagnostics`, `noAuthenticatedRealRun` | `ok`, `checks.failureIsolation`, `agents[].terminalStatus` | No temp paths, raw stdout/stderr, full prompt, token, Bearer value, auth env value, or private cwd. |
| `agent-cli-runtime.publishedVerification.v1` | `schemaVersion`, `ok`, `packageName`, `version`, `gitSha`, `checkedAt`, `packageSource`, `gates`, `registry`, `diagnostics`, `noAuthenticatedRealRun`, `noNpmPublish`, `noNpmToken` | `ok`, `gates[].ok`, `gates[].schemaVersion`, `registry.ok`, `diagnostics[].code` | No raw stdout/stderr, temp paths, full prompt, npm token references, token, Bearer value, auth env value, or private cwd. |
| `agent-cli-runtime.realCompatibilityEvidenceVerification.v1` | `schemaVersion`, `ok`, `evidenceSchemaVersion`, `file`, `checkedAt`, `diagnostics` | `ok`, `diagnostics[].code` | Diagnostics are redacted; no private paths, token-looking values, Bearer values, auth env assignments, raw stdout/stderr, full prompt text, or raw observed real CLI output. |
| `agent-runtime.realSmoke.v1` | `schemaVersion`, `type`, `ok`, `mode`, `adapter`, `version`, `auth`, `modelsSource`, `runClassification`, `expectedTextRequired`, `expectedTextMatched`, `observedTextDeltaCount`, `observedTextTail`, `cwdMutationChecked`, `cwdMutated`, `diagnosticsCount`, `diagnostics`, `skippedReason`, `failureReason` | `runClassification`, `skippedReason`, `failureReason` | No final run record, prompt, token, raw stdout/stderr, or private cwd; `observedTextTail` is bounded and redacted. |
| `agent-runtime.storeHealth.v1` | `schemaVersion`, `ok`, `checkedAt`, `lock`, `totals`, `corruptManifests`, `corruptEventLogs`, `partialTails`, `activeRecords`, `activeInterrupted`, `warnings`, `storageDiagnostics`, `diagnostics` | `ok`, `lock.status`, `diagnostics.byCode` | No raw corrupt JSONL line, token, Bearer value, auth env value, or private path. |
| `agent-runtime.storeRepair.v1` | `schemaVersion`, `storageDir`, `checkedAt`, `dryRun`, `applied`, `ok`, `actions`, `diagnostics` | `ok`, `blockedReason`, `actions[].action`, `diagnostics.byCode` | Backup paths and diagnostics are redacted; no raw corrupt JSONL line, token, Bearer value, auth env value, or private path. |
| `agent-runtime.cliError.v1` | `schemaVersion`, `ok`, `error` | `error.code` | `error.message` is short and redacted; no prompt, token, Bearer value, auth env value, or private path. |
| `agent-cli-runtime.releaseVerification.v1` | `schemaVersion`, `ok`, `checkedFiles`, `tarball`, `diagnostics`, `artifactNames`, `gateEvidence`, `packageName`, `version` | `ok`, `diagnostics[].code` | Diagnostics are redacted; no private package paths, token-looking values, Bearer values, auth env assignments, npm token references, or disallowed package paths. |
| `agent-cli-runtime.releaseGateEvidence.v1` | `schemaVersion`, `generatedAt`, `gates`, `noAuthenticatedRealRun`, `noNpmPublish`, `noNpmToken` | `gates[].ok`, `gates[].outputSchemaVersion`, `gates[].packageSource` | No authenticated real run output, npm token references, raw paths, prompts, or secrets. |

## Failure Taxonomy

Event terminal reasons use the `EventTerminalReason` vocabulary:

- `success`
- `failed`
- `timeout`
- `canceled`
- `interrupted`
- `validation_failed`
- `execution_failed`
- `unavailable`
- `auth_missing`
- `task_graph_invalid`

Smoke and conformance classifications use:

- `success`
- `real_run_skipped`
- `auth_missing`
- `unavailable_executable`
- `unsupported_flag`
- `needs_verification`
- `unexpected_output`
- `cwd_mutated`
- `timeout`
- `failed`

Classification rules:

- `skipped` is not `success`.
- `auth_missing` is not `unavailable`.
- `needs_verification` must not be guessed into a flag mapping or success state.
- `unsupported_flag`, `unexpected_output`, and `cwd_mutated` are smoke/conformance classifications, not normal run terminal reasons.
- The historical run result spelling `cancelled` maps to daemon-facing terminal reason `canceled`.

## Release Gate Rules

Default gates may run real local detection/profile certification, but they must not launch authenticated real agent runs. `--allow-real-run` is the explicit local account/network boundary and remains outside CI, dogfood, prepublish, and release-candidate gates.

Release verification and gate evidence schemas must stay aligned with `scripts/verify-release-artifacts.mjs` and `scripts/create-release-candidate.mjs`. `gate-evidence.json` records the installed-tarball daemon-ready gates, while `release-verification.json` validates artifacts, package file parity, private-path/secret scans, and release gate evidence.

Published package verification uses `agent-cli-runtime.publishedVerification.v1` and stays repo-only. It aggregates `smoke:published`, `published:daemon:verify`, `published:adapters:verify`, `release:post-alpha:verify`, and npm registry metadata without storing raw stdout/stderr or adding any publish credential path.

Repo-only real compatibility evidence uses `agent-cli-runtime.realCompatibilityEvidence.v1` and is generated by `npm run compat:real:evidence` under `.release-evidence/`. It is not a package runtime CLI schema, but it follows the same redaction boundary: no raw stdout/stderr, no full prompt text, no private absolute paths, no token values, no Bearer values, and no auth environment assignment values. It records `gitHeadSha`, `gitDirty`, `gitStatusBeforeWrite`, and `gitStatusAfterWrite` because the evidence may be generated from a dirty implementation tree before the P6-1 commit exists. The default command runs only safe real preflight; authenticated real smoke requires explicit `--allow-real-run --agent <id> --expect-text <text>` pairs.

P6-2 verification uses `agent-cli-runtime.realCompatibilityEvidenceVerification.v1` and is run with `npm run compat:real:evidence:verify`. It is an offline repo-only evidence gate: it reads the existing evidence file, does not start authenticated real CLI runs, and fails with stable diagnostic codes such as `invalid_schema`, `unsafe_content`, `missing_dirty_state`, `skip_state_claimed_as_success`, `authenticated_success_incomplete`, `needs_verification_missing`, and `package_boundary_invalid`.
