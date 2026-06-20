export type RuntimeErrorCode =
  | "AGENT_UNAVAILABLE"
  | "AGENT_NOT_EXECUTABLE"
  | "AGENT_AUTH_REQUIRED"
  | "AGENT_PROMPT_TOO_LARGE"
  | "AGENT_MODEL_UNAVAILABLE"
  | "PERMISSION_POLICY_UNSUPPORTED"
  | "AGENT_EXECUTION_FAILED"
  | "AGENT_STREAM_PARSE_FAILED"
  | "AGENT_TIMEOUT"
  | "AGENT_CANCELLED"
  | "AGENT_TASK_GRAPH_INVALID"
  | "AGENT_RUNTIME_INTERRUPTED"
  | "AGENT_EVENT_LOG_CORRUPT"
  | "AGENT_EVENT_PERSIST_FAILED"
  | "AGENT_STORAGE_SYNC_FALLBACK"
  | "AGENT_STORAGE_LEASE_TAKEOVER"
  | "AGENT_STORE_REPAIR_APPLIED"
  | "AGENT_STORE_REPAIR_FAILED"
  | "AGENT_STORE_REPAIR_REFUSED_LIVE_OWNER"
  | "AGENT_STORE_RECORD_CORRUPT";

export interface RuntimeDiagnostic {
  code: RuntimeErrorCode | string;
  message: string;
  agentId?: string;
  path?: string;
  argv?: string[];
  promptTransport?: string;
  streamFormat?: string;
  parsedEventCount?: number;
  stdoutTail?: string;
  searchedLocations?: string[];
  probe?: string;
  exitCode?: number | null;
  signal?: string | null;
  stderrTail?: string;
  actionableHints?: string[];
  retryable?: boolean;
}

export function diagnostic(
  code: RuntimeDiagnostic["code"],
  message: string,
  init: Omit<RuntimeDiagnostic, "code" | "message"> = {},
): RuntimeDiagnostic {
  return { code, message, ...init };
}
