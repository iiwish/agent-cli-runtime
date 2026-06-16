import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { claudeAdapter, codexAdapter, opencodeAdapter } from "../src/index.js";
import { preparePromptTransport } from "../src/runs/prompt-transport.js";

describe("MVP adapters", () => {
  it("declares compatibility profiles for Codex, Claude, and OpenCode", () => {
    expect(codexAdapter.compatibility).toMatchObject({
      executableNames: ["codex"],
      promptTransport: "stdin:text",
      streamFormat: "codex-json",
    });
    expect(claudeAdapter.compatibility).toMatchObject({
      executableNames: ["claude"],
      promptTransport: "stdin:jsonl",
      streamFormat: "claude-stream-json",
    });
    expect(opencodeAdapter.compatibility).toMatchObject({
      executableNames: ["opencode-cli", "opencode"],
      promptTransport: "stdin:text",
      streamFormat: "opencode-json",
    });
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

  it("builds OpenCode args without placing prompt in argv", () => {
    const prompt = "do important work";
    const args = opencodeAdapter.buildArgs({
      prompt,
      cwd: "/tmp/project",
      extraAllowedDirs: [],
      permissionPolicy: "headless-auto",
      model: "openai/gpt-5",
    });
    expect(args).toEqual(["run", "--format", "json", "--dir", "/tmp/project", "-m", "openai/gpt-5", "--dangerously-skip-permissions"]);
    expect(args).not.toContain(prompt);
  });

  it("keeps long prompts out of argv by using stdin transport", async () => {
    const prompt = "x".repeat(128 * 1024);
    const prepared = await preparePromptTransport(codexAdapter.promptTransport, prompt);
    const args = codexAdapter.buildArgs({ prompt, cwd: "/tmp/project", extraAllowedDirs: [], permissionPolicy: "agent-default" });
    expect(prepared.stdinData).toBe(prompt);
    expect(args.join("\u0000")).not.toContain(prompt);
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
