# Release Checklist (pre-alpha / developer preview)

## Release candidate hygiene

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run ci`
- [ ] `npm audit --omit=dev`
- [ ] `npm pack --dry-run`

## Package boundary verification

- [ ] `npm pack --json` and confirm package files do not include:
  - `.reference/`
  - `tests/`
  - `tests/fixtures/`
  - fixture secrets / private paths.
- [ ] Confirm `dist/`, docs, README, LICENSE, and release docs are included.

## Install smoke

- [ ] `repo_root="${GITHUB_WORKSPACE:-$(pwd -P)}"`.
- [ ] `tmp_dir="$(mktemp -d /tmp/agent-runtime-release-XXXXXX)"`.
- [ ] `pack_info="$(cd "$repo_root" && npm pack --json --ignore-scripts --pack-destination "$tmp_dir")"`.
- [ ] `package_file="$(printf '%s' "$pack_info" | node -e "const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(data[0].filename);")"`.
- [ ] `pushd "$tmp_dir"`.
- [ ] `npm init -y`.
- [ ] `npm install "$tmp_dir/$package_file" --no-save`.
- [ ] `node -e "(async()=>{ const m = await import('agent-cli-runtime'); if (typeof m.createAgentRuntime !== 'function') process.exit(1); console.log(typeof m.createAgentRuntime); })()"`.
- [ ] `node ./node_modules/.bin/agent-runtime agents --json` returns JSON.
- [ ] `node ./node_modules/.bin/agent-runtime doctor --json` returns an object with `ok`.
- [ ] `node ./node_modules/.bin/agent-runtime smoke --mode fixtures --json` returns `{ ok: true, mode: "fixtures" }`.

## Artifact review

- [ ] `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md` are present and up to date.
- [ ] `docs/ssot.md` and `docs/compatibility.md` are synced to current P1-8 status.
- [ ] `README` and `README.zh-CN` include pre-alpha developer-preview boundary and quick verification commands.

## Final review notes

- [ ] No stable API guarantee language is used for this release track.
- [ ] Confirm no daemon/WAL/remote runtime promises are made in public docs.
- [ ] Confirm package install smoke is added/updated in `tests/contract.test.ts`.
