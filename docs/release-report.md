# Release Report: 0.1.0-alpha.0 P2-13 plus P3-4 gate alignment

Status: P3-4 CI / Release Gate Alignment
Last updated: 2026-06-22

This report records release-candidate and alpha publish-readiness evidence for `agent-cli-runtime@0.1.0-alpha.0`, plus post-P2-13 daemon-ready contract hardening notes. It is a pre-alpha developer-preview audit and decision package, not an npm publication record.

## Verdict

The release candidate has historical GitHub Actions release-candidate evidence from P2-12 for commit `2f8832119b4ebdb8393077052560589a398ebf56`. P3-4 updates CI and release-candidate artifacts so the P3-2 `daemon:verify` gate and P3-3 `runtime:safety` gate are represented in candidate evidence through `gate-evidence.json` and verified by `release:verify`. A fresh remote P3-4 workflow run is still pending for the current commit. The package is not published to npm, does not claim a stable API, and does not claim OpenDesign daemon parity.

## P3-4 CI / Release Gate Alignment

P3-4 is local-first release gate alignment, not a new runtime feature and not an npm publication:

- CI matrix: `.github/workflows/ci.yml` keeps Node.js 20/22/24 for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run.
- Single-Node release gates: CI now runs `npm run daemon:verify`, `npm run runtime:safety`, and `npm run dogfood` once on Node.js 22 to avoid repeating installed-package gates across the matrix.
- Release-candidate workflow: `.github/workflows/release-candidate.yml` remains manual `workflow_dispatch`, runs `npm ci`, `npm run ci`, `npm run dogfood`, then runs `npm run release:candidate -- --out-dir release-candidate`.
- Candidate artifacts: `release:candidate` writes `npm-pack.json`, `package-files.txt`, `gate-evidence.json`, the tarball, and `release-verification.json`.
- Gate evidence schema: `gate-evidence.json` uses `schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1"` and records `npm run daemon:verify` plus `npm run runtime:safety` with installed-package output schema versions.
- Verifier: `release:verify` requires `gate-evidence.json`; missing or incomplete daemon-ready gate evidence fails verification while package boundary, private path, token-looking value, Bearer, and auth env checks remain active.
- Boundary: workflows still contain no `npm publish`, no `NODE_AUTH_TOKEN` / `NPM_TOKEN`, no trusted-publishing credential setup, and no `--allow-real-run`.

Remote P3-4 evidence status:

- `remote_evidence`: pending.
- Required next step: after the P3-4 commit is pushed, run `gh workflow run release-candidate.yml --ref <branch-or-sha>`, wait for the run to complete, download all five artifacts, normalize the artifact directory if needed, and run `npm run release:verify -- --dir <downloaded-artifact-dir>`.

## P3-1 Daemon-Ready Contract Hardening

P3-1 is a post-P2-13 contract freeze, not a new release publication:

- New embedding contract: [docs/daemon-ready-contract.md](./daemon-ready-contract.md).
- Runtime positioning: local-first execution kernel for daemon/product shell embedding, not hosted control plane.
- Root value API boundary: still `createAgentRuntime` only.
- Schema freeze: event envelope `agent-runtime.event.v1`, diagnostics bundle `agent-runtime.diagnostics.v1`, conformance report `agent-runtime.conformance.v1`, store health `agent-runtime.storeHealth.v1`, store repair `agent-runtime.storeRepair.v1`, and CLI JSON error `agent-runtime.cliError.v1`.
- Compatibility rule: optional fields may be added in-schema; removing, renaming, changing type, or changing stable semantics requires a schema bump.
- Failure taxonomy: event terminal reasons remain stable; CLI/conformance classifications such as `real_run_skipped`, `unsupported_flag`, `unexpected_output`, `cwd_mutated`, `needs_verification`, and `unavailable_executable` remain explicit evidence states rather than being converted to success.
- Non-goals: no daemon/API server, no database/WAL, no remote worker, no UI/artifact layer, no telemetry, no npm publish, no publish workflow, no npm token/trusted publishing configuration.

P3-1 local validation on 2026-06-22:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed with 173 tests across 9 files.
- `npm run build`: passed.
- `npm run package:check`: passed with `package boundary ok: 147 files checked`.
- `npm run release:candidate -- --out-dir /tmp/agent-runtime-p3-1-G8WgWS`: passed, producing `agent-cli-runtime-0.1.0-alpha.0.tgz`.
- `npm run release:verify -- --dir /tmp/agent-runtime-p3-1-G8WgWS`: passed with `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, `ok: true`, package file count `147`, and empty diagnostics.
- `npm pack --dry-run`: passed with total files `147` and `docs/daemon-ready-contract.md` included.
- `node ./dist/cli/main.js agents --json`: passed.
- `node ./dist/cli/main.js doctor --json`: passed with `ok: true`; Claude Code remains `auth_missing`, which is expected local auth evidence rather than real-run success.
- `node ./dist/cli/main.js conformance --mode real --agent all --json`: passed without `--allow-real-run`; Codex `0.142.0-alpha.6` and OpenCode `1.15.6` reported `real_run_skipped`, Claude Code `2.1.178` reported `auth_missing`.
- `git diff --check`: passed.
- `npm publish --dry-run` was not run for P3-1 because this stage does not change publish readiness or perform publish simulation.

## P2-13 Alpha Publish Readiness

Decision state:

- npm publication: not performed.
- Package metadata: `repository`, `homepage`, and `bugs` are present alongside the existing package entrypoint, files, engines, keywords, and `publishConfig.tag: "alpha"`.
- Public API boundary: package root value export remains `createAgentRuntime` only; public types remain declaration/type surface.
- Publish runbook: [docs/release-publish-runbook.md](./release-publish-runbook.md) records dry-run, real publish commands, human confirmation points, dist-tag checks, rollback/deprecation/unpublish boundaries, 2FA, trusted publishing, provenance, and token strategy.
- Workflow strategy: `.github/workflows/ci.yml` and `.github/workflows/release-candidate.yml` remain artifact/check workflows only. They do not run `npm publish`, do not configure registry credentials, and do not require npm tokens.
- Token/provenance/2FA decision: prefer future trusted publishing through a dedicated publish workflow and npm-side trusted publisher configuration; for a first manual alpha, use interactive maintainer publish with npm 2FA and no committed tokens. Trusted publishing is not configured in P2-13, and local manual publish must not claim GitHub Actions provenance.
- Dist-tag decision: future real publish must use `--tag alpha`; `latest` must not move for this pre-alpha package.
- Rollback decision: wrong dist-tags are fixed with `npm dist-tag`; unsafe package content requires a new version, deprecation, or npm-policy-eligible unpublish. The same `name@version` cannot be overwritten.

P2-13 local validation on 2026-06-22:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed with 172 tests across 9 files.
- `npm run build`: passed.
- `npm run package:check`: passed with `package boundary ok: 146 files checked`.
- `npm run release:candidate -- --out-dir <tmp-dir>`: passed, producing `agent-cli-runtime-0.1.0-alpha.0.tgz`.
- `npm run release:verify -- --dir <tmp-dir>`: passed with `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, `ok: true`, package file count `146`, and empty diagnostics.
- `npm pack --dry-run`: passed with total files `146` and `docs/release-publish-runbook.md` included.
- `npm publish --dry-run --ignore-scripts --tag alpha`: passed as a dry-run. npm reported `Publishing to https://registry.npmjs.org/ with tag alpha and default access (dry-run)` and did not publish.
- `node ./dist/cli/main.js agents --json`: passed.
- `node ./dist/cli/main.js doctor --json`: passed with `ok: true`; Claude Code remains `auth_missing`, which is expected local auth evidence rather than real-run success.
- `git diff --check`: passed.

## Local Verification Commands

Run these from the repository root:

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
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
git diff --check
node ./dist/cli/main.js conformance --mode real --agent all --json
```

`npm publish --dry-run --ignore-scripts --tag alpha` is a local manual safety check only. The explicit `--tag alpha` is required so dry-run output matches the pre-alpha release intent instead of reporting `latest`. Do not add it as a required CI gate unless npm dry-run output is proven stable for this repository and registry context.

## Remote CI Evidence

P2-12 remote audit evidence on 2026-06-20:

- Local branch: `main`.
- Remote branch: `main`.
- Commit SHA: `2f8832119b4ebdb8393077052560589a398ebf56`.
- `gh auth status` succeeded with workflow-capable GitHub CLI credentials.
- `gh workflow run release-candidate.yml --ref main` created run `27869580048`.
- Run URL: `https://github.com/iiwish/agent-cli-runtime/actions/runs/27869580048`.
- Event: `workflow_dispatch`.
- Workflow: `Release Candidate`.
- Run status/conclusion: `completed` / `success`.
- Run created: `2026-06-20T11:19:33Z`.
- Run updated: `2026-06-20T11:20:40Z`.
- Job `Build release candidate artifacts` started at `2026-06-20T11:19:37Z`, completed at `2026-06-20T11:20:39Z`, and concluded `success`.
- The workflow steps `Install dependencies`, `Run CI gate`, `Run dogfood gate without authenticated real runs`, `Create npm pack artifact without publishing`, and all four artifact upload steps concluded `success`.
- GitHub emitted a non-blocking annotation that the referenced actions still target deprecated Node.js 20 internals while the runner forces Node.js 24 for those actions.

Expected remote evidence:

- `.github/workflows/ci.yml` runs typecheck, lint, tests, build, production dependency audit, package boundary check, and `npm pack --dry-run` on Node.js 20/22/24.
- The CI release-gates job runs once on Node.js 22 and executes `npm run daemon:verify`, `npm run runtime:safety`, and `npm run dogfood` without passing `--allow-real-run`.
- `.github/workflows/release-candidate.yml` is manual `workflow_dispatch` only.
- The release-candidate workflow runs `npm ci`, `npm run ci`, `npm run dogfood`, creates npm pack metadata and daemon-ready gate evidence through `npm run release:candidate`, verifies the generated artifacts through `npm run release:verify`, and uploads artifacts.
- No workflow runs `npm publish`, sets `NODE_AUTH_TOKEN`, or requires an npm token.
P2-13 keeps those workflow guarantees and does not add a publish workflow.

Remote GitHub Actions evidence for this candidate is run `27869580048`. Do not reuse it as evidence for later commits.

## Release-Candidate Artifacts

The manual release-candidate workflow uploads:

- `agent-cli-runtime-tarball`: the packed `agent-cli-runtime-0.1.0-alpha.0.tgz` tarball.
- `agent-cli-runtime-pack-metadata`: `release-candidate/npm-pack.json` from `npm pack --json`.
- `agent-cli-runtime-package-files`: `release-candidate/package-files.txt`, one packed package path per line.
- `agent-cli-runtime-gate-evidence`: `release-candidate/gate-evidence.json` from `npm run release:candidate`.
- `agent-cli-runtime-release-verification`: `release-candidate/release-verification.json` from `npm run release:verify`.

Artifacts are retained for 14 days to keep the audit window explicit while avoiding long-lived stale release-candidate evidence.

The P3-4 artifact set has five artifacts. The P2-12 downloaded artifact table below is retained as historical evidence for commit `2f8832119b4ebdb8393077052560589a398ebf56`; it predates `agent-cli-runtime-gate-evidence` and must not be reused as current P3-4 evidence.

Downloaded artifact evidence from run `27869580048`:

| Artifact | GitHub artifact id | Archive size | Digest | Expires |
| --- | ---: | ---: | --- | --- |
| `agent-cli-runtime-tarball` | `7764861497` | `187609` bytes | `sha256:db669f9ccf34873ec1619c9d7fe1669a2bdc49a4de64a7e183c1d8fe5f1a4aea` | `2026-07-04T11:20:35Z` |
| `agent-cli-runtime-pack-metadata` | `7764861577` | `1921` bytes | `sha256:0b02f459bd8bdf87c1787ecc43b2a748e27841bd59092b2e72b405970503250f` | `2026-07-04T11:20:36Z` |
| `agent-cli-runtime-package-files` | `7764861640` | `924` bytes | `sha256:9b3d5b591520d5c86723e6cb47c1bf24d11723b85d17251b4cc2095115608c52` | `2026-07-04T11:20:37Z` |
| `agent-cli-runtime-release-verification` | `7764861710` | `444` bytes | `sha256:56cb8a125a27b88b816762b6cc9ed5320da66fcc26040c4fa4fec39faec2cf99` | `2026-07-04T11:20:37Z` |

`gh run download 27869580048` downloaded artifacts into one subdirectory per artifact name. The downloaded files were copied into a temporary normalized review directory so the verifier could inspect `npm-pack.json`, `package-files.txt`, `release-verification.json`, and the tarball together.

Downloaded artifact re-verification:

```bash
npm run release:verify -- --dir /tmp/agent-runtime-p2-12-remote-5P5MSc/normalized
```

Result:

- `schemaVersion`: `agent-cli-runtime.releaseVerification.v1`
- `ok`: `true`
- package file count: `145`
- tarball: `agent-cli-runtime-0.1.0-alpha.0.tgz`
- tarball size: `187378` bytes
- tarball sha256: `3701bd6355651bbc200d5c017a9b01c3dd7136140b64dee0781e6eb601a7a657`
- package name/version: `agent-cli-runtime@0.1.0-alpha.0`
- diagnostics: empty

## Local Artifact Generation And Verification

Generate the same artifact shape locally without publishing:

```bash
npm run release:candidate -- --out-dir release-candidate
```

The command writes `npm-pack.json`, `package-files.txt`, `gate-evidence.json`, the tarball, and `release-verification.json` to the chosen directory. It does not run `npm publish` and should not leave a tarball in the repository root.

Verify a local or downloaded artifact directory:

```bash
npm run release:verify -- --dir release-candidate
```

The verification JSON uses `schemaVersion: "agent-cli-runtime.releaseVerification.v1"` and reports `ok`, `checkedFiles`, `tarball`, `diagnostics`, `artifactNames`, `packageName`, and `version`. Paths and secret-looking values in diagnostics are redacted.

## Artifact Review Checklist

Review the uploaded package file list and pack metadata before treating the candidate as shippable:

- No `.reference/`.
- No `tests/` or fixture directories.
- No fault fixtures.
- No `repair-backups/`.
- No raw corrupt samples.
- No raw real CLI output.
- No real private paths.
- No token-looking values, Bearer values, or auth env assignment values.
- Includes `docs/daemon-ready-contract.md`.
- Includes `dist/`, README files, LICENSE, docs, examples, `scripts/dogfood.mjs`, and release docs.
- Includes `docs/release-publish-runbook.md`.
- Package root value API remains limited to `createAgentRuntime`; public TypeScript types remain type exports.

## Package Boundary

`npm run package:check` is the local package boundary gate. It checks npm pack file paths and scans committed docs/examples/scripts for private paths and token-looking content. The release report itself is included in the package so consumers can inspect the candidate evidence and non-goals.

`npm run release:verify` is the release artifact gate for generated or downloaded artifacts. It validates npm pack JSON, package file list parity, daemon-ready gate evidence, tarball filename/path/existence, disallowed package paths, private paths, and token-looking values, then emits stable redacted JSON.

## Real CLI Evidence Boundary

Default release gates do not launch authenticated real agent runs. `conformance --mode real --agent all --json` performs real local executable/version/auth/model/profile certification and reports `real_run_skipped`, `auth_missing`, `unsupported_flag`, or `needs_verification` honestly.

Authenticated real runs require explicit `--allow-real-run` and remain local/manual evidence.

## Known Risks

- Remote GitHub Actions evidence is commit-specific; run `27869580048` only proves commit `2f8832119b4ebdb8393077052560589a398ebf56`.
- P3-4 remote release-candidate evidence is pending until a fresh workflow run uploads and verifies `agent-cli-runtime-gate-evidence`.
- Real CLI behavior, auth state, model lists, and flags can drift after this dated evidence.
- OpenCode explicit read-only/workspace-write flags, extra dirs, and session/resume remain in `needsVerification`.
- Claude Code authenticated run smoke depends on local auth or a correctly configured provider environment.
- npm dry-run output can vary by npm version and registry context, so it remains a manual/local gate rather than a flaky CI requirement.
- Trusted publishing and provenance are not configured in P2-13. Any future provenance claim must match the actual publish path.

## Explicit Non-Goals

- Do not publish npm.
- Do not require npm token or registry credentials.
- Do not configure trusted publishing or npm provenance.
- Do not claim stable API.
- Do not claim OpenDesign daemon parity.
- Do not add daemon/API server, database, WAL, remote worker, web UI, telemetry, or scheduler expansion.
- Do not convert `real_run_skipped`, `auth_missing`, `unsupported_flag`, or `needs_verification` into real agent run success.
