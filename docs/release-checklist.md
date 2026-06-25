# Release Checklist (pre-alpha / developer preview)

Status: `0.1.0-alpha.1` published; `0.1.0-alpha.2` candidate / prep
Last updated: 2026-06-25

## P7-1 Alpha.2 Candidate Prep

- [x] Confirm P6-6 has reached `origin/main` before creating the P7-1 branch.
- [x] Prepare package metadata for `0.1.0-alpha.2` in `package.json` and `package-lock.json`.
- [x] Keep `0.1.0-alpha.2` as a candidate / prep version only; do not describe it as published.
- [x] Keep the current published npm version as `agent-cli-runtime@0.1.0-alpha.1`.
- [x] Keep the current GitHub pre-release as `v0.1.0-alpha.1`.
- [x] Keep current npm dist-tags documented as `alpha -> 0.1.0-alpha.1` and `latest -> 0.1.0-alpha.1`.
- [x] Keep `agent-cli-runtime@0.1.0-alpha.0` documented as deprecated due to stale immutable package docs.
- [x] Keep volatile run ids, artifact ids, artifact digests, tarball hashes, pack hashes, local temporary paths, raw logs, raw CLI output, full prompts, and token-looking values outside packaged docs.
- [x] Keep `.release-evidence/` and `.reference/` outside npm package contents.

## Local Verification

Run these before treating alpha.2 as a local release candidate:

```bash
npm test
npm run typecheck
npm run lint
npm run package:check
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
- [x] `npm run package:check` passes and rejects `.release-evidence/` plus `.reference/` if they appear in pack metadata.
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

Do not run a real publish during P7-1. Before any later publish:

- [ ] Trigger a fresh manual release-candidate workflow for the exact commit being considered.
- [ ] Download all five artifacts into a local review directory.
- [ ] Run `npm run release:verify -- --dir <normalized-artifact-dir>` on the downloaded artifacts.
- [ ] Confirm the workflow head SHA equals the commit selected for publish.
- [ ] Run `npm publish --dry-run --ignore-scripts --tag alpha`.
- [ ] Obtain separate explicit maintainer authorization for the real publish.
- [ ] Run real `npm publish --tag alpha` only after that authorization.
- [ ] After publish, verify npm registry state and run the published package verification workflow.

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
- `agent-cli-runtime.releaseVerification.v1` and `agent-cli-runtime.releaseGateEvidence.v1` are the release artifact schemas.
- `real_run_skipped`, `auth_missing`, `unsupported_flag`, and `needs_verification` are evidence states, not success.
- Frozen smoke/conformance classifications: `success`, `real_run_skipped`, `auth_missing`, `unavailable_executable`, `unsupported_flag`, `needs_verification`, `unexpected_output`, `cwd_mutated`, `timeout`, and `failed`.
- This repository remains a local-first runtime/kernel and does not include a hosted daemon, control plane, API server, database/WAL, web UI, telemetry, or remote worker.
