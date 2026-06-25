# Release Report: 0.1.0-alpha.2 Publish Dry-Run

Status: `0.1.0-alpha.1` published; `0.1.0-alpha.2` publish-ready release candidate / dry-run stop point
Last updated: 2026-06-25

This report is the packaged, stable release-state summary. Volatile release evidence such as current workflow run ids, artifact ids, artifact digests, tarball hashes, pack hashes, local temporary paths, command transcripts, raw logs, raw CLI output, prompt text, and token-looking values belongs outside the npm package under `.release-evidence/` or durable GitHub Release assets.

## Current State

- Published npm package: `agent-cli-runtime@0.1.0-alpha.1`.
- Published GitHub pre-release: `v0.1.0-alpha.1`.
- `agent-cli-runtime@0.1.0-alpha.0` is deprecated because its immutable package docs shipped stale pre-publish status text.
- Candidate package metadata in this repository: `agent-cli-runtime@0.1.0-alpha.2`.
- `0.1.0-alpha.2` has fresh main release-candidate evidence and local publish dry-run evidence.
- `0.1.0-alpha.2` is not published and must not be described as published until a maintainer separately authorizes a real npm publish.
- Current npm dist-tags remain `alpha -> 0.1.0-alpha.1` and `latest -> 0.1.0-alpha.1`; while there is no stable version, this is recorded as current pre-alpha registry state rather than release failure evidence.

## Verdict

`0.1.0-alpha.2` is ready to be treated as a publish-ready release candidate after fresh main release-candidate evidence, downloaded artifact verification, and local publish dry-run verification. It remains human-controlled:

- no real `npm publish` is performed without explicit maintainer authorization;
- no GitHub Release is created without explicit maintainer authorization;
- no npm token, `NODE_AUTH_TOKEN`, trusted publishing setup, or publish workflow secret is added;
- no authenticated real Codex/Claude/OpenCode run is launched by default gates;
- `.release-evidence/` and `.reference/` stay outside npm package contents;
- this package remains a local-first runtime/kernel, not a hosted daemon, control plane, API server, database/WAL, web UI, telemetry system, or remote worker.

## P7-3 Alpha.2 Publish Dry-Run Flow

The human-controlled alpha.2 path is:

```bash
npm run typecheck
npm run lint
npm test
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

The dry-run command is the current stop point:

```bash
npm publish --dry-run --ignore-scripts --tag alpha
```

It must show a dry run with `tag alpha`. A real publish requires a separate explicit maintainer authorization after fresh current-head release-candidate evidence passes.

## Release-Candidate Artifacts

`npm run release:candidate -- --out-dir <tmp-dir>` writes five review artifacts:

- `agent-cli-runtime-tarball`
- `agent-cli-runtime-pack-metadata`
- `agent-cli-runtime-package-files`
- `agent-cli-runtime-gate-evidence`
- `agent-cli-runtime-release-verification`

`npm run release:verify -- --dir <tmp-dir>` emits `schemaVersion: "agent-cli-runtime.releaseVerification.v1"` and must return `ok: true` with empty diagnostics before the candidate can proceed.

`gate-evidence.json` must use `schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1"` and include:

- `daemon:verify`
- `runtime:safety`
- `compat:real:evidence:verify`

The gate evidence must keep `noAuthenticatedRealRun`, `noNpmPublish`, and `noNpmToken` true.

## Package Boundary

The npm package may include stable docs, examples, `dist/`, and the runtime entrypoints. It must not include:

- `.release-evidence/`
- `.reference/`
- `tests/`
- `tests/fixtures/`
- fault fixtures
- raw real CLI output
- local temporary review directories
- private user paths
- raw prompts or full command transcripts
- token-looking values, Bearer values, or auth environment assignment values

`npm run package:check`, `npm pack --dry-run`, and `npm run release:verify -- --dir <tmp-dir>` enforce this boundary.

## P6 Evidence Boundary

P6 added the offline real compatibility evidence verifier and proved that the release-candidate gate can carry compatibility evidence without launching authenticated real agent runs. The current packaged report records only the stable rule:

- `compat:real:evidence:verify` is part of `prepublish:check` and `release:candidate`;
- the verifier reads repo-only evidence under `.release-evidence/`;
- `dogfood` and normal CI do not depend on repo-only compatibility evidence;
- release gate summaries keep only command, ok state, schema versions, and redacted diagnostic count/codes.

Detailed P6-4, P6-5, and P6-6 run/artifact summaries are repo-local evidence files under `.release-evidence/`. They are not package content and must not be copied into README or packaged docs.

## Schema And Compatibility Contracts

The API and CLI schema inventory, versioning policy, root export boundary, and failure taxonomy are maintained in [docs/api-schema-contract.md](./api-schema-contract.md). The release-facing schemas are:

- `agent-cli-runtime.releaseVerification.v1`
- `agent-cli-runtime.releaseGateEvidence.v1`
- `agent-cli-runtime.realCompatibilityEvidenceVerification.v1`
- `agent-cli-runtime.realCompatibilityEvidence.v1`

Skipped evidence is not success, `auth_missing` is not unavailable, and `needs_verification` must not be guessed into support.

## Known Risks

- `0.1.0-alpha.2` is still unpublished; registry and GitHub Release post-publish verification can only run after explicit real publish authorization.
- Real CLI behavior, auth state, model lists, and flags can drift after dated compatibility evidence.
- npm dry-run output can vary by npm version and registry context, so the alpha dry-run remains a local manual safety gate rather than a required remote CI gate.
- Trusted publishing and provenance are not configured. Any future provenance claim must match the actual publish path.
