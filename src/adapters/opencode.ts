import type { AgentAdapterDef, BuildArgsInput, RuntimeModelOption } from "./adapter-types.js";
import { OpenCodeJsonParser } from "../parsers/opencode-json.js";

const DEFAULT_MODEL: RuntimeModelOption = { id: "default", label: "Default" };

export function parseLineSeparatedModels(stdout: string): RuntimeModelOption[] | null {
  const models = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
  return models.length > 0 ? [DEFAULT_MODEL, ...models] : null;
}

export function cleanOpenCodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (key.startsWith("OPENCODE_SESSION") || key === "OPENCODE_RUNTIME") delete out[key];
  }
  return out;
}

export const opencodeAdapter: AgentAdapterDef = {
  id: "opencode",
  displayName: "OpenCode",
  bin: "opencode-cli",
  fallbackBins: ["opencode"],
  binEnvVar: "OPENCODE_BIN",
  versionArgs: ["--version"],
  listModels: {
    args: ["models"],
    timeoutMs: 15_000,
    parse: (stdout) => parseLineSeparatedModels(stdout),
  },
  fallbackModels: [
    DEFAULT_MODEL,
    { id: "anthropic/claude-sonnet-4-5", label: "anthropic/claude-sonnet-4-5" },
    { id: "openai/gpt-5", label: "openai/gpt-5" },
  ],
  buildArgs(input: BuildArgsInput): string[] {
    const args = ["run", "--format", "json", "--dir", input.cwd];
    if (input.model && input.model !== "default") args.push("-m", input.model);
    if (input.permissionPolicy === "headless-auto" || input.permissionPolicy === "danger-full-access") {
      args.push("--dangerously-skip-permissions");
    }
    return args;
  },
  promptTransport: { kind: "stdin", inputFormat: "text" },
  stream: { create: () => new OpenCodeJsonParser() },
  env: {},
  capabilities: { streaming: true, tools: true, models: true },
  defaults: { permissionPolicy: "agent-default" },
};
