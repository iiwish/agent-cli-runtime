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

This repository is in **pre-alpha design stage**.

The SSOT is available in [docs/ssot.md](./docs/ssot.md). Implementation comes next. Until the first package release, command examples below describe the target API and CLI shape rather than a published npm package.

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

## Target API

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

## Target CLI

```bash
agent-runtime agents
agent-runtime run --agent codex --cwd . --prompt "fix the failing test"
agent-runtime run --agent claude --cwd . --permission workspace-write --prompt-file task.md
agent-runtime doctor
```

The library API is primary. The CLI will be a thin wrapper over the same runtime.

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
- argv construction;
- prompt transport;
- stream parser;
- permission-policy mapping.

The core runner owns process lifecycle, diagnostics, cancellation, timeout, redaction, and event delivery.

## MVP Adapters

| Adapter | Target binary | Prompt transport | Stream strategy | MVP status |
| --- | --- | --- | --- | --- |
| Codex CLI | `codex` | stdin | `codex exec --json` | Planned |
| Claude Code | `claude` | stdin JSONL | `stream-json` | Planned |
| OpenCode | `opencode-cli`, `opencode` | stdin | JSON stream | Planned |

Future adapters should be possible without changing the core runtime.

## Event Protocol

The runtime exposes a small append-only event stream:

```ts
type AgentEvent =
  | { type: "run_started"; runId: string; agentId: string; cwd: string }
  | { type: "status"; label: string; detail?: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input?: unknown }
  | { type: "tool_result"; id: string; output?: unknown; isError?: boolean }
  | { type: "usage"; usage: RuntimeUsage; costUsd?: number }
  | { type: "error"; code: RuntimeErrorCode; message: string; retryable?: boolean }
  | { type: "run_finished"; result: "success" | "failed" | "cancelled" };
```

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
- A failed adapter must not collapse detection for other adapters.

The runtime should never grant more authority than the caller requested.

## Relationship To Other Projects

Agent CLI Runtime is inspired by the adapter/runtime boundary in [OpenDesign](https://github.com/nexu-io/open-design) and the clarity of [OpenCode](https://github.com/anomalyco/opencode)'s open-source project presentation.

It is not affiliated with OpenDesign, OpenCode, Anthropic, OpenAI, or any supported CLI vendor.

## Roadmap

- M0: SSOT, README, license, project skeleton.
- M1: core process runner with fake CLI tests.
- M2: Codex adapter.
- M3: Claude Code adapter.
- M4: OpenCode adapter.
- M5: CLI wrapper and `doctor` command.
- M6: public package, compatibility matrix, contribution guide, and security policy.

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
