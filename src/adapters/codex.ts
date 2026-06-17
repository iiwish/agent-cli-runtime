import type { AgentAdapterDef, BuildArgsInput, RuntimeModelOption } from "./adapter-types.js";
import { CodexJsonParser } from "../parsers/codex-json.js";

const DEFAULT_MODEL: RuntimeModelOption = { id: "default", label: "Default" };

export function parseCodexDebugModels(stdout: string): RuntimeModelOption[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(stdout));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) return null;
  const seen = new Set<string>([DEFAULT_MODEL.id]);
  const out = [DEFAULT_MODEL];
  for (const model of (parsed as { models: unknown[] }).models) {
    if (!model || typeof model !== "object") continue;
    const entry = model as Record<string, unknown>;
    if (entry.visibility === "hidden") continue;
    const id = typeof entry.slug === "string" ? entry.slug : typeof entry.id === "string" ? entry.id : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = typeof entry.display_name === "string" ? entry.display_name : id;
    out.push({ id, label });
  }
  return out.length > 1 ? out : null;
}

function extractJsonPayload(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const jsonLine = trimmed.split(/\r?\n/u).find((line) => line.trim().startsWith("{"));
  return jsonLine?.trim() ?? trimmed;
}

export const codexAdapter: AgentAdapterDef = {
  id: "codex",
  displayName: "Codex CLI",
  bin: "codex",
  binEnvVar: "CODEX_BIN",
  versionArgs: ["--version"],
  listModels: {
    args: ["debug", "models"],
    timeoutMs: 5_000,
    parse: (stdout) => parseCodexDebugModels(stdout),
  },
  fallbackModels: [
    DEFAULT_MODEL,
    { id: "gpt-5-codex", label: "gpt-5-codex" },
    { id: "gpt-5", label: "gpt-5" },
    { id: "o3", label: "o3" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  buildArgs(input: BuildArgsInput): string[] {
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (input.permissionPolicy === "danger-full-access") {
      args.push("--sandbox", "danger-full-access");
    } else if (input.permissionPolicy === "workspace-write") {
      args.push("--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true");
    } else if (input.permissionPolicy === "read-only") {
      args.push("--sandbox", "read-only");
    }
    args.push("-C", input.cwd);
    for (const dir of input.extraAllowedDirs) args.push("--add-dir", dir);
    if (input.model && input.model !== "default") args.push("--model", input.model);
    if (input.reasoning && input.reasoning !== "default") {
      args.push("-c", `model_reasoning_effort="${input.reasoning}"`);
    }
    return args;
  },
  promptTransport: { kind: "stdin", inputFormat: "text" },
  stream: { create: () => new CodexJsonParser() },
  capabilities: { streaming: true, tools: true, models: true },
  defaults: { permissionPolicy: "agent-default" },
  compatibility: {
    executableNames: ["codex"],
    executableCandidates: [
      { name: "codex", source: "env", envVar: "CODEX_BIN" },
      { name: "codex", source: "primary" },
    ],
    versionProbe: { args: ["--version"], timeoutMs: 3_000 },
    modelProbe: { args: ["debug", "models"], timeoutMs: 5_000 },
    authProbe: null,
    defaultArgs: ["exec", "--json", "--skip-git-repo-check", "-C", "<cwd>"],
    knownFlags: [
      { flag: "--json", mapsTo: "streamFormat" },
      { flag: "-C", mapsTo: "cwd" },
      { flag: "--sandbox", mapsTo: "permissionPolicy" },
      { flag: "--add-dir", mapsTo: "extraAllowedDirs" },
      { flag: "--model", mapsTo: "model" },
      { flag: "-c model_reasoning_effort", mapsTo: "reasoning" },
      { flag: "--skip-git-repo-check", mapsTo: "defaultArgs" },
    ],
    needsVerification: [
      {
        mapsTo: "session",
        notes: "No stable Codex session/resume flag is used by this adapter yet; session input is intentionally not mapped.",
      },
      {
        mapsTo: "authProbe",
        notes: "Codex authentication remains CLI-managed because a stable non-mutating auth status probe has not been verified.",
      },
    ],
    promptTransport: "stdin:text",
    promptTransportMode: { kind: "stdin", inputFormat: "text" },
    streamFormat: "codex-json",
    streamMode: { format: "codex-json", framing: "jsonl", source: "stdout" },
    capabilityNotes: [
      "Default prompt transport is stdin; prompts are not placed in argv.",
      "Auth is treated as CLI-managed; no stable non-mutating auth probe is currently used by this adapter.",
    ],
  },
};
