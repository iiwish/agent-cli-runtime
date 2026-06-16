export type RunResult = "success" | "failed" | "cancelled";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export function runResultFromStatus(status: RunStatus | string | undefined): RunResult {
  if (status === "succeeded") return "success";
  if (status === "canceled") return "cancelled";
  return "failed";
}

export function deriveRunErrorCode(status: {
  status: RunStatus | string;
  errorCode?: string | null;
  exitCode?: number | null;
  signal?: string | null;
}): string | undefined {
  const result = runResultFromStatus(status.status);
  if (result === "success") return undefined;
  if (result === "cancelled") return status.errorCode ?? undefined;
  if (status.errorCode) return status.errorCode;
  if (status.signal) return `AGENT_SIGNAL_${status.signal}`;
  if (typeof status.exitCode === "number" && status.exitCode !== 0) return `AGENT_EXIT_${status.exitCode}`;
  return "AGENT_TERMINATED_UNKNOWN";
}
