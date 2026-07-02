# Release Checklist (pre-alpha / developer preview)

Status: `0.1.0-alpha.5` is the published corrective alpha release; npm `alpha` and `latest` point at alpha.5
Last updated: 2026-07-02

## P9 Alpha.5 Corrective Release State

- [x] Prepare package metadata for `0.1.0-alpha.5` in `package.json` and `package-lock.json`.
- [x] Keep `publishConfig.tag` set to `alpha`.
- [x] Document `0.1.0-alpha.5` as the published corrective alpha release that replaces stale alpha.4 package docs for package consumers.
- [x] Complete prepublish fresh release-candidate evidence for the alpha.5 publish target.
- [x] Publish `agent-cli-runtime@0.1.0-alpha.5` to npm with `npm publish --tag alpha` after explicit maintainer authorization.
- [x] Set npm `latest` to `0.1.0-alpha.5` after successful alpha.5 publish.
- [x] Record that `agent-cli-runtime@0.1.0-alpha.5` is published on npm.
- [x] Record that npm alpha dist-tag points at `0.1.0-alpha.5`.
- [x] Record that npm latest dist-tag points at `0.1.0-alpha.5`.
- [x] Verify npm registry state: `agent-cli-runtime@0.1.0-alpha.5` exists, `alpha` points at alpha.5, and `latest` points at alpha.5.
- [x] Create GitHub Release `v0.1.0-alpha.5` as a prerelease, keep it out of GitHub latest release, attach the npm registry tarball asset, and record that GitHub Release tarball parity verification passes.
- [x] Rerun `published:verify` and `published:verify:evidence` against the published alpha.5 npm registry package; both pass.
- [x] Keep package docs free of old unpublished-state, missing-release-asset, or latest-alpha1 claims.
- [x] Publish `agent-cli-runtime@0.1.0-alpha.4` to npm with the `alpha` dist-tag.
- [x] Record alpha.4 as historical published pre-alpha state after alpha.5 became the current `alpha` and `latest` dist-tag target.
- [x] Record that the immutable `0.1.0-alpha.4` npm tarball contains stale release-prep package docs.
- [x] Record that `agent-cli-runtime@0.1.0-alpha.4` is published on npm with the `alpha` dist-tag.
- [x] Create GitHub Release `v0.1.0-alpha.4`, attach the npm registry tarball asset, and record that GitHub Release tarball parity verification passes.
- [x] Keep P9 stable surface gate coverage visible through `npm run stable:surface:check`.
- [x] Keep P9-4 fresh main release-candidate evidence package-out and exact-SHA scoped.
- [x] Record that package-content comparison against the P9-4 release target must show package-visible drift and `freshReleaseCandidateRequired: true` for alpha.4 version/docs changes.
- [x] Record that P9-6 generated fresh main release-candidate evidence after the P9-5 merge.
- [x] Record that P9-7 authorized npm publish and captured post-publish registry state under `.release-evidence/`.
- [x] Record that P9-9 authorized alpha.5 npm publish, latest retag, GitHub Release parity, and post-publish verification under `.release-evidence/`.
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

Do not run another real publish, deprecate an existing version, modify dist-tags, unpublish, or create/modify a GitHub Release without explicit maintainer authorization. For alpha.4:

- [x] Trigger fresh main release-candidate evidence for the release target.
- [x] Confirm package content equivalence from the P9-6 release target to the evidence-recording publish HEAD.
- [x] Run `npm publish --dry-run --ignore-scripts --tag alpha`.
- [x] Run real `npm publish --tag alpha` only after explicit maintainer authorization.
- [x] Verify npm registry state: `agent-cli-runtime@0.1.0-alpha.4` exists, `alpha` points at alpha.4, and `latest` remains alpha.1.
- [x] Run published verification against npmjs.
- [x] Confirm registry tarball docs are inspected by `agent-cli-runtime.packagedDocsVerification.v1`.
- [x] Create GitHub Release `v0.1.0-alpha.4` and attach the npm registry tarball asset after separate explicit maintainer authorization.
- [x] Rerun `release:post-alpha:verify` after GitHub Release assets exist; tarball parity passes.
- [x] Rerun aggregate `published:verify:evidence` after GitHub Release assets exist; it still fails only because the immutable npm tarball contains stale release-prep package docs.
- [x] `0.1.0-alpha.5` publish was executed after fresh release-candidate evidence and explicit maintainer authorization.
- [x] Published alpha.5 verification was rerun with `published:verify` and `published:verify:evidence` against the npm registry package.
- [x] Move npm `latest` to `0.1.0-alpha.5` after alpha.5 publish and verify both `alpha` and `latest` point at alpha.5.
- [x] Create GitHub Release `v0.1.0-alpha.5` as a prerelease with the npm registry tarball asset after explicit maintainer authorization.
- [x] Rerun `release:post-alpha:verify` after GitHub Release assets exist; tarball parity passes for alpha.5.
- [ ] For any future beta or stable promotion, regenerate fresh release evidence for that target before a new registry or release mutation.

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
