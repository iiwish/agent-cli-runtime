import {
  closeSync,
  existsSync,
  fdatasyncSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import type { ReplayEvent } from "../core/events.js";
import { redactText } from "../core/redaction.js";
import type { JsonlReadIssue, JsonlReadResult, StorageDurability, StorageFaultHooks, StorageSyncHooks } from "./storage-types.js";

export function appendJsonl<T>(
  file: string,
  record: ReplayEvent<T>,
  options: { durability?: StorageDurability; sync?: StorageSyncHooks; faults?: StorageFaultHooks; onSyncDiagnostic?: (message: string) => void } = {},
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  options.faults?.beforeJsonlAppend?.(file);
  const fd = openSync(file, "a");
  try {
    if (needsJsonlBoundary(file)) {
      writeSync(fd, "\n", undefined, "utf8");
    }
    writeSync(fd, `${JSON.stringify(record)}\n`, undefined, "utf8");
    syncFileDescriptor(fd, options);
  } finally {
    closeSync(fd);
  }
}

function needsJsonlBoundary(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const { size } = statSync(file);
    if (size === 0) return false;
    const handle = openSync(file, "r");
    try {
      const buffer = Buffer.alloc(1);
      readSync(handle, buffer, 0, 1, size - 1);
      return buffer[0] !== 10;
    } finally {
      closeSync(handle);
    }
  } catch {
    return false;
  }
}

export function readJsonl<T>(file: string): JsonlReadResult<T> {
  if (!existsSync(file)) return { records: [], issues: [] };
  const text = readFileSync(file, "utf8");
  const records: Array<ReplayEvent<T>> = [];
  const lines = text.split(/\r?\n/);
  const lastNonEmptyLine = lastNonEmptyLineIndex(lines);
  const issues: JsonlReadIssue[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ReplayEvent<T>;
      if (!isReplayEvent(parsed)) {
        issues.push(jsonlIssue(file, index + 1, "line is not a replay event", records, false, line));
        continue;
      }
      records.push(parsed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const partialTail = isPartialTail(text, index, lastNonEmptyLine, reason);
      issues.push(jsonlIssue(file, index + 1, reason, records, partialTail, line));
      if (partialTail) break;
    }
  }
  if (issues.length === 0) return { records, issues };
  return {
    records,
    error: new Error(issueSummary(issues)),
    issue: issues[0],
    issues,
  };
}

function jsonlIssue<T>(
  file: string,
  line: number,
  reason: string,
  records: Array<ReplayEvent<T>>,
  partialTail: boolean,
  rawLine: string,
): JsonlReadIssue {
  const lastGood = records.at(-1);
  return {
    file: path.basename(file),
    line,
    reason,
    retainedEventCount: records.length,
    partialTail,
    corruptLineCount: 1,
    partialTailDetected: partialTail,
    lastGoodEventId: lastGood?.id,
    lastGoodSequence: lastGood?.sequence,
    repairRecommendation: partialTail ? "truncate_partial_tail" : "isolate_corrupt_line",
    redactedTailPreview: redactText(rawLine.slice(0, 256)),
  };
}

function issueSummary(issues: JsonlReadIssue[]): string {
  const [first] = issues;
  const partialTailCount = issues.filter((issue) => issue.partialTail).length;
  return `${first?.file ?? "events.jsonl"} has ${issues.length} corrupt JSONL line(s)`
    + `${partialTailCount > 0 ? ` including ${partialTailCount} partial tail(s)` : ""}`
    + `; retained ${first?.retainedEventCount ?? 0} event(s) before first issue`;
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

function syncFileDescriptor(
  fd: number,
  options: { durability?: StorageDurability; sync?: StorageSyncHooks; onSyncDiagnostic?: (message: string) => void },
): void {
  if (options.durability !== "fsync") return;
  try {
    const fdatasync = options.sync?.fdatasyncSync ?? fdatasyncSync;
    fdatasync(fd);
  } catch (fdatasyncError) {
    try {
      const fsync = options.sync?.fsyncSync ?? fsyncSync;
      fsync(fd);
    } catch (fsyncError) {
      options.onSyncDiagnostic?.(
        `fdatasync failed (${errorMessage(fdatasyncError)}); fsync fallback failed (${errorMessage(fsyncError)}); continuing with relaxed durability`,
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
