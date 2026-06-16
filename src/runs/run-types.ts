import type { AgentEvent } from "../core/events.js";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import type { AgentAdapterDef, AgentId, PermissionPolicy } from "../adapters/adapter-types.js";
import type { RunStatus } from "./run-result.js";

export interface RuntimeContextBlock {
  title: string;
  body: string;
  priority?: "required" | "optional";
}

export interface RuntimeSessionRef {
  id?: string;
  resumeId?: string;
}

export interface RuntimeOptions {
  adapters?: AgentAdapterDef[];
  env?: NodeJS.ProcessEnv;
  searchPath?: string[];
  storageDir?: string;
  maxConcurrentTasks?: number;
}

export interface RunRequest {
  agentId: AgentId;
  cwd: string;
  prompt: string;
  systemPrompt?: string;
  contextBlocks?: RuntimeContextBlock[];
  model?: string;
  reasoning?: string;
  env?: Record<string, string>;
  extraAllowedDirs?: string[];
  permissionPolicy?: PermissionPolicy;
  timeoutMs?: number;
  inactivityTimeoutMs?: number;
  signal?: AbortSignal;
  session?: RuntimeSessionRef;
}

export interface RunHandle {
  runId: string;
  events: AsyncIterable<AgentEvent>;
  cancel(reason?: string): Promise<void>;
}

export interface RunRecord {
  id: string;
  agentId: AgentId;
  cwd: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
  errorCode?: string | null;
  diagnostics: RuntimeDiagnostic[];
}
