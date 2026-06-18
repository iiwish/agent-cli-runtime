import type { RuntimeErrorCode } from "./diagnostics.js";
import type { AgentEvent, EventTerminalReason, ReplayEvent, SchedulerEvent } from "./events.js";
import type { RunResult } from "../runs/run-result.js";

export const EVENT_SCHEMA_VERSION = "agent-runtime.event.v1";

export type EventScope = { kind: "run"; id: string } | { kind: "goal"; id: string };

export type { EventTerminalReason } from "./events.js";

export interface EventTerminalContract {
  result: RunResult;
  reason: EventTerminalReason;
}

export interface VersionedEventEnvelope<TEvent = AgentEvent | SchedulerEvent> {
  schemaVersion: typeof EVENT_SCHEMA_VERSION;
  id: number;
  sequence: number;
  timestamp: number;
  scope: EventScope;
  event: TEvent;
  terminal?: EventTerminalContract;
}

export function envelopeReplayEvent<TEvent>(
  record: ReplayEvent<TEvent>,
  diagnosticCode?: string,
): VersionedEventEnvelope<TEvent> {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: record.id,
    sequence: record.sequence,
    timestamp: record.timestamp,
    scope: replayScope(record),
    event: record.event,
    terminal: terminalContractFromEvent(record.event, diagnosticCode),
  };
}

export function envelopeReplayEvents<TEvent>(records: Array<ReplayEvent<TEvent>>): Array<VersionedEventEnvelope<TEvent>> {
  let diagnosticCode: string | undefined;
  return records.map((record) => {
    diagnosticCode = diagnosticCodeFromEvent(record.event) ?? diagnosticCode;
    return envelopeReplayEvent(record, diagnosticCode);
  });
}

export function envelopeStreamEvent<TEvent>(
  event: TEvent,
  scope: EventScope,
  sequence: number,
  diagnosticCode?: string,
): VersionedEventEnvelope<TEvent> {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: sequence,
    sequence,
    timestamp: eventTimestamp(event),
    scope,
    event,
    terminal: terminalContractFromEvent(event, diagnosticCode),
  };
}

export function diagnosticCodeFromEvent(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if ((event.type === "error" || event.type === "scheduler_error") && typeof event.code === "string") return event.code;
  if (typeof event.errorCode === "string") return event.errorCode;
  if (event.type === "run_event") return diagnosticCodeFromEvent(event.event);
  return undefined;
}

export function terminalContractFromEvent(event: unknown, diagnosticCode?: string): EventTerminalContract | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type === "run_event") return terminalContractFromEvent(event.event, diagnosticCode);
  if (event.type === "scheduler_error" && typeof event.code === "string") {
    return { result: "failed", reason: terminalReasonFromDiagnosticCode(event.code) };
  }
  if (!isTerminalEvent(event)) return undefined;
  return {
    result: event.result,
    reason: isEventTerminalReason(event.reason)
      ? event.reason
      : terminalReasonFromResult(event.result, diagnosticCode, typeof event.signal === "string" ? event.signal : undefined),
  };
}

export function terminalReasonFromDiagnosticCode(code: RuntimeErrorCode | string | undefined): EventTerminalReason {
  if (code === "AGENT_TIMEOUT") return "timeout";
  if (code === "AGENT_CANCELLED") return "canceled";
  if (code === "AGENT_RUNTIME_INTERRUPTED") return "interrupted";
  if (code === "AGENT_TASK_GRAPH_INVALID") return "task_graph_invalid";
  if (code === "AGENT_AUTH_REQUIRED" || code === "auth_missing") return "auth_missing";
  if (code === "AGENT_UNAVAILABLE" || code === "AGENT_NOT_EXECUTABLE" || code === "AGENT_MODEL_UNAVAILABLE") return "unavailable";
  if (code === "AGENT_PROMPT_TOO_LARGE" || code === "PERMISSION_POLICY_UNSUPPORTED" || code === "AGENT_VALIDATION_FAILED") return "validation_failed";
  if (code === "AGENT_EXECUTION_FAILED" || code === "AGENT_STREAM_PARSE_FAILED" || code === "AGENT_EVENT_PERSIST_FAILED") return "execution_failed";
  return "failed";
}

export function terminalReasonFromResult(
  result: RunResult | undefined,
  diagnosticCode?: string,
  signal?: string,
): EventTerminalReason {
  if (result === "success") return "success";
  if (result === "cancelled") return "canceled";
  if (signal === "RUNTIME_RESTART") return "interrupted";
  return terminalReasonFromDiagnosticCode(diagnosticCode);
}

function replayScope(record: ReplayEvent<unknown>): EventScope {
  if (record.runId) return { kind: "run", id: record.runId };
  if (record.goalId) return { kind: "goal", id: record.goalId };
  const event = isRecord(record.event) ? record.event : undefined;
  if (typeof event?.runId === "string") return { kind: "run", id: event.runId };
  if (typeof event?.goalId === "string") return { kind: "goal", id: event.goalId };
  throw new Error("Replay event is missing runId or goalId scope");
}

function eventTimestamp(event: unknown): number {
  if (isRecord(event) && typeof event.timestamp === "number") return event.timestamp;
  return Date.now();
}

function isTerminalEvent(event: Record<string, unknown>): event is { type: string; result: RunResult; signal?: string | null; reason?: unknown } {
  return (
    event.type === "run_finished"
    || event.type === "goal_finished"
    || event.type === "task_finished"
    || event.type === "task_attempt_finished"
  ) && isRunResult(event.result);
}

function isRunResult(value: unknown): value is RunResult {
  return value === "success" || value === "failed" || value === "cancelled";
}

function isEventTerminalReason(value: unknown): value is EventTerminalReason {
  return value === "success"
    || value === "failed"
    || value === "timeout"
    || value === "canceled"
    || value === "interrupted"
    || value === "validation_failed"
    || value === "execution_failed"
    || value === "unavailable"
    || value === "auth_missing"
    || value === "task_graph_invalid";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
