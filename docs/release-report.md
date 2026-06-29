# Release Report: 0.1.0-alpha.3 Corrective Release

Status: `0.1.0-alpha.3` corrective pre-alpha release
Last updated: 2026-06-29

This report is the packaged, stable release-state summary. Volatile release evidence such as current workflow run ids, artifact ids, artifact digests, tarball hashes, pack hashes, local temporary paths, command transcripts, raw logs, raw CLI output, prompt text, and token-looking values belongs outside the npm package under `.release-evidence/` or durable GitHub Release assets.

## Current State

- Corrective package line: `agent-cli-runtime@0.1.0-alpha.3`.
- `agent-cli-runtime@0.1.0-alpha.2` is published on npm and has GitHub pre-release `v0.1.0-alpha.2`, but its immutable npm tarball contains stale pre-publish package docs.
- `agent-cli-runtime@0.1.0-alpha.1` remains an earlier published alpha with GitHub pre-release `v0.1.0-alpha.1`.
- `agent-cli-runtime@0.1.0-alpha.0` is deprecated because its immutable package docs shipped stale pre-publish status text.
- npm registry metadata and GitHub Releases are the source of truth for available versions and dist-tags.
- `.release-evidence/` and `.reference/` stay outside npm package contents.

## Verdict

`0.1.0-alpha.3` is the corrective pre-alpha release for the stale alpha.2 package-docs incident. The release gate now verifies the docs that actually enter the tarball:

- local `npm pack` is unpacked and scanned by `npm run package:docs:check`;
- `npm run package:check` includes the packaged-docs check after the package boundary check;
- `npm run prepublish:check` includes the packaged-docs check through `npm run package:check`;
- post-publish verification downloads and unpacks the npm registry tarball before accepting package-docs state;
- later repository docs are not treated as proof that an already published immutable tarball was fixed.

The release remains local-first runtime/kernel scope:

- no npm token, `NODE_AUTH_TOKEN`, trusted publishing setup, or publish workflow secret is added;
- no authenticated real Codex/Claude/OpenCode run is launched by default gates;
- no daemon, hosted control plane, API server, database/WAL, web UI, telemetry system, or remote worker is added.

## P7-5 Alpha.3 Corrective Flow

The alpha.3 pre-publish path uses:

```bash
npm test
npm run typecheck
npm run lint
npm run package:check
npm run package:docs:check
npm run prepublish:check
npm publish --dry-run --ignore-scripts --tag alpha
npm pack --dry-run
git diff --check
```

The packaged-docs check runs an actual local pack and tarball extraction:

```bash
node ./scripts/check-packaged-docs.mjs
```

Published verification uses the registry package, not repo files:

```bash
node ./scripts/check-packaged-docs.mjs --package-spec agent-cli-runtime@0.1.0-alpha.3
npm run published:verify -- --out-dir published-verification
npm run published:verify:evidence -- --dir published-verification
```

`published:verify` creates the evidence file. `published:verify:evidence` verifies an existing local output directory or downloaded `agent-cli-runtime-published-verification` artifact directory; a bare verifier run without `published-verification/published-verification.json` exits `1` with redacted actionable JSON by design.

## Release-Candidate Artifacts

`npm run release:candidate -- --out-dir <tmp-dir>` writes local strict review artifacts. Remote clean-checkout workflows use `npm run release:candidate -- --out-dir release-candidate --real-compatibility-mode repo-only-skipped`. Both modes write five review artifacts:

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

The compatibility gate summary must include the verifier schema, verified matrix schema, target SHA status, freshness status, dirty policy status, and diagnostic count/codes. Local strict mode records matched/fresh release evidence and distinguishes clean input evidence, `self_dirty_only` matrix output-file writes, and explicitly allowed dirty input evidence. Remote repo-only skipped mode records `targetSha.status`, `freshness.status`, and `dirtyPolicy.status` as `repo_only_not_run` plus the fixed `repoOnlyEvidence.status: "not_refreshed_in_ci"` reason. It must not include the raw `.release-evidence/` matrix, raw stdout/stderr, prompt text, private paths, tokens, Bearer values, or auth environment values. The gate evidence must keep `noAuthenticatedRealRun`, `noNpmPublish`, and `noNpmToken` true.

P8-4 release-strict compatibility closure uses `.release-evidence/p8-4-release-strict-compatibility.json` as the repo-only summary. It records the target SHA, matrix/verifier schemas, strict compatibility verifier result, local strict `release:candidate` and `release:verify` summary, remote workflow trigger state, downloaded-artifact verification state, and branch/main evidence decision. A target SHA that is not in `origin/main` remains branch/local evidence with `mainEvidence: false`; fresh `main` release-candidate evidence requires a workflow run whose `headSha` equals the target SHA and whose downloaded five artifacts pass `npm run release:verify -- --dir <normalized-downloaded-artifact-dir>`.

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

`npm run package:check`, `npm run package:docs:check`, `npm pack --dry-run`, and `npm run release:verify -- --dir <tmp-dir>` enforce this boundary.

## Schema And Compatibility Contracts

The API and CLI schema inventory, versioning policy, root export boundary, and failure taxonomy are maintained in [docs/api-schema-contract.md](./api-schema-contract.md). The release-facing schemas are:

- `agent-cli-runtime.releaseVerification.v1`
- `agent-cli-runtime.releaseGateEvidence.v1`
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
