# Release Report: 0.1.0-alpha.0 P2-13 plus P3-5 remote evidence closure

Status: P3-5 Remote Release Evidence Closure
Last updated: 2026-06-22

This report records release-candidate and alpha publish-readiness evidence for `agent-cli-runtime@0.1.0-alpha.0`, plus post-P2-13 daemon-ready contract hardening notes. It is a pre-alpha developer-preview audit and decision package, not an npm publication record.

## Verdict

The release candidate has GitHub Actions release-candidate evidence from P3-5 for workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`. Workflow run `27932628093` completed successfully, uploaded all five release-candidate artifacts, and the downloaded artifacts passed local `npm run release:verify` after normalization. This evidence proves the workflow head SHA, not any later documentation commit that records the evidence. The package is not published to npm, does not claim a stable API, and does not claim OpenDesign daemon parity.

## P3-5 Remote Release Evidence Closure

P3-5 closes the P3-4 remote evidence gap for the release-candidate workflow head SHA. It does not add runtime features and does not publish npm.

Workflow evidence target:

- Branch: `main`.
- Workflow head SHA: `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`.
- Trigger command: `gh workflow run release-candidate.yml --ref main`.
- Run id: `27932628093`.
- Run URL: `https://github.com/iiwish/agent-cli-runtime/actions/runs/27932628093`.
- Event: `workflow_dispatch`.
- Workflow: `Release Candidate`.
- Run status/conclusion: `completed` / `success`.
- Run created/updated: `2026-06-22T05:56:49Z` / `2026-06-22T05:57:59Z`.
- Job `Build release candidate artifacts` started at `2026-06-22T05:56:53Z`, completed at `2026-06-22T05:57:58Z`, and concluded `success`.
- Steps `Install dependencies`, `Run CI gate`, `Run dogfood gate without authenticated real runs`, `Create npm pack artifact and gate evidence without publishing`, `Upload tarball`, `Upload pack metadata`, `Upload package file list`, `Upload daemon-ready gate evidence`, and `Upload release verification` all concluded `success`.
- Download directory: `/tmp/agent-runtime-p3-5-remote-7rkBqm/downloaded`.
- Normalized review directory: `/tmp/agent-runtime-p3-5-remote-7rkBqm/normalized`.

Current artifact metadata from the GitHub Actions API:

| Artifact | GitHub artifact id | Archive size | Digest | Expires |
| --- | ---: | ---: | --- | --- |
| `agent-cli-runtime-tarball` | `7784276720` | `206911` bytes | `sha256:8f7c4b8d9aa4aee9f375fcbf1de5644884d388693832ed42310dfc41a48e6270` | `2026-07-06T05:57:52Z` |
| `agent-cli-runtime-pack-metadata` | `7784276910` | `1960` bytes | `sha256:c28f03b875ca489eee15f0867d4dd309f0dbc46a2ed9184f61be8fc5f5b1e773` | `2026-07-06T05:57:53Z` |
| `agent-cli-runtime-package-files` | `7784277102` | `947` bytes | `sha256:7bff251b88d155027061de0e32a2f065e4614e61d2cc1cdceabbf9333fae4e03` | `2026-07-06T05:57:54Z` |
| `agent-cli-runtime-gate-evidence` | `7784277275` | `443` bytes | `sha256:ddb608e25f79489f16604a01de10a2ab0664721636b1f20448e18adcd369caf2` | `2026-07-06T05:57:55Z` |
| `agent-cli-runtime-release-verification` | `7784277464` | `649` bytes | `sha256:c97a91bb356a1934d82ebcc69404ad614968a2ab3904a6e9d5871bd8c818ed78` | `2026-07-06T05:57:56Z` |

Downloaded artifact normalization:

```bash
gh run download 27932628093 --dir /tmp/agent-runtime-p3-5-remote-7rkBqm/downloaded
cp /tmp/agent-runtime-p3-5-remote-7rkBqm/downloaded/agent-cli-runtime-tarball/agent-cli-runtime-0.1.0-alpha.0.tgz /tmp/agent-runtime-p3-5-remote-7rkBqm/normalized/
cp /tmp/agent-runtime-p3-5-remote-7rkBqm/downloaded/agent-cli-runtime-pack-metadata/npm-pack.json /tmp/agent-runtime-p3-5-remote-7rkBqm/normalized/
cp /tmp/agent-runtime-p3-5-remote-7rkBqm/downloaded/agent-cli-runtime-package-files/package-files.txt /tmp/agent-runtime-p3-5-remote-7rkBqm/normalized/
cp /tmp/agent-runtime-p3-5-remote-7rkBqm/downloaded/agent-cli-runtime-gate-evidence/gate-evidence.json /tmp/agent-runtime-p3-5-remote-7rkBqm/normalized/
cp /tmp/agent-runtime-p3-5-remote-7rkBqm/downloaded/agent-cli-runtime-release-verification/release-verification.json /tmp/agent-runtime-p3-5-remote-7rkBqm/normalized/
npm run release:verify -- --dir /tmp/agent-runtime-p3-5-remote-7rkBqm/normalized
```

Downloaded artifact re-verification result:

- `schemaVersion`: `agent-cli-runtime.releaseVerification.v1`
- `ok`: `true`
- diagnostics: empty
- package file count: `147`
- local `npm pack --dry-run --json --ignore-scripts` file count at review: `147`
- artifact names: `agent-cli-runtime-tarball`, `agent-cli-runtime-pack-metadata`, `agent-cli-runtime-package-files`, `agent-cli-runtime-gate-evidence`, `agent-cli-runtime-release-verification`
- tarball: `agent-cli-runtime-0.1.0-alpha.0.tgz`
- tarball size: `206662` bytes
- tarball sha256: `6e7711a275a1d58e862809e4dd5d34c76cf79ca5f812af1e16872ea54b97542c`
- npm pack shasum: `3ee52f4b97131527de752651f5a395b769ccf7c0`
- package name/version: `agent-cli-runtime@0.1.0-alpha.0`
- gate evidence schema: `agent-cli-runtime.releaseGateEvidence.v1`
- gate evidence commands: `npm run daemon:verify`, `npm run runtime:safety`
- gate evidence package source: both `installed-tarball`
- gate evidence flags: `noAuthenticatedRealRun: true`, `noNpmPublish: true`, `noNpmToken: true`

P3-5 local sanity evidence on 2026-06-22:

- `git diff --check`: passed before P3-5 doc/test edits.
- `node ./dist/cli/main.js agents --json`: passed; Codex `codex-cli 0.142.0-alpha.6` and OpenCode `1.15.6` available, Claude Code `2.1.178` available with `auth_missing`.
- `node ./dist/cli/main.js doctor --json`: passed with `ok: true`; Claude Code remains `auth_missing`.
- `node ./dist/cli/main.js conformance --mode real --agent all --json`: passed without `--allow-real-run`; Codex and OpenCode reported `real_run_skipped` / `real_run_not_allowed`, Claude Code reported `auth_missing`. No authenticated real agent run was launched.

## P3-4 CI / Release Gate Alignment

P3-4 is local-first release gate alignment, not a new runtime feature and not an npm publication:

- CI matrix: `.github/workflows/ci.yml` keeps Node.js 20/22/24 for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run.
- Single-Node release gates: CI now runs `npm run daemon:verify`, `npm run runtime:safety`, and `npm run dogfood` once on Node.js 22 to avoid repeating installed-package gates across the matrix.
- Release-candidate workflow: `.github/workflows/release-candidate.yml` remains manual `workflow_dispatch`, runs `npm ci`, `npm run ci`, `npm run dogfood`, then runs `npm run release:candidate -- --out-dir release-candidate`.
- Candidate artifacts: `release:candidate` writes `npm-pack.json`, `package-files.txt`, `gate-evidence.json`, the tarball, and `release-verification.json`.
- Gate evidence schema: `gate-evidence.json` uses `schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1"` and records `npm run daemon:verify` plus `npm run runtime:safety` with installed-package output schema versions.
- Verifier: `release:verify` requires `gate-evidence.json`; missing or incomplete daemon-ready gate evidence fails verification while package boundary, private path, token-looking value, Bearer, and auth env checks remain active.
- Boundary: workflows still contain no `npm publish`, no `NODE_AUTH_TOKEN` / `NPM_TOKEN`, no trusted-publishing credential setup, and no `--allow-real-run`.

Remote P3-4 evidence was pending until P3-5. P3-5 run `27932628093` is the workflow-head evidence closure for the five-artifact set.

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

Remote GitHub Actions evidence for the P3-5 release-candidate target is run `27932628093` on workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`. Historical P2-12 run `27869580048` must not be reused as evidence for later release-candidate targets.

## Release-Candidate Artifacts

The manual release-candidate workflow uploads:

- `agent-cli-runtime-tarball`: the packed `agent-cli-runtime-0.1.0-alpha.0.tgz` tarball.
- `agent-cli-runtime-pack-metadata`: `release-candidate/npm-pack.json` from `npm pack --json`.
- `agent-cli-runtime-package-files`: `release-candidate/package-files.txt`, one packed package path per line.
- `agent-cli-runtime-gate-evidence`: `release-candidate/gate-evidence.json` from `npm run release:candidate`.
- `agent-cli-runtime-release-verification`: `release-candidate/release-verification.json` from `npm run release:verify`.

Artifacts are retained for 14 days to keep the audit window explicit while avoiding long-lived stale release-candidate evidence.

The P3-5 artifact set has five artifacts. The P2-12 downloaded artifact table below is retained as historical evidence for commit `2f8832119b4ebdb8393077052560589a398ebf56`; it predates `agent-cli-runtime-gate-evidence` and must not be reused as P3-5 evidence.

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

- Remote GitHub Actions evidence is commit-specific; P3-5 run `27932628093` only proves workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`.
- Historical P2-12 run `27869580048` only proves commit `2f8832119b4ebdb8393077052560589a398ebf56` and predates the gate-evidence artifact.
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
