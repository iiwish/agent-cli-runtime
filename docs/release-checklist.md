# Release Checklist (pre-alpha / developer preview)

Status: `0.1.0-alpha.4` release-prep pre-alpha candidate
Last updated: 2026-06-30

## P9-5 Alpha.4 Release Prep

- [x] Prepare package metadata for `0.1.0-alpha.4` in `package.json` and `package-lock.json`.
- [x] Keep `0.1.0-alpha.4` as release-prep package candidate wording, not published-package wording.
- [x] Keep P9 stable surface gate coverage visible through `npm run stable:surface:check`.
- [x] Keep P9-4 fresh main release-candidate evidence package-out and exact-SHA scoped.
- [x] Record that package-content comparison against the P9-4 release target must show package-visible drift and `freshReleaseCandidateRequired: true` for alpha.4 version/docs changes.
- [x] Record that P9-6 must generate fresh main release-candidate evidence after the P9-5 merge before any human publish decision.
- [x] Record that `0.1.0-alpha.2` is published but its immutable npm tarball contains stale pre-publish package docs.
- [x] Keep `0.1.0-alpha.3` documented as the previous corrective pre-alpha release for package consumers.
- [x] Keep `0.1.0-alpha.1` and GitHub pre-release `v0.1.0-alpha.1` documented as earlier alpha history.
- [x] Keep `0.1.0-alpha.0` documented as deprecated because its immutable package docs shipped stale pre-publish state.
- [x] Keep npm registry metadata and GitHub Releases as the source of truth for available versions and dist-tags.
- [x] Add a local packaged-docs gate that runs an actual pack, unpacks the tarball, and scans the docs that enter the package.
- [x] Add a published verification gate that downloads and unpacks `agent-cli-runtime@<version>` from the npm registry before accepting package-docs state.
- [x] Keep `.release-evidence/` and `.reference/` outside npm package contents.
- [x] Keep volatile run ids, artifact ids, artifact digests, tarball hashes, pack hashes, local temporary paths, raw logs, raw CLI output, full prompts, and token-looking values outside packaged docs.

## Local Verification

Run these before treating a future alpha version as a local release candidate:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run stable:surface:check
npm run package:check
npm run package:docs:check
npm run compat:real:evidence:verify
npm run release:candidate -- --out-dir <tmp-dir>
npm run release:verify -- --dir <tmp-dir>
npm pack --dry-run
npm publish --dry-run --ignore-scripts --tag alpha
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
git diff --check
```

Acceptance:

- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` passes.
- [x] `npm run build` passes before build-output gates.
- [x] `npm run stable:surface:check` passes with `schemaVersion: "agent-cli-runtime.stableSurfaceCheck.v1"` and keeps package-root value exports limited to `createAgentRuntime`.
- [x] `npm run package:check` passes and rejects `.release-evidence/` plus `.reference/` if they appear in pack metadata.
- [x] `npm run package:docs:check` unpacks the local tarball and rejects stale publish-state claims for this version, dry-run stop wording, publish-ready candidate wording, and old current dist-tag claims.
- [x] `npm run compat:real:evidence:verify` passes without launching authenticated real agent runs.
- [x] `npm run release:candidate -- --out-dir <tmp-dir>` produces the five-artifact release-candidate set.
- [x] `npm run release:verify -- --dir <tmp-dir>` passes with `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, `ok: true`, and empty diagnostics.
- [x] `gate-evidence.json` contains `daemon:verify`, `runtime:safety`, and `compat:real:evidence:verify`.
- [x] `npm pack --dry-run` shows only expected package files.
- [x] `npm publish --dry-run --ignore-scripts --tag alpha` passes as a dry-run and reports `tag alpha`.
- [x] `node ./dist/cli/main.js agents --json` returns parseable JSON.
- [x] `node ./dist/cli/main.js doctor --json` returns parseable JSON.
- [x] `git diff --check` passes.

## Human Publish Gate

Do not run a real publish, deprecate an existing version, or create/modify a GitHub Release without explicit maintainer authorization. Before any later publish:

- [ ] Trigger a fresh manual release-candidate workflow for the exact commit being considered.
- [ ] Download all five artifacts into a local review directory.
- [ ] Run `npm run release:verify -- --dir <normalized-artifact-dir>` on the downloaded artifacts.
- [ ] Confirm the workflow head SHA equals the commit selected for publish.
- [ ] Run `npm publish --dry-run --ignore-scripts --tag alpha`.
- [ ] Run `npm run package:docs:check` and confirm it inspected the local packed tarball.
- [ ] Obtain separate explicit maintainer authorization for the real publish.
- [ ] Run real `npm publish --tag alpha` only after that authorization.
- [ ] After publish, verify npm registry state, run the published package verification workflow, and confirm registry tarball docs pass `agent-cli-runtime.packagedDocsVerification.v1`.

## Release-Candidate Artifact Contract

The candidate artifact set is exactly:

- `agent-cli-runtime-tarball`
- `agent-cli-runtime-pack-metadata`
- `agent-cli-runtime-package-files`
- `agent-cli-runtime-gate-evidence`
- `agent-cli-runtime-release-verification`

`agent-cli-runtime-gate-evidence` must record:

- `daemon:verify`
- `runtime:safety`
- `compat:real:evidence:verify`

It must also keep:

- `noAuthenticatedRealRun: true`
- `noNpmPublish: true`
- `noNpmToken: true`

## Package Boundary

The package must not contain:

- `.release-evidence/`
- `.reference/`
- `tests/`
- fixtures
- raw real CLI output
- local temporary review directories
- private user paths
- full prompts
- raw stdout/stderr transcripts
- token-looking values
- Bearer values
- auth environment assignment values

## Stable Contract Reminders

- The package root value export remains `createAgentRuntime`.
- The schema inventory and versioning policy live in [docs/api-schema-contract.md](./api-schema-contract.md).
- The daemon/product shell embedding contract lives in [docs/daemon-ready-contract.md](./daemon-ready-contract.md).
- `agent-cli-runtime.releaseVerification.v1`, `agent-cli-runtime.releaseGateEvidence.v1`, `agent-cli-runtime.mainReleaseCandidateEvidence.v1`, `agent-cli-runtime.packagedDocsVerification.v1`, and `agent-cli-runtime.stableSurfaceCheck.v1` are release or repository gate schemas.

## Schema Vocabulary

Smoke and conformance classifications remain:

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
