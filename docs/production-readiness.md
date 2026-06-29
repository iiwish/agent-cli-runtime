# Production Readiness

Status: `0.1.0-alpha.3` corrective pre-alpha release
Last updated: 2026-06-29

This project is still **pre-alpha / developer preview**. Version `0.1.0-alpha.3` is the corrective pre-alpha release for package consumers.

Version `0.1.0-alpha.2` was published with fresh main release-candidate evidence, real publish evidence, registry verification, installed-package CLI smoke, and GitHub Release verification, but its immutable npm tarball contains stale pre-publish package docs. Version `0.1.0-alpha.1` remains published as an earlier alpha and has GitHub pre-release `v0.1.0-alpha.1`. Version `0.1.0-alpha.0` is deprecated because that immutable tarball contains stale pre-publish status text. npm registry metadata and GitHub Releases are the source of truth for available versions and dist-tags. P3-1 froze daemon-ready execution-kernel contracts for embedders in [docs/daemon-ready-contract.md](./daemon-ready-contract.md); P3-7 freezes the API / CLI schema inventory and versioning policy in [docs/api-schema-contract.md](./api-schema-contract.md); P8-2 records real Codex / Claude Code / OpenCode compatibility as a repo-only matrix, and P8-3/P8-5 bind that matrix to release review through matrix target SHA, freshness, dirty-policy verification, local strict release artifacts, branch/main evidence scope, and fresh main remote artifact verification without launching authenticated real agent runs.

Detailed run and artifact evidence for P6-4 through P8-5 is recorded outside the npm package under `.release-evidence/`.

Volatile target-SHA evidence stays out of the npm package. Fresh run ids, artifact ids, artifact digests, tarball hashes, pack hashes, downloaded verification paths, raw logs, raw CLI output, full prompts, and token-looking values belong under `.release-evidence/` or durable GitHub Release assets. Packaged docs keep stable release rules, the alpha.2 stale package-docs incident, the alpha.3 corrective release boundary, package-docs verification, and the human-gated boundary for any registry mutation. P5-1 adds a published-package daemon consumer harness for the already published `agent-cli-runtime@0.1.0-alpha.1`: it installs from the npm registry, uses fake CLIs only, and verifies daemon-style lifecycle coverage without touching local `dist/` or publishing a new version. The post-alpha path does not configure trusted publishing, claim provenance, or add daemon/API server/database/WAL/remote-worker/UI/telemetry/artifact layers.

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
- store health, store repair, diagnostics, conformance, and CLI JSON usage errors are versioned as `agent-runtime.storeHealth.v1`, `agent-runtime.storeRepair.v1`, `agent-runtime.diagnostics.v1`, `agent-runtime.conformance.v1`, and `agent-runtime.cliError.v1`;
- daemon/product shell embedding semantics are documented without adding a hosted daemon surface;
- `npm run daemon:verify` packs and installs the package into a temporary consumer, then verifies fake run, fake goal, replay, diagnostics, store inspection, shutdown, and reopen using temp storage and fake CLIs;
- `npm run runtime:safety` packs and installs the package into a temporary consumer, then verifies repeated run/goal execution, slow event consumption, cancel/timeout churn, bounded redacted diagnostics, repeated shutdown, lease close, and reopen behavior using fake CLIs only;
- `npm run published:daemon:verify` installs `agent-cli-runtime@0.1.0-alpha.1` from the npm registry into a temporary daemon-style consumer and verifies detect, run, goal, cancel, timeout, replay, read-only inspection during active writer ownership, second-writer refusal, shutdown/reopen, and stale owner recovery with schema `agent-runtime.publishedDaemonConsumer.v1`;
- real CLI conformance and smoke default to detection/profile certification only; authenticated real agent runs require explicit `--allow-real-run`;
- `npm run compat:real:evidence` creates repo-only redacted real CLI compatibility matrix evidence at `.release-evidence/p8-2-real-cli-compatibility-matrix.json`; it defaults to safe preflight and requires explicit `--allow-real-run --agent <id> --expect-text <text>` pairs before launching authenticated real smoke;
- `npm run compat:real:evidence:verify` is the offline P8 matrix gate for `.release-evidence/p8-2-real-cli-compatibility-matrix.json`; it does not launch authenticated real runs and rejects unsafe content, evidence drift, skip/auth/unavailable-as-success claims, incomplete authenticated success evidence, missing adapter fields, missing `needsVerification` audits, and invalid repo-only package-boundary claims; release review passes `--target-sha <target-sha> --max-age-hours 24 --release-strict`, accepts matrix-output-only dirty state as `self_dirty_only`, and requires explicit `--allow-dirty` for dirty non-evidence inputs;
- real smoke evidence uses `schemaVersion: "agent-runtime.realSmoke.v1"`, requires expected text for success, checks cwd mutation, and omits prompts, raw stdout/stderr, private cwd, tokens, and final run records;
- release artifact verification uses `agent-cli-runtime.releaseVerification.v1`, release gate evidence uses `agent-cli-runtime.releaseGateEvidence.v1`, and both are covered by the schema versioning policy in [docs/api-schema-contract.md](./api-schema-contract.md); release gate evidence records compatibility verification with command, ok, verifier schema, verified evidence schema, target SHA status, freshness status, dirty policy status, diagnostic count/codes, and the fixed repo-only skip reason when CI did not refresh the matrix;
- `npm run release:strict-compatibility:evidence -- --target-sha <target-sha> --local-release-dir <tmp-local-strict>` writes `.release-evidence/p8-4-release-strict-compatibility.json` as the repo-only release-strict compatibility closure summary; it records matrix/verifier schemas, local strict release-candidate artifact verification, remote workflow trigger/download status, `noAuthenticatedRealRun`, `noNpmPublish`, `noNpmToken`, and branch/main evidence scope without raw stdout/stderr, prompts, private paths, local temp paths, resolved executable paths, tokens, or auth environment values;
- `.release-evidence/p8-5-main-release-candidate.json` is the repo-only main-scoped remote release-candidate summary; it records `releaseTargetSha`, local strict matrix verification, local strict release artifact verification, fresh `release-candidate.yml --ref main` metadata, complete five-artifact download verification, `mainEvidence: true`, `branchEvidence: false`, and the same no-authenticated-run/no-publish/no-token boundary without raw logs, raw stdout/stderr, prompts, private paths, local temp paths, resolved executable paths, tokens, or auth environment values;
- `npm run dogfood` is the default release-candidate gate and does not launch authenticated real agent runs;
- `npm run dogfood` also installs the packed tarball into a temporary TypeScript consumer, runs `tsc --noEmit`, and executes fake-CLI library run/goal/replay/diagnostics smoke;
- `npm run prepublish:check` is the local prepublish guard, includes `npm run daemon:verify`, `npm run runtime:safety`, and `npm run compat:real:evidence:verify`, and also avoids authenticated real agent runs;
- `npm run release:candidate` creates local release-candidate artifacts without publishing npm; it defaults to `--real-compatibility-mode local-strict`, while remote clean-checkout workflows pass `--real-compatibility-mode repo-only-skipped`;
- `npm run release:artifacts:normalize -- --download-dir <gh-download-dir> --out-dir <normalized-artifact-dir>` normalizes the five downloaded release-candidate artifact directories into one verifier-ready directory, emits `agent-cli-runtime.releaseArtifactNormalization.v1`, and rejects missing, duplicate, or unknown files without exposing local absolute paths;
- `npm run release:verify` validates local or downloaded release artifacts and emits stable redacted JSON;
- `npm run release:main-candidate:evidence` writes the P8-5 main-scoped remote release-candidate summary after `releaseTargetSha`, `origin/main`, remote workflow `headSha`, exact artifact metadata, and downloaded `release:verify` all match;
- `npm run release:post-alpha:verify` compares npm registry and GitHub Release tarballs, allowing raw gzip hash differences only when unpacked package content is identical;
- `npm run smoke:published` installs the published npm package and verifies package-root ESM import plus `agent-runtime agents --json` parsing without authenticated real runs;
- `npm run published:daemon:verify` is the published-package daemon lifecycle proof and emits redacted JSON with `packageSource: "npm-registry"` and `noAuthenticatedRealRun: true`;
- `npm run published:adapters:verify` installs the published npm package from the npm registry and verifies built-in Codex, Claude, and OpenCode adapters with fake binaries, real adapter argv/stdin/parser paths, redacted JSON schema `agent-runtime.publishedAdapters.v1`, and no authenticated real runs;
- `npm run published:verify -- --out-dir published-verification` aggregates `smoke:published`, `published:daemon:verify`, `published:adapters:verify`, `release:post-alpha:verify`, and npm registry metadata into `agent-cli-runtime.publishedVerification.v1` evidence without raw stdout/stderr, token values, temp paths, or publish credentials;
- `npm run published:verify:evidence -- --dir published-verification` verifies existing published verification evidence and never generates it; missing default evidence is an expected redacted JSON guard failure, while downloaded GitHub artifact review passes `--dir <downloaded-artifact-dir>`;
- `npm run published:usability:audit` is a repository-only post-publish audit script that is intentionally excluded from npm package contents and verifies the already published package from the npm registry;
- `docs/release-publish-runbook.md` records current post-alpha registry state, the future alpha publish command path, 2FA/trusted publishing/provenance decisions, dist-tag checks, and rollback boundaries without configuring real publishing;
- CLI JSON success and error contracts are parseable, redacted, and covered for core release-facing commands;
- `npm test` uses Vitest verbose output for default contract coverage; slower installed-package gates and install smokes run through single-Node release gates or explicit opt-in checks rather than every Node matrix entry;
- GitHub Actions CI runs Node.js 20/22/24 matrix checks plus one single-Node release-gates job for `npm run daemon:verify`, `npm run runtime:safety`, and `npm run dogfood`; CI does not run the repo-only compatibility verifier because it is evidence-bound to `.release-evidence/`, while prepublish and local strict release-candidate do;
- the manual release-candidate workflow is configured to upload the packed tarball, pack metadata, package file list, gate evidence JSON, and verification JSON with explicit artifact retention;
- the release report records local commands, remote workflow evidence, downloaded artifact verification, package boundary, real CLI evidence boundaries, known risks, and non-goals;
- validation evidence is replayable through goal manifests and diagnostics export.

## Production Readiness Gates

Offline gates:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run daemon:verify
npm run runtime:safety
npm run compat:real:evidence:verify
npm run published:daemon:verify
npm run published:adapters:verify
npm run ci
npm run dogfood
npm run prepublish:check
npm run package:check
npm run release:candidate -- --out-dir release-candidate
npm run release:candidate -- --out-dir release-candidate --real-compatibility-mode repo-only-skipped
npm run release:artifacts:normalize -- --download-dir <gh-download-dir> --out-dir <normalized-artifact-dir>
npm run release:verify -- --dir release-candidate
npm run release:main-candidate:evidence -- --release-target-sha <origin-main-sha> --local-release-dir <local-strict-dir> --remote-run-json <run.json> --artifacts-json <artifacts.json> --downloaded-dir <normalized-artifact-dir>
npm run release:post-alpha:verify
npm run smoke:published
npm run published:daemon:verify
npm run published:adapters:verify
npm run published:verify -- --out-dir <tmp-dir>
npm run published:verify:evidence -- --dir <tmp-dir>
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
node ./dist/cli/main.js smoke --mode real --agent codex --json
node ./dist/cli/main.js store-health --storage-dir <temp-dir> --json
node ./dist/cli/main.js store-repair --storage-dir <corrupt-fixture-temp-dir> --dry-run --json
node ./dist/cli/main.js store-repair --storage-dir <corrupt-fixture-temp-dir> --apply --json
node ./dist/cli/main.js store-health --storage-dir <corrupt-fixture-temp-dir> --json
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
npm pack --dry-run
npm publish --dry-run --ignore-scripts --tag alpha
```

Remote CI gates:

- `.github/workflows/ci.yml`: Node.js 20/22/24 matrix for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run; single Node.js 22 release-gates job for `npm run daemon:verify`, `npm run runtime:safety`, and `npm run dogfood`. The CI path intentionally leaves repo-only compatibility evidence target-SHA verification to local `prepublish:check` and local strict `release:candidate`, where the default target is the matrix `gitSha`.
- `.github/workflows/release-candidate.yml`: manual `workflow_dispatch` gate that runs `npm ci`, `npm run ci`, `npm run dogfood`, and `npm run release:candidate -- --out-dir release-candidate --real-compatibility-mode repo-only-skipped`; it uploads `agent-cli-runtime-tarball`, `agent-cli-runtime-pack-metadata`, `agent-cli-runtime-package-files`, `agent-cli-runtime-gate-evidence`, and `agent-cli-runtime-release-verification`. `gate-evidence.json` must include `daemon:verify`, `runtime:safety`, and a `compat:real:evidence:verify` summary. Remote clean-checkout workflow artifacts record `targetSha.status`, `freshness.status`, and `dirtyPolicy.status` as `repo_only_not_run` plus `repoOnlyEvidence.status: "not_refreshed_in_ci"`. The fresh workflow head SHA must match the release target SHA, the downloaded artifacts are normalized with `npm run release:artifacts:normalize -- --download-dir <gh-download-dir> --out-dir <normalized-artifact-dir>`, the normalized artifacts must pass `npm run release:verify -- --dir <normalized-artifact-dir>`, and volatile evidence must be recorded under `.release-evidence/` instead of package docs. Historical runs only prove their own workflow head SHAs. The workflow does not publish and does not require an npm token.
- `.github/workflows/published-package-verification.yml`: manual `workflow_dispatch` post-publish gate on Node.js 22 that runs `npm ci`, `npm run published:verify -- --out-dir published-verification`, verifies the summary with `npm run published:verify:evidence -- --dir published-verification`, and uploads `agent-cli-runtime-published-verification` with 14-day retention. Downloaded artifact review passes the downloaded artifact directory to `published:verify:evidence`; each run proves only its own workflow head SHA. This is not a publish workflow and does not require npm registry credentials.

`npm publish --dry-run --ignore-scripts --tag alpha` is a manual local dry-run check. The explicit `--tag alpha` keeps dry-run output aligned with the pre-alpha release intent even when npm does not apply `publishConfig.tag` in dry-run output. It is intentionally documented but not required as a remote CI gate because npm dry-run output can vary by npm version and registry context.

Package install smoke:

```bash
tmp_dir="$(mktemp -d)"
pack_info="$(npm pack --json --ignore-scripts --pack-destination "$tmp_dir")"
package_file="$(printf '%s' "$pack_info" | node -e "const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(data[0].filename);")"
(
  cd "$tmp_dir"
  npm init -y
  npm install "$tmp_dir/$package_file" --no-save --ignore-scripts --no-audit --no-fund
  node -e "import('agent-cli-runtime').then((m) => { if (typeof m.createAgentRuntime !== 'function') process.exit(1); })"
  node /path/to/typescript/bin/tsc --noEmit
  node consumer.mjs
  node ./node_modules/.bin/agent-runtime conformance --mode fixtures --json
  node ./node_modules/.bin/agent-runtime conformance --mode fake --json
  node ./node_modules/.bin/agent-runtime smoke --mode fixtures --json
)
```

The checked-in automated version of this smoke is `npm run dogfood`; it creates the temporary `consumer.ts`, `consumer.mjs`, fake adapter binary, and fake CLI environment itself. `daemon:verify` and `runtime:safety` run in the single-Node CI release-gates job and in `release:candidate`, not in every Node matrix entry. `compat:real:evidence:verify` runs in `prepublish:check` and local strict `release:candidate`, not in dogfood or remote clean-checkout release-candidate workflows, so installed-package consumers never depend on repo-only `.release-evidence/`.

Manual real CLI run gate, only on a machine where the selected CLI is installed, authorized, and safe to run:

```bash
node ./dist/cli/main.js conformance --mode real --agent all --json
node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --expect-text <safe_text> --json
node ./dist/cli/main.js smoke --mode real --agent claude --allow-real-run --expect-text <safe_text> --json
node ./dist/cli/main.js smoke --mode real --agent opencode --allow-real-run --expect-text <safe_text> --json
```

`--agent all` keeps one adapter's fail/skip isolated in the conformance summary. Real mode without `--allow-real-run` never launches a real agent run; it performs executable/version/auth/model/profile certification and returns `runClassification: "real_run_skipped"` when a run would require explicit authorization.

`--allow-real-run` is the safety boundary. When it is present, the runtime may consume the selected local CLI account/network path. Without `--cwd`, conformance/smoke real runs use an isolated temporary cwd, request read-only behavior, require expected text by default, and check cwd mutation evidence. A custom `--prompt` or `--prompt-file` without `--expect-text` is intentionally `unexpected_output`.

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
- `cwdMutationChecked`
- `cwdMutated`
- `diagnosticsCount`
- `diagnostics`
- `skippedReason`
- `failureReason`

The conformance and real-smoke layers report `unsupported_flag`, unfamiliar version/help shapes, and parser/stream failures as actionable diagnostics instead of guessing replacements. Unknown or unproven flags stay in `argvProfile.needsVerification` and may classify real smoke as `needs_verification` before launch. JSON output is recursively redacted and must not contain tokens, Bearer values, auth-token environment assignments, full prompts, raw private absolute paths, raw stdout/stderr, final real-smoke run records, or unredacted observed text tails.

## Examples And Package Boundary

The npm package may include docs and examples, but not local reference material or test fixtures.

Included release-candidate artifacts:

- `dist/`
- `README.md`
- `README.zh-CN.md`
- `LICENSE`
- `docs/daemon-ready-contract.md`
- `docs/ssot.md`
- `docs/compatibility.md`
- `docs/production-readiness.md`
- `docs/release-checklist.md`
- `docs/release-report.md`
- `docs/release-publish-runbook.md`
- `examples/library-run.js`
- `examples/library-goal.js`
- `examples/cli-dogfood.md`
- `scripts/dogfood.mjs`

Repository-only release verification scripts:

- `scripts/create-release-candidate.mjs`
- `scripts/verify-release-artifacts.mjs`

Repository-only daemon embedding gates:

- `scripts/verify-daemon-ready.mjs`
- `scripts/verify-runtime-safety.mjs`
- `scripts/verify-published-daemon-consumer.mjs`
- `scripts/verify-published-adapters.mjs`
- `scripts/create-published-verification-evidence.mjs`
- `scripts/verify-published-verification-evidence.mjs`
- `scripts/create-real-compatibility-evidence.mjs`
- `scripts/verify-real-compatibility-evidence.mjs`

Repository-only prepublish artifacts:

- `scripts/check-package-boundary.mjs`

Excluded artifacts:

- `.reference/`
- `published-verification/`
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
- P6-1 local evidence on 2026-06-23 refreshed Codex, Claude Code, and OpenCode preflight plus opt-in Codex/OpenCode smoke. It is machine-local compatibility evidence, not a CI gate and not a future-version guarantee.
- P6 release-candidate evidence is commit-specific and recorded outside the package. It is not evidence for future commits, future publish, or authenticated real Codex/Claude/OpenCode success. Because release docs are packaged, final publish evidence must come from a fresh workflow run after candidate documentation is committed. Internal files under `dist/` may exist in the tarball for declarations and CLI execution, but importing internal subpaths is not a documented contract.
- `status-only real smoke exit 0`, wrong expected text, or a custom prompt without `--expect-text` remain intentionally non-passing: classification is `unexpected_output`.
- Real conformance preflight can classify a local CLI as unavailable/auth-missing because of machine-specific executable, auth, network, or proxy state. That skip is useful compatibility evidence but is not a successful real run.
- Codex session/resume and a stable non-mutating auth probe remain in `needsVerification`.
- OpenCode explicit read-only/workspace-write flags, extra dirs, and session/resume mappings remain in `needsVerification`.
- Claude Code authenticated run smoke remains dependent on local auth or a correctly configured Anthropic-compatible provider environment; current P6-1 local evidence is `auth_missing`.
- P3-6 adds opt-in real smoke evidence, but does not add authenticated real runs to CI, dogfood, prepublish, or release-candidate gates and does not implement scheduler expansion, daemon/API server, database, WAL, remote workers, web UI, telemetry, npm publish, trusted publishing configuration, provenance publishing, or guaranteed authenticated real-run success certification. Repair and fault-injection hardening remains local JSONL-only within the existing store layout.

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

Store health uses `schemaVersion: "agent-runtime.storeHealth.v1"` and includes `ok`, `storageDir`, `checkedAt`, `lock`, `totals`, `corruptManifests`, `corruptEventLogs`, `partialTails`, `activeRecords`, `activeInterrupted`, `warnings`, `storageDiagnostics`, and `diagnostics`. Store repair uses `schemaVersion: "agent-runtime.storeRepair.v1"`. CLI JSON usage errors use `schemaVersion: "agent-runtime.cliError.v1"` with `ok: false` and a short redacted error object.

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
