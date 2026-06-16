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
  | "AGENT_EVENT_PERSIST_FAILED";

export interface RuntimeDiagnostic {
  code: RuntimeErrorCode | string;
  message: string;
  agentId?: string;
  path?: string;
  searchedLocations?: string[];
  probe?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  stdoutTail?: string;
  stderrTail?: string;
  retryable?: boolean;
}

export function diagnostic(
  code: RuntimeDiagnostic["code"],
  message: string,
  init: Omit<RuntimeDiagnostic, "code" | "message"> = {},
): RuntimeDiagnostic {
  return { code, message, ...init };
}
