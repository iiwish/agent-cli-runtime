import { describe, expect, it } from "vitest";
import { claudeAdapter, codexAdapter, opencodeAdapter } from "../src/index.js";

describe("MVP adapters", () => {
  it("builds Codex, Claude, and OpenCode args without placing prompt in argv", () => {
    const prompt = "do important work";
    expect(codexAdapter.buildArgs({ prompt, cwd: "/tmp/project", extraAllowedDirs: [], permissionPolicy: "workspace-write" })).toEqual(
      expect.arrayContaining(["exec", "--json", "-C", "/tmp/project"]),
    );
    expect(claudeAdapter.buildArgs({ prompt, cwd: "/tmp/project", extraAllowedDirs: ["/tmp/extra"], permissionPolicy: "headless-auto" })).toEqual(
      expect.arrayContaining(["-p", "--output-format", "stream-json", "--add-dir", "/tmp/extra"]),
    );
    expect(opencodeAdapter.buildArgs({ prompt, cwd: "/tmp/project", extraAllowedDirs: [], permissionPolicy: "headless-auto", model: "openai/gpt-5" })).toEqual(
      expect.arrayContaining(["run", "--format", "json", "--dir", "/tmp/project", "-m", "openai/gpt-5", "--dangerously-skip-permissions"]),
    );
  });

  it("parses Codex, Claude, and OpenCode stream fixtures", () => {
    const codexEvents = codexAdapter.stream.create().parse('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}\n');
    expect(codexEvents).toContainEqual({ type: "text_delta", text: "hello" });

    const claudeEvents = claudeAdapter.stream.create().parse('{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n');
    expect(claudeEvents).toContainEqual({ type: "text_delta", text: "hi" });

    const opencodeEvents = opencodeAdapter.stream.create().parse('{"type":"text","part":{"text":"yo"}}\n');
    expect(opencodeEvents).toContainEqual({ type: "text_delta", text: "yo" });
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
