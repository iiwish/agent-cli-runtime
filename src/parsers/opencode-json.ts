import type { AgentEventInput, RuntimeUsage } from "../core/events.js";
import type { StreamParser } from "../adapters/adapter-types.js";
import { isRecord, LineBuffer, safeJsonParse } from "./line-buffer.js";

export class OpenCodeJsonParser implements StreamParser {
  private readonly lines = new LineBuffer();

  parse(chunk: string): AgentEventInput[] {
    return this.lines.push(chunk).flatMap((line) => this.parseLine(line));
  }

  flush(): AgentEventInput[] {
    return this.lines.flush().flatMap((line) => this.parseLine(line));
  }

  private parseLine(line: string): AgentEventInput[] {
    const value = safeJsonParse(line);
    if (!isRecord(value)) return [];
    const part = isRecord(value.part) ? value.part : {};
    if (value.type === "step_start") return [{ type: "status", label: "running" }];
    if (value.type === "text" && typeof part.text === "string") return [{ type: "text_delta", text: part.text }];
    if (value.type === "tool_use" && typeof part.callID === "string") {
      const state = isRecord(part.state) ? part.state : {};
      const events: AgentEventInput[] = [];
      if (typeof part.tool === "string") {
        events.push({ type: "tool_call", id: part.callID, name: part.tool, input: parseMaybeJson(state.input) });
      }
      if (state.status === "completed") {
        events.push({ type: "tool_result", id: part.callID, output: state.output, isError: false });
      }
      return events;
    }
    if (value.type === "step_finish") {
      const usage = usageFrom(isRecord(part.tokens) ? part.tokens : null);
      return usage ? [{ type: "usage", usage, costUsd: typeof part.cost === "number" ? part.cost : undefined }] : [];
    }
    if (value.type === "error") {
      return [{ type: "error", code: "AGENT_EXECUTION_FAILED", message: errorMessage(value, "OpenCode error") }];
    }
    return [];
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return safeJsonParse(value) ?? value;
}

function usageFrom(tokens: Record<string, unknown> | null): RuntimeUsage | null {
  if (!tokens) return null;
  const usage: RuntimeUsage = {};
  if (typeof tokens.input === "number") usage.inputTokens = tokens.input;
  if (typeof tokens.output === "number") usage.outputTokens = tokens.output;
  if (typeof tokens.reasoning === "number") usage.thinkingTokens = tokens.reasoning;
  return Object.keys(usage).length > 0 ? usage : null;
}

function errorMessage(value: Record<string, unknown>, fallback: string): string {
  if (typeof value.message === "string" && value.message) return value.message;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  if (typeof value.error === "string" && value.error) return value.error;
  return fallback;
}
