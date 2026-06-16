# Agent CLI Compatibility Matrix

Status: P0-3 real CLI compatibility baseline
Last updated: 2026-06-16

This matrix records the CLI versions and behaviors that have been verified with the current runtime. Real agent CLIs change quickly; treat this file as compatibility evidence, not a permanent guarantee.

## Summary

| Adapter | CLI path | CLI version tested | Detection | Run smoke | Goal smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | `/Applications/Codex.app/Contents/Resources/codex` | `codex-cli 0.140.0-alpha.2` | Pass | Timeout in 30s non-mutating runtime smoke | Not run in P0-3 | Uses `codex exec --json` with stdin prompt and `-C <cwd>`. Live model probe passed. |
| Claude Code | `/opt/homebrew/bin/claude` | `2.1.178 (Claude Code)` | Pass with `auth_missing` diagnostic | Blocked by local auth | Not run in P0-3 | `claude auth status` returned `loggedIn:false`, `authMethod:none`, `apiProvider:firstParty`. |
| OpenCode | `/opt/homebrew/bin/opencode` | `1.15.6` | Pass | Timeout in 30s non-mutating runtime smoke | Not run in P0-3 | `opencode-cli` was not installed; fallback `opencode` was used. Live model probe passed. |

## Verified Invocation Shapes

### Codex

```bash
codex exec --json --skip-git-repo-check -C <cwd>
```

Runtime notes:

- prompt transport: stdin text
- model flag: `--model <id>`
- workspace-write policy: `--sandbox workspace-write`
- extra dirs: repeated `--add-dir <path>`
- reasoning effort: `-c model_reasoning_effort="<effort>"`
- auth probe: no stable non-mutating auth probe is enabled; auth status is `unknown`
- model probe: `codex debug models`; parser keeps only model `slug`/`display_name` and ignores hidden models

### Claude Code

```bash
claude -p --input-format stream-json --output-format stream-json --verbose
```

Runtime notes:

- prompt transport: stdin JSONL
- model flag: `--model <id>`
- headless-auto policy: `--permission-mode bypassPermissions`
- auth probe: `claude auth status`
- capability probe: `claude -p --help`; current local output includes the tracked capability flags and produced no capability diagnostics
- model probe: no live model probe; fallback aliases are `default`, `sonnet`, `opus`, `haiku`
- `--session-id` is represented in the profile as `needsVerification`; `--resume` is the verified resume path in fixtures
- DeepSeek Anthropic-compatible config can be supplied through environment variables:

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
```

Set the provider's documented Anthropic-compatible auth token environment variable outside committed docs and fixtures.

### OpenCode

```bash
opencode run --format json --dir <cwd>
```

Runtime notes:

- prompt transport: stdin text
- binary candidates: `opencode-cli`, then `opencode`
- model flag: `-m <id>`
- headless-auto policy: `--dangerously-skip-permissions`
- model probe: `opencode models`
- read-only and workspace-write are left to OpenCode defaults until stable permission flags are verified

## Smoke Commands

Build the package first:

```bash
npm ci
npm run build
```

Detect installed agents:

```bash
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Local non-mutating run smoke, only when the relevant local CLI auth is available:

```bash
tmp="$(mktemp -d /tmp/agent-runtime-run-smoke.XXXXXX)"
node ./dist/cli/main.js run \
  --agent codex \
  --cwd "$tmp" \
  --permission read-only \
  --timeout-ms 30000 \
  --stream jsonl \
  --prompt "Reply exactly: agent-runtime codex smoke ok. Do not edit files."
```

Run smoke in an isolated temp directory:

```bash
tmp="$(mktemp -d /tmp/agent-runtime-smoke.XXXXXX)"
node ./dist/cli/main.js run \
  --agent codex \
  --cwd "$tmp" \
  --permission workspace-write \
  --stream jsonl \
  --prompt "Create smoke.txt containing exactly: agent-runtime smoke ok"
```

Goal smoke:

```bash
tmp="$(mktemp -d /tmp/agent-runtime-goal.XXXXXX)"
node ./dist/cli/main.js goal \
  --agent codex \
  --cwd "$tmp" \
  --permission workspace-write \
  --stream jsonl \
  --prompt "Create one file named goal-smoke.txt containing exactly: agent-runtime goal smoke ok"
```

## Known MVP Gaps

- Disk backed run/goal replay storage is opt-in via `storageDir`; default runtime behavior remains memory-only.
- Real CLI auth and model availability depend on the user's local installation.
- Runtime-side validation executes shell commands supplied by task graphs; callers should only use it with trusted objectives or trusted planners.
- Parser coverage is fixture-based plus local smoke; more real stream captures should be added before a stable release.
- P0-3 local non-mutating run smoke did not establish a successful run baseline for Codex or OpenCode; both hit the 30s runtime timeout in this environment.
- Claude Code run/goal smoke is blocked by local auth until `claude auth status` reports a logged-in account or a supported Anthropic-compatible provider env is supplied.

## P0-3 Detection Evidence

Commands run from this repository after `npm run build`:

```bash
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Observed results:

- Codex: available, live models source, auth status `unknown`, diagnostics empty.
- Claude Code: available, fallback models source, auth status `missing`, diagnostic code `auth_missing`.
- OpenCode: available via fallback binary `opencode`, live models source, auth status `unknown`, diagnostics empty.

Version, model, auth, and capability probe diagnostics are redacted before being returned by detection. Probe cwd is a neutral temp directory, not the caller project.
