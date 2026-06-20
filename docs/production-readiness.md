# Production Readiness

Status: P2-8 crash consistency and fault injection gate
Last updated: 2026-06-20

This project is still **pre-alpha / developer preview**. P2-8 adds fault-injected crash consistency coverage for the existing local JSON manifest, JSONL event log, and lock-file store: failed manifest writes preserve the old manifest, failed event appends become terminal diagnostics, repair backup/rewrite failures are diagnosable and non-destructive, corrupt locks do not block read-only inspection, and repair/health/diagnostics output stays redacted. P2-8 is still not OpenDesign daemon-level production: it does not add daemon/web/db/WAL/telemetry/artifact layers.

## Local-First Production Definition

For this repository, "production-ready local runtime" means:

- single-machine execution only;
- local CLI adapters only: Codex CLI, Claude Code, OpenCode, or caller-supplied compatible adapters;
- explicit `cwd`, permission policy, and optional `storageDir`;
- no silent permission escalation and no silent adapter fallback;
- durable local manifests/events when `storageDir` is supplied;
- one writer runtime per `storageDir` by default, with read-only inspection paths that do not acquire the writer lease;
- explicit `store-repair --apply` for partial/corrupt JSONL event-log repair, with backup, temp-file-and-rename writes, best-effort fsync, and idempotent no-op behavior after repair;
- crash-consistency behavior verified by test-only storage fault injection for temp writes, rename, JSONL append, fsync/fdatasync fallback, repair backup/rewrite, and lock acquire/close;
- active run/goal reload is conservative: only records owned by a missing/stale/closed owner are marked interrupted, not resumed;
- diagnostics are auditable and redacted before storage/export;
- CLI event JSONL is versioned as `agent-runtime.event.v1` for both live stream and replay output;
- real CLI conformance defaults to detection/profile certification only; authenticated real agent runs require explicit `--allow-real-run`;
- `npm run dogfood` is the default release-candidate gate and does not launch authenticated real agent runs;
- `npm run prepublish:check` is the local prepublish guard and also avoids authenticated real agent runs;
- `npm test` uses Vitest verbose output so long contract/install-smoke coverage does not look idle to CI or local watchdogs;
- GitHub Actions CI runs Node.js 20/22/24 matrix checks plus one single-Node dogfood job;
- validation evidence is replayable through goal manifests and diagnostics export.

## Production Readiness Gates

Offline gates:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
npm run dogfood
npm run prepublish:check
npm run package:check
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
node ./dist/cli/main.js store-health --storage-dir <temp-dir> --json
node ./dist/cli/main.js store-repair --storage-dir <corrupt-fixture-temp-dir> --dry-run --json
node ./dist/cli/main.js store-repair --storage-dir <corrupt-fixture-temp-dir> --apply --json
node ./dist/cli/main.js store-health --storage-dir <corrupt-fixture-temp-dir> --json
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
npm pack --dry-run
```

Remote CI gates:

- `.github/workflows/ci.yml`: Node.js 20/22/24 matrix for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run; single Node.js 22 dogfood job for `npm run dogfood`.
- `.github/workflows/release-candidate.yml`: manual `workflow_dispatch` gate that runs `npm ci`, `npm run ci`, `npm run dogfood`, creates `npm pack --json` output, and uploads the tarball, pack metadata, and package file list. It does not publish and does not require an npm token.

Package install smoke:

```bash
tmp_dir="$(mktemp -d /tmp/agent-runtime-release-XXXXXX)"
pack_info="$(npm pack --json --ignore-scripts --pack-destination "$tmp_dir")"
package_file="$(printf '%s' "$pack_info" | node -e "const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(data[0].filename);")"
(
  cd "$tmp_dir"
  npm init -y
  npm install "$tmp_dir/$package_file" --no-save --ignore-scripts --no-audit --no-fund
  node -e "import('agent-cli-runtime').then((m) => { if (typeof m.createAgentRuntime !== 'function') process.exit(1); })"
  node ./node_modules/.bin/agent-runtime conformance --mode fixtures --json
  node ./node_modules/.bin/agent-runtime conformance --mode fake --json
  node ./node_modules/.bin/agent-runtime smoke --mode fixtures --json
)
```

Manual real CLI run gate, only on a machine where the selected CLI is installed, authorized, and safe to run:

```bash
node ./dist/cli/main.js conformance --mode real --agent all --json
node ./dist/cli/main.js conformance --mode real --agent codex --allow-real-run --json
node ./dist/cli/main.js conformance --mode real --agent claude --allow-real-run --json
node ./dist/cli/main.js conformance --mode real --agent opencode --allow-real-run --json
```

`--agent all` keeps one adapter's fail/skip isolated in the summary. Real mode without `--allow-real-run` never launches a real agent run; it performs executable/version/auth/model/profile certification and returns `runClassification: "real_run_skipped"` when a run would require explicit authorization.

`--allow-real-run` is the safety boundary. When it is present, the runtime may consume the selected local CLI account/network path. Without `--cwd`, conformance/smoke real runs use an isolated temporary cwd, request read-only behavior, require expected text by default, and check cwd mutation evidence.

Conformance JSON uses `schemaVersion: "agent-runtime.conformance.v1"`. Stable summary fields per adapter:

- `adapter`
- `version`
- `resolvedExecutable`
- `auth`
- `modelsSource`
- `capabilities`
- `argvProfile`
- `promptTransport`
- `parserMode`
- `runClassification`
- `expectedTextMatched`
- `observedTextTail`
- `cwdMutated`
- `diagnosticsCount`
- `diagnostics`
- `skippedReason`
- `failureReason`

The conformance layer reports `unsupported_flag`, unfamiliar version/help shapes, and parser/stream failures as actionable diagnostics instead of guessing replacements. Unknown or unproven flags stay in `argvProfile.needsVerification`. JSON output is recursively redacted and must not contain tokens, Bearer values, auth-token environment assignments, full prompts, raw private absolute paths, or unredacted observed text tails.

## Examples And Package Boundary

The npm package may include docs and examples, but not local reference material or test fixtures.

Included release-candidate artifacts:

- `dist/`
- `README.md`
- `README.zh-CN.md`
- `LICENSE`
- `docs/ssot.md`
- `docs/compatibility.md`
- `docs/production-readiness.md`
- `docs/release-checklist.md`
- `examples/library-run.js`
- `examples/library-goal.js`
- `examples/cli-dogfood.md`
- `scripts/dogfood.mjs`

Repository-only prepublish artifacts:

- `scripts/check-package-boundary.mjs`

Excluded artifacts:

- `.reference/`
- `tests/`
- `tests/fixtures/`
- fault fixtures
- raw corrupt samples
- `repair-backups/`
- raw real CLI output
- real private paths
- real provider secrets or token-looking values

`examples/library-run.js` and `examples/library-goal.js` create local fake CLIs and are intended to run after `npm run build`. They must not require real Codex, Claude, OpenCode, provider credentials, or user project paths.

## Known Risks

- Real CLI behavior can drift after this release candidate. Treat `docs/compatibility.md` as dated evidence, not a permanent guarantee.
- `status-only real smoke exit 0` remains intentionally non-passing: a real smoke run must emit `text_delta`; if required text is missing, classification is `unexpected_output`.
- Real conformance preflight can classify a local CLI as unavailable/auth-missing because of machine-specific executable, auth, network, or proxy state. That skip is useful compatibility evidence but is not a successful real run.
- OpenCode explicit read-only/workspace-write flags, extra dirs, and session/resume mappings remain in `needsVerification`.
- Claude Code authenticated run smoke remains dependent on local auth or a correctly configured Anthropic-compatible provider environment.
- P2-8 repair and fault-injection hardening does not implement WAL, database transactions, compaction, manifest semantic reconciliation, daemon resume, remote workers, or multi-host coordination. It repairs only local JSONL event-log partial/corrupt records within the existing store layout.

## Durable Supervisor Contract

The runtime does not resume live processes after a process restart. When `storageDir` is supplied, `createAgentRuntime()` opens a local single-writer lease in `runtime.lock.json`. The owner includes `runtimeInstanceId`, `pid`, `startedAt`, and `heartbeatAt`; active run/goal manifests carry the same owner metadata. Heartbeat is enabled only for durable storage; memory-only runtimes do not create a lease.

- a second writer runtime for the same `storageDir` is refused while the owner is live;
- stale or closed lock owners may be taken over, with a redacted `AGENT_STORAGE_LEASE_TAKEOVER` diagnostic;
- read-only inspection commands (`runs`, `goals`, `run-status`, `goal-status`, `replay-run`, `replay-goal`, `store-health`, `store-lock`, `diagnostics`) do not acquire the writer lease and must not mutate active work;
- repair apply (`store-repair --apply`) requires an explicit storage directory, refuses live writer owners, holds the local store lease while writing, creates an internal `repair-backups/<timestamp>/...` backup through temp-file-and-rename, rewrites event logs through temp-file-and-rename, records redacted success or failure repair storage diagnostics, and is idempotent after successful repair;
- repair backup failure leaves the original `events.jsonl` unchanged and does not set `applied: true`; rewrite failure preserves the backup path and leaves the original event log readable;
- repair apply truncates partial tails and removes corrupt JSONL lines while preserving later legal replay events; terminal manifest/event mismatches remain manual-review warnings and are not auto-reconciled;
- active runs owned by a stale/missing/closed owner become `failed` with `AGENT_RUNTIME_INTERRUPTED` and signal `RUNTIME_RESTART`;
- active goals owned by a stale/missing/closed owner become `failed`, pending/running tasks become `canceled`, and a scheduler error is replayed;
- active records owned by another live runtime are left untouched and reported through health/diagnostics owner status;
- terminal events are appended once and replay remains ordered by `sequence`;
- `shutdown()`, `cancelRun()`, and `cancelGoal()` are idempotent around terminal events;
- `shutdown()` releases or marks the storage lease closed.

Diagnostics export uses `schemaVersion: "agent-runtime.diagnostics.v1"` and includes `diagnostics`, `storageDiagnostics`, `supervisorSummary`, `adapterSummary`, and goal `attemptEvidence` when present. `supervisorSummary` includes terminal reason, terminal event count, active reload recovery, owner/lease status, and task status counts for goals. It intentionally omits env values, prompts, raw corrupt lines, raw private paths, and tokens.

## Event Schema Contract

CLI `run --stream jsonl`, `goal --stream jsonl`, `replay-run --jsonl`, and `replay-goal --jsonl` emit the same event envelope:

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

Library replay APIs remain source-compatible and return `ReplayEvent<T>`. Terminal reasons use the stable vocabulary `success`, `failed`, `timeout`, `canceled`, `interrupted`, `validation_failed`, `execution_failed`, `unavailable`, `auth_missing`, and `task_graph_invalid`.

This lease is a same-machine best-effort guard for local embedded runtimes. It is not a daemon coordination protocol, distributed lock, WAL, group commit, database transaction layer, multi-host scheduler, or live process resume/session attachment.

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
- distributed execution, distributed locking, remote workers, Docker/SSH runtime, or queue leasing;
- browser/UI surfaces, artifact viewers, project workspaces, and media pipelines;
- telemetry pipeline, metrics database, tracing backend, or hosted analytics;
- database-backed auth, tenancy, teams, policy management, or audit log service;
- artifact/object model parity with OpenDesign design workspaces;
- plugin marketplace or skill installation runtime.

The intended production path is to harden this local adapter runtime first, then let a daemon or product shell own these larger layers explicitly.
