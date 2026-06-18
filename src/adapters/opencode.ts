import type { AgentAdapterDef, BuildArgsInput, RuntimeModelOption } from "./adapter-types.js";
import { OpenCodeJsonParser } from "../parsers/opencode-json.js";

const DEFAULT_MODEL: RuntimeModelOption = { id: "default", label: "Default" };

export function parseLineSeparatedModels(stdout: string): RuntimeModelOption[] | null {
  const seen = new Set<string>([DEFAULT_MODEL.id]);
  const models = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(isModelLine)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((id) => ({ id, label: id }));
  return models.length > 0 ? [DEFAULT_MODEL, ...models] : null;
}

function isModelLine(line: string): boolean {
  if (!line) return false;
  if (/^(warn|warning|info|debug|trace|error)\b/i.test(line)) return false;
  if (/\s/u.test(line)) return false;
  if (line.startsWith("{") || line.startsWith("[") || line.startsWith("-")) return false;
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/iu.test(line) || /^[a-z][a-z0-9._:-]{2,}$/iu.test(line);
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
  compatibility: {
    executableNames: ["opencode-cli", "opencode"],
    executableCandidates: [
      { name: "opencode", source: "env", envVar: "OPENCODE_BIN" },
      { name: "opencode-cli", source: "primary" },
      { name: "opencode", source: "fallback" },
    ],
    versionProbe: { args: ["--version"], timeoutMs: 3_000 },
    versionOutputPattern: "opencode|^\\d+\\.\\d+\\.\\d+",
    modelProbe: { args: ["models"], timeoutMs: 15_000 },
    authProbe: null,
    defaultArgs: ["run", "--format", "json", "--dir", "<cwd>"],
    knownFlags: [
      { flag: "run", mapsTo: "runMode" },
      { flag: "--format json", mapsTo: "streamFormat" },
      { flag: "--dir", mapsTo: "cwd" },
      { flag: "-m", mapsTo: "model" },
      { flag: "--dangerously-skip-permissions", mapsTo: "headless-auto" },
    ],
    needsVerification: [
      {
        mapsTo: "extraAllowedDirs",
        notes: "No stable extra-readable-directory flag is mapped for OpenCode in this profile.",
      },
      {
        mapsTo: "session",
        notes: "No stable OpenCode session/resume flag is mapped by this adapter.",
      },
      {
        mapsTo: "permissionPolicy.read-only",
        notes: "Read-only/workspace-write flags are left to OpenCode defaults until verified; only explicit headless bypass is mapped.",
      },
    ],
    promptTransport: "stdin:text",
    promptTransportMode: { kind: "stdin", inputFormat: "text" },
    streamFormat: "opencode-json",
    streamMode: { format: "opencode-json", framing: "jsonl", source: "stdout" },
    capabilityNotes: [
      "Default prompt transport is stdin; prompts are not placed in argv.",
      "Read-only/workspace-write permission mappings are left to OpenCode defaults until stable flags are verified.",
    ],
  },
};
