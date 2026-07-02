# Release Report: 0.1.0-alpha.6 Published Corrective Release

Status: `0.1.0-alpha.6` is the published corrective alpha release; npm `alpha` and `latest` point at alpha.6
Last updated: 2026-07-02

This report is the packaged, stable release-state summary. Volatile release evidence such as current workflow run ids, artifact ids, artifact digests, tarball hashes, pack hashes, local temporary paths, command transcripts, raw logs, raw CLI output, prompt text, and token-looking values belongs outside the npm package under `.release-evidence/` or durable GitHub Release assets. P8 main release-candidate files remain historical repo-only evidence for their exact target SHAs; package-content drift decisions and current main release-candidate decisions are recorded under `.release-evidence/` with stage-specific repo-only summaries.

## Current State

- Published corrective alpha release: `agent-cli-runtime@0.1.0-alpha.6`; alpha.6 is published.
- Future beta or stable promotion requires fresh release-candidate evidence, package-docs verification, dry-run, and explicit maintainer authorization.
- `agent-cli-runtime@0.1.0-alpha.5` remains published on npm as a stale-docs incident.
- npm `alpha` dist-tag points at `0.1.0-alpha.6`.
- npm `latest` dist-tag points at `0.1.0-alpha.6`.
- GitHub Release `v0.1.0-alpha.6` exists as a prerelease with the npm registry tarball asset, and GitHub Release tarball parity verification passes for alpha.6.
- GitHub Release `v0.1.0-alpha.5` exists as a prerelease with the npm registry tarball asset, and GitHub Release tarball parity verification passes for alpha.5.
- The immutable `0.1.0-alpha.5` npm tarball contains stale package docs, so aggregate `published:verify` and `published:verify:evidence` fail with `registry_packaged_docs_failed`.
- Alpha.5 is a published stale-docs incident, not final corrective release acceptance.
- Historical published npm package with stale docs: `agent-cli-runtime@0.1.0-alpha.4`.
- The immutable `0.1.0-alpha.4` npm tarball contains stale release-prep package docs; npm registry metadata is authoritative for the alpha.4 version and dist-tags.
- GitHub Release `v0.1.0-alpha.4` exists as a prerelease with the npm registry tarball asset, and GitHub Release tarball parity verification passes for alpha.4.
- P9-6 records the fresh main release-candidate workflow evidence for the alpha.4 package content. P9-7 records the dry-run decision and post-publish registry state. P9-9 records alpha.5 publish, latest retag, GitHub Release parity, and stale-docs published verification failure under `.release-evidence/`. P9-10 records alpha.6 corrective candidate evidence and P9-11 records alpha.6 authorized publish evidence under `.release-evidence/`.
- `agent-cli-runtime@0.1.0-alpha.3` remains the previous corrective pre-alpha release for package consumers.
- `agent-cli-runtime@0.1.0-alpha.2` is published on npm and has GitHub pre-release `v0.1.0-alpha.2`, but its immutable npm tarball contains stale pre-publish package docs.
- `agent-cli-runtime@0.1.0-alpha.1` remains an earlier published alpha with GitHub pre-release `v0.1.0-alpha.1`.
- `agent-cli-runtime@0.1.0-alpha.0` is deprecated because its immutable package docs shipped stale pre-publish status text.
- npm registry metadata and GitHub Releases are the source of truth for available versions and dist-tags.
- `.release-evidence/` and `.reference/` stay outside npm package contents.

## Verdict

`0.1.0-alpha.6` is the published corrective alpha release. It replaces the consumer-visible stale package docs from alpha.5. npm registry state is: `alpha` and `latest` both point at `0.1.0-alpha.6`. GitHub Release `v0.1.0-alpha.6` exists as a prerelease with the npm registry tarball asset and `release:post-alpha:verify` tarball parity passes. GitHub Release `v0.1.0-alpha.5` also exists with tarball parity passing, but aggregate `published:verify:evidence` fails for alpha.5 because registry packaged docs are stale.

The P9 line keeps these release gates in force:

- `npm run stable:surface:check` keeps the package-root value export limited to `createAgentRuntime` and keeps repo-only gates out of the public runtime API;
- `npm run package:check` verifies the package boundary and scans the docs that enter the tarball;
- `npm run release:package-content:verify -- --base-ref <release-target-sha> --head-ref HEAD` records package-visible drift decisions for future release targets;
- `npm run published:verify -- --out-dir published-verification` verifies the registry package; for alpha.5 it fails with `registry_packaged_docs_failed` because the immutable tarball docs are stale.

The alpha.3 stale-docs corrective path remains history. Alpha.4 package content is published on npm, and GitHub Release parity evidence is closed; the stale package docs already shipped inside the immutable alpha.4 npm tarball remain historical incident context. Alpha.5 is published but failed final corrective acceptance because its immutable npm tarball also contains stale package docs. Future beta promotion or stable promotion requires fresh release evidence for the target version.

The release remains local-first runtime/kernel scope:

- no npm token, `NODE_AUTH_TOKEN`, trusted publishing setup, or publish workflow secret is added;
- no authenticated real Codex/Claude/OpenCode run is launched by default gates;
- no daemon, hosted control plane, API server, database/WAL, web UI, telemetry system, or remote worker is added.

## P9-10 Alpha.6 Candidate Verification

The alpha.6 corrective candidate path uses:

```bash
git diff --check
npm run typecheck
npm run lint
npm run build
npm run stable:surface:check
npm test
npm run package:check
npm run prepublish:check
npm pack --dry-run
npm pack --dry-run --json --ignore-scripts
npm publish --dry-run --ignore-scripts --tag alpha
npm view agent-cli-runtime@0.1.0-alpha.6 version --json
npm dist-tag ls agent-cli-runtime
tmp_dir="$(mktemp -d)"
npm run release:candidate -- --out-dir "$tmp_dir" --real-compatibility-mode repo-only-skipped --target-sha <HEAD>
npm run release:verify -- --dir "$tmp_dir"
npm run release:package-content:verify -- --base-ref <alpha5-release-target-sha> --head-ref HEAD
git diff --check
```

The packaged-docs check runs an actual local pack and tarball extraction:

```bash
node ./scripts/check-packaged-docs.mjs
```

Published verification uses the registry package, not repo files:

```bash
node ./scripts/check-packaged-docs.mjs --package-spec agent-cli-runtime@<published-version>
npm run published:verify -- --out-dir published-verification
npm run published:verify:evidence -- --dir published-verification
```

`published:verify` creates the evidence file. `published:verify:evidence` verifies an existing local output directory or downloaded `agent-cli-runtime-published-verification` artifact directory; a bare verifier run without `published-verification/published-verification.json` exits `1` with redacted actionable JSON by design.

For `0.1.0-alpha.5`, npm registry metadata, published smoke, daemon, adapters, and `release:post-alpha:verify` tarball parity pass against npmjs and GitHub Release `v0.1.0-alpha.5`, but registry packaged-docs inspection fails because the immutable tarball contains stale package docs. For `0.1.0-alpha.4`, registry package and GitHub Release parity checks pass, but registry packaged-docs inspection remains historical failure evidence because the immutable tarball contains stale release-prep package docs. Do not reuse alpha.5 evidence as alpha.6, beta, or stable evidence.

## Release-Candidate Artifacts

`npm run release:candidate -- --out-dir <tmp-dir>` writes local strict review artifacts. Remote clean-checkout workflows use `npm run release:candidate -- --out-dir release-candidate --real-compatibility-mode repo-only-skipped`. Both modes write five review artifacts:

- `agent-cli-runtime-tarball`
- `agent-cli-runtime-pack-metadata`
- `agent-cli-runtime-package-files`
- `agent-cli-runtime-gate-evidence`
- `agent-cli-runtime-release-verification`

Downloaded GitHub Actions artifacts are normalized before verification:

```bash
npm run release:artifacts:normalize -- --download-dir <gh-download-dir> --out-dir <normalized-artifact-dir>
```

The normalizer emits `schemaVersion: "agent-cli-runtime.releaseArtifactNormalization.v1"`, copies only `npm-pack.json`, `package-files.txt`, `gate-evidence.json`, `release-verification.json`, and `agent-cli-runtime-*.tgz`, and rejects missing, duplicate, or unknown files without exposing absolute local paths. The normalized directory is the input to `npm run release:verify -- --dir <normalized-artifact-dir>`.

`npm run release:verify -- --dir <tmp-dir>` emits `schemaVersion: "agent-cli-runtime.releaseVerification.v1"` and must return `ok: true` with empty diagnostics before the candidate can proceed.

`gate-evidence.json` must use `schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1"` and include:

- `daemon:verify`
- `runtime:safety`
- `compat:real:evidence:verify`

The compatibility gate summary must include the verifier schema, verified matrix schema, target SHA status, freshness status, dirty policy status, and diagnostic count/codes. Local strict mode uses the checked-in matrix `gitSha` as the default release target, records matched/fresh release evidence, and distinguishes clean input evidence, `self_dirty_only` matrix output-file writes, and explicitly allowed dirty input evidence. Remote repo-only skipped mode records `targetSha.status`, `freshness.status`, and `dirtyPolicy.status` as `repo_only_not_run` plus the fixed `repoOnlyEvidence.status: "not_refreshed_in_ci"` reason. It must not include the raw `.release-evidence/` matrix, raw stdout/stderr, prompt text, private paths, tokens, Bearer values, or auth environment values. The gate evidence must keep `noAuthenticatedRealRun`, `noNpmPublish`, and `noNpmToken` true.

P8-4 release-strict compatibility closure uses `.release-evidence/p8-4-release-strict-compatibility.json` as the repo-only summary. It records the target SHA, matrix/verifier schemas, strict compatibility verifier result, local strict `release:candidate` and `release:verify` summary, remote workflow trigger state, downloaded-artifact verification state, and branch/main evidence decision. A target SHA that is not in `origin/main` remains branch/local evidence with `mainEvidence: false`; fresh `main` release-candidate evidence requires a workflow run whose `headSha` equals the target SHA and whose downloaded five artifacts pass `npm run release:verify -- --dir <normalized-downloaded-artifact-dir>`.

Main-scoped remote release-candidate closure uses `npm run release:main-candidate:evidence -- --stage <stage> --release-target-sha <origin-main-sha> --local-release-dir <local-strict-dir> --remote-run-json <run.json> --artifacts-json <artifacts.json> --downloaded-dir <normalized-artifact-dir> --out .release-evidence/<stage-lower>-main-release-candidate.json`. Stage labels such as `P9-2` are accepted and the output schema is `agent-cli-runtime.mainReleaseCandidateEvidence.v1`. The summary binds `releaseTargetSha` to `origin/main`, records local strict matrix verification and local strict release artifacts, then records a fresh `release-candidate.yml --ref main` run whose `event` is `workflow_dispatch`, `headBranch` is `main`, `status` is `completed`, `conclusion` is `success`, and `headSha` equals `releaseTargetSha`. The evidence scope is target-SHA-only: the evidence-recording commit and any later PR merge commit require their own fresh main evidence before they can be treated as release targets. P8 main release-candidate summaries are listed only as `historicalMainEvidence` with `currentMainFreshEvidence: false`. The remote artifact metadata must contain exactly the five release-candidate artifact names, with no missing, duplicate, expired, unknown, digest-less, or expiration-unverified artifact. The downloaded artifact set must keep each expected file under its matching artifact directory before normalization and must pass `npm run release:verify -- --dir <normalized-downloaded-artifact-dir>` with `ok: true`. Remote clean-checkout artifacts record real compatibility as `repo_only_not_run` / `not_refreshed_in_ci`; the compatibility conclusion comes from the local strict matrix verifier. Main-scoped release-candidate evidence is not npm publish evidence and does not create a GitHub Release, npm token, trusted publishing configuration, or authenticated real run.

Package-content drift review uses `npm run release:package-content:verify -- --base-ref <release-target-sha> --head-ref <sha-or-ref>`. The verifier emits `schemaVersion: "agent-cli-runtime.packageContentEquivalence.v1"` and compares the npm package file list plus file-content hashes for both refs from temporary git worktrees. `.release-evidence/`, tests, and repo-only scripts can change without changing package content; README, README.zh-CN, packaged docs, package.json, dist, type declarations, bin files, examples, and other package-visible files trigger `freshReleaseCandidateRequired: true` when their package content differs. The P8-8 evidence file is `.release-evidence/p8-8-package-content-equivalence.json`. It is a package-content decision, not a replacement for fresh main release-candidate workflow evidence.

Stable surface regression review uses `npm run stable:surface:check` after `npm run build`. The verifier emits `schemaVersion: "agent-cli-runtime.stableSurfaceCheck.v1"` and checks the package-root runtime value export, root declarations, schema inventory docs, terminal/classification vocabularies, experimental adapter-surface classification, and repo-only package exclusions. It is a local repository/release gate; it does not publish npm, create a GitHub Release, launch authenticated real agent runs, or make `dist/**` subpaths public API.

## Package Boundary

The npm package may include stable docs, examples, `dist/`, and the runtime entrypoints. It must not include:

- `.release-evidence/`
- `.reference/`
- `tests/`
- `tests/fixtures/`
- fault fixtures
- raw real CLI output
- repo-only release evidence scripts
- local temporary review directories
- private user paths
- raw prompts or full command transcripts
- token-looking values, Bearer values, or auth environment assignment values

`npm run package:check`, `npm run package:docs:check`, `npm pack --dry-run`, and `npm run release:verify -- --dir <tmp-dir>` enforce this boundary.

## Schema And Compatibility Contracts

The API and CLI schema inventory, versioning policy, root export boundary, and failure taxonomy are maintained in [docs/api-schema-contract.md](./api-schema-contract.md). The release-facing schemas are:

- `agent-cli-runtime.releaseVerification.v1`
- `agent-cli-runtime.releaseGateEvidence.v1`
- `agent-cli-runtime.releaseArtifactNormalization.v1`
- `agent-cli-runtime.mainReleaseCandidateEvidence.v1`
- `agent-cli-runtime.packageContentEquivalence.v1`
- `agent-cli-runtime.stableSurfaceCheck.v1`
- `agent-cli-runtime.realCompatibilityEvidenceVerification.v1`
- `agent-cli-runtime.realCompatibilityMatrix.v1`
- `agent-cli-runtime.realCompatibilityEvidence.v1`
- `agent-cli-runtime.packagedDocsVerification.v1`
- `agent-cli-runtime.publishedVerification.v1`

Skipped evidence is not success, `auth_missing` is not unavailable, and `needs_verification` must not be guessed into support.

## Known Risks

- Real CLI behavior, auth state, model lists, and flags can drift after dated compatibility evidence.
- npm dry-run output can vary by npm version and registry context, so the alpha dry-run remains a local manual safety gate rather than a required remote CI gate.
- Trusted publishing and provenance are not configured. Any future provenance claim must match the actual publish path.
