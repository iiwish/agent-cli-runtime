# Agent CLI Runtime

> A tiny local-first runtime for driving Codex CLI, Claude Code, OpenCode, and other coding-agent CLIs through one typed API.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#status)

[English](./README.md) | [简体中文](./README.zh-CN.md)

Agent CLI Runtime is the adapter layer you reach for when you do **not** want to build another coding agent.

Modern local coding agents already know how to plan, edit files, run tools, ask for permission, manage sessions, and talk to models. This project keeps those loops inside the user's installed CLI and gives product builders a small, dependable runtime around them:

- detect installed local coding agents;
- launch them in a chosen `cwd`;
- pass prompts through safe transports such as stdin;
- normalize streaming output into one event protocol;
- cancel, time out, diagnose, and classify runs;
- keep permissions and extra readable directories explicit.

## Status

This repository is in **pre-alpha MVP stage**.

The SSOT is available in [docs/ssot.md](./docs/ssot.md). The current implementation is a library-first Node.js/TypeScript MVP with memory-only default run and goal scheduling, optional durable local replay storage, compatibility profiles for the built-in CLIs, hardened planner/task-graph validation, real-stream parser fixtures, fake CLI integration tests, and thin local smoke/query CLI commands with redacted diagnostics and opt-in real CLI smoke evidence capture.

## Why

Every serious coding-agent product eventually needs the same boring, sharp-edged runtime work:

| Problem | Runtime responsibility |
| --- | --- |
| Users have different CLIs installed | Detect Codex CLI, Claude Code, OpenCode, and future adapters |
| Each CLI has different flags | Hide argv construction behind adapter definitions |
| Long prompts break argv limits | Prefer stdin or prompt files by default |
| Streams have different schemas | Parse per-agent output into one `AgentEvent` stream |
| Headless runs can hang | Provide cancellation, timeout, inactivity, and exit classification |
| Permissions are easy to overgrant | Make `cwd`, `extraAllowedDirs`, and `permissionPolicy` explicit |

The goal is to make this layer boring enough that excellent tools can build on it.

## What This Is Not

Agent CLI Runtime is not:

- an LLM provider router;
- a hosted cloud agent;
- a replacement for Codex CLI, Claude Code, or OpenCode;
- a web UI;
- a plugin marketplace;
- a custom `Read` / `Write` / `Edit` tool loop;
- a permission bypass wrapper.

The runtime delegates the agent loop. It normalizes execution, not intelligence.

## API

```ts
import { createAgentRuntime } from "agent-cli-runtime";

const runtime = createAgentRuntime();

const agents = await runtime.detect({
  includeUnavailable: true,
});

const run = await runtime.run({
  agentId: "codex",
  cwd: "/path/to/project",
  prompt: "Add a focused regression test for the failing parser case.",
  permissionPolicy: "workspace-write",
});

for await (const event of run.events) {
  if (event.type === "text_delta") process.stdout.write(event.text);
  if (event.type === "tool_call") console.log("tool", event.name);
  if (event.type === "error") console.error(event.code, event.message);
}
```

Goals add a planner run before task execution:

```ts
const goal = await runtime.createGoal({
  cwd: "/path/to/project",
  objective: "Implement a focused parser regression fix.",
  defaultAgentId: "codex",
  permissionPolicy: "workspace-write",
  maxConcurrentTasks: 2,
  retryPolicy: {
    maxAttempts: 2,
    retryableErrorCodes: ["AGENT_TIMEOUT", "AGENT_EXECUTION_FAILED"],
    backoffMs: 500,
  },
});

for await (const event of goal.events) {
  if (event.type === "task_attempt_started") console.log(event.taskId, event.attemptId, event.runId);
  if (event.type === "goal_finished") console.log(event.result);
}
```

Goal scheduling uses a dependency-aware ready queue. A task can start only after all dependencies have succeeded. The conservative default is `maxConcurrentTasks: 1`, preserving serial dependency-order execution; set `maxConcurrentTasks` on `createGoal()` or `createAgentRuntime()` to allow independent ready tasks to run in parallel. `retryPolicy` defaults to `{ maxAttempts: 1 }`; only failures whose terminal error code is listed in `retryableErrorCodes` are retried. Cancellation and validation failures are not retried unless the caller explicitly includes their error code.

Planner output is validated before any task starts. The preferred planner response is strict JSON, but the runtime can extract one JSON object from a Markdown fenced block or short surrounding prose. Multiple JSON objects, malformed JSON, missing `tasks`, or invalid field types fail planning with `AGENT_TASK_GRAPH_INVALID` as a `scheduler_error` and the goal finishes as `failed`; they are not reported as task failures or adapter unavailability. Diagnostics are concise and do not echo oversized planner output.

Task graph schema:

```json
{
  "tasks": [
    {
      "id": "T001",
      "title": "Short title",
      "objective": "Self-contained task objective",
      "dependencies": [],
      "allowedFiles": ["src/example.ts"],
      "validationCommands": ["npm test"],
      "agentId": "codex",
      "retryPolicy": {
        "maxAttempts": 2,
        "retryableErrorCodes": ["AGENT_TIMEOUT"],
        "backoffMs": 250
      }
    }
  ]
}
```

`id`, `title`, `objective`, and every `dependencies` item must be strings. `dependencies`, `allowedFiles`, `validationCommands`, and `retryPolicy.retryableErrorCodes` must be string arrays when present. `agentId` must be a string when present. A task-level `retryPolicy` must include a positive integer `maxAttempts`, a string-array `retryableErrorCodes`, and a non-negative numeric `backoffMs`.

Task evidence records every attempt:

```json
{
  "runId": "run_latest",
  "result": "success",
  "attempts": [
    {
      "attemptId": "T001:attempt:1",
      "runId": "run_1",
      "startedAt": 1760000000000,
      "finishedAt": 1760000001200,
      "result": "failed",
      "diagnostics": [{ "code": "AGENT_EXECUTION_FAILED", "message": "..." }]
    },
    {
      "attemptId": "T001:attempt:2",
      "runId": "run_2",
      "startedAt": 1760000001800,
      "finishedAt": 1760000002600,
      "result": "success",
      "diagnostics": []
    }
  ],
  "validationCommands": [],
  "summary": "Task T001 finished with success after 2 attempts."
}
```

Persistence is opt-in. Without `storageDir`, runs and goals stay memory-only. With `storageDir`, manifests and replay events are written as auditable JSON files:

```ts
const runtime = createAgentRuntime({
  storageDir: ".agent-runtime",
});

const runs = await runtime.listRuns({ status: "active" });
const runEvents = await runtime.replayRunEvents("run_123", { afterEventId: 10 });
const goals = await runtime.listGoals();
const goalEvents = await runtime.replayGoalEvents("goal_123");
```

The public facade exposes:

- `createAgentRuntime(options?)`
- `runtime.detect(options?)`
- `runtime.detectStream(options?)`
- `runtime.run(request)`
- `runtime.createGoal(request)`
- `runtime.cancelRun(runId)`
- `runtime.cancelGoal(goalId)`
- `runtime.shutdown(reason?)`
- `runtime.getRun(runId)`
- `runtime.replayRunEvents(runId, { afterEventId? })`
- `runtime.listRuns({ status? })`
- `runtime.getGoal(goalId)`
- `runtime.replayGoalEvents(goalId, { afterEventId? })`
- `runtime.listGoals({ status? })`
- `runtime.inspectStore({ storageDir? })`
- `runtime.exportDiagnostics({ kind: "run", runId, storageDir? })`
- `runtime.exportDiagnostics({ kind: "goal", goalId, storageDir? })`
- `runtime.getAdapter(id)`

### API Contract Boundary

For the pre-alpha release, the package root is intentionally small. It exports the `createAgentRuntime()` value plus the public TypeScript types needed to call it and consume its records:

- stable MVP surface: `AgentRuntime`, `RuntimeOptions`, `DetectOptions`, `DetectedAgent`, `RunRequest`, `RunHandle`, `RunRecord`, `RunStatus`, `CreateGoalRequest`, `GoalHandle`, `GoalRecord`, `GoalStatus`, `AgentEvent`, `SchedulerEvent`, `ReplayEvent`, `RuntimeDiagnostic`, and `RuntimeErrorCode`;
- experimental extension surface: adapter-authoring types such as `AgentAdapterDef`, `BuildArgsInput`, `PromptTransport`, `StreamParser`, and `AdapterCompatibilityProfile`;
- not exported from the package root: built-in adapter values, parser helpers, executable-resolution helpers, stores, schedulers, and task-graph helpers.

`getAdapter(id)` and `RuntimeOptions.adapters` exist for adapter experimentation in pre-alpha. Treat them as extension points whose shape may still change before a stable release.

## Installation

```bash
npm install agent-cli-runtime
```

For local development from this repository:

```bash
npm ci
npm run build
node ./dist/cli/main.js agents --json
```

## CLI

```bash
agent-runtime agents
agent-runtime smoke --mode detection --json
agent-runtime smoke --mode fixtures --json
agent-runtime run --agent codex --cwd . --prompt "fix the failing test"
agent-runtime goal --agent codex --cwd . --prompt "split this objective into tasks and execute them"
agent-runtime goal --agent codex --cwd . --prompt "run independent fixes" --max-concurrent-tasks 2 --max-attempts 2 --retryable-error-codes AGENT_TIMEOUT,AGENT_EXECUTION_FAILED
agent-runtime run --agent claude --cwd . --permission workspace-write --prompt-file task.md
agent-runtime run --agent codex --cwd . --prompt "fix the failing test" --json
agent-runtime run --agent codex --cwd . --prompt "fix the failing test" --stream jsonl --diagnostics
agent-runtime doctor
agent-runtime runs --storage-dir .agent-runtime --json
agent-runtime run-status run_123 --storage-dir .agent-runtime --json
agent-runtime replay-run run_123 --storage-dir .agent-runtime --after 10 --jsonl
agent-runtime goals --storage-dir .agent-runtime --json
agent-runtime goal-status goal_123 --storage-dir .agent-runtime --json
agent-runtime replay-goal goal_123 --storage-dir .agent-runtime --after 10 --jsonl
agent-runtime store-health --storage-dir .agent-runtime --json
agent-runtime diagnostics run run_123 --storage-dir .agent-runtime --json
agent-runtime diagnostics goal goal_123 --storage-dir .agent-runtime --json --out diagnostics-goal_123.json
agent-runtime smoke --mode real --agent codex --allow-real-run --prompt-file task.md --expect-text "expected reply" --timeout-ms 30000 --json --diagnostics
```

The library API is primary. The CLI is a thin wrapper over the same runtime and supports `--json` plus `--stream jsonl` for run/goal event streams. For run/goal commands, `--json` prints the final run or goal record. `--stream jsonl --diagnostics` keeps the event stream and appends a redacted `run_summary` or `goal_summary` line after the terminal event.

`agent-runtime smoke` has three modes:

- `--mode detection` runs local executable/model/auth detection only.
- `--mode fixtures` dry-runs built-in parser conformance fixtures for Codex, Claude, and OpenCode without launching real CLIs.
- `--mode real` launches one real non-mutating run with runtime-requested read-only behavior, but only when `--allow-real-run` and `--agent <id>` are both supplied. Without `--cwd`, it uses an isolated temp directory and the default prompt asks the agent to reply exactly with `agent-runtime <agent> smoke ok` without editing files. The default smoke automatically requires that expected text in aggregated `text_delta` output; `--expect-text <text>` overrides it. If `--prompt` or `--prompt-file` is supplied without `--expect-text`, the summary sets `expectedTextRequired: false` but still requires some observed `text_delta` so status-only exit `0` cannot pass. JSON and `--stream jsonl --diagnostics` output include a redacted `real_smoke_summary` with `classification`, `expectedTextMatched`, `observedTextTail`, cwd mutation evidence, the final run record, and diagnostics. A missing required text is `unexpected_output`; detected cwd writes/updates/deletes are `cwd_mutated`.

Disk storage layout is intentionally simple and tail-friendly:

```text
.agent-runtime/
  runs/<runId>/manifest.json
  runs/<runId>/events.jsonl
  goals/<goalId>/manifest.json
  goals/<goalId>/events.jsonl
```

Each JSONL line is `{ "id": 1, "sequence": 1, "runId": "run_123", "timestamp": 123, "event": {...} }` or the same shape with `goalId`. Event ids/sequences are monotonic per run or goal and are preserved for stable replay. `runtime.shutdown(reason?)` cancels active runs/goals and waits briefly for terminal events before returning. When a new runtime opens a `storageDir`, terminal runs/goals are readable immediately; runs/goals found in `queued`, `running`, or `planning` are marked failed with an `AGENT_RUNTIME_INTERRUPTED` diagnostic/event so they never pretend to still be active after a process restart. A corrupt manifest or JSONL line is isolated to that record and reported through `AGENT_STORE_RECORD_CORRUPT` or `AGENT_EVENT_LOG_CORRUPT` diagnostics instead of failing runtime initialization. Corrupt manifests are not silently rewritten during load, so later health scans can still see the original damaged record.

`store-health` scans the on-disk store without launching an agent. It reports run/goal totals, corrupt manifests, corrupt event logs, partial JSONL tails with retained prefix counts, interrupted historical records, and consistency warnings. Terminal manifests without terminal events and non-terminal manifests with terminal events are reported as warnings; the runtime does not silently reconcile them.

Diagnostics bundles are redacted JSON evidence packets for one run or goal. A bundle includes the sanitized manifest, an event summary rather than full event payloads, diagnostics, goal task attempt evidence when present, and an environment-safe adapter summary. `--out <file>` writes the bundle with a temp-file-and-rename atomic write. Bundles and health output do not include raw corrupt JSONL lines, tokens, Bearer values, auth-token environment assignments, full environment dumps, or absolute private paths.

## Configuration

Executable overrides:

```bash
export CODEX_BIN=/absolute/path/to/codex
export CLAUDE_BIN=/absolute/path/to/claude
export OPENCODE_BIN=/absolute/path/to/opencode
```

Proxy settings are inherited from the process environment:

```bash
export HTTPS_PROXY=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
```

Claude Code can also target Anthropic-compatible providers such as DeepSeek:

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
```

Set the provider's documented Anthropic-compatible auth token environment variable in your shell or process manager; do not place real tokens in prompts, fixtures, manifests, or committed docs.

See [docs/compatibility.md](./docs/compatibility.md) for the current real CLI smoke matrix.

## Runtime Model

```mermaid
flowchart LR
  App["Your app or script"] --> Runtime["Agent CLI Runtime"]
  Runtime --> Registry["Adapter registry"]
  Registry --> Codex["Codex CLI"]
  Registry --> Claude["Claude Code"]
  Registry --> OpenCode["OpenCode"]
  Codex --> Events["AgentEvent stream"]
  Claude --> Events
  OpenCode --> Events
  Events --> App
```

Each adapter owns only the details that truly vary by CLI:

- binary names and env overrides;
- version, auth, capability, and model probes;
- compatibility profile notes for verified and unverified invocation flags;
- argv construction;
- prompt transport;
- stream parser;
- permission-policy mapping.

The core runner owns process lifecycle, process-tree best-effort termination, diagnostics, cancellation, timeout, shutdown, redaction, and event delivery.

## MVP Adapters

| Adapter | Target binary | Prompt transport | Stream strategy | MVP status |
| --- | --- | --- | --- | --- |
| Codex CLI | `codex` | stdin | `codex exec --json` | P1-6 real smoke requires expected text evidence and cwd mutation checks; timeout diagnostics classify local network/plugin startup stalls; transient reconnect events are parsed as status |
| Claude Code | `claude` | stdin JSONL | `stream-json` | P0-4 detection baseline recorded; local auth still missing |
| OpenCode | `opencode-cli`, `opencode` | stdin | JSON stream | P1-6 non-mutating isolated smoke is checked for expected text and cwd mutation; stdin prompt support is verified on local `opencode` 1.15.6, explicit read-only flags remain unverified |

Future adapters should be possible without changing the core runtime.

## Event Protocol

The runtime exposes a small append-only event stream:

```ts
type AgentEvent =
  | { type: "run_started"; runId: string; agentId: string; cwd: string; model?: string; timestamp: number }
  | { type: "status"; label: string; detail?: string; timestamp: number }
  | { type: "text_delta"; text: string; timestamp: number }
  | { type: "thinking_delta"; text: string; timestamp: number }
  | { type: "tool_call"; id: string; name: string; input?: unknown; timestamp: number }
  | { type: "tool_result"; id: string; output?: unknown; isError?: boolean; timestamp: number }
  | { type: "file_event"; path: string; action: "created" | "updated" | "deleted" | "unknown"; timestamp: number }
  | { type: "usage"; usage: RuntimeUsage; costUsd?: number; timestamp: number }
  | { type: "error"; code: RuntimeErrorCode; message: string; retryable?: boolean; detail?: unknown; timestamp: number }
  | { type: "run_finished"; result: "success" | "failed" | "cancelled"; exitCode?: number | null; signal?: string | null; timestamp: number };
```

Goal scheduling wraps run events with `goal_started`, `task_created`, `task_started`, `task_attempt_started`, `run_event`, `task_attempt_finished`, `task_finished`, `goal_finished`, and `scheduler_error`.

Adapter-specific raw events can be logged for debugging, but the public API should stay stable and small.

## Security Model

This project starts local processes on behalf of the caller. That is powerful and deserves explicit defaults.

- The runtime does not log in to agent CLIs.
- The runtime does not edit user CLI config files in MVP.
- Metadata probes run in a neutral temp directory, not in the user's project.
- Prompts should use stdin or prompt files before argv.
- `cwd` must be explicit.
- `extraAllowedDirs` must be explicit.
- Permission escalation must be explicit.
- Logs and diagnostics must redact secret-looking env values and tokens.
- Disk backed storage does not write secret-bearing environment maps. Diagnostics and validation stdout/stderr are redacted before they are written to manifests or events.
- A failed adapter must not collapse detection for other adapters.
- Detection probe diagnostics are classified as `not_installed`, `not_executable`, `auth_missing`, `network_error`, `unsupported_flag`, or `probe_failed`.
- JSON stream parsers ignore empty, warning, log, and non-JSON noise lines; user-visible text is emitted only from structured CLI text fields.
- Timeout diagnostics include sanitized argv/profile labels, parsed event counts, stdout/stderr tails, and actionable hints; prompts are still kept out of argv.
- Goal task `validationCommands` run in the task `cwd` after a successful agent run; failed validation marks the task and goal as failed.

The runtime should never grant more authority than the caller requested.

## Relationship To Other Projects

Agent CLI Runtime is inspired by the adapter/runtime boundary in [OpenDesign](https://github.com/nexu-io/open-design) and the clarity of [OpenCode](https://github.com/anomalyco/opencode)'s open-source project presentation.

It is not affiliated with OpenDesign, OpenCode, Anthropic, OpenAI, or any supported CLI vendor.

## Roadmap

- M0: SSOT, README, license, project skeleton. Done.
- M1: core process runner with fake CLI tests. Done.
- M2: Codex adapter MVP. Done.
- M3: Claude Code adapter MVP. Done.
- M4: OpenCode adapter MVP. Done.
- M5: CLI wrapper and `doctor` command. Done.
- M6: public package boundary, compatibility matrix, API/CLI contract freeze, contribution guide, and security policy. In progress for pre-alpha; contribution and security policy docs remain post-MVP follow-up.

## Contributing

The project is not ready for external contributions yet. The first contribution guide will land with the implementation skeleton.

Good first contribution areas will likely include:

- fake CLI fixtures;
- parser fixtures from real CLI streams;
- adapter compatibility tests;
- docs for local CLI setup;
- security and diagnostics review.

## License

Apache License 2.0. See [LICENSE](./LICENSE).
