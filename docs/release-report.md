# Release Report: 0.1.0-alpha.0 P2-12

Status: P2-12 Remote Release Candidate Evidence Closure
Last updated: 2026-06-20

This report records release-candidate evidence for `agent-cli-runtime@0.1.0-alpha.0`. It is a pre-alpha developer-preview release candidate audit, not an npm publication record.

## Verdict

The release candidate has real GitHub Actions release-candidate evidence: the manual workflow ran successfully, uploaded the expected artifacts, and the downloaded artifacts passed local machine verification. It is not published to npm, does not claim a stable API, and does not claim OpenDesign daemon parity.

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
- The CI dogfood job runs once on Node.js 22 and executes `npm run dogfood` without passing `--allow-real-run`.
- `.github/workflows/release-candidate.yml` is manual `workflow_dispatch` only.
- The release-candidate workflow runs `npm ci`, `npm run ci`, `npm run dogfood`, creates npm pack metadata, verifies the generated artifacts through `npm run release:verify`, and uploads artifacts.
- No workflow runs `npm publish`, sets `NODE_AUTH_TOKEN`, or requires an npm token.

Remote GitHub Actions evidence for this candidate is run `27869580048`. Do not reuse it as evidence for later commits.

## Release-Candidate Artifacts

The manual release-candidate workflow uploads:

- `agent-cli-runtime-tarball`: the packed `agent-cli-runtime-0.1.0-alpha.0.tgz` tarball.
- `agent-cli-runtime-pack-metadata`: `release-candidate/npm-pack.json` from `npm pack --json`.
- `agent-cli-runtime-package-files`: `release-candidate/package-files.txt`, one packed package path per line.
- `agent-cli-runtime-release-verification`: `release-candidate/release-verification.json` from `npm run release:verify`.

Artifacts are retained for 14 days to keep the audit window explicit while avoiding long-lived stale release-candidate evidence.

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

The command writes `npm-pack.json`, `package-files.txt`, the tarball, and `release-verification.json` to the chosen directory. It does not run `npm publish` and should not leave a tarball in the repository root.

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
- Includes `dist/`, README files, LICENSE, docs, examples, `scripts/dogfood.mjs`, and release docs.
- Package root value API remains limited to `createAgentRuntime`; public TypeScript types remain type exports.

## Package Boundary

`npm run package:check` is the local package boundary gate. It checks npm pack file paths and scans committed docs/examples/scripts for private paths and token-looking content. The release report itself is included in the package so consumers can inspect the candidate evidence and non-goals.

`npm run release:verify` is the release artifact gate for generated or downloaded artifacts. It validates npm pack JSON, package file list parity, tarball filename/path/existence, disallowed package paths, private paths, and token-looking values, then emits stable redacted JSON.

## Real CLI Evidence Boundary

Default release gates do not launch authenticated real agent runs. `conformance --mode real --agent all --json` performs real local executable/version/auth/model/profile certification and reports `real_run_skipped`, `auth_missing`, `unsupported_flag`, or `needs_verification` honestly.

Authenticated real runs require explicit `--allow-real-run` and remain local/manual evidence.

## Known Risks

- Remote GitHub Actions evidence is commit-specific; run `27869580048` only proves commit `2f8832119b4ebdb8393077052560589a398ebf56`.
- Real CLI behavior, auth state, model lists, and flags can drift after this dated evidence.
- OpenCode explicit read-only/workspace-write flags, extra dirs, and session/resume remain in `needsVerification`.
- Claude Code authenticated run smoke depends on local auth or a correctly configured provider environment.
- npm dry-run output can vary by npm version and registry context, so it remains a manual/local gate rather than a flaky CI requirement.

## Explicit Non-Goals

- Do not publish npm.
- Do not require npm token or registry credentials.
- Do not claim stable API.
- Do not claim OpenDesign daemon parity.
- Do not add daemon, database, WAL, remote worker, web UI, telemetry, or scheduler expansion.
- Do not convert `real_run_skipped`, `auth_missing`, `unsupported_flag`, or `needs_verification` into real agent run success.
