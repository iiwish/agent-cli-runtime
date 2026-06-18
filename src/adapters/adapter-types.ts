import type { AgentEventInput, RuntimeUsage } from "../core/events.js";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import type { RuntimeContextBlock, RuntimeSessionRef } from "../runs/run-types.js";

export type AgentId = "codex" | "claude" | "opencode" | string;

export type PermissionPolicy =
  | "agent-default"
  | "workspace-write"
  | "read-only"
  | "headless-auto"
  | "danger-full-access";

export interface RuntimeModelOption {
  id: string;
  label: string;
}

export interface AgentCapabilities {
  streaming: boolean;
  tools: boolean;
  models: boolean;
  authProbe: boolean;
  prompt: Array<PromptTransport["kind"]>;
}

export interface AgentCapabilityHints {
  streaming?: boolean;
  tools?: boolean;
  models?: boolean;
  authProbe?: boolean;
}

export interface BuildArgsInput {
  prompt: string;
  cwd: string;
  model?: string;
  reasoning?: string;
  extraAllowedDirs: string[];
  permissionPolicy: PermissionPolicy;
  promptFilePath?: string;
  session?: RuntimeSessionRef;
  contextBlocks?: RuntimeContextBlock[];
}

export type PromptTransport =
  | { kind: "stdin"; inputFormat?: "text" | "jsonl" }
  | { kind: "file"; flag: string }
  | { kind: "argv"; maxBytes: number };

export interface StreamParser {
  parse(chunk: string): AgentEventInput[];
  flush(): AgentEventInput[];
}

export interface StreamParserDef {
  create(): StreamParser;
}

export interface ProbeCommand {
  args: string[];
  timeoutMs?: number;
  parse?: (stdout: string, stderr: string) => unknown;
}

export interface AgentListModelsProbe extends ProbeCommand {
  parse: (stdout: string, stderr: string) => RuntimeModelOption[] | null;
}

export interface AgentAuthProbe extends ProbeCommand {
  parse?: (stdout: string, stderr: string) => "ok" | "missing" | "expired" | "unknown";
}

export interface AgentRunDefaults {
  timeoutMs?: number;
  inactivityTimeoutMs?: number;
  permissionPolicy?: PermissionPolicy;
}

export interface AdapterCompatibilityProfile {
  executableNames: string[];
  executableCandidates?: Array<{ name: string; source: "primary" | "fallback" | "env"; envVar?: string }>;
  versionProbe: ProbeCommand;
  versionOutputPattern?: string;
  modelProbe?: (ProbeCommand & { needsVerification?: boolean; notes?: string }) | null;
  authProbe?: (ProbeCommand & { needsVerification?: boolean; notes?: string }) | null;
  defaultArgs: string[];
  knownFlags: Array<{ flag: string; mapsTo: string; needsVerification?: boolean; notes?: string }>;
  needsVerification?: Array<{ mapsTo: string; flags?: string[]; notes: string }>;
  promptTransport: string;
  promptTransportMode?: PromptTransport;
  streamFormat: string;
  streamMode?: { format: string; framing: "jsonl" | "json" | "text"; source: "stdout" | "stderr" | "mixed" };
  capabilityNotes: string[];
}

export interface AgentAdapterDef {
  id: AgentId;
  displayName: string;
  bin: string;
  fallbackBins?: string[];
  binEnvVar?: string;
  versionArgs: string[];
  helpArgs?: string[];
  capabilityFlags?: Record<string, string>;
  authProbe?: AgentAuthProbe;
  listModels?: AgentListModelsProbe;
  fallbackModels?: RuntimeModelOption[];
  buildArgs(input: BuildArgsInput): string[];
  promptTransport: PromptTransport;
  stream: StreamParserDef;
  env?: Record<string, string>;
  capabilities?: AgentCapabilityHints;
  defaults?: AgentRunDefaults;
  compatibility?: AdapterCompatibilityProfile;
}

export interface DetectedAgent {
  id: AgentId;
  displayName: string;
  available: boolean;
  path?: string;
  version?: string | null;
  authStatus?: "ok" | "missing" | "expired" | "unknown";
  models: RuntimeModelOption[];
  modelsSource: "live" | "fallback" | "none";
  capabilities: AgentCapabilities;
  diagnostics: RuntimeDiagnostic[];
}

export type ParserUsageInput = RuntimeUsage;
