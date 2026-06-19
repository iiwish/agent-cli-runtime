# Release Checklist (pre-alpha / developer preview)

## P2-6 release candidate gate

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run ci`
- [ ] `npm run dogfood`
- [ ] `npm run prepublish:check`
- [ ] `node ./dist/cli/main.js conformance --mode fixtures --json`
- [ ] `node ./dist/cli/main.js conformance --mode fake --json`
- [ ] `node ./dist/cli/main.js conformance --mode real --agent all --json`
- [ ] `node ./dist/cli/main.js smoke --mode fixtures --json`
- [ ] `node ./dist/cli/main.js agents --json`
- [ ] `node ./dist/cli/main.js doctor --json`
- [ ] `npm audit --omit=dev`
- [ ] `npm run package:check`
- [ ] `npm pack --dry-run`

`npm run dogfood` is the default publish-readiness bundle. It rebuilds, runs offline fixtures/fake conformance, runs real local detection/profile conformance without `--allow-real-run`, executes fake-CLI examples, performs a pack dry-run, and installs the packed tarball into a temporary project for import and installed CLI smoke.

`npm run prepublish:check` is the local release-candidate guard. It combines typecheck, lint, tests, build, dogfood, production audit, package boundary checking, and pack dry-run. It must not run authenticated real agents.

`npm test` uses Vitest's verbose reporter so long contract/install-smoke files keep emitting progress in CI and outer runners instead of appearing idle.

## GitHub Actions release candidate

- [ ] Trigger `.github/workflows/release-candidate.yml` manually with `workflow_dispatch`.
- [ ] Confirm the workflow runs `npm ci`, `npm run ci`, and `npm run dogfood`.
- [ ] Confirm dogfood output is limited to fixtures, fake CLIs, and real local detection/profile certification without `--allow-real-run`.
- [ ] Confirm `npm pack --json` creates a tarball artifact but no `npm publish` step exists.
- [ ] Download and review the uploaded artifacts:
  - `agent-cli-runtime-tarball`
  - `agent-cli-runtime-pack-metadata`
  - `agent-cli-runtime-package-files`
- [ ] Confirm no npm token, npm provenance publish, or registry credential is required.

## Package boundary verification

- [ ] `npm run package:check`.
- [ ] `npm pack --json` and confirm package files do not include:
  - `.reference/`
  - `tests/`
  - `tests/fixtures/`
  - raw fixtures
  - fixture secrets / private paths
  - raw real CLI output
  - real provider tokens or token-looking values.
- [ ] Confirm `dist/`, docs, examples, `scripts/dogfood.mjs`, README files, LICENSE, and release docs are included.
- [ ] Confirm package root value exports remain limited to `createAgentRuntime`; replay, diagnostics, and storage inspection are facade methods plus type exports only.

## Install smoke

- [ ] `repo_root="${GITHUB_WORKSPACE:-$(pwd -P)}"`.
- [ ] `tmp_dir="$(mktemp -d /tmp/agent-runtime-release-XXXXXX)"`.
- [ ] `pack_info="$(cd "$repo_root" && npm pack --json --ignore-scripts --pack-destination "$tmp_dir")"`.
- [ ] `package_file="$(printf '%s' "$pack_info" | node -e "const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(data[0].filename);")"`.
- [ ] `pushd "$tmp_dir"`.
- [ ] `npm init -y`.
- [ ] `npm install "$tmp_dir/$package_file" --no-save --ignore-scripts --no-audit --no-fund`.
- [ ] `node -e "(async()=>{ const m = await import('agent-cli-runtime'); if (typeof m.createAgentRuntime !== 'function') process.exit(1); console.log(typeof m.createAgentRuntime); })()"`.
- [ ] `node ./node_modules/.bin/agent-runtime agents --json` returns JSON.
- [ ] `node ./node_modules/.bin/agent-runtime doctor --json` returns an object with `ok`.
- [ ] `node ./node_modules/.bin/agent-runtime conformance --mode fixtures --json` returns stable adapter summaries.
- [ ] `node ./node_modules/.bin/agent-runtime conformance --mode fake --json` returns stable adapter summaries.
- [ ] `node ./node_modules/.bin/agent-runtime smoke --mode fixtures --json` returns `{ ok: true, mode: "fixtures" }`.
- [ ] The install smoke uses fake/local CLIs for deterministic `agents` and `doctor` checks; it does not require real auth.

## Examples smoke

- [ ] `node examples/library-run.js` succeeds after `npm run build`.
- [ ] `node examples/library-goal.js` succeeds after `npm run build`.
- [ ] `examples/cli-dogfood.md` documents fixtures, fake, and real-profile conformance.
- [ ] Examples contain no real token, real user path, provider secret, complete prompt dump, or raw real CLI output.

## Artifact review

- [ ] `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md` are present and up to date.
- [ ] `README.md` and `README.zh-CN.md` explain npm install, `npx`, and local checkout paths.
- [ ] `README.md` and `README.zh-CN.md` explain Codex / Claude / OpenCode configuration without token values.
- [ ] Claude Anthropic-compatible provider docs list environment variable names/placeholders only; no real token values.
- [ ] `README.md`, `README.zh-CN.md`, `docs/ssot.md`, `docs/compatibility.md`, and `docs/production-readiness.md` are synced to current P2-6 status.
- [ ] `docs/production-readiness.md` names remaining known risks rather than treating skipped/preflight evidence as real run success.

## Final review notes

- [ ] No stable API guarantee language is used for this release track.
- [ ] Confirm no daemon/WAL/remote runtime promises are made in public docs.
- [ ] Confirm OpenDesign daemon-level gaps are named without implying parity.
- [ ] Confirm real conformance requires `--allow-real-run` and safely skips unauthorized CLIs.
- [ ] Confirm `conformance --mode real --agent all --json` without `--allow-real-run` does not launch real agent runs.
- [ ] Confirm optional real run docs use isolated cwd by default and make `--allow-real-run` the explicit account/network boundary.
- [ ] Confirm status-only exit `0` real smoke remains `unexpected_output`, not success.
- [ ] Confirm package install smoke is added/updated in `tests/contract.test.ts`.
