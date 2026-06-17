# Agent CLI Compatibility Matrix

Status: P1-5 real CLI smoke matrix and invocation profile calibration
Last updated: 2026-06-17

This matrix records the CLI versions and behaviors that have been verified with the current runtime. Real agent CLIs change quickly; treat this file as compatibility evidence, not a permanent guarantee. P1-5 keeps real smoke non-mutating and read-only, adds structured invocation profiles, and records current local Codex/OpenCode real smoke evidence without committing raw CLI output.

## Summary

| Adapter | CLI path | CLI version tested | Detection | Run smoke | Goal smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | redacted local app path | `codex-cli 0.140.0-alpha.19` | Pass | Pass: `smoke --mode real --agent codex --allow-real-run --json --diagnostics --timeout-ms 30000` completed in an isolated temp cwd with read-only permission. | Not run in P1-5 | Uses `codex exec --json` with stdin prompt and `-C <cwd>`. Live model probe passed. Timeout diagnostics still show sanitized argv/profile, parsed event count, stdout/stderr tails, and startup diagnostic hints when needed. |
| Claude Code | `/opt/homebrew/bin/claude` | `2.1.178 (Claude Code)` | Pass with `auth_missing` diagnostic | Blocked by local auth | Not run in P0-4 | `claude auth status` returned `loggedIn:false`, `authMethod:none`, `apiProvider:firstParty`. |
| OpenCode | `/opt/homebrew/bin/opencode` | `1.15.6` | Pass | Pass: `smoke --mode real --agent opencode --allow-real-run --json --diagnostics --timeout-ms 30000` completed in an isolated temp cwd with the runtime requesting read-only behavior. | Not run in P1-5 | `opencode-cli` was not installed; fallback `opencode` was used. Live model probe passed. Stdin prompt support is verified for local `opencode run --format json --dir <cwd>` on 1.15.6; explicit read-only/workspace-write flags, extra dirs, and session remain unverified. |

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
- session/resume: not mapped; profile marks session support as `needsVerification`
- auth probe: no stable non-mutating auth probe is enabled; auth status is `unknown`
- model probe: `codex debug models`; parser keeps only model `slug`/`display_name` and ignores hidden models
- parser note: transient `Reconnecting... n/5` structured error frames are normalized to `status: reconnecting`; they are not fatal if the run later emits text/usage and exits `0`
- P1-5 real smoke evidence: the opt-in read-only smoke passed on 2026-06-17. Prior P0-4 timeout/reconnect captures remain useful parser and diagnostics fixtures, but are not the latest local status.

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
- `--resume` is the verified resume path in fixtures; `--session-id` is represented in the profile as `needsVerification` and is not emitted by `buildArgs()`
- P1-5 real smoke behavior: `smoke --mode real` preflights detection and returns `classification: "auth_missing"` without launching Claude when local auth is missing.
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
- extra dirs and session/resume are not mapped; profile marks them as `needsVerification`
- P1-5 real smoke evidence: stdin prompt support is verified for local `opencode` 1.15.6 through the opt-in non-mutating isolated smoke. Keep prompt out of argv; do not switch to positional argv prompt. The runtime requested read-only behavior, but OpenCode explicit read-only/workspace-write flags remain unverified.

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
node ./dist/cli/main.js smoke --mode detection --json
```

Dry-run parser conformance fixtures without launching real agent CLIs:

```bash
node ./dist/cli/main.js smoke --mode fixtures --json
```

Durable store query/replay smoke with fake or test-generated records:

```bash
node ./dist/cli/main.js runs --storage-dir .agent-runtime --json
node ./dist/cli/main.js run-status run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-run run_123 --storage-dir .agent-runtime --jsonl
node ./dist/cli/main.js goals --storage-dir .agent-runtime --json
node ./dist/cli/main.js goal-status goal_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-goal goal_123 --storage-dir .agent-runtime --jsonl
node ./dist/cli/main.js store-health --storage-dir .agent-runtime --json
node ./dist/cli/main.js diagnostics run run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js diagnostics goal goal_123 --storage-dir .agent-runtime --json --out diagnostics-goal_123.json
```

Optional real non-mutating run smoke, only when the relevant local CLI auth is available. This is disabled unless `--allow-real-run` is present; without `--cwd`, it uses an isolated temp directory and runtime-requested `read-only` behavior:

```bash
node ./dist/cli/main.js smoke \
  --mode real \
  --agent codex \
  --allow-real-run \
  --json \
  --diagnostics \
  --timeout-ms 30000
```

The same command accepts `--prompt-file <file>` for longer prompts. Prompt text is still transported through the adapter transport and must not appear in argv or diagnostics.

Equivalent lower-level run command:

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

Preferred OpenCode real smoke:

```bash
node ./dist/cli/main.js smoke \
  --mode real \
  --agent opencode \
  --allow-real-run \
  --json \
  --diagnostics \
  --timeout-ms 30000
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
- P1-5 verifies the real smoke harness, current Codex read-only invocation path, and current OpenCode non-mutating isolated invocation path with runtime-requested read-only behavior. It does not prove that a specific real CLI can complete authenticated write tasks in the local environment, nor that OpenCode exposes a verified explicit read-only flag.
- JSONL append is still a simple append-only file, not fsync-backed and not segmented. P1-4 verifies corrupt/partial tail prefix replay plus explicit health diagnostics, but a host crash can still lose the final in-flight line.
- There is still no long-lived daemon, WAL, fsync group commit, segment compaction, or automatic destructive repair.
- Package root is intentionally small for pre-alpha: runtime facade and public types are exported; built-in adapter values and parser/detection helpers remain internal implementation details.
- CLI remains a thin local smoke/scripting wrapper over the library API, not a daemon or long-lived service.
- Real CLI auth and model availability depend on the user's local installation.
- Runtime-side validation executes shell commands supplied by task graphs; callers should only use it with trusted objectives or trusted planners.
- Parser coverage is fixture-based plus prior local smoke captures; more real stream captures should be added before a stable release.
- Historical P0-4 Codex smoke showed reconnect/timeout behavior; parser fixtures and timeout diagnostics preserve that coverage.
- Historical P0-4 OpenCode smoke timed out with zero parsed events, but P1-5 local `opencode` 1.15.6 real smoke passed and verifies stdin prompt support for this version.
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

## P1-3 Planner And CLI Conformance Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
node ./dist/cli/main.js smoke --mode detection --json
node ./dist/cli/main.js smoke --mode fixtures --json
```

Covered behavior:

- task graph validation rejects invalid `dependencies`, `allowedFiles`, `validationCommands`, `agentId`, and task-level `retryPolicy` field types with task id and field name in the error;
- planner Markdown fenced JSON and surrounding prose with one JSON object are accepted;
- multiple JSON objects and malformed JSON fail clearly without swallowing unrelated text or emitting oversized raw planner output;
- planner parse/validation failure emits `scheduler_error` with `AGENT_TASK_GRAPH_INVALID`, writes goal diagnostics, and finishes the goal as failed without task attempts;
- Codex / Claude / OpenCode parser conformance fixtures cover normal output, structured error, usage, tool/file event, partial line, and unknown event;
- Codex / Claude / OpenCode `buildArgs` tests confirm long prompts stay out of argv while cwd/model/permission/session/extra dir mappings remain explicit;
- `smoke --mode detection` and `smoke --mode fixtures` are offline-safe; `smoke --mode real` requires `--allow-real-run`;
- Claude auth missing remains an expected `doctor` diagnostic and does not fail the overall doctor result when the adapter itself is available;
- package root value exports remain limited to `createAgentRuntime`;
- `npm pack --dry-run` excludes `.reference/`, test fixtures/secrets, and real smoke output.

## P1-4 Store Health And Diagnostics Bundle Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js store-health --storage-dir <tmp> --json
node ./dist/cli/main.js smoke --mode fixtures --json
node ./dist/cli/main.js doctor --json
```

Covered behavior:

- empty store health returns `ok: true`;
- corrupt run and goal manifests do not crash runtime load and remain visible to health scan;
- corrupt/partial run JSONL keeps the replayable prefix and reports file, line, reason, and retained event count without storing the raw bad line;
- terminal manifest missing terminal event and terminal event with non-terminal manifest are reported as warnings, not auto-repaired;
- run diagnostics bundle contains redacted manifest, event summary, diagnostics, and environment-safe adapter summary;
- goal diagnostics bundle includes redacted task attempt evidence;
- `diagnostics ... --out <file>` writes a valid redacted bundle via atomic temp-file-and-rename;
- health and bundle output redact token-looking values, Bearer values, auth-token assignments, and absolute private paths;
- package root value exports remain limited to `createAgentRuntime`;
- `npm pack --dry-run` excludes `.reference/`, test fixtures/secrets, and real smoke output.

## P1-5 Real Smoke And Profile Evidence

Commands verified in this stage:

```bash
npm test -- tests/adapters-and-parsers.test.ts tests/run-scheduler.test.ts tests/contract.test.ts
npm run build
node ./dist/cli/main.js smoke --mode fixtures --json
node ./dist/cli/main.js smoke --mode detection --json
node ./dist/cli/main.js doctor --json
node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --json --diagnostics --timeout-ms 30000
node ./dist/cli/main.js smoke --mode real --agent opencode --allow-real-run --json --diagnostics --timeout-ms 30000
```

Observed local results on 2026-06-17:

- Codex: available, `codex-cli 0.140.0-alpha.19`, live model source, auth status `unknown`, read-only real smoke `classification: "success"` in isolated temp cwd.
- Claude Code: available, `2.1.178 (Claude Code)`, auth status `missing`; real run intentionally skipped by preflight until local auth is available.
- OpenCode: available through fallback binary `opencode`, version `1.15.6`, live model source, real smoke `classification: "success"` in isolated temp cwd with runtime-requested read-only behavior; explicit read-only flag remains unverified.

Covered behavior:

- adapter profiles expose structured executable candidates, prompt transport mode, stream mode, known flags, and `needsVerification` flags;
- `buildArgs()` keeps long prompts out of argv and no longer guesses unverified Claude `--session-id`;
- real smoke refuses to run without `--allow-real-run`;
- real smoke supports `--prompt-file`, `--cwd`, `--timeout-ms`, `--storage-dir`, `--json`, `--stream jsonl`, and `--diagnostics`;
- auth missing and unavailable executable are classified before launch;
- unsupported flag, timeout, and no-output runs include sanitized argv/profile diagnostics with stdout/stderr tails and actionable hints;
- diagnostics bundle adapter summary exposes prompt transport, stream format, parsed event count, sanitized argv, and hints without raw output or private paths.

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
