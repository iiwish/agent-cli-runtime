import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReplayEvent } from "../core/events.js";

export function appendJsonl<T>(file: string, record: ReplayEvent<T>): void {
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function readJsonl<T>(file: string): { records: Array<ReplayEvent<T>>; error?: Error } {
  if (!existsSync(file)) return { records: [] };
  const text = readFileSync(file, "utf8");
  const records: Array<ReplayEvent<T>> = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ReplayEvent<T>;
      if (!isReplayEvent(parsed)) {
        return { records, error: new Error(`${path.basename(file)}:${index + 1} is not a replay event`) };
      }
      records.push(parsed);
    } catch (error) {
      return {
        records,
        error: new Error(`${path.basename(file)}:${index + 1} ${error instanceof Error ? error.message : String(error)}`),
      };
    }
  }
  return { records };
}

function isReplayEvent(value: unknown): value is ReplayEvent<unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.timestamp === "number" && Boolean(record.event);
}
