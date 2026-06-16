import type { AgentEventInput, RuntimeUsage } from "../core/events.js";
import type { StreamParser } from "../adapters/adapter-types.js";
import { isRecord, LineBuffer, safeJsonParse } from "./line-buffer.js";

export class ClaudeStreamJsonParser implements StreamParser {
  private readonly lines = new LineBuffer();
  private lastStatusKey: string | null = null;

  parse(chunk: string): AgentEventInput[] {
    return this.lines.push(chunk).flatMap((line) => this.parseLine(line));
  }

  flush(): AgentEventInput[] {
    return this.lines.flush().flatMap((line) => this.parseLine(line));
  }

  private parseLine(line: string): AgentEventInput[] {
    const value = safeJsonParse(line);
    if (!isRecord(value)) return [{ type: "text_delta", text: `${line}\n` }];
    if (value.type === "system") return this.status("initializing");
    if (value.type === "result") {
      const usage = usageFrom(value.usage);
      return usage ? [{ type: "usage", usage }] : [];
    }
    if (value.type === "error") {
      return [{ type: "error", code: "AGENT_EXECUTION_FAILED", message: errorMessage(value, "Claude error") }];
    }
    if (value.type === "assistant" && isRecord(value.message)) {
      return contentEvents(value.message.content);
    }
    if (value.type === "stream_event" && isRecord(value.event)) {
      return this.streamEvent(value.event);
    }
    return [];
  }

  private streamEvent(event: Record<string, unknown>): AgentEventInput[] {
    if (event.type === "message_start") return this.status("running");
    if (event.type === "content_block_delta" && isRecord(event.delta)) {
      if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
        return [{ type: "text_delta", text: event.delta.text }];
      }
      if (event.delta.type === "thinking_delta" && typeof event.delta.thinking === "string") {
        return [{ type: "thinking_delta", text: event.delta.thinking }];
      }
    }
    return [];
  }

  private status(label: string, detail?: string): AgentEventInput[] {
    const key = `${label}\u0000${detail ?? ""}`;
    if (this.lastStatusKey === key) return [];
    this.lastStatusKey = key;
    return detail ? [{ type: "status", label, detail }] : [{ type: "status", label }];
  }
}

function contentEvents(content: unknown): AgentEventInput[] {
  if (!Array.isArray(content)) return [];
  const events: AgentEventInput[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      events.push({ type: "text_delta", text: part.text });
    } else if (part.type === "thinking" && typeof part.thinking === "string") {
      events.push({ type: "thinking_delta", text: part.thinking });
    } else if (part.type === "tool_use" && typeof part.id === "string" && typeof part.name === "string") {
      events.push({ type: "tool_call", id: part.id, name: part.name, input: part.input });
    } else if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
      events.push({ type: "tool_result", id: part.tool_use_id, output: part.content, isError: Boolean(part.is_error) });
    }
  }
  return events;
}

function usageFrom(value: unknown): RuntimeUsage | null {
  if (!isRecord(value)) return null;
  const usage: RuntimeUsage = {};
  if (typeof value.input_tokens === "number") usage.inputTokens = value.input_tokens;
  if (typeof value.output_tokens === "number") usage.outputTokens = value.output_tokens;
  if (typeof value.cache_read_input_tokens === "number") usage.cachedReadTokens = value.cache_read_input_tokens;
  if (typeof value.cache_creation_input_tokens === "number") usage.cachedWriteTokens = value.cache_creation_input_tokens;
  return Object.keys(usage).length > 0 ? usage : null;
}

function errorMessage(value: Record<string, unknown>, fallback: string): string {
  if (typeof value.message === "string" && value.message) return value.message;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return fallback;
}
