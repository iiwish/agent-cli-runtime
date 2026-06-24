# Release Report: 0.1.0-alpha.1 post-alpha evidence normalization

Status: `0.1.0-alpha.1` published; post-alpha evidence normalized
Last updated: 2026-06-24

This report records release-candidate, alpha publish-readiness, daemon-ready contract hardening, P3-6 real CLI opt-in smoke evidence, P3-7 API / CLI schema freeze evidence, the P3-11 non-package evidence boundary, and the post-alpha evidence path for `agent-cli-runtime@0.1.0-alpha.1`. Immutable npm version `0.1.0-alpha.0` was published and has GitHub pre-release `v0.1.0-alpha.0`, but its package docs contain stale pre-publish status text; `0.1.0-alpha.0` is now deprecated. `agent-cli-runtime@0.1.0-alpha.1` is published to npm and has GitHub pre-release `v0.1.0-alpha.1`. P5-4 closes the remote published-package verification evidence loop for the current verification workflow by storing volatile run and artifact metadata outside the npm package. P6-4 closes remote release-candidate evidence for the P6-3 branch target SHA `59b8c00a4ef79356fcba30fb526eab2f158bcdf3`; because that SHA was not on `origin/main` at trigger time, it is branch evidence, not main evidence.

Current npm registry state:

- Versions: `0.1.0-alpha.0`, `0.1.0-alpha.1`.
- Dist-tags: `alpha -> 0.1.0-alpha.1`, `latest -> 0.1.0-alpha.1`.
- `latest -> 0.1.0-alpha.1` is recorded as current registry reality while there is no stable version; it is not treated as release failure evidence.
- npm registry dist shasum for `0.1.0-alpha.1`: `5b6062197b5f5543010e364da625ac682c5b087c`.
- npm registry integrity for `0.1.0-alpha.1`: `sha512-+bWmKNGlzEo9FC2HnoT2MQBZ2d1D6AYnEv9XbCfTntkVg47lfetyVuMjKML/FHUIsIc7t+WE3bVQu7AEKCdFLw==`.
- GitHub pre-release: `v0.1.0-alpha.1`.

## Verdict

P3-7 freezes the public root boundary, daemon-facing CLI JSON schema inventory, version bump policy, and failure taxonomy in [docs/api-schema-contract.md](./api-schema-contract.md), with drift tests tying the docs to source-level schema/failure vocabularies.

P3-11 moves current-head release-candidate run evidence out of packaged docs: volatile run ids, artifact ids, artifact digests, tarball shasums, and pack shasums belong under `.release-evidence/` or durable GitHub Release assets. Packaged docs keep stable rules only: trigger a fresh release-candidate workflow for the commit being considered, download all five artifacts, run `npm run release:verify -- --dir <normalized-artifact-dir>`, verify the workflow head SHA equals that commit, and run `npm publish --dry-run --ignore-scripts --tag alpha` before any separately authorized real publish.

It preserves the product boundary: no new npm publish, no trusted publishing setup, no committed npm token, no daemon/API server, no database/WAL, no remote worker, no UI/telemetry layer, and no authenticated real agent run in default gates. Historical P3-9 run `27943672095` only proves target SHA `65fac505ca3eb830a06d8656068cf4ed5f6dd46a`; Historical P3-9 interim run `27942743285` only proves target SHA `a0299a7d81bb614661922bebc8c75496cf0a3d11` before the strict `fixtures?` package-boundary lock; historical P3-8 run `27940814340` only proves target SHA `eb8de0f9b1edfa3f94c35a50b31005c5d3c105d4`; historical P3-5 run `27932628093` only proves workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`; historical P2-12 run `27869580048` only proves commit `2f8832119b4ebdb8393077052560589a398ebf56`. The package remains a pre-alpha developer preview, does not claim a stable API, and does not claim OpenDesign daemon parity.

## P6-4 Remote Release-Candidate Branch Evidence Closure

P6-4 records fresh remote release-candidate workflow evidence for branch `codex/p6-3-offline-compat-gate` and target SHA `59b8c00a4ef79356fcba30fb526eab2f158bcdf3`. At trigger time, `origin/main` was `c65d21c104e743551d12da31635d90fe5bdfbec8`, so this evidence must not be described as current main evidence. It proves only the branch workflow `headSha` and downloaded artifacts for that SHA.

Remote workflow evidence:

- Trigger command: `gh workflow run release-candidate.yml --ref codex/p6-3-offline-compat-gate`.
- Run id: `28089574967`.
- Run URL: `https://github.com/iiwish/agent-cli-runtime/actions/runs/28089574967`.
- Event: `workflow_dispatch`.
- Run status/conclusion: `completed` / `success`.
- Run created/updated: `2026-06-24T09:41:07Z` / `2026-06-24T09:42:24Z`.
- Job `Build release candidate artifacts` id `83163923943` completed with conclusion `success`.
- Steps `Run CI gate`, `Run dogfood gate without authenticated real runs`, `Create npm pack artifact and gate evidence without publishing`, `Upload tarball`, `Upload pack metadata`, `Upload package file list`, `Upload daemon-ready gate evidence`, and `Upload release verification` all concluded `success`.

Downloaded artifact re-verification:

- Artifacts: `agent-cli-runtime-tarball`, `agent-cli-runtime-pack-metadata`, `agent-cli-runtime-package-files`, `agent-cli-runtime-gate-evidence`, and `agent-cli-runtime-release-verification`.
- Verification command: `npm run release:verify -- --dir <normalized-downloaded-artifact-dir>`.
- Verification result: `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, `ok: true`, diagnostics empty, package file count `151`, package `agent-cli-runtime@0.1.0-alpha.1`, and tarball `agent-cli-runtime-0.1.0-alpha.1.tgz`.
- `gate-evidence.json` records `daemon:verify`, `runtime:safety`, and `compat:real:evidence:verify`.
- The compatibility verifier gate records `outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1"`, `evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1"`, and diagnostics only as `{ count: 0, codes: [] }`.
- The gate evidence confirms `noAuthenticatedRealRun: true`, `noNpmPublish: true`, and `noNpmToken: true`.

Repo-only evidence is recorded in `.release-evidence/p6-4-remote-release-candidate.json`. That file stores run/artifact/gate summaries only and intentionally excludes raw workflow logs, raw CLI output, full prompts, private absolute paths, local temp download paths, token values, Bearer values, and auth env assignment values. If P6-3 is later merged into `main`, a new fresh release-candidate workflow on `main` is required before claiming main evidence for the merged commit.

## P3-11 Current-Head Evidence Boundary

P3-11 solves the P3-10 self-reference problem by separating stable package docs from volatile current-run evidence:

- Package docs may describe the release-candidate workflow, required artifacts, verification command, dry-run boundary, human publish gate, and historical evidence as historical only.
- Package docs must not record the current run id, artifact ids, artifact digests, tarball shasum, npm pack shasum, or private downloaded-artifact paths for the commit being considered.
- Volatile current-head evidence is recorded under `.release-evidence/`, which is outside `package.json` `files` and is explicitly rejected by package-boundary checks if it appears in npm pack metadata.
- A release-candidate workflow proves only the commit in its `headSha`. Historical runs must not be reused as proof for later commits.
- A dry-run is not a real publish. A true npm publish remains human-gated and requires a later explicit authorization.

## P5-4 Remote Published Verification Evidence Closure

P5-4 records the fresh remote `Published Package Verification` workflow result outside the npm package in `.release-evidence/p5-4-published-verification.json`.

That package-out evidence file records the target SHA, run id, run URL, status/conclusion, artifact id/digest/size/expiry, downloaded verification schema/ok result, checked gate summaries, registry version/dist-tags, and the redacted local verification command. The packaged report intentionally does not inline the current run id or artifact id.

The workflow proves only its own `headSha`. It must not be reused as evidence for future commits, future workflow changes, a future npm publish, or authenticated real Codex/Claude/OpenCode success. The P5-4 workflow is post-publish verification of the already published package: it does not publish npm, modify dist-tags, configure npm tokens, configure trusted publishing/provenance, or add daemon/API server/database/WAL/remote worker/UI/telemetry surfaces.

Downloaded artifact re-verification command:

```bash
npm run published:verify:evidence -- --dir <normalized-downloaded-artifact-dir>
```

Required downloaded verification result:

- `schemaVersion: "agent-cli-runtime.publishedVerification.v1"`.
- `ok: true`.
- Gates `smoke:published`, `published:daemon:verify`, `published:adapters:verify`, and `release:post-alpha:verify` all pass.
- `registry.ok: true`.
- `noAuthenticatedRealRun`, `noNpmPublish`, and `noNpmToken` are all `true`.

## P3-10 Pre-Documentation Alpha Release Candidate Evidence

P3-10 refreshes release-candidate evidence for pre-documentation HEAD SHA `fdba3ebccb2e57a0ad295101028a2a3937a92204` after the P3-9 evidence-recording repair commit. It does not add runtime APIs, publish npm, configure npm tokens/trusted publishing, execute authenticated real agent runs, or add daemon/API server/database/WAL/remote-worker/UI/telemetry layers.

This report is the repository-resident evidence packet. The remote workflow evidence is intentionally commit-specific and proves only the pre-documentation SHA above and the tarball produced from that SHA. Run `27945938663` must not be used as final post-documentation publish evidence.

This repository includes `docs/release-report.md`, `docs/release-checklist.md`, `docs/release-publish-runbook.md`, and other release docs in `package.json` `files`. This means committing this packet changes the package shasum. Any commit that records the P3-10 evidence packet changes packaged content and therefore changes `npm pack` shasum. The final package selected for a real publish must be proven by a fresh release-candidate workflow after committing this packet, then re-downloaded and re-verified before publish.

Historical runs, including P3-9 run `27943672095`, must not be reused for this stage. The rule for later evidence-recording commits is that each must trigger its own fresh release-candidate run before being described as current release-candidate evidence.

Evidence target and worktree state before remote trigger:

- Branch: `main`.
- Pre-documentation HEAD SHA: `fdba3ebccb2e57a0ad295101028a2a3937a92204`.
- Initial worktree before the P3-10 remote trigger: clean.
- Local `main`, `origin/main`, and `HEAD` all resolved to `fdba3ebccb2e57a0ad295101028a2a3937a92204` before triggering the workflow.

P3-10 local validation evidence on 2026-06-22:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed with 196 tests and 1 skipped installed-package smoke.
- `npm run build`: passed.
- `npm run package:check`: passed with `package boundary ok: 151 files checked`.
- `npm run dogfood`: passed.
- `npm run daemon:verify`: passed with `schemaVersion: "agent-runtime.daemonVerification.v1"`, `ok: true`, and `packageSource: "installed-tarball"`.
- `npm run runtime:safety`: passed with `schemaVersion: "agent-runtime.runtimeSafety.v1"`, `ok: true`, and `packageSource: "installed-tarball"`.
- `npm run release:candidate -- --out-dir /tmp/agent-runtime-p3-10-local-release-candidate`: passed, producing `agent-cli-runtime-0.1.0-alpha.0.tgz`, `npm-pack.json`, `package-files.txt`, `gate-evidence.json`, and `release-verification.json`.
- `npm run release:verify -- --dir /tmp/agent-runtime-p3-10-local-release-candidate`: passed with `schemaVersion: "agent-cli-runtime.releaseVerification.v1"`, `ok: true`, package file count `151`, five artifact names, empty diagnostics, and gate evidence for `daemon:verify` plus `runtime:safety`.
- `npm audit --omit=dev`: passed with `found 0 vulnerabilities`.
- `npm pack --dry-run --json --ignore-scripts`: passed with `151` files and tarball `agent-cli-runtime-0.1.0-alpha.0.tgz`.
- `npm publish --dry-run --ignore-scripts --tag alpha`: passed as a dry-run; npm reported `Publishing to https://registry.npmjs.org/ with tag alpha and default access (dry-run)` and did not publish.
- `node ./dist/cli/main.js agents --json`: passed; Codex `codex-cli 0.142.0-alpha.6` and OpenCode `1.15.6` available, Claude Code `2.1.178` available with `auth_missing`.
- `node ./dist/cli/main.js doctor --json`: passed with `ok: true`; Claude Code remains `auth_missing`.
- `node ./dist/cli/main.js conformance --mode real --agent all --json`: passed without `--allow-real-run`; Codex and OpenCode reported `real_run_skipped`, Claude Code reported `auth_missing`.
- `node ./dist/cli/main.js smoke --mode real --agent codex --json`: exited `0` as safe preflight with `schemaVersion: "agent-runtime.realSmoke.v1"`, `ok: false`, and `runClassification: "real_run_skipped"`; no authenticated real run was launched.
- `git diff --check`: passed.

Remote workflow pre-documentation evidence:

- Branch: `main`.
- Workflow head SHA: `fdba3ebccb2e57a0ad295101028a2a3937a92204`.
- Trigger command: `gh workflow run release-candidate.yml --ref main`.
- Run id: `27945938663`.
- Run URL: `https://github.com/iiwish/agent-cli-runtime/actions/runs/27945938663`.
- Event: `workflow_dispatch`.
- Workflow: `Release Candidate`.
- Run status/conclusion: `completed` / `success`.
- Run created/updated: `2026-06-22T10:22:12Z` / `2026-06-22T10:23:33Z`.
- Job `Build release candidate artifacts` id `82690587870`, URL `https://github.com/iiwish/agent-cli-runtime/actions/runs/27945938663/job/82690587870`, started at `2026-06-22T10:22:18Z`, completed at `2026-06-22T10:23:33Z`, and concluded `success`.
- Steps `Install dependencies`, `Run CI gate`, `Run dogfood gate without authenticated real runs`, `Create npm pack artifact and gate evidence without publishing`, `Upload tarball`, `Upload pack metadata`, `Upload package file list`, `Upload daemon-ready gate evidence`, and `Upload release verification` all concluded `success`.
- Download directory: `/tmp/agent-runtime-p3-10-current-head-remote-66VIhN/downloaded`.
- Normalized review directory: `/tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized`.

Current artifact metadata from the GitHub Actions API:

| Artifact | GitHub artifact id | Archive size | Digest | Expires |
| --- | ---: | ---: | --- | --- |
| `agent-cli-runtime-tarball` | `7789535097` | `225632` bytes | `sha256:698d80cd9ce86643396d7c9305424ac0f85cfe9d11bca654912048ed92118a34` | `2026-07-06T10:23:22Z` |
| `agent-cli-runtime-pack-metadata` | `7789535626` | `1998` bytes | `sha256:6c902654a5a8ddc8c5cb59c63efd82ef600d81488efc9eab7c98669a3e8eb564` | `2026-07-06T10:23:24Z` |
| `agent-cli-runtime-package-files` | `7789536134` | `961` bytes | `sha256:18b8adab4fc43d54389137cbdcf6db8e744f0a12c9498f88c0238c759ce39b79` | `2026-07-06T10:23:25Z` |
| `agent-cli-runtime-gate-evidence` | `7789536677` | `443` bytes | `sha256:458f63ff6b59a7b16ec8a918d7253a12e000563a7f9452ae932924902b6e0179` | `2026-07-06T10:23:27Z` |
| `agent-cli-runtime-release-verification` | `7789537198` | `649` bytes | `sha256:27e094fd6aad1b317d9073bef75a27336fe08850592c408d8861eb14df6e7633` | `2026-07-06T10:23:28Z` |

Downloaded artifact normalization:

```bash
gh run download 27945938663 --dir /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/downloaded
cp /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/downloaded/agent-cli-runtime-tarball/agent-cli-runtime-0.1.0-alpha.0.tgz /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized/
cp /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/downloaded/agent-cli-runtime-pack-metadata/npm-pack.json /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized/
cp /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/downloaded/agent-cli-runtime-package-files/package-files.txt /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized/
cp /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/downloaded/agent-cli-runtime-gate-evidence/gate-evidence.json /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized/
cp /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/downloaded/agent-cli-runtime-release-verification/release-verification.json /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized/
npm run release:verify -- --dir /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized
```

Downloaded artifact re-verification result:

- `schemaVersion`: `agent-cli-runtime.releaseVerification.v1`
- `ok`: `true`
- diagnostics: empty
- package file count: `151`
- artifact names: `agent-cli-runtime-tarball`, `agent-cli-runtime-pack-metadata`, `agent-cli-runtime-package-files`, `agent-cli-runtime-gate-evidence`, `agent-cli-runtime-release-verification`
- tarball: `agent-cli-runtime-0.1.0-alpha.0.tgz`
- tarball size: `225378` bytes
- tarball sha256: `b8a9c2beaaed18dd238c27065285362d1c3380e04be57d5f9cec7b198ddd786d`
- npm pack shasum: `513efc70dcc17d2ef58caed070dcf27a7a0eb90d`
- npm pack integrity: `sha512-mOpm9L3FbT+24WgKBQxKvbv90V/3odgekzBYmjPdIl4KzW4U0+P6yHk+02FC8ba1Tm1d6fgERoGqwsTiHC5uEA==`
- package name/version: `agent-cli-runtime@0.1.0-alpha.0`
- gate evidence schema: `agent-cli-runtime.releaseGateEvidence.v1`
- gate evidence commands: `npm run daemon:verify`, `npm run runtime:safety`
- gate evidence package source: both `installed-tarball`
- gate evidence flags: `noAuthenticatedRealRun: true`, `noNpmPublish: true`, `noNpmToken: true`
- package file review: 151 entries and no `.reference/`, `tests/`, fixture paths, raw real CLI output, private paths, token-looking values, Bearer values, or auth env assignments.

## 0.1.0-alpha.1 Post-Alpha Evidence Normalization

Current published package: `agent-cli-runtime@0.1.0-alpha.1`.

Post-alpha verification commands:

```bash
npm run release:post-alpha:verify
npm run smoke:published
npm view agent-cli-runtime@0.1.0-alpha.1 dist dist-tags --json
```

Evidence normalization rule:

- The npm registry tarball `shasum` / `integrity` and the GitHub Release asset `digest` are evidence for their own raw gzip artifacts.
- The npm registry gzip tarball SHA and GitHub Release asset gzip SHA may differ. That is expected and acceptable when the unpacked `package/` file list and file content are identical.
- If unpacked package content differs, stop and treat it as a blocker; do not publish a replacement without a new version and explicit maintainer approval.
- Package content review uses npm registry shasum/integrity, unpacked package file parity, published-install smoke, and `npm run release:verify -- --dir <downloaded-github-release-assets-dir>`.
- `release:post-alpha:verify` emits `schemaVersion: "agent-cli-runtime.postAlphaEvidence.v1"` and redacts local temp paths.
- `smoke:published` installs from npm registry, verifies `import { createAgentRuntime } from "agent-cli-runtime"`, runs `agent-runtime agents --json`, and does not execute a real Codex/Claude/OpenCode run.

Current release facts:

- `agent-cli-runtime@0.1.0-alpha.1` is published.
- GitHub pre-release `v0.1.0-alpha.1` exists and is marked prerelease, not draft.
- `agent-cli-runtime@0.1.0-alpha.0` is deprecated due to stale pre-publish package docs.
- npm dist-tags currently include `alpha -> 0.1.0-alpha.1` and `latest -> 0.1.0-alpha.1`.
- No new npm version is published by this post-alpha normalization task.

GitHub Release asset re-verification remains:

```bash
tmp_dir="$(mktemp -d /tmp/agent-runtime-alpha1-release-assets-XXXXXX)"
gh release download v0.1.0-alpha.1 --repo iiwish/agent-cli-runtime --dir "$tmp_dir"
npm run release:verify -- --dir "$tmp_dir"
```

Rollback boundary:

- If only the dist-tag is wrong, use `npm dist-tag add agent-cli-runtime@0.1.0-alpha.1 alpha` and, only after confirming it points at an unintended pre-alpha, `npm dist-tag rm agent-cli-runtime latest`.
- If package contents are wrong, publish a new corrected pre-release version; npm does not allow overwriting `agent-cli-runtime@0.1.0-alpha.1`.
- Use `npm unpublish agent-cli-runtime@0.1.0-alpha.1` only if npm policy allows it and a maintainer accepts the registry impact; otherwise deprecate the bad version.

## P3-7 API / CLI Schema Freeze

P3-7 changes documentation and drift protection for existing public/CLI contracts:

- Added [docs/api-schema-contract.md](./api-schema-contract.md) as the schema inventory and versioning policy entrypoint.
- Public root value export remains `createAgentRuntime`; public type exports remain source-compatible package-root imports for the runtime facade, run/goal records, replay/event envelopes, diagnostics/store shapes, and adapter-authoring types.
- Internal `dist/**` files may exist in the package, but subpath imports into storage/parser/adapter implementation are not documented API.
- Frozen schema inventory: `agent-runtime.event.v1`, `agent-runtime.diagnostics.v1`, `agent-runtime.conformance.v1`, `agent-runtime.realSmoke.v1`, `agent-runtime.storeHealth.v1`, `agent-runtime.storeRepair.v1`, `agent-runtime.cliError.v1`, `agent-cli-runtime.releaseVerification.v1`, and `agent-cli-runtime.releaseGateEvidence.v1`.
- Version bump policy: optional additive fields may stay in-schema; field removal/rename/type or semantic changes require a schema version bump; terminal reason/classification vocabulary changes require docs, tests, and a migration note.
- Failure taxonomy remains explicit: skipped evidence is not success, `auth_missing` is not unavailable, and `needs_verification` is not guessed into flag support.
- Default gates still do not pass `--allow-real-run`.

P3-7 local validation evidence on 2026-06-22:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed with 196 tests and 1 skipped installed-package smoke.
- `npm run build`: passed.
- `npm run package:check`: passed with `package boundary ok: 151 files checked`.
- `node ./dist/cli/main.js agents --json`: passed; Codex and OpenCode available, Claude Code available with `auth_missing`.
- `node ./dist/cli/main.js doctor --json`: passed with `ok: true`; Claude Code remains `auth_missing`.
- `node ./dist/cli/main.js conformance --mode real --agent all --json`: passed without `--allow-real-run`; Codex and OpenCode reported `real_run_skipped`, Claude Code reported `auth_missing`.
- `node ./dist/cli/main.js smoke --mode real --agent codex --json`: passed as safe preflight and reported `real_run_skipped`.
- `git diff --check`: passed.

## P3-6 Real CLI Opt-In Smoke Evidence

P3-6 changes how real smoke evidence is requested and reviewed:

- `node ./dist/cli/main.js smoke --mode real --agent <id> --json` does not launch a real agent run; it emits `schemaVersion: "agent-runtime.realSmoke.v1"` with `runClassification: "real_run_skipped"` or another preflight classification.
- Authenticated real runs require `--allow-real-run` and expected text, for example `node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --expect-text <safe_text> --json`.
- The same command shape is documented for Codex, Claude Code, and OpenCode.
- The summary includes `adapter`, `version`, `auth`, `modelsSource`, `runClassification`, `expectedTextMatched`, redacted/truncated `observedTextTail`, `cwdMutationChecked`, `cwdMutated`, `diagnosticsCount`, `skippedReason`, and `failureReason`.
- The summary excludes prompt text, token values, private cwd, raw stdout/stderr, and final run records.
- A custom `--prompt` or `--prompt-file` without `--expect-text` cannot pass on exit `0`; it is classified as `unexpected_output`.
- Preflight/run classifications include `auth_missing`, `unavailable_executable`, `unsupported_flag`, `unexpected_output`, `cwd_mutated`, `needs_verification`, and `real_run_skipped`.
- Claude Anthropic-compatible provider docs use environment variable names and placeholders only; no real token value, provider URL, or private model alias is committed.
- `.github/workflows/ci.yml`, `.github/workflows/release-candidate.yml`, `scripts/dogfood.mjs`, `scripts/create-release-candidate.mjs`, and `package.json` remain free of `--allow-real-run`.

P3-6 local validation evidence on 2026-06-22:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed with 191 tests and 1 skipped installed-package smoke.
- `npm run build`: passed.
- `npm run package:check`: passed with `package boundary ok: 147 files checked`.
- `node ./dist/cli/main.js conformance --mode real --agent all --json`: passed without `--allow-real-run`; Codex and OpenCode reported `real_run_skipped`, Claude Code reported `auth_missing`.
- `node ./dist/cli/main.js smoke --mode real --agent codex --json`: passed as safe preflight and reported `real_run_skipped`.
- `node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --expect-text "agent-runtime real smoke ok" --timeout-ms 120000 --json`: completed with `runClassification: "success"`, `expectedTextMatched: true`, and `cwdMutated: false`. A 30s default-timeout retry can still classify as `timeout` in this environment.
- `node ./dist/cli/main.js smoke --mode real --agent claude --allow-real-run --expect-text "agent-runtime real smoke ok" --json`: completed with `runClassification: "auth_missing"` before launch.
- `node ./dist/cli/main.js smoke --mode real --agent opencode --allow-real-run --expect-text "agent-runtime real smoke ok" --timeout-ms 120000 --json`: completed with `runClassification: "success"`, `expectedTextMatched: true`, and `cwdMutated: false`. A 30s default-timeout retry can still classify as `timeout` in this environment.

## Historical P3-5 Remote Release Evidence Closure

P3-5 closed the P3-4 remote evidence gap for its workflow head SHA. It remains historical evidence only and does not prove the P3-8, P3-9, or P3-10 target SHA.

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

Historical artifact metadata from the GitHub Actions API:

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

Remote P3-4 evidence was pending until P3-5. P3-5 run `27932628093` is the historical workflow-head evidence closure for the five-artifact set.

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
node ./dist/cli/main.js conformance --mode real --agent all --json
node ./dist/cli/main.js smoke --mode real --agent codex --json
node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --expect-text "agent-runtime real smoke ok" --json
git diff --check
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

Remote GitHub Actions evidence for the P3-10 pre-documentation release-candidate target is run `27945938663` on SHA `fdba3ebccb2e57a0ad295101028a2a3937a92204`. It must not be reused as final publish evidence after this packaged evidence packet is committed. Historical P3-9 run `27943672095` only proves target SHA `65fac505ca3eb830a06d8656068cf4ed5f6dd46a`; historical P3-9 interim run `27942743285` only proves target SHA `a0299a7d81bb614661922bebc8c75496cf0a3d11` before the strict `fixtures?` package-boundary lock; historical P3-8 run `27940814340` only proves target SHA `eb8de0f9b1edfa3f94c35a50b31005c5d3c105d4`; historical P3-5 run `27932628093` only proves workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`; historical P2-12 run `27869580048` must not be reused as evidence for later release-candidate targets.

## Release-Candidate Artifacts

The manual release-candidate workflow uploads:

- `agent-cli-runtime-tarball`: the packed `agent-cli-runtime-0.1.0-alpha.0.tgz` tarball.
- `agent-cli-runtime-pack-metadata`: `release-candidate/npm-pack.json` from `npm pack --json`.
- `agent-cli-runtime-package-files`: `release-candidate/package-files.txt`, one packed package path per line.
- `agent-cli-runtime-gate-evidence`: `release-candidate/gate-evidence.json` from `npm run release:candidate`.
- `agent-cli-runtime-release-verification`: `release-candidate/release-verification.json` from `npm run release:verify`.

Artifacts are retained for 14 days to keep the audit window explicit while avoiding long-lived stale release-candidate evidence.

The P3-10 artifact set has five artifacts and all were re-verified from downloaded GitHub Actions artifacts. The P2-12 downloaded artifact table below is retained as historical evidence for commit `2f8832119b4ebdb8393077052560589a398ebf56`; it predates `agent-cli-runtime-gate-evidence` and must not be reused as current release-candidate evidence.

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

Default release gates do not launch authenticated real agent runs. `conformance --mode real --agent all --json` and `smoke --mode real --agent <id> --json` perform real local executable/version/auth/model/profile certification and report `real_run_skipped`, `auth_missing`, `unsupported_flag`, or `needs_verification` honestly.

Authenticated real runs require explicit `--allow-real-run --expect-text <safe_text>` and remain local/manual evidence. The real-smoke summary is redacted and does not contain prompt text, token values, private cwd, raw stdout/stderr, or the final run record.

## Known Risks

- Remote GitHub Actions evidence is commit-specific; P3-10 run `27945938663` proves pre-documentation SHA `fdba3ebccb2e57a0ad295101028a2a3937a92204`, not any later commit containing this report.
- Because release docs are packaged, committing this report changes npm pack output; final publish evidence requires a fresh post-documentation release-candidate workflow and artifact re-verification.
- Historical P3-9 run `27943672095` only proves target SHA `65fac505ca3eb830a06d8656068cf4ed5f6dd46a`; historical P3-9 interim run `27942743285` only proves target SHA `a0299a7d81bb614661922bebc8c75496cf0a3d11` before the strict `fixtures?` package-boundary lock; historical P3-8 run `27940814340` only proves target SHA `eb8de0f9b1edfa3f94c35a50b31005c5d3c105d4`; historical P3-5 run `27932628093` only proves workflow head SHA `8d7bc2a19c626caa1ad5223acbcd35df34aff18e`; historical P2-12 run `27869580048` only proves commit `2f8832119b4ebdb8393077052560589a398ebf56` and predates the gate-evidence artifact.
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
