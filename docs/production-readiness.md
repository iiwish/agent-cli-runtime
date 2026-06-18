# Production Readiness

Status: P2-1 production runtime hardening
Last updated: 2026-06-17

This project is still **pre-alpha / developer preview**. P2-1 defines a local-first production target for embedding the runtime on one machine; it does not claim OpenDesign daemon-level production parity.

## Local-First Production Definition

For this repository, "production-ready local runtime" means:

- single-machine execution only;
- local CLI adapters only: Codex CLI, Claude Code, OpenCode, or caller-supplied compatible adapters;
- explicit `cwd`, permission policy, and optional `storageDir`;
- no silent permission escalation and no silent adapter fallback;
- durable local manifests/events when `storageDir` is supplied;
- active run/goal reload is conservative: records are marked interrupted, not resumed;
- diagnostics are auditable and redacted before storage/export;
- real CLI conformance is opt-in and requires `--allow-real-run`;
- validation evidence is replayable through goal manifests and diagnostics export.

## Production Readiness Gates

Offline gates:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Real CLI gate, only on a machine where the selected CLI is installed and authorized:

```bash
node ./dist/cli/main.js conformance --mode real --agent codex --allow-real-run --json
node ./dist/cli/main.js conformance --mode real --agent claude --allow-real-run --json
node ./dist/cli/main.js conformance --mode real --agent opencode --allow-real-run --json
```

`--agent all` keeps one adapter's fail/skip isolated in the summary. Real mode without `--allow-real-run` must refuse before launching a CLI.

Stable conformance summary fields per adapter:

- `adapter`
- `version`
- `auth`
- `modelsSource`
- `runClassification`
- `expectedTextMatched`
- `cwdMutated`
- `diagnosticsCount`
- `skippedReason`

## Durable Supervisor Contract

The runtime does not resume live processes after a process restart. When a new runtime loads a durable store:

- active runs become `failed` with `AGENT_RUNTIME_INTERRUPTED` and signal `RUNTIME_RESTART`;
- active goals become `failed`, pending/running tasks become `canceled`, and a scheduler error is replayed;
- terminal events are appended once and replay remains ordered by `sequence`;
- `shutdown()`, `cancelRun()`, and `cancelGoal()` are idempotent around terminal events.

Diagnostics export includes a `supervisorSummary` with terminal reason, terminal event count, active reload recovery, and task status counts for goals. It intentionally omits env values, prompts, raw private paths, and tokens.

## Validation Contract

Runtime-side validation runs after a task run succeeds and before task success is committed. Validation failure keeps task status monotonic: a task is not marked `succeeded` and then failed.

Validation evidence records:

- redacted command text;
- redacted logical `cwd`;
- timeout;
- redacted caller env overrides only, not the inherited process env;
- exit code, signal, stdout/stderr tails, duration, pass/fail, and classification.

Timeout validation failures are classified as `timeout` and produce `AGENT_TIMEOUT` diagnostics. Other command failures produce `AGENT_EXECUTION_FAILED`.

## Parser Noise Contract

Codex, Claude, and OpenCode parsers are line-oriented JSON parsers. The contract is:

- recognized structured events become normalized runtime events;
- warning/log/noise lines are ignored;
- partial JSON lines are buffered until complete;
- corrupt lines are ignored and do not become `text_delta`;
- unknown future structured event types are ignored.

Non-JSON CLI noise must not become user-visible assistant text. Parser diagnostics should stay short, redacted, and aggregate-friendly when surfaced by higher layers.

## Remaining Gap To OpenDesign Daemon-Level Production

This repository deliberately does not include the following OpenDesign daemon layers:

- daemon/API server lifecycle and multi-client coordination;
- WAL, segmented logs, compaction, and transactional repair;
- live process resume/session attachment after restart;
- distributed execution, remote workers, Docker/SSH runtime, or queue leasing;
- browser/UI surfaces, artifact viewers, project workspaces, and media pipelines;
- telemetry pipeline, metrics database, tracing backend, or hosted analytics;
- database-backed auth, tenancy, teams, policy management, or audit log service;
- artifact/object model parity with OpenDesign design workspaces;
- plugin marketplace or skill installation runtime.

The intended production path is to harden this local adapter runtime first, then let a daemon or product shell own these larger layers explicitly.
