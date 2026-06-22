# Release Checklist (pre-alpha / developer preview)

## P3-5 remote release evidence closure

- [x] `.github/workflows/ci.yml` keeps the Node.js 20/22/24 matrix for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run.
- [x] CI runs `npm run daemon:verify`, `npm run runtime:safety`, and `npm run dogfood` in one single-Node release-gates job instead of repeating installed-package gates across the matrix.
- [x] `.github/workflows/release-candidate.yml` remains manual `workflow_dispatch`, runs `npm ci`, `npm run ci`, `npm run dogfood`, and delegates artifact creation to `npm run release:candidate -- --out-dir release-candidate`.
- [x] `release:candidate` writes `gate-evidence.json` with `agent-cli-runtime.releaseGateEvidence.v1`, `npm run daemon:verify`, `npm run runtime:safety`, and the installed-package output schema versions.
- [x] `release:verify` requires `gate-evidence.json`, rejects missing or incomplete daemon-ready gate evidence, and still checks `.reference/`, tests/fixtures, private paths, token-looking values, Bearer values, and auth env assignments.
- [x] `npm run prepublish:check` includes both `npm run daemon:verify` and `npm run runtime:safety`.
- [x] Workflows still contain no `npm publish`, no `NODE_AUTH_TOKEN` / `NPM_TOKEN`, no trusted-publishing credential setup, and no `--allow-real-run`.
- [x] Triggered fresh remote `.github/workflows/release-candidate.yml` run `27932628093` for workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e` and downloaded/re-verified all five artifacts, including `agent-cli-runtime-gate-evidence`.

## P3-3 long-lived runtime resource safety gate

- [x] `npm run runtime:safety` exists and emits `schemaVersion: "agent-runtime.runtimeSafety.v1"` JSON.
- [x] The runtime safety verification path packs and installs the package into a temporary consumer before running fake CLI resource-safety checks.
- [x] The gate covers repeated fake runs, repeated fake goals, slow event consumption, run replay counts, cancel churn, timeout/process-close race, goal cancellation with queued/running tasks, diagnostics tail bounds/redaction, repeated shutdown, storage lease closure, and reopen of terminal records.
- [x] The gate does not require real Codex, Claude Code, OpenCode accounts or `--allow-real-run`.
- [x] P3-3 tests cover event iterators closing after terminal events, one terminal event per run/goal, active run/goal cleanup, no false active recovery after reopen, and bounded redacted diagnostics.
- [x] `npm run prepublish:check` includes `npm run runtime:safety`; `npm run dogfood` remains the bounded package/API dogfood gate and does not duplicate the P3-3 churn verifier.
- [x] P3-3 does not add daemon/API server, database, WAL, remote worker, web UI, telemetry, npm publish, publish workflow, npm token, trusted publishing configuration, or package-root value exports.

## P3-2 daemon embedding stability gate

- [x] `npm run daemon:verify` exists and emits `schemaVersion: "agent-runtime.daemonVerification.v1"` JSON.
- [x] The daemon verification path packs and installs the package into a temporary consumer before running fake CLI embedding checks.
- [x] The gate covers fake adapter detection, fake conformance, fake run, fake goal, run/goal replay, store health, diagnostics export, shutdown, and reopen of terminal records.
- [x] The gate does not require real Codex, Claude Code, OpenCode accounts or `--allow-real-run`.
- [x] Read-only inspection coverage verifies `store-health`, `store-lock`, `diagnostics`, `replay-run`, and `replay-goal` do not acquire the writer lease or recover live-owner active records.
- [x] Second writer refusal leaves live-owner active run/goal records active and unmodified.
- [x] Shutdown/cancel/recovery paths are covered for single terminal event idempotence.
- [x] Active goal recovery keeps pending/running tasks canceled and succeeded tasks stable across reopen.
- [x] Daemon-facing schema compatibility coverage includes event envelope, diagnostics, conformance, store health, store repair, and CLI JSON error v1 shapes.
- [x] P3-2 does not add daemon/API server, database, WAL, remote worker, web UI, telemetry, npm publish, publish workflow, npm token, trusted publishing configuration, or package-root value exports.

## P3-1 daemon-ready contract freeze

- [x] `docs/daemon-ready-contract.md` documents daemon/product shell embedding semantics without implementing a daemon.
- [x] Public docs position the package as a local-first execution kernel, not a hosted control plane.
- [x] Package root value exports remain limited to `createAgentRuntime`; public types remain type exports only.
- [x] `store-health --json` uses `schemaVersion: "agent-runtime.storeHealth.v1"`.
- [x] CLI `--json` usage errors use `schemaVersion: "agent-runtime.cliError.v1"`.
- [x] Event, diagnostics, conformance, store-health, store-repair, and CLI-error schema compatibility rules are documented.
- [x] Failure taxonomy preserves skipped/auth-missing/unsupported/unexpected-output/cwd-mutated states instead of converting them into success.
- [x] P3-1 does not add daemon/API server, database, WAL, remote worker, web UI, telemetry, npm publish, publish workflow, npm token, or trusted publishing configuration.

## P2-13 alpha publish readiness gate

- [x] `package.json` metadata includes `name`, `version`, `description`, `license`, `type`, `bin`, `main`, `types`, `exports`, `files`, `engines`, `repository`, `homepage`, `bugs`, `keywords`, and `publishConfig.tag`.
- [x] Package root value exports remain limited to `createAgentRuntime`; public types remain type exports only.
- [x] `docs/release-publish-runbook.md` records dry-run, real publish commands, human confirmation points, dist-tag checks, rollback/deprecation/unpublish boundaries, npm 2FA, trusted publishing, provenance, and token strategy.
- [x] `npm publish --dry-run --ignore-scripts --tag alpha` passed locally on 2026-06-22 and reported `Publishing to https://registry.npmjs.org/ with tag alpha ... (dry-run)`.
- [x] `npm pack --dry-run` includes release docs, including `docs/release-publish-runbook.md`, and excludes `.reference/`, tests, fixtures, raw real CLI output, private paths, and token-looking values.
- [x] `.github/workflows/ci.yml` and `.github/workflows/release-candidate.yml` still contain no `npm publish`, no npm token setup, and no registry credential requirement.
- [x] P2-13 records publish readiness only; it does not publish npm, create npm tokens, configure trusted publishing, publish a GitHub release, or launch authenticated real agent runs.

## P2-12 release candidate gate

- [x] `npm ci` — passed in remote release-candidate run `27869580048`.
- [x] `npm run typecheck` — passed locally on 2026-06-20.
- [x] `npm run lint` — passed locally on 2026-06-20.
- [x] `npm test` — passed locally on 2026-06-20 with 170 tests.
- [x] `npm run build` — passed locally on 2026-06-20.
- [x] `npm run daemon:verify` — passed locally on 2026-06-22.
- [x] `npm run ci` — passed in remote release-candidate run `27869580048`.
- [x] `npm run dogfood` — passed locally and in remote release-candidate run `27869580048`.
- [x] `npm run runtime:safety` — passed locally on 2026-06-22.
- [x] `npm run prepublish:check` — passed locally on 2026-06-22 with `runtime:safety` included.
- [x] `npm run release:candidate -- --out-dir <temp-dir>` — passed locally on 2026-06-20.
- [x] `npm run release:verify -- --dir <temp-dir>` — passed locally and against downloaded remote artifacts.
- [ ] `node ./dist/cli/main.js conformance --mode fixtures --json`
- [ ] `node ./dist/cli/main.js conformance --mode fake --json`
- [x] `node ./dist/cli/main.js conformance --mode real --agent all --json` — passed locally without `--allow-real-run`.
- [ ] `node ./dist/cli/main.js smoke --mode fixtures --json`
- [x] `node ./dist/cli/main.js agents --json` — passed locally on 2026-06-20.
- [x] `node ./dist/cli/main.js doctor --json` — passed locally on 2026-06-20.
- [ ] `node ./dist/cli/main.js store-health --storage-dir <empty-temp-dir> --json`
- [ ] `node ./dist/cli/main.js store-repair --storage-dir <empty-temp-dir> --dry-run --json`
- [ ] Error contract: `node ./dist/cli/main.js run --json` exits `1` and prints parseable redacted JSON.
- [ ] Error contract: `node ./dist/cli/main.js store-health --json` exits `1` and prints parseable redacted JSON.
- [ ] Error contract: `node ./dist/cli/main.js store-repair --storage-dir <temp-dir> --apply --dry-run --json` exits `1` and prints parseable redacted JSON.
- [ ] `node ./dist/cli/main.js store-repair --storage-dir <corrupt-fixture-temp-dir> --dry-run --json`
- [ ] `node ./dist/cli/main.js store-repair --storage-dir <corrupt-fixture-temp-dir> --apply --json`
- [ ] `node ./dist/cli/main.js store-health --storage-dir <corrupt-fixture-temp-dir> --json`
- [x] `npm audit --omit=dev` — passed inside `npm run prepublish:check`.
- [x] `npm run package:check` — passed locally on 2026-06-20.
- [x] `npm pack --dry-run` — passed locally and inside `npm run prepublish:check`.
- [x] `npm publish --dry-run --ignore-scripts --tag alpha` — passed locally as dry-run with `tag alpha`.

`npm run dogfood` is the default publish-readiness bundle. It rebuilds, runs offline fixtures/fake conformance, runs real local detection/profile conformance without `--allow-real-run`, executes fake-CLI examples, performs a pack dry-run, and installs the packed tarball into a temporary project for package-root import, TypeScript `tsc --noEmit`, fake library run/goal/replay/diagnostics, and installed CLI smoke.

`npm run prepublish:check` is the local release-candidate guard. It combines typecheck, lint, tests, build, daemon verification, runtime safety verification, dogfood, production audit, package boundary checking, and pack dry-run. It must not run authenticated real agents.

`npm publish --dry-run --ignore-scripts --tag alpha` is a manual local safety check only. It must show `tag alpha`, must not publish, and must not require an npm token. Keep it out of required CI unless the output is proven stable enough for this repository.

`npm test` uses Vitest's verbose reporter for default contract coverage. Slower installed-package gates and install smokes are kept out of the Node.js matrix and run through single-Node release gates, `dogfood`, `prepublish:check`, or explicit opt-in checks.

## GitHub Actions release candidate

P2-12 remote evidence, observed on 2026-06-20, remains historical evidence for commit `2f8832119b4ebdb8393077052560589a398ebf56`. P3-5 release-candidate evidence is workflow run `27932628093` for workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`; it includes the P3-4 five-artifact set with `gate-evidence.json`.

- [x] Trigger `.github/workflows/release-candidate.yml` manually with `workflow_dispatch` for the P3-5 commit.
- [x] Confirm the workflow is configured to run `npm ci`, `npm run ci`, `npm run dogfood`, and `npm run release:candidate -- --out-dir release-candidate`.
- [x] Confirm dogfood output is limited to fixtures, fake CLIs, and real local detection/profile certification without `--allow-real-run`.
- [x] Confirm `npm run release:candidate` is configured to create a tarball artifact, gate evidence, and release verification JSON but no `npm publish` step exists.
- [x] Download and review the uploaded artifacts:
  - `agent-cli-runtime-tarball`
  - `agent-cli-runtime-pack-metadata`
  - `agent-cli-runtime-package-files`
  - `agent-cli-runtime-gate-evidence`
  - `agent-cli-runtime-release-verification`
- [x] Recreate a review directory from downloaded artifacts and run `npm run release:verify -- --dir /tmp/agent-runtime-p3-5-remote-7rkBqm/normalized`.
- [x] Confirm `release-verification.json` uses `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, has `ok: true`, package file count `147`, and empty diagnostics.
- [x] Confirm `gate-evidence.json` uses `schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1"` and records `daemon:verify` plus `runtime:safety` with `packageSource: "installed-tarball"`.
- [x] Confirm no npm token, npm provenance publish, or registry credential is required.
- [x] Confirm artifacts use the documented 14-day retention window.

## Package boundary verification

- [x] `npm run package:check`.
- [x] `npm run release:verify -- --dir <release-candidate-or-downloaded-artifact-dir>`.
- [ ] `npm pack --json` and confirm package files do not include:
  - `.reference/`
  - `tests/`
  - `tests/fixtures/`
  - raw fixtures
  - fault fixtures
  - `repair-backups/`
  - raw corrupt samples
  - fixture secrets / private paths
  - raw real CLI output
  - real provider tokens or token-looking values.
- [ ] Confirm `dist/`, docs, examples, `scripts/dogfood.mjs`, README files, LICENSE, and release docs are included.
- [ ] Confirm `docs/release-report.md` is included.
- [ ] Confirm package root value exports remain limited to `createAgentRuntime`; replay, diagnostics, and storage inspection are facade methods plus public type exports only.
- [ ] Confirm built `dist/index.d.ts` does not re-export package-root types from `storage/`, parser, store, or adapter instance internals.

## Install smoke

- [ ] `repo_root="${GITHUB_WORKSPACE:-$(pwd -P)}"`.
- [ ] `tmp_dir="$(mktemp -d /tmp/agent-runtime-release-XXXXXX)"`.
- [ ] `pack_info="$(cd "$repo_root" && npm pack --json --ignore-scripts --pack-destination "$tmp_dir")"`.
- [ ] `package_file="$(printf '%s' "$pack_info" | node -e "const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(data[0].filename);")"`.
- [ ] `pushd "$tmp_dir"`.
- [ ] `npm init -y`.
- [ ] `npm install "$tmp_dir/$package_file" --no-save --ignore-scripts --no-audit --no-fund`.
- [ ] `node -e "(async()=>{ const m = await import('agent-cli-runtime'); if (typeof m.createAgentRuntime !== 'function') process.exit(1); console.log(typeof m.createAgentRuntime); })()"`.
- [ ] Create `consumer.ts` importing `createAgentRuntime`, `RunRequest`, `CreateGoalRequest`, and other public types from `agent-cli-runtime`.
- [ ] Run `tsc --noEmit` in the temporary consumer project.
- [ ] Create a fake consumer adapter/CLI and run installed-package library `run`, `createGoal`, `replayRunEvents`, `replayGoalEvents`, `exportDiagnostics`, and `inspectStore`.
- [ ] `node ./node_modules/.bin/agent-runtime agents --json` returns JSON.
- [ ] `node ./node_modules/.bin/agent-runtime doctor --json` returns an object with `ok`.
- [ ] `node ./node_modules/.bin/agent-runtime conformance --mode fixtures --json` returns stable adapter summaries.
- [ ] `node ./node_modules/.bin/agent-runtime conformance --mode fake --json` returns stable adapter summaries.
- [ ] `node ./node_modules/.bin/agent-runtime smoke --mode fixtures --json` returns `{ ok: true, mode: "fixtures" }`.
- [ ] The install smoke uses fake/local CLIs for deterministic `agents` and `doctor` checks; it does not require real auth.

## Examples smoke

- [ ] `node examples/library-run.js` succeeds after `npm run build`.
- [ ] `node examples/library-goal.js` succeeds after `npm run build`.
- [ ] `examples/cli-dogfood.md` documents fixtures, fake, and real-profile conformance.
- [ ] Examples contain no real token, real user path, provider secret, complete prompt dump, or raw real CLI output.

## Artifact review

- [ ] `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md` are present and up to date.
- [ ] `README.md` and `README.zh-CN.md` explain npm install, `npx`, and local checkout paths.
- [ ] `README.md` and `README.zh-CN.md` explain Codex / Claude / OpenCode configuration without token values.
- [ ] Claude Anthropic-compatible provider docs list environment variable names/placeholders only; no real token values.
- [ ] `docs/compatibility.md` is refreshed with the 2026-06-20 local real conformance detection/preflight evidence and does not describe skipped/auth-missing runs as real-run success.
- [x] `docs/ssot.md`, `docs/compatibility.md`, and `docs/production-readiness.md` are synced to current release-readiness status.
- [x] `docs/release-report.md` records local commands, remote workflow evidence, artifact checklist, package boundary, real CLI evidence boundary, known risks, and explicit non-goals.
- [x] `docs/production-readiness.md` names remaining known risks rather than treating skipped/preflight evidence as real run success.

## Final review notes

- [ ] No stable API guarantee language is used for this release track.
- [ ] Confirm no daemon/WAL/remote runtime promises are made in public docs.
- [ ] Confirm OpenDesign daemon-level gaps are named without implying parity.
- [ ] Confirm real conformance requires `--allow-real-run` and safely skips unauthorized CLIs.
- [ ] Confirm `conformance --mode real --agent all --json` without `--allow-real-run` does not launch real agent runs.
- [ ] Confirm optional real run docs use isolated cwd by default and make `--allow-real-run` the explicit account/network boundary.
- [ ] Confirm status-only exit `0` real smoke remains `unexpected_output`, not success.
- [ ] Confirm package install smoke is covered by `npm run dogfood` and remains available as the explicit `AGENT_RUNTIME_RUN_INSTALLED_PACKAGE_TESTS=1` contract test path.
- [ ] Confirm `store-repair --apply` remains opt-in, holds the local store lease while writing, creates atomic backups, refuses live owners, records redacted repair success/failure diagnostics, leaves original logs untouched on backup/rewrite failure, is idempotent, and does not claim WAL/database/daemon resume semantics.
- [ ] Confirm crash consistency tests cover manifest rename failure, JSONL append failure, repair backup/rewrite failure, fsync/fdatasync fallback, lock takeover/close behavior, corrupt lock read-only CLI inspection, and diagnostics redaction.
