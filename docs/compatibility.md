# Agent CLI Compatibility Matrix

Status: P2-10 Release Candidate Artifact & Remote CI Audit
Last updated: 2026-06-20

This matrix records the CLI versions and behaviors that have been verified with the current runtime. Real agent CLIs change quickly; treat this file as dated compatibility evidence, not a permanent guarantee. P2-10 adds remote CI and release-candidate artifact audit evidence on top of the P2-9 package-root API and consumer compatibility gate. Raw CLI output, tokens, full prompts, auth env values, and private paths are not committed.

## Evidence policy

Current status is P2-10 pre-alpha release-candidate evidence, which is intended to be the default interpretation for this matrix.

- Current behavior is what is validated by `npm test` / typecheck / lint / build plus the current `npm pack`, package boundary, CLI JSON contract, and TypeScript consumer install-smoke checks.
- CI behavior is matrixed for Node.js 20/22/24 except dogfood, which runs once on Node.js 22 to avoid duplicating the slower install smoke.
- `npm test` uses Vitest's verbose reporter to keep long contract/install-smoke files chatty enough for CI and local watchdogs.
- `npm run prepublish:check` is the local guard that combines typecheck, lint, tests, build, dogfood, production audit, package boundary checks, and pack dry-run.
- `npm publish --dry-run --ignore-scripts --tag alpha` is a documented manual local dry-run check; it is not a remote CI gate.
- `npm run dogfood` installs the tarball into a temporary consumer project, runs `tsc --noEmit`, then executes fake-CLI library run/goal/replay/diagnostics smoke through the installed package.
- Evidence modes are intentionally separate:
  - `fixtures`: offline parser contract fixtures; no real or fake CLI process is launched.
  - `fake`: temporary local fake CLIs through the real adapter argv/stdin/parser path; no network or real account is used.
  - `real local observed`: local executable/version/auth/model/profile certification by default; real runs only when `--allow-real-run` is explicit.
  - `package install smoke`: npm tarball installation into a temporary project, with fake/local CLI checks and no real provider secrets.
- P1-6 and earlier notes in this file are historical references for parser fixtures, timeout/reconnect evidence, and compatibility context; they are not equivalent to current "latest expected" contract assumptions.
- When using this file as runtime contract input, prioritize the `Status` section, explicit "Runtime notes" in each adapter, and the most recent command evidence.
- For changed behavior, add a new evidence row at the top of the section rather than keeping the old row as authoritative.

## P2-10 Release Candidate Artifact And Remote CI Audit

Release-candidate audit evidence:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run package:check
npm run dogfood
npm run prepublish:check
npm pack --dry-run
npm publish --dry-run --ignore-scripts --tag alpha
node ./dist/cli/main.js conformance --mode real --agent all --json
```

P2-10 release-candidate semantics:

- `.github/workflows/ci.yml` keeps the Node.js 20/22/24 matrix for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run.
- The CI dogfood gate runs `npm run dogfood` once on Node.js 22 and does not pass `--allow-real-run`.
- `.github/workflows/release-candidate.yml` remains `workflow_dispatch` only. It runs `npm ci`, `npm run ci`, and `npm run dogfood`, then creates `npm pack --json` output, validates the package file list, and uploads the tarball, pack metadata, and package file list artifacts.
- No workflow step runs `npm publish`, sets `NODE_AUTH_TOKEN`, or requires real Codex/Claude/OpenCode installation.
- [docs/release-report.md](./release-report.md) is the release-candidate evidence entrypoint for local commands, remote workflow expectations, artifact review, package boundary, real CLI evidence boundaries, known risks, and non-goals.
- Remote GitHub Actions evidence must be manually triggered and reviewed; it is not treated as passed merely because workflow files exist locally.

## P2-9 Release Candidate API And Consumer Compatibility Evidence

Release-candidate gates:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run ci
npm run dogfood
npm run prepublish:check
npm run package:check
node ./dist/cli/main.js conformance --mode real --agent all --json
npm pack --dry-run
```

P2-9 release-candidate semantics:

- Package root value exports remain limited to `createAgentRuntime`; root type exports come from documented public types and facade/adapter-authoring types, not storage/parser/store internals.
- The published tarball may include internal `dist/` implementation files, but only the package root API is documented as stable for consumers.
- The package install smoke uses `npm install <tarball> --no-save --ignore-scripts --no-audit --no-fund`.
- The consumer TypeScript smoke imports `createAgentRuntime`, `RunRequest`, `CreateGoalRequest`, and other public types from the package root, then runs `tsc --noEmit` from the temporary project.
- The installed-package fake library smoke executes run, goal, replay, diagnostics export, and store health through a consumer-supplied fake adapter; it does not require Codex, Claude, OpenCode, network, or real credentials.
- CLI JSON success contracts are covered for `agents --json`, `doctor --json`, `conformance --mode fixtures --json`, `conformance --mode fake --json`, `store-health --json`, and `store-repair --dry-run --json`.
- CLI JSON error contracts are covered for missing required parameters and mutually exclusive `store-repair --apply --dry-run`; errors return exit code `1`, a short parseable JSON object, and redacted messages.
- `.github/workflows/ci.yml` keeps the Node.js 20/22/24 matrix for typecheck, lint, tests, build, production dependency audit, package boundary checks, and pack dry-run.
- The official test script is `vitest run --reporter=verbose --no-file-parallelism --testTimeout 30000`, keeping full-suite progress visible without dropping contract/install-smoke coverage.
- The CI dogfood gate runs `npm run dogfood` once on Node.js 22. It does not pass `--allow-real-run`, so real mode is limited to executable/version/auth/model/profile certification and runnable adapters report `real_run_skipped`.
- `.github/workflows/release-candidate.yml` is `workflow_dispatch` only. It runs `npm ci`, `npm run ci`, and `npm run dogfood`, then creates `npm pack --json` output and uploads the tarball, pack metadata, and package file list as artifacts.
- No workflow step runs `npm publish`, requests an npm token, or requires real Codex/Claude/OpenCode installation.
- `scripts/check-package-boundary.mjs` checks the pack dry-run file list and scans docs/examples/scripts for real token-like values, Bearer values, auth environment assignment values, and private user paths.

Current local real-CLI detection/preflight evidence from `node ./dist/cli/main.js conformance --mode real --agent all --json` on 2026-06-20:

| Adapter | CLI version | Auth/model source | runClassification | skippedReason | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.142.0-alpha.1` | auth `unknown`; models `live` | `real_run_skipped` | `real_run_not_allowed` | Detection/profile passed; no real run launched because `--allow-real-run` was not supplied. Session and auth probe remain `needsVerification`. |
| Claude Code | `2.1.178 (Claude Code)` | auth `missing`; models `fallback` | `auth_missing` | `auth_missing` | Detection/profile passed; run skipped before launch because local auth is missing. `--session-id` and reasoning remain `needsVerification`. |
| OpenCode | `1.15.6` | auth `unknown`; models `live` | `real_run_skipped` | `real_run_not_allowed` | Detection/profile passed; no real run launched because `--allow-real-run` was not supplied. Extra dirs, session, and read-only/workspace-write flags remain `needsVerification`. |

## Summary

| Adapter | CLI path | CLI version tested | Detection | Run smoke | Goal smoke | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | redacted local app path | `codex-cli 0.142.0-alpha.1` | Pass | Skipped in P2-9 default real conformance; prior opt-in Codex smoke evidence remains historical. | Not run in P2-9 | Uses `codex exec --json --skip-git-repo-check` with stdin prompt and `-C <cwd>`. Live model probe passed. P2-9 reports `real_run_skipped` without `--allow-real-run`; session and auth probe remain `needsVerification`. |
| Claude Code | redacted local app path | `2.1.178 (Claude Code)` | Pass with `auth_missing` diagnostic | Blocked by local auth | Not run in P2-9 | `claude auth status` returned auth missing in the local P2-9 certification. Conformance skips before launching Claude. |
| OpenCode | redacted local app path | `1.15.6` | Pass | Skipped in P2-9 default real conformance; prior opt-in OpenCode smoke evidence remains historical. | Not run in P2-9 | P2-9 reports `real_run_skipped` without `--allow-real-run` and live model source is available. Explicit read-only/workspace-write flags, extra dirs, and session remain unverified. |

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
- 2026-06-20 P2-9 local certification: executable/version/model preflight passed for `codex-cli 0.142.0-alpha.1`; no real run was launched because `--allow-real-run` was not supplied.
- Historical opt-in Codex real smoke evidence remains useful but is not the latest local status.

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
- 2026-06-20 P2-9 local certification: executable/version/auth preflight passed for `2.1.178 (Claude Code)`, but auth was `missing`; no real run was launched.
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
- 2026-06-20 P2-9 local certification: executable/version/model preflight passed for `opencode` 1.15.6; no real run was launched because `--allow-real-run` was not supplied.
- Historical opt-in OpenCode real smoke evidence verifies stdin prompt support for local `opencode` 1.15.6. Keep prompt out of argv; do not switch to positional argv prompt. The runtime requested read-only behavior, but OpenCode explicit read-only/workspace-write flags remain unverified.

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

Production conformance gates without launching real agent CLIs:

```bash
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
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
node ./dist/cli/main.js store-lock --storage-dir .agent-runtime --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --dry-run --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --apply --json
node ./dist/cli/main.js diagnostics run run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js diagnostics goal goal_123 --storage-dir .agent-runtime --json --out diagnostics-goal_123.json
```

Optional real non-mutating run certification, only when the relevant local CLI auth is available. Real run execution is disabled unless `--allow-real-run` is present; without `--cwd`, it uses an isolated temp directory and runtime-requested `read-only` behavior:

```bash
node ./dist/cli/main.js conformance \
  --mode real \
  --agent codex \
  --allow-real-run \
  --json \
  --timeout-ms 30000
```

`conformance --mode real` without `--allow-real-run` performs real local detection/profile certification and reports `runClassification: "real_run_skipped"` for runnable adapters. With `--allow-real-run`, it also executes the selected real CLI run and validates expected text plus cwd mutation evidence. It returns `schemaVersion: "agent-runtime.conformance.v1"` plus stable per-adapter fields: `adapter`, `version`, `resolvedExecutable`, `auth`, `modelsSource`, `capabilities`, `argvProfile`, `promptTransport`, `parserMode`, `runClassification`, `expectedTextMatched`, `observedTextTail`, `cwdMutated`, `diagnosticsCount`, `diagnostics`, `skippedReason`, and `failureReason`. `--agent all` keeps one adapter fail/skip isolated in the summary. The legacy `smoke --mode real` command remains available for detailed run-summary evidence with `--stream jsonl --diagnostics`.

P2-4 drift diagnostics:

- `unsupported_flag`: a tracked capability flag is missing from help output or a real run reports an unsupported flag/argument.
- `needs_verification`: version/help shape is outside the current profile; do not infer new flags from it.
- parser/stream failures: structured stream errors become run diagnostics and are counted in conformance.

All conformance output is redacted recursively. Do not commit real username paths, tokens, Bearer values, auth-token env assignments, full prompts, raw CLI output, or unredacted observed tails.

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
- Durable `storageDir` writer mode uses a local single-writer lease. It prevents accidental same-machine multi-writer corruption but is not a distributed lock, daemon, WAL, or transactional database.
- Read-only CLI inspection paths do not acquire the writer lease and are intended to work while another live owner is active.
- P1-6 verifies the real smoke harness against stronger fake CLI contract tests and local real Codex/OpenCode smoke runs with expected text matched and no cwd mutation. It does not prove that a specific real CLI can complete authenticated write tasks in the local environment, nor that OpenCode exposes a verified explicit read-only flag.
- JSONL append is still a simple append-only file and not segmented. Default durability is `relaxed`; callers can request `storage.durability: "fsync"` for best-effort fdatasync/fsync after manifest writes and event appends, but there is no WAL or group commit.
- There is still no long-lived daemon, database, WAL, segment compaction, automatic manifest reconciliation, or live process resume. `store-repair --apply` is explicit, local JSONL-only repair with backups and live-owner refusal.
- Package root is intentionally small for pre-alpha: runtime facade and public types are exported; built-in adapter values and parser/detection helpers remain internal implementation details.
- CLI event JSONL is versioned as `agent-runtime.event.v1` for both live stream and replay commands; library replay APIs continue to return legacy `ReplayEvent<T>` records.
- CLI remains a thin local smoke/scripting wrapper over the library API, not a daemon or long-lived service.
- Real CLI auth and model availability depend on the user's local installation.
- Runtime-side validation executes shell commands supplied by task graphs; callers should only use it with trusted objectives or trusted planners.
- Parser coverage is fixture-based plus prior local smoke captures; more real stream captures should be added before a stable release.
- Historical P0-4 Codex smoke showed reconnect/timeout behavior; parser fixtures and timeout diagnostics preserve that coverage.
- Historical P0-4 OpenCode smoke timed out with zero parsed events, but P1-5 local `opencode` 1.15.6 real smoke passed and verifies stdin prompt support for this version.
- Claude Code run/goal smoke is blocked by local auth until `claude auth status` reports a logged-in account or a supported Anthropic-compatible provider env is supplied.

## P2-4 Real CLI Compatibility Certification Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
```

Covered behavior:

- `fixtures`, `fake`, and `real local observed` conformance evidence are distinct and labeled by `mode`;
- current local `real --agent all --json` observed: Codex detected with live models and `real_run_skipped`; Claude detected with `auth_missing`; OpenCode detected with live models and `real_run_skipped`;
- current local opt-in `real --agent codex --allow-real-run --expect-text "agent-runtime codex smoke ok" --json` observed: `success`, expected text matched, cwd not mutated, diagnostics count 0;
- `real --agent all --json` performs detection/profile certification without launching real runs unless `--allow-real-run` is explicit;
- per-adapter summaries include resolved executable, auth state, models source, capabilities, argv profile, prompt transport, parser mode, run classification, diagnostics count, compact diagnostics, and skip/fail reason;
- one adapter being unavailable, auth-missing, unsupported, or failed does not prevent other adapter summaries from being reported;
- tracked flag drift reports `unsupported_flag`; unfamiliar version shape reports `needs_verification`; stream/parser errors become actionable diagnostics;
- `--expect-text` failures include only a redacted/truncated `observedTextTail`;
- conformance JSON redacts token-like values, Bearer values, auth env assignments, prompts, private absolute paths, and cwd mutation secret-looking filenames;
- `.reference/`, tests, fixtures, and secret-looking values remain excluded from npm pack.

## P2-5 Release Candidate Dogfood Evidence

Release-candidate gate:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run ci
npm run dogfood
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js conformance --mode real --agent all --json
npm pack --dry-run
```

Dogfood coverage:

- `npm run dogfood` rebuilds before running CLI gates;
- fixtures conformance remains fully offline;
- fake conformance runs temporary fake CLIs through real adapter argv/stdin/parser paths;
- real conformance with `--agent all` performs detection/profile certification only because `--allow-real-run` is not supplied;
- `smoke --mode fixtures`, `agents --json`, and `doctor --json` remain runnable local checks;
- `examples/library-run.js` demonstrates `detect -> run -> replay/diagnostics/store health` using a fake Codex CLI;
- `examples/library-goal.js` demonstrates `createGoal -> task graph -> final result/replay/diagnostics` using a fake Codex CLI;
- package install smoke verifies `import('agent-cli-runtime')`, installed CLI fixtures conformance, installed fake conformance, and installed fixtures smoke from a packed tarball;
- package dry-run includes docs, examples, and `scripts/dogfood.mjs`, and excludes `.reference/`, `tests/`, test fixtures, raw real CLI output, private paths, and secrets.

Known compatibility/readiness risks:

- status-only real smoke exit `0` is intentionally classified as `unexpected_output` when no `text_delta` is observed;
- real conformance preflight can report unavailable/auth-missing on a specific machine because executable, auth, network, or proxy state is local;
- optional authenticated real runs must be performed manually with `--allow-real-run`;
- OpenCode explicit read-only/workspace-write flags, extra dirs, and session/resume remain unverified.

## P2-2 Local Supervisor Lease Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js store-health --storage-dir <temp-dir> --json
```

Covered behavior:

- two writer runtimes for the same `storageDir` conflict with a concise actionable error;
- stale lock takeover records a redacted storage diagnostic;
- read-only store inspection commands do not require the writer lock;
- live-owner active records are not interrupted by another writer attempt;
- stale-owner active runs/goals become interrupted, with pending/running goal tasks canceled;
- active run manifests receive heartbeat owner updates while the run is active;
- shutdown marks the lease closed;
- `store-health` reports lock/lease and active owner status;
- diagnostics `supervisorSummary` includes redacted owner/lease status;
- lock diagnostics and package dry-run remain secret/path safe.

## P2-3 Event Contract Evidence

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js smoke --mode fixtures --json
```

Covered behavior:

- `run --stream jsonl` and `replay-run --jsonl` emit `schemaVersion: "agent-runtime.event.v1"` envelopes with `scope.kind: "run"`;
- `goal --stream jsonl` and `replay-goal --jsonl` emit the same envelope shape with `scope.kind: "goal"`;
- terminal envelopes use stable `terminal.result` and `terminal.reason` values for success, timeout, canceled, interrupted, validation failure, execution failure, unavailable, auth missing, and task graph invalid cases;
- `runtime.replayRunEvents()` and `runtime.replayGoalEvents()` keep the old `ReplayEvent<T>` return shape;
- diagnostics bundles remain `agent-runtime.diagnostics.v1` and redact storage diagnostics, supervisor summaries, adapter summaries, and attempt evidence;
- conformance JSON includes `schemaVersion: "agent-runtime.conformance.v1"` and stable per-adapter summary fields;
- package root value exports remain limited to `createAgentRuntime`;
- package dry-run excludes `.reference/`, tests, fixtures, and secret-looking values.

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

## P1-6 Real Smoke Evidence Hardening

Commands verified in this stage:

```bash
node ./dist/cli/main.js smoke --mode real --agent codex --allow-real-run --json --diagnostics --timeout-ms 30000
node ./dist/cli/main.js smoke --mode real --agent opencode --allow-real-run --json --diagnostics --timeout-ms 30000
node ./dist/cli/main.js smoke --mode real --agent claude --allow-real-run --json --diagnostics --timeout-ms 30000
npm run typecheck
```

Covered behavior:

- default real smoke expects `agent-runtime <agent> smoke ok` in aggregated `text_delta`;
- status-only exit `0` and wrong text classify as `unexpected_output`;
- default isolated cwd mutation classifies as `cwd_mutated`;
- `--prompt-file` without `--expect-text` does not force text matching and still keeps prompt content out of argv;
- `--prompt-file --expect-text ...` enforces the override;
- `observedTextTail`, expected text, cwd, diagnostics, and mutation samples are redacted and observed text is truncated.
- local Codex and OpenCode real smoke passed with `expectedTextMatched: true`, `cwdMutationChecked: true`, and `cwdMutated: false`;
- local Claude real smoke preflight returned `classification: "auth_missing"` without launching a run.

## P1-7 Durable Store Hardening

Commands verified in this stage:

```bash
npm test
npm run typecheck
node ./dist/cli/main.js run --agent codex --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --json
node ./dist/cli/main.js run --agent opencode --permission read-only --timeout-ms 30000 --stream jsonl --diagnostics --json
npm run lint
npm run build
npm run ci
npm pack --dry-run
```

Store hardening and recovery verification:

```bash
node ./dist/cli/main.js runs --storage-dir .agent-runtime --json
node ./dist/cli/main.js run-status run_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-run run_123 --storage-dir .agent-runtime --after 10 --jsonl
node ./dist/cli/main.js goals --storage-dir .agent-runtime --json
node ./dist/cli/main.js goal-status goal_123 --storage-dir .agent-runtime --json
node ./dist/cli/main.js replay-goal goal_123 --storage-dir .agent-runtime --after 10 --jsonl
node ./dist/cli/main.js store-health --storage-dir .agent-runtime --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --dry-run --json
node ./dist/cli/main.js store-repair --storage-dir .agent-runtime --apply --json
```
Covered behavior:
- `RuntimeOptions.storage.durability` keeps `storageDir` compatible and defaults to `relaxed`;
- `fsync` mode exercises fdatasync/fsync hooks for manifest atomic writes and JSONL appends, with persisted `AGENT_STORAGE_SYNC_FALLBACK` diagnostics visible through store health and diagnostics bundles when sync primitives fail;
- JSONL record boundary is one JSON replay envelope plus trailing newline;
- partial JSONL tails keep the valid prefix and report corrupt line count, partial tail detection, last good event id/sequence, redacted tail preview, and `truncate_partial_tail`;
- corrupt middle JSONL lines report health diagnostics while preserving later valid records for replay;
- `store-repair --dry-run --json` reports intended non-destructive actions and does not modify files;
- `store-repair --apply --json` holds the local store lease while writing, backs up original event logs through temp-file-and-rename, truncates partial tails or removes corrupt middle lines, preserves later valid replay events, refuses live owners, records redacted repair diagnostics, and is idempotent;
- interrupted running runs and interrupted planning/running goals reload as failed, update manifests, append diagnostic/terminal replay events, clear active lists, and appear in store health;
- health, repair dry-run, and diagnostics bundle output remain redacted;
- `npm pack --dry-run` remains covered by the public contract test and excludes `.reference/`, fixtures, and real smoke output.

## P2-1 Production Runtime Hardening

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Covered behavior:

- `conformance --mode fixtures` returns stable per-adapter summaries without launching CLIs;
- `conformance --mode fake` runs temporary fake CLIs through the real adapter argv/stdin/parser path;
- historical P2-3 `conformance --mode real` refused without `--allow-real-run`; P2-4 supersedes this with safe detection/profile certification and no real run launch unless `--allow-real-run` is explicit;
- `--agent all` preserves one adapter fail/skip alongside other adapter summaries;
- validation timeout evidence records classification, timeout, redacted env override, and replayable diagnostics export;
- diagnostics bundle includes `supervisorSummary` without raw env, prompt, token, or private path data;
- reload, cancel, and shutdown terminal events remain idempotent;
- parser fixtures cover warning/log/noise and corrupt lines without producing `text_delta`;
- package dry-run excludes `.reference/`, tests, private fixture paths, and secret-looking values;
- production scope and OpenDesign daemon-level gaps are documented in `docs/production-readiness.md`.

## P1-8 Release Candidate Hardening

Commands verified in this stage:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run ci
npm pack --dry-run
```

Release-preflight workflow:

```bash
repo_root="${GITHUB_WORKSPACE:-$(pwd -P)}"
tmp_dir="$(mktemp -d /tmp/agent-runtime-release-XXXXXX)"
pushd "$tmp_dir"
pack_info="$(cd "$repo_root" && npm pack --json --ignore-scripts --pack-destination "$tmp_dir")"
package_file="$(printf '%s' "$pack_info" | node -e "const data = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); process.stdout.write(data[0].filename);")"
npm init -y >/dev/null
npm install "$tmp_dir/$package_file" --no-save --ignore-scripts --no-audit --no-fund >/tmp/agent-runtime-release-smoke-install.log
node -e "(async()=>{ const m = await import('agent-cli-runtime'); if (typeof m.createAgentRuntime !== 'function') process.exit(1); console.log(typeof m.createAgentRuntime); })()"
node ./node_modules/.bin/agent-runtime agents --json > /tmp/agent-runtime-release-smoke-agents.json
node ./node_modules/.bin/agent-runtime doctor --json > /tmp/agent-runtime-release-smoke-doctor.json
node ./node_modules/.bin/agent-runtime smoke --mode fixtures --json > /tmp/agent-runtime-release-smoke-fixtures.json
popd
node -e "const fs = require('node:fs'); JSON.parse(fs.readFileSync('/tmp/agent-runtime-release-smoke-agents.json','utf8')); JSON.parse(fs.readFileSync('/tmp/agent-runtime-release-smoke-doctor.json','utf8')); JSON.parse(fs.readFileSync('/tmp/agent-runtime-release-smoke-fixtures.json','utf8'));"
```

Release-candidate notes:

- pre-alpha / developer preview scope:
  - no stable API guarantee;
  - no daemon;
  - no WAL;
  - no remote runtime.
- `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/release-checklist.md` are part of package boundary docs.

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
