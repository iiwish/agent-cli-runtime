import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { claudeAdapter } from "../src/adapters/claude.js";
import { codexAdapter } from "../src/adapters/codex.js";
import { opencodeAdapter } from "../src/adapters/opencode.js";
import { preparePromptTransport } from "../src/runs/prompt-transport.js";
import { runParserFixtureCases } from "../src/smoke/parser-samples.js";

describe("MVP adapters", () => {
  it("declares compatibility profiles for Codex, Claude, and OpenCode", () => {
    expect(codexAdapter.compatibility).toMatchObject({
      executableNames: ["codex"],
      versionOutputPattern: expect.any(String),
      promptTransport: "stdin:text",
      promptTransportMode: { kind: "stdin", inputFormat: "text" },
      streamFormat: "codex-json",
      streamMode: { format: "codex-json", framing: "jsonl", source: "stdout" },
    });
    expect(codexAdapter.compatibility?.executableCandidates).toEqual(expect.arrayContaining([
      { name: "codex", source: "primary" },
      { name: "codex", source: "env", envVar: "CODEX_BIN" },
    ]));
    expect(claudeAdapter.compatibility).toMatchObject({
      executableNames: ["claude"],
      versionOutputPattern: expect.any(String),
      promptTransport: "stdin:jsonl",
      promptTransportMode: { kind: "stdin", inputFormat: "jsonl" },
      streamFormat: "claude-stream-json",
      streamMode: { format: "claude-stream-json", framing: "jsonl", source: "stdout" },
    });
    expect(claudeAdapter.compatibility?.executableCandidates).toEqual(expect.arrayContaining([
      { name: "claude", source: "primary" },
      { name: "claude", source: "env", envVar: "CLAUDE_BIN" },
    ]));
    expect(opencodeAdapter.compatibility).toMatchObject({
      executableNames: ["opencode-cli", "opencode"],
      versionOutputPattern: expect.any(String),
      promptTransport: "stdin:text",
      promptTransportMode: { kind: "stdin", inputFormat: "text" },
      streamFormat: "opencode-json",
      streamMode: { format: "opencode-json", framing: "jsonl", source: "stdout" },
    });
    expect(opencodeAdapter.compatibility?.executableCandidates).toEqual(expect.arrayContaining([
      { name: "opencode-cli", source: "primary" },
      { name: "opencode", source: "fallback" },
      { name: "opencode", source: "env", envVar: "OPENCODE_BIN" },
    ]));
    expect(codexAdapter.compatibility?.needsVerification).toEqual(expect.arrayContaining([
      expect.objectContaining({ mapsTo: "session" }),
    ]));
    expect(claudeAdapter.compatibility?.needsVerification).toEqual(expect.arrayContaining([
      expect.objectContaining({ mapsTo: "session.id" }),
    ]));
    expect(opencodeAdapter.compatibility?.needsVerification).toEqual(expect.arrayContaining([
      expect.objectContaining({ mapsTo: "extraAllowedDirs" }),
      expect.objectContaining({ mapsTo: "session" }),
    ]));
  });

  it("builds Codex args without placing prompt in argv", () => {
    const prompt = "do important work";
    const args = codexAdapter.buildArgs({
      prompt,
      cwd: "/tmp/project",
      extraAllowedDirs: ["/tmp/extra"],
      permissionPolicy: "workspace-write",
      model: "gpt-5-codex",
      reasoning: "high",
      session: { id: "codex-session" },
    });
    expect(args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "-C",
      "/tmp/project",
      "--add-dir",
      "/tmp/extra",
      "--model",
      "gpt-5-codex",
      "-c",
      'model_reasoning_effort="high"',
    ]);
    expect(args).not.toContain(prompt);
    expect(args).not.toContain("codex-session");
  });

  it("builds Claude args without placing prompt in argv", () => {
    const prompt = "do important work";
    const args = claudeAdapter.buildArgs({
      prompt,
      cwd: "/tmp/project",
      extraAllowedDirs: ["/tmp/extra"],
      permissionPolicy: "headless-auto",
      model: "sonnet",
      session: { resumeId: "session-123" },
    });
    expect(args).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "sonnet",
      "--add-dir",
      "/tmp/extra",
      "--resume",
      "session-123",
      "--permission-mode",
      "bypassPermissions",
    ]);
    expect(args).not.toContain(prompt);
  });

  it("does not guess unverified Claude session-id flags", () => {
    const args = claudeAdapter.buildArgs({
      prompt: "do important work",
      cwd: "/tmp/project",
      extraAllowedDirs: [],
      permissionPolicy: "agent-default",
      session: { id: "session-needs-verification" },
    });
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("session-needs-verification");
  });

  it("builds OpenCode args without placing prompt in argv", () => {
    const prompt = "do important work";
    const args = opencodeAdapter.buildArgs({
      prompt,
      cwd: "/tmp/project",
      extraAllowedDirs: ["/tmp/extra"],
      permissionPolicy: "headless-auto",
      model: "openai/gpt-5",
      session: { id: "opencode-session" },
    });
    expect(args).toEqual(["run", "--format", "json", "--dir", "/tmp/project", "-m", "openai/gpt-5", "--dangerously-skip-permissions"]);
    expect(args).not.toContain(prompt);
    expect(args).not.toContain("/tmp/extra");
    expect(args).not.toContain("opencode-session");
  });

  it("keeps long prompts out of argv by using stdin transport for all built-in adapters", async () => {
    const prompt = "x".repeat(128 * 1024);
    for (const adapter of [codexAdapter, claudeAdapter, opencodeAdapter]) {
      const prepared = await preparePromptTransport(adapter.promptTransport, prompt);
      const args = adapter.buildArgs({ prompt, cwd: "/tmp/project", extraAllowedDirs: [], permissionPolicy: "agent-default" });
      expect(prepared.stdinData).toContain(prompt);
      expect(args.join("\u0000")).not.toContain(prompt);
    }
  });

  it("passes built-in parser conformance fixtures, including partial and unknown events", () => {
    const results = runParserFixtureCases();
    expect(results).toHaveLength(24);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.name === "partial line").every((result) => result.eventTypes.length === 1)).toBe(true);
    expect(results.filter((result) => result.name === "unknown event").every((result) => result.eventTypes.length === 0)).toBe(true);
    expect(results.filter((result) => result.name === "warning log noise").every((result) => result.eventTypes.length === 0)).toBe(true);
    expect(results.filter((result) => result.name === "corrupt line noise").every((result) => result.eventTypes.length === 0)).toBe(true);
  });

  it("parses Codex JSON while ignoring noisy non-JSON lines", () => {
    const parser = codexAdapter.stream.create();
    const events = parser.parse(fixture("codex-json.jsonl"));
    expect(events).toEqual([
      { type: "status", label: "initializing" },
      { type: "text_delta", text: "hello" },
      { type: "error", code: "AGENT_EXECUTION_FAILED", message: "boom" },
    ]);
  });

  it("parses redacted Codex run smoke streams through the terminal content path", () => {
    const parser = codexAdapter.stream.create();
    const events = parser.parse(fixture("codex-run-smoke-redacted.jsonl"));
    expect(events).toEqual([
      { type: "status", label: "initializing" },
      { type: "status", label: "running" },
      {
        type: "status",
        label: "reconnecting",
        detail: "Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))",
      },
      { type: "text_delta", text: "agent-runtime codex smoke ok" },
      { type: "usage", usage: { inputTokens: 11, outputTokens: 6, thinkingTokens: 1 } },
    ]);
  });

  it("parses Claude stream-json while ignoring noisy non-JSON lines", () => {
    const parser = claudeAdapter.stream.create();
    const events = parser.parse(fixture("claude-stream-json.jsonl"));
    expect(events).toEqual([
      { type: "status", label: "initializing" },
      { type: "text_delta", text: "hi" },
      { type: "tool_call", id: "toolu_1", name: "Read", input: { file_path: "/tmp/redacted.txt" } },
      { type: "tool_result", id: "toolu_1", output: "ok", isError: false },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 7, cachedReadTokens: 2 } },
      { type: "error", code: "AGENT_EXECUTION_FAILED", message: "auth required" },
    ]);
  });

  it("parses OpenCode JSON while ignoring noisy non-JSON lines", () => {
    const parser = opencodeAdapter.stream.create();
    const events = parser.parse(fixture("opencode-json.jsonl"));
    expect(events).toEqual([
      { type: "status", label: "running" },
      { type: "text_delta", text: "yo" },
      { type: "tool_call", id: "call_1", name: "bash", input: { cmd: "pwd" } },
      { type: "tool_result", id: "call_1", output: "ok", isError: false },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 4, thinkingTokens: 1 }, costUsd: 0.01 },
      { type: "error", code: "AGENT_EXECUTION_FAILED", message: "bad request" },
    ]);
  });

  it("parses redacted OpenCode run smoke streams through the terminal content path", () => {
    const parser = opencodeAdapter.stream.create();
    const events = parser.parse(fixture("opencode-run-smoke-redacted.jsonl"));
    expect(events).toEqual([
      { type: "status", label: "running" },
      { type: "text_delta", text: "agent-runtime opencode smoke ok" },
      { type: "usage", usage: { inputTokens: 7, outputTokens: 5, thinkingTokens: 2 }, costUsd: 0.001 },
    ]);
  });

  it("deduplicates repeated Claude status noise", () => {
    const parser = claudeAdapter.stream.create();
    const events = [
      ...parser.parse('{"type":"system"}\n'),
      ...parser.parse('{"type":"system"}\n'),
      ...parser.parse('{"type":"stream_event","event":{"type":"message_start"}}\n'),
      ...parser.parse('{"type":"stream_event","event":{"type":"message_start"}}\n'),
    ];
    expect(events).toEqual([
      { type: "status", label: "initializing" },
      { type: "status", label: "running" },
    ]);
  });
});

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/streams/${name}`, import.meta.url), "utf8");
}
