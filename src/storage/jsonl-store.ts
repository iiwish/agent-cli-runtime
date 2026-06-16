import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReplayEvent } from "../core/events.js";
import type { JsonlReadIssue } from "./storage-types.js";

export function appendJsonl<T>(file: string, record: ReplayEvent<T>): void {
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readJsonl<T>(file: string): { records: Array<ReplayEvent<T>>; error?: Error; issue?: JsonlReadIssue } {
  if (!existsSync(file)) return { records: [] };
  const text = readFileSync(file, "utf8");
  const records: Array<ReplayEvent<T>> = [];
  const lines = text.split(/\r?\n/);
  const lastNonEmptyLine = lastNonEmptyLineIndex(lines);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ReplayEvent<T>;
      if (!isReplayEvent(parsed)) {
        return issueResult(file, index + 1, "line is not a replay event", records, false);
      }
      records.push(parsed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return issueResult(file, index + 1, reason, records, isPartialTail(text, index, lastNonEmptyLine, reason));
    }
  }
  return { records };
}

function issueResult<T>(
  file: string,
  line: number,
  reason: string,
  records: Array<ReplayEvent<T>>,
  partialTail: boolean,
): { records: Array<ReplayEvent<T>>; error: Error; issue: JsonlReadIssue } {
  const issue = {
    file: path.basename(file),
    line,
    reason,
    retainedEventCount: records.length,
    partialTail,
  };
  return {
    records,
    error: new Error(`${issue.file}:${line} ${reason}; retained ${records.length} event(s)`),
    issue,
  };
}

function isReplayEvent(value: unknown): value is ReplayEvent<unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.timestamp === "number" && Boolean(record.event);
}

function lastNonEmptyLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim()) return index;
  }
  return -1;
}

function isPartialTail(text: string, index: number, lastNonEmptyLine: number, reason: string): boolean {
  return index === lastNonEmptyLine
    && !/\r?\n$/u.test(text)
    && /(end of JSON input|unterminated|string|property name|after|expected|unexpected)/iu.test(reason);
}
