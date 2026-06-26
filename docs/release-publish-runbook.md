# Alpha Publish Readiness Runbook

Status: `0.1.0-alpha.3` corrective pre-alpha release; registry mutations remain human-controlled
Last updated: 2026-06-26

This runbook records the publish and registry boundary for the alpha.3 corrective release line. `agent-cli-runtime@0.1.0-alpha.2` is published, but its immutable npm tarball contains stale pre-publish package docs. `agent-cli-runtime@0.1.0-alpha.3` is the corrective pre-alpha release for package consumers. npm registry metadata and GitHub Releases are the source of truth for available versions and dist-tags.

This runbook does not create or commit npm credentials and does not configure trusted publishing. Current-head release-candidate run ids, artifact digests, tarball shasums, pack shasums, integrity values, and local temporary paths are recorded outside the npm package under `.release-evidence/` or attached as GitHub Release assets; package docs keep only stable process rules, the alpha.2 stale package-docs incident, the alpha.3 corrective boundary, and the human-gated boundary for registry mutations.

## Decision

Current state and future human gate:

- Package metadata is ready for an alpha package page: `name`, `version`, `description`, `license`, `type`, `bin`, `main`, `types`, `exports`, `files`, `engines`, `repository`, `homepage`, `bugs`, `keywords`, and `publishConfig.tag` are present and intentional.
- The package root value API remains `createAgentRuntime` only; public TypeScript types are exposed through the root declarations, not as runtime values.
- The release-candidate workflow remains artifact-only: it creates and verifies the tarball but does not publish and does not require registry credentials.
- Corrective package line: `agent-cli-runtime@0.1.0-alpha.3`.
- Stale-docs incident package: `agent-cli-runtime@0.1.0-alpha.2`.
- Previous package: `agent-cli-runtime@0.1.0-alpha.1`.
- Previous GitHub pre-release: `v0.1.0-alpha.1`.
- `agent-cli-runtime@0.1.0-alpha.0` is deprecated because its immutable package docs shipped stale pre-publish state.
- Future human-controlled publish path: use the fresh release-candidate workflow for the commit being considered, download all five artifacts, run `npm run release:verify -- --dir <normalized-artifact-dir>`, run `npm run package:docs:check`, run `npm publish --dry-run --ignore-scripts --tag alpha`, and require explicit maintainer authorization before any registry mutation.
- Current-head evidence rule: trigger a fresh release-candidate workflow for the commit being considered, download all five artifacts, run `npm run release:verify -- --dir <normalized-artifact-dir>`, and record volatile run evidence under `.release-evidence/`.
- Because this runbook and release report are included in the npm package, do not write current run ids, artifact digests, tarball shasums, integrity values, or pack shasums into package docs.
- Before any future real publish, confirm the fresh release-candidate workflow head SHA matches the commit being published.
- After any future real publish, run the manual published package verification workflow and download `agent-cli-runtime-published-verification`; it must pass `npm run published:verify:evidence -- --dir <downloaded-artifact-dir>`.
- Do not reuse historical workflow runs as publish evidence for a later commit.

## Boundaries

- Do not add npm tokens, GitHub tokens, registry credential environment variables, or private auth files.
- Do not configure real npm trusted publishing in this release line.
- Do not add daemon, database, WAL, remote worker, web UI, telemetry, scheduler expansion, or package-root value exports.
- Do not run `npm publish`, `npm deprecate`, or GitHub Release create/edit commands without explicit maintainer authorization.

## Future Pre-Publish Checks

Run from the repository root on a clean checkout before any future package version is published:

```bash
git status --short
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run package:check
npm run package:docs:check
tmp_dir="$(mktemp -d)"
npm run release:candidate -- --out-dir "$tmp_dir"
npm run release:verify -- --dir "$tmp_dir"
npm pack --dry-run
npm publish --dry-run --ignore-scripts --tag alpha
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
git diff --check
```

Before a future real publish, also confirm the current branch and evidence target:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-parse origin/main
gh workflow run release-candidate.yml --ref main
gh run view <current-release-candidate-run-id> --json headSha,status,conclusion,url,jobs
npm view agent-cli-runtime@<next-version> version --json
npm dist-tag ls agent-cli-runtime
```

The dry-run command is the required local npm publish simulation for this stage:

```bash
npm publish --dry-run --ignore-scripts --tag alpha
```

The command must report a dry run and must show `tag alpha`. If it reports `latest`, fix the command or metadata before publishing.

## Human Confirmation Points

Before a future real publish, a maintainer must confirm:

- The version is exactly the intended immutable npm version. A published `name@version` cannot be overwritten.
- The release-candidate run head SHA matches the commit being published; historical runs are insufficient for later commits.
- `npm run package:docs:check`, `npm pack --dry-run`, and `npm publish --dry-run --ignore-scripts --tag alpha` show only expected files and release-state wording.
- `.reference/`, `.release-evidence/`, `tests/`, fixtures, raw real CLI output, private paths, token-looking values, and repair backups are absent from the packed files.
- `dist/index.js` runtime value exports remain limited to `createAgentRuntime`.
- `dist/index.d.ts` exposes public types without re-exporting storage/parser/store internals as the package-root contract.
- The alpha tag is intentional. If there is still no stable version and npm also points `latest` at a pre-alpha, document that exact post-publish state outside packaged docs or in stable package wording that names the registry as authoritative.
- The npm account/package publishing policy is understood: 2FA or an approved token path is required by npm package settings.
- The publisher accepts the provenance choice below and has the right npm package permissions.

## Real Publish Commands

Do not run these commands until the human publish gate is explicitly approved.

Manual local publish with interactive npm authentication:

```bash
npm publish --tag alpha
```

If the package requires public access on first publish, the maintainer may need:

```bash
npm publish --tag alpha --access public
```

If npm asks for a second factor, complete the interactive 2FA prompt or use the npm CLI's supported OTP flow. Do not put an OTP, token, or session credential in committed files, shell history snippets, CI logs, docs, or issue comments.

## Dist-Tag Verification

Immediately after any real publish:

```bash
npm view agent-cli-runtime@0.1.0-alpha.3 version dist-tags --json
npm dist-tag ls agent-cli-runtime
npm run published:verify -- --out-dir published-verification
npm run published:verify:evidence -- --dir published-verification
```

Expected result:

- `agent-cli-runtime@0.1.0-alpha.3` is the corrective package line.
- Registry dist-tags match the maintainer's intended pre-alpha policy.
- Published verification includes `agent-cli-runtime.packagedDocsVerification.v1` for the npm registry tarball.

If the wrong tag is attached but the package version itself is acceptable, fix the tag rather than republishing the same version:

```bash
npm dist-tag add agent-cli-runtime@0.1.0-alpha.3 alpha
npm dist-tag ls agent-cli-runtime
```

## 2FA, Token, And Provenance Strategy

Current decision:

- Preferred future automated path: npm trusted publishing from a dedicated GitHub Actions publish workflow with a human approval gate. This is not configured here.
- Preferred manual alpha path: interactive local `npm publish --tag alpha` by a maintainer with 2FA enabled and no committed tokens.
- Avoid long-lived npm automation tokens for this package unless trusted publishing cannot be used and a maintainer explicitly accepts the rotation, scope, and audit trade-off.
- Do not add registry credential environment variables to the existing `ci.yml` or `release-candidate.yml` workflows.

Trusted publishing boundary:

- npm trusted publishing uses OIDC from supported CI providers and is intended to avoid long-lived npm tokens.
- npm trusted publishing requires npm CLI and Node versions that satisfy npm's current trusted publishing requirements.
- A future trusted-publishing workflow would need its own publish file, package-side trusted publisher configuration on npmjs.com, `id-token: write`, a hosted runner, `registry-url: https://registry.npmjs.org`, and an explicit human approval/release trigger.
- Do not retrofit publish into `.github/workflows/release-candidate.yml`; keep that workflow artifact-only.

Provenance boundary:

- If publishing through trusted publishing, npm currently documents automatic provenance generation.
- If publishing with provenance through a token-based GitHub Actions workflow instead, the workflow would need the npm provenance path and OIDC permissions documented by npm. This repo has not configured that path.
- If publishing manually from a local machine, do not claim GitHub Actions provenance for that package. Manual local publish and CI trusted publishing are different evidence models.

Useful official references:

- npm trusted publishing: https://docs.npmjs.com/trusted-publishers/
- npm provenance: https://docs.npmjs.com/generating-provenance-statements/
- npm package 2FA publishing requirements: https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/
- npm dist-tag CLI: https://docs.npmjs.com/cli/v9/commands/npm-dist-tag/
- npm unpublish policy: https://docs.npmjs.com/policies/unpublish/

## Failure Handling

If dry-run fails:

- Stop before any registry mutation.
- Fix metadata, build output, package boundary, package docs, or auth state.
- Rerun the full pre-publish checks.

If real publish fails before package creation:

- Capture the redacted error class only.
- Do not commit npm debug logs if they contain local paths, auth state, or registry session details.
- Re-run `npm view agent-cli-runtime@0.1.0-alpha.3 version --json` before retrying to confirm the version was not created.

If real publish succeeds but post-publish checks fail:

- Do not republish the same version. npm package versions are immutable.
- If only dist-tags are wrong, fix the tags with `npm dist-tag`.
- If package contents are wrong, publish a new patch/pre-release version after fixing the repository state.
- If the package is unsafe and still eligible under npm policy, consider unpublish only as an emergency path:

```bash
npm unpublish agent-cli-runtime@0.1.0-alpha.3
```

Unpublish has strict policy limits and cannot make the same `name@version` reusable. If unpublish is not allowed or would break consumers, prefer deprecation:

```bash
npm deprecate agent-cli-runtime@0.1.0-alpha.3 "Do not use this alpha; upgrade to a later pre-release."
```

## Rollback Boundary

Rollback means one of these actions:

- Move or remove an incorrect dist-tag.
- Deprecate a bad version with a clear warning.
- Unpublish only when npm policy allows it and a maintainer accepts the registry impact.
- Publish a new corrected pre-release version.

Rollback does not mean overwriting `agent-cli-runtime@0.1.0-alpha.2` or `agent-cli-runtime@0.1.0-alpha.3`; npm does not permit replacing an already published package version.
