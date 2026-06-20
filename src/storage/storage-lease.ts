import { appendFileSync, closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { createId } from "../core/ids.js";
import { redactUnknown } from "../core/redaction.js";

export const STORAGE_LOCK_FILE = "runtime.lock.json";
export const DEFAULT_LEASE_STALE_MS = 30_000;

export interface RuntimeOwner {
  runtimeInstanceId: string;
  pid: number;
  startedAt: number;
  heartbeatAt: number;
  closedAt?: number;
}

export type OwnerStatus = "missing" | "live" | "stale" | "closed" | "invalid";

export interface OwnerInspection {
  status: OwnerStatus;
  owner?: RuntimeOwner;
  ageMs?: number;
  reason?: string;
}

export interface StorageLockInspection extends OwnerInspection {
  file: string;
  staleMs: number;
  diagnostics: string[];
}

export interface StorageLeaseFaultHooks {
  beforeAcquire?: (file: string) => void;
  beforeClose?: (file: string) => void;
}

export class StorageLease {
  private closed = false;
  private lost = false;

  private constructor(
    private readonly storageDir: string,
    private readonly owner: RuntimeOwner,
    private readonly staleMs: number,
    private readonly faults: StorageLeaseFaultHooks = {},
  ) {}

  static acquire(storageDir: string, init: { staleMs?: number; faults?: StorageLeaseFaultHooks } = {}): StorageLease {
    const staleMs = init.staleMs ?? DEFAULT_LEASE_STALE_MS;
    mkdirSync(storageDir, { recursive: true });
    const owner = createRuntimeOwner();
    const lockPath = path.join(storageDir, STORAGE_LOCK_FILE);
    const diagnostics: string[] = [];
    while (true) {
      try {
        init.faults?.beforeAcquire?.(lockPath);
        const fd = openSync(lockPath, "wx");
        try {
          writeFileSync(fd, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
        } finally {
          closeSync(fd);
        }
        if (diagnostics.length > 0) appendLeaseDiagnostics(storageDir, diagnostics);
        return new StorageLease(storageDir, owner, staleMs, init.faults);
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        const inspection = inspectStorageLock(storageDir, { staleMs });
        if (inspection.status !== "stale" && inspection.status !== "closed" && inspection.status !== "invalid") {
          const heldBy = inspection.owner ? `pid ${inspection.owner.pid}` : "another runtime";
          throw new Error(`storageDir is already open for writing by ${heldBy}; use read-only inspection commands or wait for the owner to close`);
        }
        diagnostics.push(`Storage lock takeover: previous owner was ${inspection.status}${inspection.reason ? ` (${inspection.reason})` : ""}.`);
        try {
          unlinkSync(lockPath);
        } catch (unlinkError) {
          if (existsSync(lockPath)) throw unlinkError;
        }
      }
    }
  }

  currentOwner(): RuntimeOwner {
    return { ...this.owner };
  }

  ownsCurrentLock(): boolean {
    if (this.closed || this.lost) return false;
    let fd: number | undefined;
    try {
      fd = openSync(path.join(this.storageDir, STORAGE_LOCK_FILE), "r");
      const current = parseRuntimeOwner(JSON.parse(readFileSync(fd, "utf8")) as unknown);
      if (current?.runtimeInstanceId !== this.owner.runtimeInstanceId) {
        this.lost = true;
        return false;
      }
      return true;
    } catch {
      this.lost = true;
      return false;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  heartbeat(): RuntimeOwner | undefined {
    if (this.closed || this.lost) return undefined;
    this.owner.heartbeatAt = Date.now();
    if (!this.writeIfCurrentOwner(this.owner)) return undefined;
    return this.currentOwner();
  }

  close(): RuntimeOwner | undefined {
    if (this.closed || this.lost) return undefined;
    this.closed = true;
    this.owner.heartbeatAt = Date.now();
    this.owner.closedAt = this.owner.heartbeatAt;
    this.faults.beforeClose?.(path.join(this.storageDir, STORAGE_LOCK_FILE));
    if (!this.writeIfCurrentOwner(this.owner)) return undefined;
    return this.currentOwner();
  }

  private writeIfCurrentOwner(owner: RuntimeOwner): boolean {
    let fd: number | undefined;
    try {
      fd = openSync(path.join(this.storageDir, STORAGE_LOCK_FILE), "r+");
      const current = parseRuntimeOwner(JSON.parse(readFileSync(fd, "utf8")) as unknown);
      if (current?.runtimeInstanceId !== this.owner.runtimeInstanceId) {
        this.lost = true;
        return false;
      }
      ftruncateSync(fd, 0);
      writeSync(fd, `${JSON.stringify(redactUnknown(owner), null, 2)}\n`, 0, "utf8");
      return true;
    } catch {
      this.lost = true;
      return false;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}

export function createRuntimeOwner(): RuntimeOwner {
  const now = Date.now();
  return {
    runtimeInstanceId: createId("runtime"),
    pid: process.pid,
    startedAt: now,
    heartbeatAt: now,
  };
}

export function inspectStorageLock(storageDir: string, init: { staleMs?: number } = {}): StorageLockInspection {
  const staleMs = init.staleMs ?? DEFAULT_LEASE_STALE_MS;
  const file = STORAGE_LOCK_FILE;
  const lockPath = path.join(storageDir, STORAGE_LOCK_FILE);
  if (!existsSync(lockPath)) return { file, status: "missing", staleMs, diagnostics: [] };
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    const owner = parseRuntimeOwner(parsed);
    if (!owner) return { file, status: "invalid", staleMs, diagnostics: ["Storage lock owner is invalid."] };
    const inspected = inspectOwner(owner, { staleMs });
    return redactUnknown({ file, staleMs, diagnostics: [], ...inspected });
  } catch (error) {
    return {
      file,
      status: "invalid",
      staleMs,
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function inspectOwner(owner: RuntimeOwner | undefined, init: { staleMs?: number; now?: number } = {}): OwnerInspection {
  if (!owner) return { status: "missing", reason: "owner metadata is missing" };
  const now = init.now ?? Date.now();
  const staleMs = init.staleMs ?? DEFAULT_LEASE_STALE_MS;
  const ageMs = Math.max(0, now - owner.heartbeatAt);
  if (owner.closedAt !== undefined) return { status: "closed", owner, ageMs, reason: "owner closed the lease" };
  if (ageMs > staleMs) return { status: "stale", owner, ageMs, reason: "owner heartbeat is stale" };
  if (!isPidAlive(owner.pid)) return { status: "stale", owner, ageMs, reason: "owner process is not alive" };
  return { status: "live", owner, ageMs };
}

export function parseRuntimeOwner(value: unknown): RuntimeOwner | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.runtimeInstanceId !== "string") return undefined;
  if (typeof record.pid !== "number") return undefined;
  if (typeof record.startedAt !== "number" || typeof record.heartbeatAt !== "number") return undefined;
  if ("closedAt" in record && record.closedAt !== undefined && typeof record.closedAt !== "number") return undefined;
  return {
    runtimeInstanceId: record.runtimeInstanceId,
    pid: record.pid,
    startedAt: record.startedAt,
    heartbeatAt: record.heartbeatAt,
    closedAt: typeof record.closedAt === "number" ? record.closedAt : undefined,
  };
}

function appendLeaseDiagnostics(storageDir: string, messages: string[]): void {
  for (const message of messages) {
    try {
      appendFileSync(path.join(storageDir, "diagnostics.jsonl"), `${JSON.stringify(redactUnknown({
        timestamp: Date.now(),
        diagnostic: {
          code: "AGENT_STORAGE_LEASE_TAKEOVER",
          message,
          retryable: false,
        },
      }))}\n`, "utf8");
    } catch {
      // Lease diagnostics must never block lock acquisition.
    }
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}
