# Release Report: 0.1.0-alpha.2 Published

Status: `0.1.0-alpha.2` published on npm and GitHub pre-release
Last updated: 2026-06-25

This report is the packaged, stable release-state summary. Volatile release evidence such as current workflow run ids, artifact ids, artifact digests, tarball hashes, pack hashes, local temporary paths, command transcripts, raw logs, raw CLI output, prompt text, and token-looking values belongs outside the npm package under `.release-evidence/` or durable GitHub Release assets.

## Current State

- Published npm package: `agent-cli-runtime@0.1.0-alpha.2`.
- Published GitHub pre-release: `v0.1.0-alpha.2`.
- Previous npm package: `agent-cli-runtime@0.1.0-alpha.1`.
- Previous GitHub pre-release: `v0.1.0-alpha.1`.
- `agent-cli-runtime@0.1.0-alpha.0` is deprecated because its immutable package docs shipped stale pre-publish status text.
- `0.1.0-alpha.2` has fresh main release-candidate evidence, real publish evidence, registry verification, installed-package CLI smoke, and GitHub Release verification recorded outside the npm package.
- Current npm dist-tags are `alpha -> 0.1.0-alpha.2` and `latest -> 0.1.0-alpha.1`; while there is no stable version, this is recorded as current pre-alpha registry state rather than release failure evidence.

## Verdict

`0.1.0-alpha.2` is published after fresh main release-candidate evidence, downloaded artifact verification, local publish dry-run verification, explicit maintainer authorization, npm browser/2FA authorization, post-publish registry verification, installed-package CLI smoke, and GitHub pre-release creation.

- no npm token, `NODE_AUTH_TOKEN`, trusted publishing setup, or publish workflow secret is added;
- no authenticated real Codex/Claude/OpenCode run is launched by default gates;
- `.release-evidence/` and `.reference/` stay outside npm package contents;
- this package remains a local-first runtime/kernel, not a hosted daemon, control plane, API server, database/WAL, web UI, telemetry system, or remote worker.

## P7-4 Alpha.2 Publish Flow

The alpha.2 publish path used:

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
npm publish --ignore-scripts --tag alpha
npm view agent-cli-runtime@0.1.0-alpha.2 version --json
npm view agent-cli-runtime dist-tags --json
npm install agent-cli-runtime@0.1.0-alpha.2
gh release create v0.1.0-alpha.2 --target <target-sha> --prerelease
gh release view v0.1.0-alpha.2 --json tagName,targetCommitish,isPrerelease,url
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
git diff --check
```

The local dry-run command remains the pre-publish simulation for future immutable versions:

```bash
npm publish --dry-run --ignore-scripts --tag alpha
```

It must show a dry run with `tag alpha`. A future real publish requires explicit maintainer authorization after fresh current-head release-candidate evidence passes.

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

- Real CLI behavior, auth state, model lists, and flags can drift after dated compatibility evidence.
- npm dry-run output can vary by npm version and registry context, so the alpha dry-run remains a local manual safety gate rather than a required remote CI gate.
- Trusted publishing and provenance are not configured. Any future provenance claim must match the actual publish path.
