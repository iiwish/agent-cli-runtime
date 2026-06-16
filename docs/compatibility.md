# Agent CLI Compatibility Matrix

Status: MVP smoke matrix
Last updated: 2026-06-16

This matrix records the CLI versions and behaviors that have been verified with the current runtime. Real agent CLIs change quickly; treat this file as compatibility evidence, not a permanent guarantee.

## Summary

| Adapter | CLI version tested | Detection | Run smoke | Goal smoke | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.140.0-alpha.2` | Pass | Pass | Pass | Uses `codex exec --json` with stdin prompt and `-C <cwd>`. |
| Claude Code | `2.1.178 (Claude Code)` | Pass | Pass with DeepSeek Anthropic-compatible env | Not yet repeated after DeepSeek setup | Native Claude auth was unavailable locally; DeepSeek Anthropic-compatible config worked. |
| OpenCode | `1.15.6` | Pass | Pass | Not yet repeated after `--dir` fix | Requires explicit `--dir <cwd>`; relying on process cwd alone writes to the wrong workspace. |

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

### Claude Code

```bash
claude -p --input-format stream-json --output-format stream-json --verbose
```

Runtime notes:

- prompt transport: stdin JSONL
- model flag: `--model <id>`
- headless-auto policy: `--permission-mode bypassPermissions`
- auth probe: `claude auth status`
- DeepSeek Anthropic-compatible config can be supplied through environment variables:

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=<your-token>
export ANTHROPIC_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
```

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

- This package does not persist run or goal events to disk.
- Real CLI auth and model availability depend on the user's local installation.
- Runtime-side validation executes shell commands supplied by task graphs; callers should only use it with trusted objectives or trusted planners.
- Parser coverage is fixture-based plus local smoke; more real stream captures should be added before a stable release.
