# Agent CLI Compatibility Matrix

Status: P8-3 release-bound real CLI compatibility matrix verification; `0.1.0-alpha.4` is the release-prep package candidate
Last updated: 2026-06-30

This matrix records the CLI versions and behaviors that have been verified with the current runtime. Real agent CLIs change quickly; treat this file as dated compatibility evidence, not a permanent guarantee. P3-6 added a reviewable opt-in real smoke evidence path while keeping default release gates on detection/profile certification only. P3-7 freezes the API / CLI schema inventory and versioning policy in [docs/api-schema-contract.md](./api-schema-contract.md). P6 integrates the offline real compatibility evidence verifier into prepublish and release-candidate evidence; it does not refresh real CLI evidence during normal release gates. P7-5 marks `0.1.0-alpha.3` as the previous corrective pre-alpha release after the published `0.1.0-alpha.2` tarball shipped stale package docs from the pre-publish state. P9-5 prepares `0.1.0-alpha.4` as a release-prep package candidate; P9-6 fresh main release-candidate evidence is required after merge before any human publish decision. npm registry metadata and GitHub Releases are the source of truth for available versions and dist-tags. Raw CLI output, tokens, full prompts, auth env values, private paths, local temporary paths, artifact ids, and artifact digests are not committed to packaged docs.

## Evidence policy

Current status is P8 release-bound verification for the P8-2 real CLI compatibility matrix. `npm run compat:real:evidence` writes `.release-evidence/p8-2-real-cli-compatibility-matrix.json` with `schemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1"`. The matrix records package version, `gitSha`, input dirty state (`gitDirty` / `gitInputDirty`), output-file dirty state (`gitOutputDirty`), `dirtySummary`, and per-adapter executable resolution, version, auth, model source, capabilities, argv profile, parser mode, prompt transport, safe preflight, optional smoke, redacted diagnostics, and `needsVerification`. `npm run compat:real:evidence:verify` is the offline drift gate for the current matrix and still accepts legacy P6 evidence when passed through `--file`. It emits `agent-cli-runtime.realCompatibilityEvidenceVerification.v1`, does not launch real CLI runs, and rejects unsafe content, missing dirty-state metadata, skip/auth/unavailable states claimed as success, incomplete authenticated success evidence, missing adapter fields, missing required `needsVerification` items, and invalid repo-only package-boundary claims. Release review uses `--target-sha <sha> --max-age-hours 24 --release-strict` so a matrix can only support a local release conclusion when the evidence target SHA matches the release target SHA, the evidence is fresh, and the dirty policy is explicit. Local strict release candidates default to the matrix `gitSha` as the release target; remote clean-checkout release-candidate artifacts record `repo-only-skipped` when CI does not refresh or verify the local matrix.

- Current behavior is what is validated by `npm test` / typecheck / lint / build plus the current `npm pack`, package boundary, CLI JSON contract, and single-Node TypeScript consumer install-smoke checks.
- CI behavior is matrixed for Node.js 20/22/24 except dogfood, which runs once on Node.js 22 to avoid duplicating the slower install smoke.
- `npm test` uses Vitest's verbose reporter for contract coverage; slower installed-package gates and install smokes stay out of the Node.js matrix and run through single-Node release gates or explicit opt-in checks.
- `npm run prepublish:check` is the local guard that combines typecheck, lint, tests, build, `daemon:verify`, `runtime:safety`, offline P8-2 real compatibility matrix verification, dogfood, production audit, package boundary checks, packaged-docs verification, and pack dry-run.
- `npm run release:candidate` creates local release-candidate artifacts including `gate-evidence.json`, and `npm run release:verify -- --dir <path>` validates local or downloaded artifacts with stable redacted JSON. Local `release:candidate` defaults to `--real-compatibility-mode local-strict` and uses the matrix `gitSha` as its target unless `--target-sha <sha>` is supplied; GitHub Actions passes `--real-compatibility-mode repo-only-skipped`. `gate-evidence.json` records the compatibility gate as a redacted summary only: command, ok, verifier schema, verified evidence schema, target SHA status, freshness status, dirty policy status, diagnostic count/codes, and the fixed repo-only skip reason when CI did not refresh the matrix.
- `npm publish --dry-run --ignore-scripts --tag alpha` is a documented manual local dry-run check; it is not a remote CI gate.
- `docs/release-publish-runbook.md` documents the future human alpha publish path, dist-tag verification, rollback/deprecation/unpublish boundary, 2FA, trusted publishing, provenance, and token strategy; no real publish is performed in P2-13.
- `docs/daemon-ready-contract.md` documents embedding semantics for daemon/product shell callers without adding a hosted daemon surface.
- `npm run dogfood` installs the tarball into a temporary consumer project, runs `tsc --noEmit`, then executes fake-CLI library run/goal/replay/diagnostics smoke through the installed package.
- `npm run published:adapters:verify` installs the already published npm package from the npm registry into a temporary consumer and verifies built-in Codex, Claude, and OpenCode adapter detection, argv shape, stdin prompt transport, parser behavior, redaction, and per-adapter failure isolation with fake CLIs only.
- `npm run published:verify` generates post-publish evidence, and `npm run published:verify:evidence -- --dir <dir>` only verifies an existing local output or downloaded `agent-cli-runtime-published-verification` artifact. A bare verifier run without `published-verification/published-verification.json` is an expected redacted JSON guard failure.
- CI runs `daemon:verify`, `runtime:safety`, and dogfood once in a single Node.js 22 release-gates job; the Node.js 20/22/24 matrix does not repeat installed-package gates. CI does not run `compat:real:evidence:verify` because that verifier depends on repo-only `.release-evidence/`; remote release-candidate artifacts use the explicit `repo-only-skipped` gate summary, while dogfood remains an installed-package consumer gate.
- Remote GitHub Actions release-candidate evidence is commit-specific and recorded outside the package under `.release-evidence/`; historical runs only prove their own workflow head SHA and must not be reused for a different target SHA.
- Evidence modes are intentionally separate:
  - `fixtures`: offline parser contract fixtures; no real or fake CLI process is launched.
  - `fake`: temporary local fake CLIs through the real adapter argv/stdin/parser path; no network or real account is used.
  - `real local observed`: local executable/version/auth/model/profile certification by default; real runs only when `--allow-real-run` is explicit.
  - `package install smoke`: npm tarball installation into a temporary project, with fake/local CLI checks and no real provider secrets.
- P1-6 and earlier notes in this file are historical references for parser fixtures, timeout/reconnect evidence, and compatibility context; they are not equivalent to current "latest expected" contract assumptions.
- When using this file as runtime contract input, prioritize the `Status` section, explicit "Runtime notes" in each adapter, and the most recent command evidence.
- For changed behavior, add a new evidence row at the top of the section rather than keeping the old row as authoritative.

## P8-2 Current Real CLI Compatibility Matrix

P8-2 local evidence is generated with:

```bash
npm run compat:real:evidence
```

Authenticated smoke evidence is optional and must be explicitly authorized with all safety gates:

```bash
npm run compat:real:evidence -- --allow-real-run \
  --agent codex --expect-text "agent-runtime codex smoke ok" \
  --timeout-ms 120000
```

The current repo-only file is `.release-evidence/p8-2-real-cli-compatibility-matrix.json` with `schemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1"`. It stores redacted summaries only: no raw stdout/stderr, no prompt text, no full observed text tail, no private paths, no local temp paths, no token values, no Bearer values, and no auth environment assignment values. The file is outside the npm package boundary.

Current P8-2 matrix:

| Adapter | CLI version | Auth/model source | Safe preflight | Optional smoke | Current `needsVerification` decision |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.142.3` | auth `unknown`; models `live` | `real_run_skipped`; no authenticated run without `--allow-real-run` | `real_run_skipped`; no authenticated run attempted in the checked-in matrix | Keep `session` and `authProbe` unpromoted. Safe preflight verifies detection/profile only. |
| Claude Code | `2.1.178 (Claude Code)` | auth `missing`; models `fallback` | `auth_missing` | `real_run_skipped`; no authenticated run attempted | Keep `session.id` and `reasoning` unpromoted. Local auth is missing; provider-dependent reasoning behavior is still not a stable mapped flag. |
| OpenCode | `1.15.6` | auth `unknown`; models `live` | `real_run_skipped`; no authenticated run without `--allow-real-run` | `real_run_skipped`; no authenticated run attempted in P8-2 | Keep `extraAllowedDirs`, `session`, and `permissionPolicy.read-only` unpromoted. Safe preflight verifies detection/profile only. |

P8-2 verifier:

```bash
npm run compat:real:evidence:verify
npm run compat:real:evidence:verify -- --self-test
npm run compat:real:evidence:verify -- --target-sha <target-sha> --max-age-hours 24 --release-strict
```

The default verifier accepts structurally valid dirty repo-only evidence and reports `dirtyPolicy.status` rather than treating it as clean release evidence. The release-strict verifier requires a matching target SHA and a fresh `checkedAt` within the configured max age. Dirty changes limited to the matrix output file are reported as `self_dirty_only` and pass; dirty non-evidence inputs fail unless `--allow-dirty` is explicitly supplied. The verifier accepts `auth_missing`, `unavailable_executable`, `real_run_skipped`, and `needs_verification` as valid evidence states, but those states must not be counted as success. A successful optional smoke must include expected-text evidence and cwd-mutation evidence. Drift remains explicit: unsupported flags stay `unsupported_flag`, unproven fields stay in `needsVerification`, and unknown CLI changes are not guessed into argv.

## P6-1 Historical Real CLI Evidence

P6-1 local evidence was generated on 2026-06-23 with:

```bash
npm run compat:real:evidence -- --allow-real-run \
  --agent codex --expect-text "agent-runtime codex smoke ok" \
  --agent opencode --expect-text "agent-runtime opencode smoke ok"
```

The historical repo-only file is `.release-evidence/p6-1-real-cli-compatibility.json` with `schemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1"`. It stores redacted summaries only: no raw stdout/stderr, no prompt text, no full observed text tail, no private paths, no token values, no Bearer values, and no auth environment assignment values. It records legacy `gitHeadSha` plus `gitDirty` and before/after dirty summaries so a dirty-tree evidence file is not mistaken for clean-commit evidence. The command runs safe preflight by default; authenticated real runs are added only when `--allow-real-run`, `--agent <id>`, and `--expect-text <text>` are all explicit.

P6-2 verifies the same repo-only evidence with:

```bash
npm run compat:real:evidence:verify
npm run compat:real:evidence:verify -- --self-test
```

The verifier emits `schemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1"` and stable diagnostics. It rejects raw stdout/stderr fields, private paths, token/Bearer/auth env values, missing `gitHeadSha` / `gitDirty` / before-after dirty summaries, safe preflight skipped states claimed as success, authenticated success without expected-text and cwd-mutation evidence, missing Codex/Claude/OpenCode `needsVerification` audit items, and evidence that claims `.release-evidence/` belongs in the package boundary.

P6-3 does not regenerate this evidence. It only requires the existing repo-only evidence to pass the offline verifier before local prepublish and while creating release-candidate artifacts. `dogfood` does not run the verifier, so installed-package consumers never depend on `.release-evidence/`.

P6-1 safe preflight command results:

| Command | Result | Notes |
| --- | --- | --- |
| `node ./dist/cli/main.js agents --json` | parsed | Codex, Claude Code, and OpenCode detected; paths redacted. |
| `node ./dist/cli/main.js doctor --json` | `ok: true` | Overall local adapter catalog is usable. |
| `node ./dist/cli/main.js conformance --mode real --agent all --json` | `ok: true` | Safe detection/profile certification only; no authenticated real run launched. |
| `node ./dist/cli/main.js smoke --mode real --agent codex --json` | `real_run_skipped` | Safe preflight only; `skippedReason: "real_run_not_allowed"`. |
| `node ./dist/cli/main.js smoke --mode real --agent claude --json` | `auth_missing` | Local Claude Code auth missing; no run launched. |
| `node ./dist/cli/main.js smoke --mode real --agent opencode --json` | `real_run_skipped` | Safe preflight only; `skippedReason: "real_run_not_allowed"`. |

P6-1 adapter evidence:

| Adapter | CLI version | Auth/model source | Safe runClassification | Authenticated smoke | Historical `needsVerification` decision |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.142.0` | auth `unknown`; models `live` | `real_run_skipped` | `success`; expected text matched; cwd not mutated | Keep `session` and `authProbe` unpromoted. The successful run verifies the current prompt/stdin/parser/cwd-mutation path, not a stable session/resume or non-mutating auth probe. |
| Claude Code | `2.1.178 (Claude Code)` | auth `missing`; models `fallback` | `auth_missing` | not attempted | Keep `session.id` and `reasoning` unpromoted. Local auth is missing, and provider-dependent reasoning behavior is still not a stable mapped flag. |
| OpenCode | `1.15.6` | auth `unknown`; models `live` | `real_run_skipped` | `success`; expected text matched; cwd not mutated | Keep `extraAllowedDirs`, `session`, and `permissionPolicy.read-only` unpromoted. The successful run verifies stdin/parser/cwd-mutation behavior, not explicit extra-dir/session/read-only/workspace-write flags. |

P6-1 drift analysis:

- Codex version changed from the previous documented `codex-cli 0.142.0-alpha.6` to `codex-cli 0.142.0`; that model probe returned live models and no unsupported flag diagnostic.
- Claude Code remains executable at `2.1.178`, but auth is still `missing`; `auth_missing` is evidence, not success.
- OpenCode remains `1.15.6`; live model probe worked and no unsupported flag diagnostic appeared.
- No `unsupported_flag` or `needs_verification` diagnostic was produced by the P6-1 safe preflight. Existing `needsVerification` entries remain because they are unproven capabilities, not because that CLI preflight failed.

## P3-6 Real CLI Opt-In Smoke Evidence

P3-6 is historical after P6-1. It changed the evidence path, not the adapter invocation profiles:

- `smoke --mode real --agent <id> --json` performs detection/profile certification and reports `runClassification: "real_run_skipped"` unless `--allow-real-run` is explicit.
- `smoke --mode real --agent <id> --allow-real-run --expect-text <safe_text> --json` is the recommended authenticated real-run evidence command.
- Real smoke uses isolated temp cwd by default, requests read-only behavior, checks cwd mutation, and requires expected text for success. A custom `--prompt` or `--prompt-file` without `--expect-text` cannot pass solely because the CLI exits `0`.
- Real smoke emits `schemaVersion: "agent-runtime.realSmoke.v1"` with `adapter`, `version`, `auth`, `modelsSource`, `runClassification`, `expectedTextMatched`, redacted/truncated `observedTextTail`, `cwdMutationChecked`, `cwdMutated`, `diagnosticsCount`, `skippedReason`, and `failureReason`.
- Real smoke summaries do not include prompt text, token values, private cwd, raw stdout/stderr, or the final run record.
- Explicit classifications include `auth_missing`, `unavailable_executable`, `unsupported_flag`, `unexpected_output`, `cwd_mutated`, `needs_verification`, and `real_run_skipped`.
- CI, dogfood, prepublish, and `release:candidate` still do not pass `--allow-real-run`.

Local P3-6 real-smoke evidence on 2026-06-22:

| Adapter | Command shape | runClassification | expectedTextMatched | cwdMutated | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `smoke --mode real --agent codex --allow-real-run --expect-text <safe_text> --timeout-ms 120000 --json` | `success` | `true` | `false` | Latest same-machine opt-in smoke matched the expected text and did not mutate the isolated cwd; a 30s default-timeout retry can still classify as `timeout`. |
| Claude Code | `smoke --mode real --agent claude --allow-real-run --expect-text <safe_text> --json` | `auth_missing` | `null` | `null` | Preflight skipped before launch because local Claude Code auth is missing. |
| OpenCode | `smoke --mode real --agent opencode --allow-real-run --expect-text <safe_text> --timeout-ms 120000 --json` | `success` | `true` | `false` | Latest same-machine opt-in smoke matched the expected text and did not mutate the isolated cwd; a 30s default-timeout retry can still classify as `timeout`; explicit read-only/workspace-write flags still remain unverified. |

## P2-12 Remote Release Candidate Evidence Closure

P2-12 remote audit evidence on 2026-06-20:

- Commit: `2f8832119b4ebdb8393077052560589a398ebf56`.
- Run id: `27869580048`.
- Run URL: `https://github.com/iiwish/agent-cli-runtime/actions/runs/27869580048`.
- Run event: `workflow_dispatch`.
- Run status/conclusion: `completed` / `success`.
- Run created/updated: `2026-06-20T11:19:33Z` / `2026-06-20T11:20:40Z`.
- Uploaded artifacts: `agent-cli-runtime-tarball`, `agent-cli-runtime-pack-metadata`, `agent-cli-runtime-package-files`, `agent-cli-runtime-release-verification`.
- Downloaded artifact re-verification: `npm run release:verify -- --dir <normalized-artifact-dir>`.
- Verification result: `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, `ok: true`, package file count recorded in package-out evidence, and empty diagnostics.

The GitHub download layout used one directory per artifact name; the downloaded files were copied into a temporary normalized review directory before local verification.

## P2-13 Alpha Publish Readiness Decision

P2-13 does not change adapter compatibility. It keeps the pre-alpha runtime behavior and adds only publish-readiness evidence:

- package metadata includes repository, homepage, bugs, keywords, Node engine, `publishConfig.tag: "alpha"`, package root `exports`, CLI `bin`, and the existing `files` boundary;
- the package root value export remains `createAgentRuntime` only;
- `docs/release-publish-runbook.md` records future real publish commands without executing them in this stage;
- `npm publish --dry-run --ignore-scripts --tag alpha` is the only publish simulation for P2-13;
- `.github/workflows/ci.yml` and `.github/workflows/release-candidate.yml` remain artifact/check workflows and do not publish npm or require registry credentials;
- trusted publishing and provenance are future choices, not configured evidence for P2-13.

## P3-5 Remote Release Evidence Closure

P3-5 does not change adapter invocation compatibility. It closes workflow-head release-candidate evidence:

- `.github/workflows/release-candidate.yml` run `27932628093` completed successfully on workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`.
- The run uploaded `agent-cli-runtime-tarball`, `agent-cli-runtime-pack-metadata`, `agent-cli-runtime-package-files`, `agent-cli-runtime-gate-evidence`, and `agent-cli-runtime-release-verification`.
- Downloaded artifacts were normalized into a local review directory and passed `npm run release:verify -- --dir <normalized-artifact-dir>`.
- Verification result: `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, `ok: true`, package file count `147`, empty diagnostics, and gate evidence for `daemon:verify` plus `runtime:safety` with `packageSource: "installed-tarball"`.
- Local real conformance after the remote run still did not launch authenticated real agent runs: Codex and OpenCode reported `real_run_skipped`; Claude Code reported `auth_missing`.

## P3-4 CI / Release Gate Alignment

P3-4 does not change adapter invocation compatibility. It changes release evidence handling:

- `.github/workflows/ci.yml` keeps the Node.js 20/22/24 matrix for normal checks and moves `npm run daemon:verify`, `npm run runtime:safety`, and `npm run dogfood` into one Node.js 22 release-gates job.
- `.github/workflows/release-candidate.yml` remains `workflow_dispatch` only and uploads five artifacts for current P3-4 candidates: `agent-cli-runtime-tarball`, `agent-cli-runtime-pack-metadata`, `agent-cli-runtime-package-files`, `agent-cli-runtime-gate-evidence`, and `agent-cli-runtime-release-verification`.
- `gate-evidence.json` uses `schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1"` and records `npm run daemon:verify` plus `npm run runtime:safety` with installed-package output schema versions.
- `npm run release:verify` rejects missing or incomplete gate evidence while keeping package boundary and secret/private-path checks.
- P3-4 remote evidence was closed by P3-5 run `27932628093` for the workflow head SHA.
- P3-4 does not run authenticated real agent runs, publish npm, configure npm tokens, configure trusted publishing, or add daemon/API server behavior.

## P3-1 Daemon-Ready Contract Freeze

P3-1 does not change adapter invocation compatibility. It freezes daemon-facing runtime contracts and adds versioned store-health / CLI-error schemas:

- daemon embedding contract: [docs/daemon-ready-contract.md](./daemon-ready-contract.md);
- store health JSON: `schemaVersion: "agent-runtime.storeHealth.v1"`;
- CLI JSON usage error: `schemaVersion: "agent-runtime.cliError.v1"`;
- package root value export remains limited to `createAgentRuntime`;
- no daemon/API server, database, WAL, remote worker, UI, telemetry, npm publish, publish workflow, npm token, or trusted publishing configuration is added.

Current local real-CLI detection/preflight evidence from `node ./dist/cli/main.js conformance --mode real --agent all --json` on 2026-06-22:

| Adapter | CLI version | Auth/model source | runClassification | skippedReason | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.142.0-alpha.6` | auth `unknown`; models `live` | `real_run_skipped` | `real_run_not_allowed` | Detection/profile passed; no real run launched because `--allow-real-run` was not supplied. Session and auth probe remain `needsVerification`. |
| Claude Code | `2.1.178 (Claude Code)` | auth `missing`; models `fallback` | `auth_missing` | `auth_missing` | Detection/profile passed; run skipped before launch because local auth is missing. `--session-id` and reasoning remain `needsVerification`. |
| OpenCode | `1.15.6` | auth `unknown`; models `live` | `real_run_skipped` | `real_run_not_allowed` | Detection/profile passed; no real run launched because `--allow-real-run` was not supplied. Extra dirs, session, and read-only/workspace-write flags remain `needsVerification`. |

## P2-11 Release Candidate Artifact Verification And Remote Evidence Intake

Release-candidate audit evidence:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run package:check
npm run dogfood
npm run prepublish:check
npm run release:candidate -- --out-dir release-candidate
npm run release:verify -- --dir release-candidate
npm pack --dry-run
npm publish --dry-run --ignore-scripts --tag alpha
node ./dist/cli/main.js conformance --mode real --agent all --json
```

P2-11 release-candidate semantics:

- `.github/workflows/ci.yml` keeps the Node.js 20/22/24 matrix for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run.
- The CI dogfood gate runs `npm run dogfood` once on Node.js 22 and does not pass `--allow-real-run`.
- `.github/workflows/release-candidate.yml` remains `workflow_dispatch` only. It runs `npm ci`, `npm run ci`, and `npm run dogfood`, then creates `npm pack --json` output, runs `npm run release:verify`, and uploads the tarball, pack metadata, package file list, and release verification artifacts.
- No workflow step runs `npm publish`, sets `NODE_AUTH_TOKEN`, or requires real Codex/Claude/OpenCode installation.
- [docs/release-report.md](./release-report.md) is the release-candidate evidence entrypoint for local commands, local generation, downloaded artifact verification, remote workflow expectations, package boundary, real CLI evidence boundaries, known risks, and non-goals.
- Remote GitHub Actions evidence must be manually triggered and reviewed; it is not treated as passed merely because workflow files exist locally.

## P2-9 Release Candidate API And Consumer Compatibility Evidence

Release-candidate gates:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run ci
npm run dogfood
npm run prepublish:check
npm run package:check
node ./dist/cli/main.js conformance --mode real --agent all --json
npm pack --dry-run
```

P2-9 release-candidate semantics:

- Package root value exports remain limited to `createAgentRuntime`; root type exports come from documented public types and facade/adapter-authoring types, not storage/parser/store internals.
- The published tarball may include internal `dist/` implementation files, but only the package root API is documented as stable for consumers.
- The package install smoke uses `npm install <tarball> --no-save --ignore-scripts --no-audit --no-fund`.
- The consumer TypeScript smoke imports `createAgentRuntime`, `RunRequest`, `CreateGoalRequest`, and other public types from the package root, then runs `tsc --noEmit` from the temporary project.
- The installed-package fake library smoke executes run, goal, replay, diagnostics export, and store health through a consumer-supplied fake adapter; it does not require Codex, Claude, OpenCode, network, or real credentials.
- CLI JSON success contracts are covered for `agents --json`, `doctor --json`, `conformance --mode fixtures --json`, `conformance --mode fake --json`, `store-health --json`, and `store-repair --dry-run --json`.
- CLI JSON error contracts are covered for missing required parameters and mutually exclusive `store-repair --apply --dry-run`; errors return exit code `1`, a short parseable JSON object, and redacted messages.
- `.github/workflows/ci.yml` keeps the Node.js 20/22/24 matrix for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run.
- The official test script is `vitest run --reporter=verbose --no-file-parallelism --testTimeout 30000`, keeping full-suite progress visible while leaving slower installed-package gates to single-Node release checks.
- The CI dogfood gate runs `npm run dogfood` once on Node.js 22. It does not pass `--allow-real-run`, so real mode is limited to executable/version/auth/model/profile certification and runnable adapters report `real_run_skipped`.
- `.github/workflows/release-candidate.yml` is `workflow_dispatch` only. It runs `npm ci`, `npm run ci`, and `npm run dogfood`, then creates `npm pack --json` output and uploads the tarball, pack metadata, and package file list as artifacts.
- No workflow step runs `npm publish`, requests an npm token, or requires real Codex/Claude/OpenCode installation.
- `scripts/check-package-boundary.mjs` checks the pack dry-run file list and scans docs/examples/scripts for real token-like values, Bearer values, auth environment assignment values, and private user paths.

Historical local real-CLI detection/preflight evidence from `node ./dist/cli/main.js conformance --mode real --agent all --json` on 2026-06-20:

| Adapter | CLI version | Auth/model source | runClassification | skippedReason | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.142.0-alpha.1` | auth `unknown`; models `live` | `real_run_skipped` | `real_run_not_allowed` | Detection/profile passed; no real run launched because `--allow-real-run` was not supplied. Session and auth probe remain `needsVerification`. |
| Claude Code | `2.1.178 (Claude Code)` | auth `missing`; models `fallback` | `auth_missing` | `auth_missing` | Detection/profile passed; run skipped before launch because local auth is missing. `--session-id` and reasoning remain `needsVerification`. |
| OpenCode | `1.15.6` | auth `unknown`; models `live` | `real_run_skipped` | `real_run_not_allowed` | Detection/profile passed; no real run launched because `--allow-real-run` was not supplied. Extra dirs, session, and read-only/workspace-write flags remain `needsVerification`. |

## Summary

| Adapter | CLI path | CLI version tested | Detection | Run smoke | Goal smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | redacted local app path | `codex-cli 0.142.3` | Pass | Safe preflight reports `real_run_skipped` without `--allow-real-run`; optional authenticated smoke is not present in the checked-in matrix. | Not run in P8-2 | Uses `codex exec --json --skip-git-repo-check` with stdin prompt and `-C <cwd>`. Live model probe passed. Session and auth probe remain `needsVerification`. |
| Claude Code | redacted local app path | `2.1.178 (Claude Code)` | Pass with `auth_missing` diagnostic | Blocked by local auth | Not run in P8-2 | `claude auth status` returned auth missing in the local P8-2 certification. Conformance skips before launching Claude. |
| OpenCode | redacted local app path | `1.15.6` | Pass | Safe preflight reports `real_run_skipped` without `--allow-real-run`; optional authenticated smoke not run in P8-2. | Not run in P8-2 | Live model source is available. Explicit read-only/workspace-write flags, extra dirs, and session remain unverified. |

P5-2 published adapter evidence uses fake CLIs only. It verifies that the published package's built-in adapter invocation profiles still match the documented shapes and that prompts stay on stdin, but it is not authenticated real CLI compatibility success evidence.

## Verified Invocation Shapes

### Codex

```bash
codex exec --json --skip-git-repo-check -C <cwd>
```

Runtime notes:

- prompt transport: stdin text
- model flag: `--model <id>`
- workspace-write policy: `--sandbox workspace-write`
- extra dirs: repeated `--add-dir <path>`
- reasoning effort: `-c model_reasoning_effort="<effort>"`
- session/resume: not mapped; profile marks session support as `needsVerification`
- auth probe: no stable non-mutating auth probe is enabled; auth status is `unknown`
- model probe: `codex debug models`; parser keeps only model `slug`/`display_name` and ignores hidden models
- parser note: transient `Reconnecting... n/5` structured error frames are normalized to `status: reconnecting`; they are not fatal if the run later emits text/usage and exits `0`
- 2026-06-27 P8-2 local certification: executable/version/model preflight passed for `codex-cli 0.142.3`; safe preflight reports `real_run_skipped` without `--allow-real-run`.
- The checked-in P8-2 matrix does not include an authenticated Codex smoke. Safe preflight verifies current executable/version/model/profile behavior only; session/resume and auth probe remain `needsVerification`.

### Claude Code

```bash
claude -p --input-format stream-json --output-format stream-json --verbose
```

Runtime notes:

- prompt transport: stdin JSONL
- model flag: `--model <id>`
- headless-auto policy: `--permission-mode bypassPermissions`
- auth probe: `claude auth status`
- capability probe: `claude -p --help`; current local output includes the tracked capability flags and produced no capability diagnostics
- model probe: no live model probe; fallback aliases are `default`, `sonnet`, `opus`, `haiku`
- `--resume` is the verified resume path in fixtures; `--session-id` is represented in the profile as `needsVerification` and is not emitted by `buildArgs()`
- 2026-06-27 P8-2 local certification: executable/version/auth preflight passed for `2.1.178 (Claude Code)`, but auth was `missing`; no authenticated real run was launched.
- DeepSeek or another Anthropic-compatible provider can be supplied through environment variables. Keep this as names and placeholders only; do not commit real token values, account-specific URLs, or private model aliases:

```bash
export ANTHROPIC_BASE_URL=<anthropic-compatible-base-url>
export ANTHROPIC_MODEL=<model-name>
export ANTHROPIC_DEFAULT_OPUS_MODEL=<model-name>
export ANTHROPIC_DEFAULT_SONNET_MODEL=<model-name>
export ANTHROPIC_DEFAULT_HAIKU_MODEL=<model-name>
export CLAUDE_CODE_SUBAGENT_MODEL=<model-name>
export CLAUDE_CODE_EFFORT_LEVEL=<effort>
```

Set the provider's documented Anthropic-compatible auth token environment variable outside committed docs and fixtures.

### OpenCode

```bash
opencode run --format json --dir <cwd>
```

Runtime notes:

- prompt transport: stdin text
- binary candidates: `opencode-cli`, then `opencode`
- model flag: `-m <id>`
- headless-auto policy: `--dangerously-skip-permissions`
- model probe: `opencode models`
- read-only and workspace-write are left to OpenCode defaults until stable permission flags are verified
- extra dirs and session/resume are not mapped; profile marks them as `needsVerification`
- 2026-06-27 P8-2 local certification: executable/version/model preflight passed for `opencode` 1.15.6; safe preflight reports `real_run_skipped` without `--allow-real-run`.
- P8-2 does not include an authenticated OpenCode smoke. Keep prompt out of argv; do not switch to positional argv prompt. OpenCode explicit read-only/workspace-write flags, extra dirs, and session remain unverified.

## Smoke Commands

Build the package first:

```bash
npm ci
npm run build
```

Detect installed agents:

```bash
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
node ./dist/cli/main.js smoke --mode detection --json
```

Production conformance gates without launching real agent CLIs:

```bash
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
```

Durable store query/replay smoke with fake or test-generated records:

```bash
node ./dist/cli/main.js runs --storage-dir .agent-runtime --json
node ./dist/cli/main.js run-status run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-run run_123 --storage-dir .agent-runtime --jsonl
node ./dist/cli/main.js goals --storage-dir .agent-runtime --json
node ./dist/cli/main.js goal-status goal_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-goal goal_123 --storage-dir .agent-runtime --jsonl
node ./dist/cli/main.js store-health --storage-dir .agent-runtime --json
node ./dist/cli/main.js store-lock --storage-dir .agent-runtime --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --dry-run --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --apply --json
node ./dist/cli/main.js diagnostics run run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js diagnostics goal goal_123 --storage-dir .agent-runtime --json --out diagnostics-goal_123.json
```

Optional real non-mutating run certification, only when the relevant local CLI auth is available. Real run execution is disabled unless `--allow-real-run` is present; without `--cwd`, it uses an isolated temp directory and runtime-requested `read-only` behavior:

```bash
node ./dist/cli/main.js conformance \
  --mode real \
  --agent codex \
  --allow-real-run \
  --expect-text "agent-runtime codex smoke ok" \
  --json \
  --timeout-ms 30000
```

`conformance --mode real` without `--allow-real-run` performs real local detection/profile certification and reports `runClassification: "real_run_skipped"` for runnable adapters. With `--allow-real-run`, it also executes the selected real CLI run and validates expected text plus cwd mutation evidence. It returns `schemaVersion: "agent-runtime.conformance.v1"` plus stable per-adapter fields: `adapter`, `version`, `resolvedExecutable`, `auth`, `modelsSource`, `capabilities`, `argvProfile`, `promptTransport`, `parserMode`, `runClassification`, `expectedTextMatched`, `observedTextTail`, `cwdMutationChecked`, `cwdMutated`, `diagnosticsCount`, `diagnostics`, `skippedReason`, and `failureReason`. `--agent all` keeps one adapter fail/skip isolated in the summary. Use `smoke --mode real --allow-real-run --expect-text <safe_text>` for focused opt-in real-run evidence.

P2-4 drift diagnostics:

- `unsupported_flag`: a tracked capability flag is missing from help output or a real run reports an unsupported flag/argument.
- `needs_verification`: version/help shape is outside the current profile; do not infer new flags from it.
- parser/stream failures: structured stream errors become run diagnostics and are counted in conformance.

All conformance and real-smoke output is redacted recursively. Do not commit real username paths, tokens, Bearer values, auth-token env assignments, full prompts, raw CLI output, final run records from real smoke, or unredacted observed tails.

Equivalent lower-level run command:

```bash
tmp="$(mktemp -d)"
node ./dist/cli/main.js run \
  --agent codex \
  --cwd "$tmp" \
  --permission read-only \
  --timeout-ms 30000 \
  --stream jsonl \
  --diagnostics \
  --prompt "Reply exactly: agent-runtime codex smoke ok. Do not edit files."
```

Preferred OpenCode real smoke:

```bash
node ./dist/cli/main.js smoke \
  --mode real \
  --agent opencode \
  --allow-real-run \
  --json \
  --diagnostics \
  --timeout-ms 30000
```

Equivalent OpenCode smoke:

```bash
tmp="$(mktemp -d)"
node ./dist/cli/main.js run \
  --agent opencode \
  --cwd "$tmp" \
  --permission read-only \
  --timeout-ms 30000 \
  --stream jsonl \
  --diagnostics \
  --prompt "Reply exactly: agent-runtime opencode smoke ok. Do not edit files."
```

Run smoke in an isolated temp directory:

```bash
tmp="$(mktemp -d)"
node ./dist/cli/main.js run \
  --agent codex \
  --cwd "$tmp" \
  --permission workspace-write \
  --stream jsonl \
  --prompt "Create smoke.txt containing exactly: agent-runtime smoke ok"
```

Goal smoke:

```bash
tmp="$(mktemp -d)"
node ./dist/cli/main.js goal \
  --agent codex \
  --cwd "$tmp" \
  --permission workspace-write \
  --stream jsonl \
  --prompt "Create one file named goal-smoke.txt containing exactly: agent-runtime goal smoke ok"
```

## Known MVP Gaps

- Durable run/goal replay storage is opt-in via `storageDir`; default runtime behavior remains memory-only.
- Durable `storageDir` writer mode uses a local single-writer lease. It prevents accidental same-machine multi-writer corruption but is not a distributed lock, daemon, WAL, or transactional database.
- Read-only CLI inspection paths do not acquire the writer lease and are intended to work while another live owner is active.
- P1-6 verifies the real smoke harness against stronger fake CLI contract tests and local real Codex/OpenCode smoke runs with expected text matched and no cwd mutation. It does not prove that a specific real CLI can complete authenticated write tasks in the local environment, nor that OpenCode exposes a verified explicit read-only flag.
- JSONL append is still a simple append-only file and not segmented. Default durability is `relaxed`; callers can request `storage.durability: "fsync"` for best-effort fdatasync/fsync after manifest writes and event appends, but there is no WAL or group commit.
- There is still no long-lived daemon, database, WAL, segment compaction, automatic manifest reconciliation, or live process resume. `store-repair --apply` is explicit, local JSONL-only repair with backups and live-owner refusal.
- Package root is intentionally small for pre-alpha: runtime facade and public types are exported; built-in adapter values and parser/detection helpers remain internal implementation details.
- CLI event JSONL is versioned as `agent-runtime.event.v1` for both live stream and replay commands; library replay APIs continue to return legacy `ReplayEvent<T>` records.
- CLI remains a thin local smoke/scripting wrapper over the library API, not a daemon or long-lived service.
- Real CLI auth and model availability depend on the user's local installation.
- Runtime-side validation executes shell commands supplied by task graphs; callers should only use it with trusted objectives or trusted planners.
- Parser coverage is fixture-based plus prior local smoke captures; more real stream captures should be added before a stable release.
- Historical P0-4 Codex smoke showed reconnect/timeout behavior; parser fixtures and timeout diagnostics preserve that coverage.
- Historical P0-4 OpenCode smoke timed out with zero parsed events, but P1-5 local `opencode` 1.15.6 real smoke passed and verifies stdin prompt support for this version.
- Claude Code run/goal smoke is blocked by local auth until `claude auth status` reports a logged-in account or a supported Anthropic-compatible provider env is supplied.

## P2-4 Real CLI Compatibility Certification Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
```

Covered behavior:

- `fixtures`, `fake`, and `real local observed` conformance evidence are distinct and labeled by `mode`;
- current P3-1 local `real --agent all --json` observed: Codex `codex-cli 0.142.0-alpha.6` detected with live models and `real_run_skipped`; Claude `2.1.178` detected with `auth_missing`; OpenCode `1.15.6` detected with live models and `real_run_skipped`;
- historical opt-in `real --agent codex --allow-real-run --expect-text "agent-runtime codex smoke ok" --json` observed: `success`, expected text matched, cwd not mutated, diagnostics count 0; P3-1 did not rerun an authenticated real agent run;
- `real --agent all --json` performs detection/profile certification without launching real runs unless `--allow-real-run` is explicit;
- per-adapter summaries include resolved executable, auth state, models source, capabilities, argv profile, prompt transport, parser mode, run classification, diagnostics count, compact diagnostics, and skip/fail reason;
- one adapter being unavailable, auth-missing, unsupported, or failed does not prevent other adapter summaries from being reported;
- tracked flag drift reports `unsupported_flag`; unfamiliar version shape reports `needs_verification`; stream/parser errors become actionable diagnostics;
- `--expect-text` failures include only a redacted/truncated `observedTextTail`;
- conformance JSON redacts token-like values, Bearer values, auth env assignments, prompts, private absolute paths, and cwd mutation secret-looking filenames;
- `.reference/`, tests, fixtures, and secret-looking values remain excluded from npm pack.

## P2-5 Release Candidate Dogfood Evidence

Release-candidate gate:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run ci
npm run dogfood
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
npm pack --dry-run
```

Dogfood coverage:

- `npm run dogfood` rebuilds before running CLI gates;
- fixtures conformance remains fully offline;
- fake conformance runs temporary fake CLIs through real adapter argv/stdin/parser paths;
- real conformance with `--agent all` performs detection/profile certification only because `--allow-real-run` is not supplied;
- `smoke --mode fixtures`, `agents --json`, and `doctor --json` remain runnable local checks;
- `examples/library-run.js` demonstrates `detect -> run -> replay/diagnostics/store health` using a fake Codex CLI;
- `examples/library-goal.js` demonstrates `createGoal -> task graph -> final result/replay/diagnostics` using a fake Codex CLI;
- package install smoke verifies `import('agent-cli-runtime')`, installed CLI fixtures conformance, installed fake conformance, and installed fixtures smoke from a packed tarball;
- package dry-run includes docs, examples, and `scripts/dogfood.mjs`, and excludes `.reference/`, `tests/`, test fixtures, raw real CLI output, private paths, and secrets.

Known compatibility/readiness risks:

- status-only real smoke exit `0` is intentionally classified as `unexpected_output` when no `text_delta` is observed;
- real conformance preflight can report unavailable/auth-missing on a specific machine because executable, auth, network, or proxy state is local;
- optional authenticated real runs must be performed manually with `--allow-real-run`;
- OpenCode explicit read-only/workspace-write flags, extra dirs, and session/resume remain unverified.

## P2-2 Local Supervisor Lease Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js store-health --storage-dir <temp-dir> --json
```

Covered behavior:

- two writer runtimes for the same `storageDir` conflict with a concise actionable error;
- stale lock takeover records a redacted storage diagnostic;
- read-only store inspection commands do not require the writer lock;
- live-owner active records are not interrupted by another writer attempt;
- stale-owner active runs/goals become interrupted, with pending/running goal tasks canceled;
- active run manifests receive heartbeat owner updates while the run is active;
- shutdown marks the lease closed;
- `store-health` reports lock/lease and active owner status;
- diagnostics `supervisorSummary` includes redacted owner/lease status;
- lock diagnostics and package dry-run remain secret/path safe.

## P2-3 Event Contract Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js smoke --mode fixtures --json
```

Covered behavior:

- `run --stream jsonl` and `replay-run --jsonl` emit `schemaVersion: "agent-runtime.event.v1"` envelopes with `scope.kind: "run"`;
- `goal --stream jsonl` and `replay-goal --jsonl` emit the same envelope shape with `scope.kind: "goal"`;
- terminal envelopes use stable `terminal.result` and `terminal.reason` values for success, timeout, canceled, interrupted, validation failure, execution failure, unavailable, auth missing, and task graph invalid cases;
- `runtime.replayRunEvents()` and `runtime.replayGoalEvents()` keep the old `ReplayEvent<T>` return shape;
- diagnostics bundles remain `agent-runtime.diagnostics.v1` and redact storage diagnostics, supervisor summaries, adapter summaries, and attempt evidence;
- conformance JSON includes `schemaVersion: "agent-runtime.conformance.v1"` and stable per-adapter summary fields;
- store health JSON includes `schemaVersion: "agent-runtime.storeHealth.v1"`, store repair remains `agent-runtime.storeRepair.v1`, and CLI JSON errors use `agent-runtime.cliError.v1`;
- package root value exports remain limited to `createAgentRuntime`;
- package dry-run excludes `.reference/`, tests, fixtures, and secret-looking values.

## P1-1 Durable Store Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Covered behavior:

- store directories are created automatically;
- terminal run and goal records are readable from a new runtime instance;
- `replayRunEvents()` / `replayGoalEvents()` return stable replay envelopes with `id`, `sequence`, `timestamp`, and `runId` / `goalId`;
- CLI `runs` / `goals` / `run-status` / `goal-status` / `replay-run --jsonl` / `replay-goal --jsonl` can read records from a previous process;
- corrupt manifests and JSONL records are isolated to the affected record and surfaced as diagnostics;
- stored diagnostics and validation evidence are redacted before writing to disk;
- `npm pack --dry-run` excludes `.reference/` and test fixtures.

## P1-2 Goal Scheduler Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Covered behavior:

- independent ready tasks start concurrently when `maxConcurrentTasks=2`;
- `maxConcurrentTasks=1` preserves stable serial order;
- dependent tasks do not start before dependencies finish successfully;
- failed upstream tasks block dependents;
- retryable failures produce multiple attempts and can eventually succeed;
- non-retryable failures do not retry;
- `cancelGoal()` cancels running task runs and queued ready tasks consistently;
- `shutdown()` leaves active goal/run lists empty and durable reload preserves terminal state;
- replay includes stable `task_attempt_started` / `task_attempt_finished` events with `id`, `sequence`, `timestamp`, and `goalId`;
- corrupt/partial JSONL logs replay the valid prefix and surface `AGENT_EVENT_LOG_CORRUPT`;
- package root value exports remain limited to `createAgentRuntime`;
- `npm pack --dry-run` excludes `.reference/` and test fixtures/secrets.

## P1-3 Planner And CLI Conformance Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
node ./dist/cli/main.js smoke --mode detection --json
node ./dist/cli/main.js smoke --mode fixtures --json
```

Covered behavior:

- task graph validation rejects invalid `dependencies`, `allowedFiles`, `validationCommands`, `agentId`, and task-level `retryPolicy` field types with task id and field name in the error;
- planner Markdown fenced JSON and surrounding prose with one JSON object are accepted;
- multiple JSON objects and malformed JSON fail clearly without swallowing unrelated text or emitting oversized raw planner output;
- planner parse/validation failure emits `scheduler_error` with `AGENT_TASK_GRAPH_INVALID`, writes goal diagnostics, and finishes the goal as failed without task attempts;
- Codex / Claude / OpenCode parser conformance fixtures cover normal output, structured error, usage, tool/file event, partial line, and unknown event;
- Codex / Claude / OpenCode `buildArgs` tests confirm long prompts stay out of argv while cwd/model/permission/session/extra dir mappings remain explicit;
- `smoke --mode detection` and `smoke --mode fixtures` are offline-safe; P3-6 changed `smoke --mode real` so it performs detection/profile certification without `--allow-real-run` and launches real CLIs only when `--allow-real-run` is explicit;
- Claude auth missing remains an expected `doctor` diagnostic and does not fail the overall doctor result when the adapter itself is available;
- package root value exports remain limited to `createAgentRuntime`;
- `npm pack --dry-run` excludes `.reference/`, test fixtures/secrets, and real smoke output.

## P1-4 Store Health And Diagnostics Bundle Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js store-health --storage-dir <tmp> --json
node ./dist/cli/main.js smoke --mode fixtures --json
node ./dist/cli/main.js doctor --json
```

Covered behavior:

- empty store health returns `ok: true`;
- corrupt run and goal manifests do not crash runtime load and remain visible to health scan;
- corrupt/partial run JSONL keeps the replayable prefix and reports file, line, reason, and retained event count without storing the raw bad line;
- terminal manifest missing terminal event and terminal event with non-terminal manifest are reported as warnings, not auto-repaired;
- run diagnostics bundle contains redacted manifest, event summary, diagnostics, and environment-safe adapter summary;
- goal diagnostics bundle includes redacted task attempt evidence;
- `diagnostics ... --out <file>` writes a valid redacted bundle via atomic temp-file-and-rename;
- health and bundle output redact token-looking values, Bearer values, auth-token assignments, and absolute private paths;
- package root value exports remain limited to `createAgentRuntime`;
- `npm pack --dry-run` excludes `.reference/`, test fixtures/secrets, and real smoke output.

## P1-5 Real Smoke And Profile Evidence

Commands verified in this stage:

```bash
npm test -- tests/adapters-and-parsers.test.ts tests/run-scheduler.test.ts tests/contract.test.ts
npm run build
node ./dist/cli/main.js smoke --mode fixtures --json
node ./dist/cli/main.js smoke --mode detection --json
node ./dist/cli/main.js doctor --json
node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --expect-text "agent-runtime codex smoke ok" --json --diagnostics --timeout-ms 30000
node ./dist/cli/main.js smoke --mode real --agent opencode --allow-real-run --expect-text "agent-runtime opencode smoke ok" --json --diagnostics --timeout-ms 30000
```

Observed local results on 2026-06-17:

- Codex: available, `codex-cli 0.140.0-alpha.19`, live model source, auth status `unknown`, read-only real smoke `runClassification: "success"` in isolated temp cwd.
- Claude Code: available, `2.1.178 (Claude Code)`, auth status `missing`; real run intentionally skipped by preflight until local auth is available.
- OpenCode: available through fallback binary `opencode`, version `1.15.6`, live model source, real smoke `runClassification: "success"` in isolated temp cwd with runtime-requested read-only behavior; explicit read-only flag remains unverified.

Covered behavior:

- adapter profiles expose structured executable candidates, prompt transport mode, stream mode, known flags, and `needsVerification` flags;
- `buildArgs()` keeps long prompts out of argv and no longer guesses unverified Claude `--session-id`;
- P3-6 supersedes the older refusal behavior: real smoke without `--allow-real-run` now emits a redacted preflight summary and does not launch a real run;
- real smoke supports `--prompt-file`, `--cwd`, `--timeout-ms`, `--storage-dir`, `--json`, `--stream jsonl`, and `--diagnostics`;
- auth missing and unavailable executable are classified before launch;
- unsupported flag, timeout, and no-output runs include sanitized argv/profile diagnostics with stdout/stderr tails and actionable hints;
- diagnostics bundle adapter summary exposes prompt transport, stream format, parsed event count, sanitized argv, and hints without raw output or private paths.

## P1-6 Real Smoke Evidence Hardening

Commands verified in this stage:

```bash
node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --expect-text "agent-runtime codex smoke ok" --json --diagnostics --timeout-ms 30000
node ./dist/cli/main.js smoke --mode real --agent opencode --allow-real-run --expect-text "agent-runtime opencode smoke ok" --json --diagnostics --timeout-ms 30000
node ./dist/cli/main.js smoke --mode real --agent claude --allow-real-run --expect-text "agent-runtime claude smoke ok" --json --diagnostics --timeout-ms 30000
npm run typecheck
```

Covered behavior:

- default real smoke expects `agent-runtime <agent> smoke ok` in aggregated `text_delta`;
- status-only exit `0` and wrong text classify as `unexpected_output`;
- default isolated cwd mutation classifies as `cwd_mutated`;
- P3-6 requires expected text for success; `--prompt-file` without `--expect-text` still keeps prompt content out of argv but classifies the run as `unexpected_output`;
- `--prompt-file --expect-text ...` enforces the override;
- `observedTextTail`, expected text, cwd, diagnostics, and mutation samples are redacted and observed text is truncated.
- local Codex and OpenCode real smoke passed with `runClassification: "success"`, `expectedTextMatched: true`, `cwdMutationChecked: true`, and `cwdMutated: false`;
- local Claude real smoke preflight returned `runClassification: "auth_missing"` without launching a run.

## P1-7 Durable Store Hardening

Commands verified in this stage:

```bash
npm test
npm run typecheck
node ./dist/cli/main.js run --agent codex --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --json
node ./dist/cli/main.js run --agent opencode --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --json
npm run lint
npm run build
npm run ci
npm pack --dry-run
```

Store hardening and recovery verification:

```bash
node ./dist/cli/main.js runs --storage-dir .agent-runtime --json
node ./dist/cli/main.js run-status run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-run run_123 --storage-dir .agent-runtime --after 10 --jsonl
node ./dist/cli/main.js goals --storage-dir .agent-runtime --json
node ./dist/cli/main.js goal-status goal_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-goal goal_123 --storage-dir .agent-runtime --after 10 --jsonl
node ./dist/cli/main.js store-health --storage-dir .agent-runtime --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --dry-run --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --apply --json
```
Covered behavior:
- `RuntimeOptions.storage.durability` keeps `storageDir` compatible and defaults to `relaxed`;
- `fsync` mode exercises fdatasync/fsync hooks for manifest atomic writes and JSONL appends, with persisted `AGENT_STORAGE_SYNC_FALLBACK` diagnostics visible through store health and diagnostics bundles when sync primitives fail;
- JSONL record boundary is one JSON replay envelope plus trailing newline;
- partial JSONL tails keep the valid prefix and report corrupt line count, partial tail detection, last good event id/sequence, redacted tail preview, and `truncate_partial_tail`;
- corrupt middle JSONL lines report health diagnostics while preserving later valid records for replay;
- `store-repair --dry-run --json` reports intended non-destructive actions and does not modify files;
- `store-repair --apply --json` holds the local store lease while writing, backs up original event logs through temp-file-and-rename, truncates partial tails or removes corrupt middle lines, preserves later valid replay events, refuses live owners, records redacted repair diagnostics, and is idempotent;
- interrupted running runs and interrupted planning/running goals reload as failed, update manifests, append diagnostic/terminal replay events, clear active lists, and appear in store health;
- health, repair dry-run, and diagnostics bundle output remain redacted;
- `npm pack --dry-run` remains covered by the public contract test and excludes `.reference/`, fixtures, and real smoke output.

## P2-1 Production Runtime Hardening

Commands verified in this stage:

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

Covered behavior:

- `conformance --mode fixtures` returns stable per-adapter summaries without launching CLIs;
- `conformance --mode fake` runs temporary fake CLIs through the real adapter argv/stdin/parser path;
- historical P2-3 `conformance --mode real` refused without `--allow-real-run`; P2-4 supersedes this with safe detection/profile certification and no real run launch unless `--allow-real-run` is explicit;
- `--agent all` preserves one adapter fail/skip alongside other adapter summaries;
- validation timeout evidence records classification, timeout, redacted env override, and replayable diagnostics export;
- diagnostics bundle includes `supervisorSummary` without raw env, prompt, token, or private path data;
- reload, cancel, and shutdown terminal events remain idempotent;
- parser fixtures cover warning/log/noise and corrupt lines without producing `text_delta`;
- package dry-run excludes `.reference/`, tests, private fixture paths, and secret-looking values;
- production scope and OpenDesign daemon-level gaps are documented in `docs/production-readiness.md`.

## P1-8 Release Candidate Hardening

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
npm pack --dry-run
```

Release-preflight workflow:

```bash
repo_root="${GITHUB_WORKSPACE:-$(pwd -P)}"
tmp_dir="$(mktemp -d)"
pushd "$tmp_dir"
pack_info="$(cd "$repo_root" && npm pack --json --ignore-scripts --pack-destination "$tmp_dir")"
package_file="$(printf '%s' "$pack_info" | node -e "const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(data[0].filename);")"
npm init -y >/dev/null
npm install "$tmp_dir/$package_file" --no-save --ignore-scripts --no-audit --no-fund >"$tmp_dir/install.log"
node -e "(async()=>{ const m = await import('agent-cli-runtime'); if (typeof m.createAgentRuntime !== 'function') process.exit(1); console.log(typeof m.createAgentRuntime); })()"
node ./node_modules/.bin/agent-runtime agents --json >"$tmp_dir/agents.json"
node ./node_modules/.bin/agent-runtime doctor --json >"$tmp_dir/doctor.json"
node ./node_modules/.bin/agent-runtime smoke --mode fixtures --json >"$tmp_dir/fixtures-smoke.json"
popd
node -e "const fs = require('node:fs'); for (const file of process.argv.slice(1)) JSON.parse(fs.readFileSync(file, 'utf8'));" "$tmp_dir/agents.json" "$tmp_dir/doctor.json" "$tmp_dir/fixtures-smoke.json"
```

Release-candidate notes:

- pre-alpha / developer preview scope:
  - no stable API guarantee;
  - no daemon;
  - no WAL;
  - no remote runtime.
- `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/release-checklist.md` are part of package boundary docs.

## P0-4 Detection Evidence

Commands run from this repository after `npm run build`:

```bash
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Observed results:

- Codex: available, live models source, auth status `unknown`, diagnostics empty.
- Claude Code: available, fallback models source, auth status `missing`, diagnostic code `auth_missing`.
- OpenCode: available via fallback binary `opencode`, live models source, auth status `unknown`, diagnostics empty.

Version, model, auth, and capability probe diagnostics are redacted before being returned by detection. Probe cwd is a neutral temp directory, not the caller project.

## P0-4 Run Smoke Evidence

Commands run from this repository after `npm run build`:

```bash
node ./dist/cli/main.js run --agent codex --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --cwd "$tmp" --prompt "Reply exactly: agent-runtime codex smoke ok. Do not edit files."
node ./dist/cli/main.js run --agent opencode --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --cwd "$tmp" --prompt "Reply exactly: agent-runtime opencode smoke ok. Do not edit files."
claude auth status
```

Observed results:

- Codex: latest run timed out after 30s with `parsedEventCount: 2` (`thread.started`, `turn.started`), sanitized argv `["exec","--json","--skip-git-repo-check","--sandbox","read-only","-C","<cwd>"]`, and startup diagnostics rather than a prompt transport mismatch. Parser fixtures cover transient reconnect frames so they are not treated as fatal.
- OpenCode: timed out after 30s with `parsedEventCount: 0`, sanitized argv `["run","--format","json","--dir","<cwd>"]`, exitCode `0` after timeout, and hints for interactive/model/auth wait or unsupported stdin profile.
- Claude Code: `claude auth status` returned `loggedIn:false`, `authMethod:none`, `apiProvider:firstParty`; run smoke remains auth-blocked.
