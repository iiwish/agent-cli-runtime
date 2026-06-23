# Alpha Publish Readiness Runbook

Status: P3-10 pre-documentation release candidate evidence recorded; post-commit human publish gate required
Last updated: 2026-06-22

This runbook is a decision and execution checklist for a future `agent-cli-runtime@0.1.0-alpha.0` npm alpha publish. P3-10 does not publish npm, does not create or commit npm credentials, and does not configure trusted publishing. It records pre-documentation release-candidate evidence and keeps the alpha publish boundary human-gated for a maintainer to review and execute later.

## Decision

Recommended state for the next human gate:

- Package metadata is ready for an alpha package page: `name`, `version`, `description`, `license`, `type`, `bin`, `main`, `types`, `exports`, `files`, `engines`, `repository`, `homepage`, `bugs`, `keywords`, and `publishConfig.tag` are present and intentional.
- The package root value API remains `createAgentRuntime` only; public TypeScript types are exposed through the root declarations, not as runtime values.
- The release-candidate workflow remains artifact-only: it creates and verifies the tarball but does not publish and does not require registry credentials.
- The future publish must use the `alpha` dist-tag. Do not publish this pre-alpha version as `latest`.
- Current publishable package candidate: `agent-cli-runtime@0.1.0-alpha.0`.
- Latest pre-documentation evidence: SHA `fdba3ebccb2e57a0ad295101028a2a3937a92204`, release-candidate workflow run `27945938663`, five downloaded artifacts verified with `agent-cli-runtime.releaseVerification.v1` at `/tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized`, and the local publish simulation boundary is `npm publish --dry-run --ignore-scripts --tag alpha`.
- Because this runbook and release report are included in the npm package, committing this packet changes package shasum. Run `27945938663` is not final publish evidence for any post-documentation commit.
- Before any real publish, trigger and verify a fresh release-candidate workflow for the commit that contains this packet.
- Historical P3-9 run `27943672095` only proves target SHA `65fac505ca3eb830a06d8656068cf4ed5f6dd46a`.
- Do not reuse historical workflow runs as publish evidence for a later commit.

## Non-Goals

- Do not run a real `npm publish` during P3-10.
- Do not add npm tokens, GitHub tokens, registry credential environment variables, or private auth files.
- Do not configure real npm trusted publishing during P2-13.
- Do not publish a GitHub release.
- Do not add daemon, database, WAL, remote worker, web UI, telemetry, scheduler expansion, or package-root value exports.

## Pre-Publish Checks

Run from the repository root on a clean `main` checkout:

```bash
git status --short
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run package:check
tmp_dir="$(mktemp -d /tmp/agent-cli-runtime-release-candidate-XXXXXX)"
npm run release:candidate -- --out-dir "$tmp_dir"
npm run release:verify -- --dir "$tmp_dir"
npm pack --dry-run
npm publish --dry-run --ignore-scripts --tag alpha
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
git diff --check
```

Before a real publish, also confirm the current branch and evidence target:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-parse origin/main
gh workflow run release-candidate.yml --ref main
gh run view <post-documentation-run-id> --json headSha,status,conclusion,url,jobs
npm view agent-cli-runtime@0.1.0-alpha.0 version --json
npm dist-tag ls agent-cli-runtime
```

The dry-run command is the required local npm publish simulation for this stage:

```bash
npm publish --dry-run --ignore-scripts --tag alpha
```

The command must report a dry run and must show `tag alpha`. If it reports `latest`, stop and fix the command or metadata before publishing.

P3-10 stop point: stop after `npm publish --dry-run --ignore-scripts --tag alpha`. A true publish requires a separate later user authorization and fresh post-documentation release-candidate evidence.

## Human Confirmation Points

Before a real publish, a maintainer must confirm:

- The version is exactly the intended immutable npm version. A published `name@version` cannot be overwritten.
- The post-documentation release-candidate run head SHA matches the commit being published; run `27945938663` alone is insufficient after this packet is committed.
- `npm pack --dry-run` and `npm publish --dry-run --ignore-scripts --tag alpha` show only expected files.
- `.reference/`, `tests/`, fixtures, raw real CLI output, private paths, token-looking values, and repair backups are absent from the packed files.
- `dist/index.js` runtime value exports remain limited to `createAgentRuntime`.
- `dist/index.d.ts` exposes public types without re-exporting storage/parser/store internals as the package-root contract.
- The alpha tag is intentional and `latest` must not move.
- The npm account/package publishing policy is understood: 2FA or an approved token path is required by npm package settings.
- The publisher accepts the provenance choice below and has the right npm package permissions.

## Real Publish Commands

These commands are documentation only in P2-13. Do not run them until the human publish gate is explicitly approved.

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
npm view agent-cli-runtime@0.1.0-alpha.0 version dist-tags --json
npm dist-tag ls agent-cli-runtime
```

Expected result:

- `alpha` points to `0.1.0-alpha.0`.
- `latest` is absent or still points to a stable version, not this pre-alpha version.

If the wrong tag is attached but the package version itself is acceptable, fix the tag rather than republishing the same version:

```bash
npm dist-tag add agent-cli-runtime@0.1.0-alpha.0 alpha
npm dist-tag rm agent-cli-runtime latest
npm dist-tag ls agent-cli-runtime
```

Only remove `latest` after confirming it points to the accidental alpha version.

## 2FA, Token, And Provenance Strategy

P2-13 decision:

- Preferred future automated path: npm trusted publishing from a dedicated GitHub Actions publish workflow with a human approval gate. This is not configured in P2-13.
- Preferred first alpha path if publishing manually: interactive local `npm publish --tag alpha` by a maintainer with 2FA enabled and no committed tokens.
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

- Stop. Do not attempt a real publish.
- Fix metadata, build output, package boundary, or auth state.
- Rerun the full pre-publish checks.

If real publish fails before package creation:

- Capture the redacted error class only.
- Do not commit npm debug logs if they contain local paths, auth state, or registry session details.
- Re-run `npm view agent-cli-runtime@0.1.0-alpha.0 version --json` before retrying to confirm the version was not created.

If real publish succeeds but post-publish checks fail:

- Do not republish the same version. npm package versions are immutable.
- If only dist-tags are wrong, fix the tags with `npm dist-tag`.
- If package contents are wrong, publish a new patch/pre-release version after fixing the repository state.
- If the package is unsafe and still eligible under npm policy, consider unpublish only as an emergency path:

```bash
npm unpublish agent-cli-runtime@0.1.0-alpha.0
```

Unpublish has strict policy limits and cannot make the same `name@version` reusable. If unpublish is not allowed or would break consumers, prefer deprecation:

```bash
npm deprecate agent-cli-runtime@0.1.0-alpha.0 "Do not use this alpha; upgrade to a later pre-release."
```

## Rollback Boundary

Rollback means one of these actions:

- Move or remove an incorrect dist-tag.
- Deprecate a bad version with a clear warning.
- Unpublish only when npm policy allows it and a maintainer accepts the registry impact.
- Publish a new corrected pre-release version.

Rollback does not mean overwriting `agent-cli-runtime@0.1.0-alpha.0`; npm does not permit replacing an already published package version.
