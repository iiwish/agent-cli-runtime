# Agent CLI Compatibility Matrix

Status: P1-2 goal scheduling hardening over P0-5 compatibility baseline
Last updated: 2026-06-16

This matrix records the CLI versions and behaviors that have been verified with the current runtime. Real agent CLIs change quickly; treat this file as compatibility evidence, not a permanent guarantee. P1-2 hardened GoalScheduler semantics: dependency-aware ready queue, configurable `maxConcurrentTasks`, task attempt events/evidence, retry policy, queued/running cancellation consistency, shutdown cleanup, and partial JSONL prefix replay diagnostics. It did not rerun authenticated real-agent write smokes beyond detection/doctor commands.

## Summary

| Adapter | CLI path | CLI version tested | Detection | Run smoke | Goal smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | `/Applications/Codex.app/Contents/Resources/codex` | `codex-cli 0.140.0-alpha.2` | Pass | Classified: mixed local behavior. One non-mutating run produced text/usage within 30s but exposed transient reconnect events; subsequent 30s smoke timed out after startup events and local plugin warnings. | Not run in P0-4 | Uses `codex exec --json` with stdin prompt and `-C <cwd>`. Live model probe passed. Timeout diagnostics now show sanitized argv/profile, parsed event count, stdout/stderr tails, and startup diagnostic hints. |
| Claude Code | `/opt/homebrew/bin/claude` | `2.1.178 (Claude Code)` | Pass with `auth_missing` diagnostic | Blocked by local auth | Not run in P0-4 | `claude auth status` returned `loggedIn:false`, `authMethod:none`, `apiProvider:firstParty`. |
| OpenCode | `/opt/homebrew/bin/opencode` | `1.15.6` | Pass | Classified timeout in 30s non-mutating runtime smoke | Not run in P0-4 | `opencode-cli` was not installed; fallback `opencode` was used. Live model probe passed. `opencode run --help` documents positional `message..`, not stdin prompt; runtime keeps stdin as safe default and reports this as an invocation profile gap. |

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
- parser note: transient `Reconnecting... n/5` structured error frames are normalized to `status: reconnecting`; they are not fatal if the run later emits text/usage and exits `0`
- P0-4 timeout classification: stdin/profile started successfully when `thread.started` and `turn.started` were parsed. The latest local timeout evidence shows local plugin manifest warnings before the runtime deadline; an earlier direct run also showed redacted `chatgpt.com` plugin/analytics request failures.

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
- P0-4 timeout classification: no structured JSON events were parsed before timeout; the installed help output only documents positional `message..`, so stdin prompt support remains unverified for this version. Do not switch the default to argv prompt without a safe non-argv transport decision.

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

Durable store query/replay smoke with fake or test-generated records:

```bash
node ./dist/cli/main.js runs --storage-dir .agent-runtime --json
node ./dist/cli/main.js run-status run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-run run_123 --storage-dir .agent-runtime --jsonl
node ./dist/cli/main.js goals --storage-dir .agent-runtime --json
node ./dist/cli/main.js goal-status goal_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-goal goal_123 --storage-dir .agent-runtime --jsonl
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
  --diagnostics \
  --prompt "Reply exactly: agent-runtime codex smoke ok. Do not edit files."
```

Equivalent OpenCode smoke:

```bash
tmp="$(mktemp -d /tmp/agent-runtime-run-smoke.XXXXXX)"
node ./dist/cli/main.js run \
  --agent opencode \
  --cwd "$tmp" \
  --permission read-only \
  --timeout-ms 30000 \
  --stream jsonl \
  --diagnostics \
  --prompt "Reply exactly: agent-runtime opencode smoke ok. Do not edit files."
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

- Durable run/goal replay storage is opt-in via `storageDir`; default runtime behavior remains memory-only.
- P1-2 verifies scheduling, attempts, retry, cancellation, shutdown, and replay behavior through fake CLI integration tests and CLI query/replay tests. It does not prove that a specific real CLI can complete authenticated write tasks in the local environment.
- JSONL append is still a simple append-only file, not fsync-backed and not segmented. P1-2 verifies corrupt/partial tail prefix replay plus `AGENT_EVENT_LOG_CORRUPT`, but a host crash can still lose the final in-flight line.
- Package root is intentionally small for pre-alpha: runtime facade and public types are exported; built-in adapter values and parser/detection helpers remain internal implementation details.
- CLI remains a thin local smoke/scripting wrapper over the library API, not a daemon or long-lived service.
- Real CLI auth and model availability depend on the user's local installation.
- Runtime-side validation executes shell commands supplied by task graphs; callers should only use it with trusted objectives or trusted planners.
- Parser coverage is fixture-based plus local smoke; more real stream captures should be added before a stable release.
- P0-4 Codex smoke is now diagnosable but still not stable in this environment: one run produced final text/usage within 30s after reconnect events, while the latest run timed out after only `thread.started`/`turn.started`; timeout diagnostics prove the stdin/profile path started and captured local startup stderr rather than leaving the failure opaque.
- P0-4 OpenCode non-mutating run smoke still times out with zero parsed events; stdin prompt support for `opencode run --format json` remains unverified in `1.15.6`.
- Claude Code run/goal smoke is blocked by local auth until `claude auth status` reports a logged-in account or a supported Anthropic-compatible provider env is supplied.

## P1-1 Durable Store Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Covered behavior:

- store directories are created automatically;
- terminal run and goal records are readable from a new runtime instance;
- `replayRunEvents()` / `replayGoalEvents()` return stable replay envelopes with `id`, `sequence`, `timestamp`, and `runId` / `goalId`;
- CLI `runs` / `goals` / `run-status` / `goal-status` / `replay-run --jsonl` / `replay-goal --jsonl` can read records from a previous process;
- corrupt manifests and JSONL records are isolated to the affected record and surfaced as diagnostics;
- stored diagnostics and validation evidence are redacted before writing to disk;
- `npm pack --dry-run` excludes `.reference/` and test fixtures.

## P1-2 Goal Scheduler Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Covered behavior:

- independent ready tasks start concurrently when `maxConcurrentTasks=2`;
- `maxConcurrentTasks=1` preserves stable serial order;
- dependent tasks do not start before dependencies finish successfully;
- failed upstream tasks block dependents;
- retryable failures produce multiple attempts and can eventually succeed;
- non-retryable failures do not retry;
- `cancelGoal()` cancels running task runs and queued ready tasks consistently;
- `shutdown()` leaves active goal/run lists empty and durable reload preserves terminal state;
- replay includes stable `task_attempt_started` / `task_attempt_finished` events with `id`, `sequence`, `timestamp`, and `goalId`;
- corrupt/partial JSONL logs replay the valid prefix and surface `AGENT_EVENT_LOG_CORRUPT`;
- package root value exports remain limited to `createAgentRuntime`;
- `npm pack --dry-run` excludes `.reference/` and test fixtures/secrets.

## P0-4 Detection Evidence

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

## P0-4 Run Smoke Evidence

Commands run from this repository after `npm run build`:

```bash
node ./dist/cli/main.js run --agent codex --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --cwd "$tmp" --prompt "Reply exactly: agent-runtime codex smoke ok. Do not edit files."
node ./dist/cli/main.js run --agent opencode --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --cwd "$tmp" --prompt "Reply exactly: agent-runtime opencode smoke ok. Do not edit files."
claude auth status
```

Observed results:

- Codex: latest run timed out after 30s with `parsedEventCount: 2` (`thread.started`, `turn.started`), sanitized argv `["exec","--json","--skip-git-repo-check","--sandbox","read-only","-C","<cwd>"]`, and startup diagnostics rather than a prompt transport mismatch. A preceding run emitted the expected final text and usage but was previously misclassified because transient reconnect frames were treated as fatal; this is fixed by the parser fixture.
- OpenCode: timed out after 30s with `parsedEventCount: 0`, sanitized argv `["run","--format","json","--dir","<cwd>"]`, exitCode `0` after timeout, and hints for interactive/model/auth wait or unsupported stdin profile.
- Claude Code: `claude auth status` returned `loggedIn:false`, `authMethod:none`, `apiProvider:firstParty`; run smoke remains auth-blocked.
