import type { AgentEventInput, RuntimeUsage } from "../core/events.js";
import type { StreamParser } from "../adapters/adapter-types.js";
import { isRecord, LineBuffer, safeJsonParse } from "./line-buffer.js";

export class CodexJsonParser implements StreamParser {
  private readonly lines = new LineBuffer();

  parse(chunk: string): AgentEventInput[] {
    return this.lines.push(chunk).flatMap((line) => this.parseLine(line));
  }

  flush(): AgentEventInput[] {
    return this.lines.flush().flatMap((line) => this.parseLine(line));
  }

  private parseLine(line: string): AgentEventInput[] {
    const value = safeJsonParse(line);
    if (!isRecord(value)) return [{ type: "text_delta", text: `${line}\n` }];
    const type = stringAt(value, "type");
    if (type === "thread.started") return [{ type: "status", label: "initializing" }];
    if (type === "turn.started") return [{ type: "status", label: "running" }];
    if (type === "turn.completed") {
      const usage = usageFrom(value.usage);
      return usage ? [{ type: "usage", usage }] : [{ type: "status", label: "completed" }];
    }
    if (type === "error") {
      return [{ type: "error", code: "AGENT_EXECUTION_FAILED", message: errorMessage(value, "Codex error") }];
    }
    if (type === "item.completed" && isRecord(value.item)) {
      return itemCompleted(value.item);
    }
    if (type === "exec_command.begin" || type === "exec_command.started") {
      const id = stringAt(value, "call_id") ?? stringAt(value, "id") ?? "command";
      const command = stringAt(value, "command") ?? "shell";
      return [{ type: "tool_call", id, name: "shell", input: { command } }];
    }
    if (type === "exec_command.end" || type === "exec_command.completed") {
      const id = stringAt(value, "call_id") ?? stringAt(value, "id") ?? "command";
      return [{ type: "tool_result", id, output: value.output ?? value.stdout ?? "", isError: value.exit_code !== 0 }];
    }
    return [];
  }
}

function itemCompleted(item: Record<string, unknown>): AgentEventInput[] {
  const itemType = stringAt(item, "type");
  if (itemType === "agent_message" || itemType === "message") {
    const text = extractText(item);
    return text ? [{ type: "text_delta", text }] : [];
  }
  if (itemType === "tool_call") {
    const id = stringAt(item, "id") ?? "tool";
    const name = stringAt(item, "name") ?? "tool";
    return [{ type: "tool_call", id, name, input: item.input }];
  }
  if (itemType === "tool_result") {
    const id = stringAt(item, "id") ?? stringAt(item, "tool_call_id") ?? "tool";
    return [{ type: "tool_result", id, output: item.output, isError: Boolean(item.is_error) }];
  }
  return [];
}

function extractText(value: Record<string, unknown>): string {
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) {
    return value.content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  if (isRecord(value.message)) return extractText(value.message);
  return "";
}

function usageFrom(value: unknown): RuntimeUsage | null {
  if (!isRecord(value)) return null;
  const usage: RuntimeUsage = {};
  if (typeof value.input_tokens === "number") usage.inputTokens = value.input_tokens;
  if (typeof value.output_tokens === "number") usage.outputTokens = value.output_tokens;
  if (typeof value.reasoning_tokens === "number") usage.thinkingTokens = value.reasoning_tokens;
  return Object.keys(usage).length > 0 ? usage : null;
}

function stringAt(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw ? raw : undefined;
}

function errorMessage(value: Record<string, unknown>, fallback: string): string {
  if (typeof value.message === "string" && value.message) return value.message;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return fallback;
}
