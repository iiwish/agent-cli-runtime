# Daemon-Ready Execution Kernel Contract

Status: P3-7 API / CLI schema freeze
Last updated: 2026-06-22

This document freezes the contract that a desktop product shell, local daemon, or other embedding process can rely on when using Agent CLI Runtime as a local-first execution kernel. P3-2 added an executable offline stability gate for that contract; P3-3 added a long-lived runtime resource safety gate for repeated embedding, event consumption, cancellation churn, shutdown, and reopen behavior; P3-7 centralizes the API and CLI schema versioning policy in [docs/api-schema-contract.md](./api-schema-contract.md). It is not a daemon implementation and does not add a hosted control plane API.

## Positioning

Agent CLI Runtime owns local execution kernel behavior:

- detect local agent CLIs;
- create run and goal lifecycles;
- normalize live events and replay events;
- cancel, time out, shut down, and classify terminal outcomes;
- export redacted diagnostics;
- inspect and repair the local JSON store when `storageDir` is supplied.

The embedding daemon or product shell owns everything outside that kernel:

- HTTP, IPC, or RPC API serving;
- authentication, users, tenants, teams, and admission policy;
- queue admission, prioritization, and multi-client coordination;
- remote workers, Docker/SSH runners, and distributed scheduling;
- UI, artifact viewers, workspaces, and product-specific object models;
- telemetry, metrics, traces, audit sinks, database/WAL, compaction, and backups.

## Runtime Instance Lifecycle

Create one runtime instance per local writer process:

```ts
import { createAgentRuntime } from "agent-cli-runtime";

const runtime = createAgentRuntime({
  storageDir: ".agent-runtime",
  storage: { durability: "fsync" },
});
```

If `storageDir` is omitted, runs and goals are memory-only. If `storageDir` is supplied, the runtime writes run/goal manifests and replay JSONL under the local store and acquires a same-machine single-writer lease in `runtime.lock.json`.

Embedding lifecycle rules:

- create the runtime during daemon/process startup;
- keep one writer runtime per `storageDir`;
- call `runtime.shutdown(reason)` before process exit when possible;
- treat process crash recovery as replay/diagnostics recovery, not live process resume;
- use read-only inspection commands or facade methods for dashboards that should not acquire the writer lease.

## P3-2 Executable Gate

`npm run daemon:verify` is the P3-2 daemon embedding stability gate. It packs the current package, installs that tarball into a temporary consumer, creates fake local CLIs and temp storage, then exercises the installed package path:

1. create a runtime with `storageDir`;
2. detect the fake adapter and run fake conformance through the installed CLI;
3. run a fake task;
4. create a fake goal;
5. replay run and goal events;
6. inspect store health;
7. export run and goal diagnostics;
8. call `shutdown()`;
9. reopen the same store and query terminal run/goal records.

The gate emits `schemaVersion: "agent-runtime.daemonVerification.v1"` JSON with only redacted summary fields. It does not require real Codex, Claude Code, or OpenCode credentials, and it does not launch authenticated real agent runs.

P3-2 also locks regression coverage for read-only inspection, live-owner isolation, shutdown/recovery terminal-event idempotence, and daemon-facing schema compatibility. It still does not implement HTTP, IPC, RPC, auth, users, tenants, remote workers, Docker/SSH, telemetry, database, WAL, compaction, or OpenDesign daemon parity.

## P3-3 Resource Safety Gate

`npm run runtime:safety` is the P3-3 long-lived runtime resource safety gate. It packs the current package, installs that tarball into a temporary consumer, creates a fake local CLI and temp storage, then exercises the installed package path under one embedded runtime:

1. execute repeated fake runs and fake goals without active run/goal leaks;
2. hold a slow event consumer while the fake CLI emits many JSON and text events, then verify terminal events and replay counts remain stable;
3. churn multiple cancellations and a timeout/process-close race, verifying one `run_finished` per run;
4. cancel a goal with running and queued tasks, verifying stable task states and one `goal_finished`;
5. export noisy failure diagnostics with bounded, redacted stdout/stderr tails;
6. call `shutdown()` repeatedly, verify terminal event counts do not grow, verify active state is empty, and verify the durable lease closes;
7. reopen the same store and verify terminal records are queryable while active records are not falsely recovered.

The gate emits `schemaVersion: "agent-runtime.runtimeSafety.v1"` JSON with redacted summary counts and statuses only. It does not include temp paths, prompts, raw corrupt lines, auth env assignments, token-looking values, or Bearer values. It uses fake CLIs only and does not require real Codex, Claude Code, or OpenCode credentials.

P3-3 is intentionally still local-kernel hardening. It does not implement HTTP, IPC, RPC, auth, users, tenants, queue admission, remote workers, Docker/SSH, telemetry, database, WAL, compaction, UI/artifact layers, or OpenDesign daemon parity.

## P5-1 Published Package Consumer Gate

`npm run published:daemon:verify` is the P5-1 published-package daemon consumer harness. It installs `agent-cli-runtime@0.1.0-alpha.1` from the npm registry into a temporary consumer project, imports only the package root, and runs a long-lived daemon-style process with fake Codex, Claude, and OpenCode binaries on `PATH`.

The gate exercises the published package path, not the local checkout, local `dist/`, or a freshly packed tarball:

1. create a runtime with an isolated `storageDir`;
2. detect the fake Codex adapter;
3. run a successful fake task;
4. create a successful fake goal through the planner/task path;
5. cancel a running run;
6. time out a running run;
7. replay run and goal events;
8. run read-only store inspection while a writer runtime is active;
9. verify a second writer for the same `storageDir` is refused without mutating live records;
10. shut down and reopen terminal records;
11. recover stale active run/goal records after simulated crash ownership.

The gate emits `schemaVersion: "agent-runtime.publishedDaemonConsumer.v1"` JSON with `packageSource: "npm-registry"`, `version`, `checks`, `diagnostics`, and `noAuthenticatedRealRun`. The output is a redacted summary only: it must not include temp paths, private user paths, tokens, raw secrets, or full prompts. It uses fake CLIs only and does not launch authenticated real Codex, Claude Code, or OpenCode runs.

P5-1 is evidence for embeddability of the already published npm package. It does not publish a new npm version, expand package-root value exports, add a daemon/API server, database, WAL, remote worker, queue service, UI, telemetry, or hosted control plane.

## P5-2 Published Package Built-In Adapter Gate

`npm run published:adapters:verify` is the P5-2 published-package built-in adapter compatibility gate. It installs `agent-cli-runtime@0.1.0-alpha.1` from the npm registry into a temporary consumer project, creates fake Codex, Claude, and OpenCode executables, and exercises the already published package's built-in adapter definitions through package-root `createAgentRuntime` and the installed `agent-runtime` CLI.

The gate verifies the published package path, not the local checkout, local `dist/`, or a freshly packed tarball:

1. `agent-runtime agents --json` detects the three fake built-in adapters;
2. `agent-runtime conformance --mode fake --json` emits `agent-runtime.conformance.v1`;
3. each built-in adapter runs through its real argv builder, stdin prompt transport, and parser path;
4. long prompts stay out of argv for Codex, Claude, and OpenCode;
5. Claude stdin uses stream-json JSONL, while Codex and OpenCode use stdin text;
6. Claude stream-json partial/unknown events and non-JSON noise do not fail parsing;
7. Codex and OpenCode non-JSON noise is ignored by parsers;
8. a forced single-adapter failure still leaves summaries for the other adapters;
9. token-looking diagnostics, Bearer values, auth env assignments, full prompts, temp paths, private paths, and raw stdout/stderr are excluded from the emitted summary.

The gate emits `schemaVersion: "agent-runtime.publishedAdapters.v1"` with `packageSource: "npm-registry"`, `agents`, `checks`, `diagnostics`, and `noAuthenticatedRealRun`. Stable classification fields include `checks.failureIsolation` and `agents[].terminalStatus`. This is fake-CLI compatibility evidence for the published package's built-in adapter contract. It is not authenticated real Codex, Claude Code, or OpenCode run evidence, and it does not publish npm, expand package-root value exports, or add a daemon/API server, database, WAL, remote worker, queue service, UI, telemetry, or hosted control plane.

## P5-3 Published Package Remote Verification Evidence

`npm run published:verify -- --out-dir published-verification` is the repo-only P5-3 aggregation gate for post-publish evidence. It runs the published package smoke, the P5-1 daemon consumer gate, the P5-2 adapter gate, post-alpha npm/GitHub Release verification, and an npm registry metadata lookup for the current `package.json` version.

The summary is written as `published-verification/published-verification.json` with `schemaVersion: "agent-cli-runtime.publishedVerification.v1"`, `packageSource: "npm-registry"`, gate summaries, registry metadata, `gitSha`, `checkedAt`, and explicit `noAuthenticatedRealRun`, `noNpmPublish`, and `noNpmToken` flags. It records gate commands, pass/fail state, output schema versions, durations, selected summary fields, and redacted diagnostics only. It does not store raw stdout/stderr, temp paths, private paths, full prompts, token values, Bearer values, or auth environment assignments.

`.github/workflows/published-package-verification.yml` is manual `workflow_dispatch` only. It runs on Node.js 22, executes `npm ci`, creates and verifies the published verification evidence, and uploads `agent-cli-runtime-published-verification` with the same 14-day retention window as release-candidate artifacts. It is evidence for the already published package on a clean runner; it is not a publish workflow and does not configure registry credentials, provenance, authenticated real agent runs, or hosted daemon behavior.

## Writer Lease And Store Ownership

The local lease is a best-effort same-machine writer guard. It is not a distributed lock, daemon consensus protocol, WAL, database transaction, or multi-host scheduler.

Lease owner fields:

- `runtimeInstanceId`
- `pid`
- `startedAt`
- `heartbeatAt`
- optional `closedAt`

Runtime behavior:

- a second writer for the same `storageDir` is refused while the current owner is live;
- stale, closed, missing, or invalid owners may be taken over;
- takeover records a redacted `AGENT_STORAGE_LEASE_TAKEOVER` diagnostic;
- active run/goal manifests carry owner metadata and are heartbeated while active;
- read-only inspection does not acquire the writer lease and must not mutate active work.

## Run Lifecycle

Daemon embedding sequence:

1. `runtime.detect({ includeUnavailable: true })` or `runtime.detectStream()` to show local adapter state.
2. `runtime.run({ agentId, cwd, prompt, permissionPolicy, ... })` to start local execution.
3. Consume `handle.events` until `run_finished`.
4. Use `runtime.cancelRun(runId)` or `handle.cancel(reason)` for user cancellation.
5. Use `runtime.replayRunEvents(runId, { afterEventId })` for durable replay.
6. Use `runtime.getRun(runId)` / `runtime.listRuns()` for status queries.
7. Use `runtime.exportDiagnostics({ kind: "run", runId })` for support bundles.

Run state is terminal when status is `succeeded`, `failed`, or `canceled`. Run result remains `success`, `failed`, or `cancelled`; daemon-facing terminal reason canonicalizes spelling to `canceled`.

## Goal Lifecycle

Daemon embedding sequence:

1. `runtime.createGoal({ cwd, objective, defaultAgentId, ... })` starts a planner run.
2. Planner text is parsed as a validated task graph before tasks start.
3. Dependency-ready tasks execute through the run scheduler.
4. Consume `handle.events` until `goal_finished`.
5. Use `runtime.cancelGoal(goalId)` or `handle.cancel(reason)` for user cancellation.
6. Use `runtime.replayGoalEvents(goalId, { afterEventId })` for durable replay.
7. Use `runtime.getGoal(goalId)` / `runtime.listGoals()` for status queries.
8. Use `runtime.exportDiagnostics({ kind: "goal", goalId })` for support bundles and task attempt evidence.

Goal state is terminal when status is `succeeded`, `failed`, or `canceled`. Pending or running tasks become `canceled` when a stale active goal is recovered or when cancellation/shutdown wins.

## Event Replay Contract

Library replay APIs return source-compatible `ReplayEvent<T>` records:

- `id`
- `sequence`
- `timestamp`
- `runId` or `goalId`
- `event`

CLI stream/replay JSONL wraps those records in a versioned envelope:

```json
{
  "schemaVersion": "agent-runtime.event.v1",
  "id": 1,
  "sequence": 1,
  "timestamp": 1760000000000,
  "scope": { "kind": "run", "id": "run_123" },
  "event": { "type": "run_finished", "result": "success", "timestamp": 1760000000000 },
  "terminal": { "result": "success", "reason": "success" }
}
```

Event replay rules:

- `id` and `sequence` are monotonic within one run or one goal;
- `afterEventId` returns only events whose `id` is greater than the cursor;
- `scope.kind` is `run` or `goal`;
- terminal events are appended at most once by cancel/shutdown/recovery paths;
- `terminal` is present only for terminal events or scheduler errors that carry terminal semantics.

## Schema Versioning

Stable daemon-facing schemas:

| Surface | Schema version | Stable top-level fields |
| --- | --- | --- |
| Event envelope | `agent-runtime.event.v1` | `schemaVersion`, `id`, `sequence`, `timestamp`, `scope`, `event`, optional `terminal` |
| Diagnostics bundle | `agent-runtime.diagnostics.v1` | `schemaVersion`, `exportedAt`, `storageDir`, `subject`, `manifest`, `events`, `diagnostics`, `storageDiagnostics`, `consistencyWarnings`, optional `attemptEvidence`, `supervisorSummary`, `adapterSummary` |
| Conformance report | `agent-runtime.conformance.v1` | `schemaVersion`, `ok`, `mode`, `agents` |
| Real smoke summary | `agent-runtime.realSmoke.v1` | `schemaVersion`, `type`, `ok`, `mode`, `adapter`, `version`, `auth`, `modelsSource`, `runClassification`, `expectedTextRequired`, `expectedTextMatched`, `observedTextDeltaCount`, `observedTextTail`, `cwdMutationChecked`, `cwdMutated`, `diagnosticsCount`, `diagnostics`, `skippedReason`, `failureReason` |
| Store health | `agent-runtime.storeHealth.v1` | `schemaVersion`, `ok`, `storageDir`, `checkedAt`, `lock`, `totals`, `corruptManifests`, `corruptEventLogs`, `partialTails`, `activeRecords`, `activeInterrupted`, `warnings`, `storageDiagnostics`, `diagnostics` |
| Store repair | `agent-runtime.storeRepair.v1` | `schemaVersion`, `storageDir`, `checkedAt`, `dryRun`, `applied`, `ok`, optional `blockedReason`, `actions`, `diagnostics` |
| CLI JSON error | `agent-runtime.cliError.v1` | `schemaVersion`, `ok`, `error` |
| Published daemon consumer | `agent-runtime.publishedDaemonConsumer.v1` | `schemaVersion`, `ok`, `packageName`, `version`, `packageSource`, `checks`, `diagnostics`, `noAuthenticatedRealRun` |
| Published built-in adapter gate | `agent-runtime.publishedAdapters.v1` | `schemaVersion`, `ok`, `packageName`, `version`, `packageSource`, `checks`, `agents`, `diagnostics`, `noAuthenticatedRealRun` |
| Published verification evidence | `agent-cli-runtime.publishedVerification.v1` | `schemaVersion`, `ok`, `packageName`, `version`, `gitSha`, `checkedAt`, `packageSource`, `gates`, `registry`, `diagnostics`, `noAuthenticatedRealRun`, `noNpmPublish`, `noNpmToken` |
| Release verification | `agent-cli-runtime.releaseVerification.v1` | `schemaVersion`, `ok`, `checkedFiles`, `tarball`, `diagnostics`, `artifactNames`, `gateEvidence`, `packageName`, `version` |
| Release gate evidence | `agent-cli-runtime.releaseGateEvidence.v1` | `schemaVersion`, `generatedAt`, `gates`, `noAuthenticatedRealRun`, `noNpmPublish`, `noNpmToken` |

Compatibility rules:

- adding optional fields is compatible within the same schema version;
- removing, renaming, changing type, or changing semantics of a stable field requires a schema bump;
- daemon callers should ignore unknown fields and branch on `schemaVersion`;
- redaction guarantees are part of the schema semantics and must not regress without a schema bump and release note.

The complete schema inventory, redaction rules, and classification fields are maintained in [docs/api-schema-contract.md](./api-schema-contract.md).

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

Daemon-facing CLI and conformance classifications additionally use:

- `real_run_skipped`
- `unsupported_flag`
- `unexpected_output`
- `cwd_mutated`
- `needs_verification`
- `unavailable_executable`

Canonical mapping notes:

- `cancelled` is the historical run result spelling; `canceled` is the daemon-facing terminal reason/status spelling.
- `scheduler_error` is an event type. Its terminal reason is derived from the scheduler diagnostic code, for example `AGENT_TASK_GRAPH_INVALID` maps to `task_graph_invalid`.
- `unsupported_flag`, `unexpected_output`, and `cwd_mutated` are conformance/smoke classifications, not normal run terminal reasons.
- `auth_missing`, `unavailable`, and `timeout` should be surfaced as user-actionable states by the embedding daemon.

## Redaction Contract

Daemon-facing JSON must not expose:

- provider tokens, token-looking values, or auth env assignment values;
- Bearer values;
- full prompts or raw email/log/source payloads;
- inherited environment dumps;
- raw corrupt JSONL lines;
- private absolute paths such as home directories or project `cwd`.

Diagnostics may include redacted argv shapes, prompt transport labels, stream format, parsed event counts, exit code, signal, short stdout/stderr tails, retryability, and actionable hints.

## Store Health And Repair

`runtime.inspectStore()` and `agent-runtime store-health --json` are read-only. They scan manifests, event logs, lock state, owner state, corrupt JSONL lines, partial tails, terminal manifest/event mismatches, storage diagnostics, and active/interrupted records.

`store-repair --dry-run` is the default non-mutating plan. `store-repair --apply` is explicit and:

- refuses live writer owners;
- acquires the local store lease while writing;
- backs up event logs under `repair-backups/<timestamp>/...`;
- rewrites through temp-file-and-rename with best-effort fsync;
- truncates partial tails and isolates corrupt middle lines while keeping later valid events;
- reports terminal manifest/event mismatches as manual review;
- records redacted success/failure repair diagnostics;
- is idempotent after successful repair.

Repair is not WAL replay, database recovery, daemon resume, or semantic reconciliation of terminal records.

## Shutdown Semantics

`runtime.shutdown(reason)`:

- cancels active goals first, then active runs;
- waits a short grace window for terminal events;
- emits cancellation diagnostics and terminal events for still-active work;
- clears active scheduler state;
- closes the local storage lease when held.

Shutdown and cancellation are idempotent around terminal events. Daemons should still handle process crash by re-opening the same store and inspecting interrupted records.

## Active Recovery

On startup with durable storage:

- active runs owned by missing/stale/closed/invalid owners become `failed` with `AGENT_RUNTIME_INTERRUPTED` and signal `RUNTIME_RESTART`;
- active goals owned by missing/stale/closed/invalid owners become `failed`;
- pending/running tasks in recovered goals become `canceled`;
- active records owned by a live owner are left untouched and surfaced through store health.

The runtime never resumes a live child process after restart. It only makes durable state queryable, replayable, and diagnosable.

## Root API Boundary

The package root value API remains intentionally small:

- exported value: `createAgentRuntime`;
- public TypeScript types are exported for facade requests, records, events, diagnostics, conformance, and store inspection;
- built-in adapters, parser helpers, stores, schedulers, and storage internals are not package-root value exports.

`getAdapter(id)` and `RuntimeOptions.adapters` remain pre-alpha adapter experimentation points. This contract freezes daemon-facing embedding semantics, not a stable hosted platform API.
