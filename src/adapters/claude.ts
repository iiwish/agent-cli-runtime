import type { AgentAdapterDef, BuildArgsInput, RuntimeModelOption } from "./adapter-types.js";
import { ClaudeStreamJsonParser } from "../parsers/claude-stream-json.js";

const DEFAULT_MODEL: RuntimeModelOption = { id: "default", label: "Default" };

export const claudeAdapter: AgentAdapterDef = {
  id: "claude",
  displayName: "Claude Code",
  bin: "claude",
  binEnvVar: "CLAUDE_BIN",
  versionArgs: ["--version"],
  helpArgs: ["-p", "--help"],
  capabilityFlags: {
    "--include-partial-messages": "partialMessages",
    "--add-dir": "addDir",
  },
  fallbackModels: [
    DEFAULT_MODEL,
    { id: "sonnet", label: "Sonnet (alias)" },
    { id: "opus", label: "Opus (alias)" },
    { id: "haiku", label: "Haiku (alias)" },
  ],
  authProbe: {
    args: ["auth", "status"],
    timeoutMs: 3_000,
    parse(stdout) {
      try {
        const parsed = JSON.parse(stdout) as { loggedIn?: unknown };
        return parsed.loggedIn === true ? "ok" : "missing";
      } catch {
        return stdout.includes("loggedIn") && stdout.includes("false") ? "missing" : "unknown";
      }
    },
  },
  buildArgs(input: BuildArgsInput): string[] {
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
    if (input.model && input.model !== "default") args.push("--model", input.model);
    if (input.extraAllowedDirs.length > 0) args.push("--add-dir", ...input.extraAllowedDirs);
    if (input.session?.resumeId) args.push("--resume", input.session.resumeId);
    else if (input.session?.id) args.push("--session-id", input.session.id);
    if (input.permissionPolicy === "headless-auto" || input.permissionPolicy === "danger-full-access") {
      args.push("--permission-mode", "bypassPermissions");
    } else if (input.permissionPolicy === "read-only") {
      args.push("--permission-mode", "plan");
    }
    return args;
  },
  promptTransport: { kind: "stdin", inputFormat: "jsonl" },
  stream: { create: () => new ClaudeStreamJsonParser() },
  capabilities: { streaming: true, tools: true, models: false },
  defaults: { permissionPolicy: "agent-default" },
};
