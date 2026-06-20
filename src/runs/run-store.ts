import { AsyncQueue } from "../core/async-queue.js";
import { createId } from "../core/ids.js";
import type { AgentEvent, ReplayEvent } from "../core/events.js";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import { diagnostic } from "../core/diagnostics.js";
import type { AgentId } from "../adapters/adapter-types.js";
import type { RunRecord } from "./run-types.js";
import type { RunStatus } from "./run-result.js";
import type { FileStorage } from "../storage/storage-types.js";
import { inspectOwner } from "../storage/storage-lease.js";
import type { RuntimeOwner } from "../public-types.js";

interface StoredRun extends RunRecord {
  events: Array<ReplayEvent<AgentEvent>>;
  subscribers: Set<AsyncQueue<AgentEvent>>;
  nextEventId: number;
  persistenceFailed?: boolean;
}

export class RunStore {
  private readonly runs = new Map<string, StoredRun>();

  constructor(
    private readonly maxEvents = 2_000,
    private readonly storage?: FileStorage,
    private readonly options: { owner?: () => RuntimeOwner | undefined; staleMs?: number } = {},
  ) {
    this.loadFromStorage();
  }

  create(input: { agentId: AgentId; cwd: string }): RunRecord {
    const now = Date.now();
    const run: StoredRun = {
      id: createId("run"),
      agentId: input.agentId,
      cwd: input.cwd,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
      owner: this.currentOwner(),
      events: [],
      subscribers: new Set(),
      nextEventId: 1,
    };
    this.runs.set(run.id, run);
    this.tryPersistManifest(run);
    return this.publicRecord(run);
  }

  get(runId: string): RunRecord | null {
    const run = this.runs.get(runId);
    return run ? this.publicRecord(run) : null;
  }

  list(options: { status?: "active" | RunStatus } = {}): RunRecord[] {
    const runs = [...this.runs.values()].map((run) => this.publicRecord(run));
    if (!options.status) return runs;
    if (options.status === "active") return runs.filter((run) => !isTerminal(run.status));
    return runs.filter((run) => run.status === options.status);
  }

  setStatus(runId: string, status: RunStatus, init: Partial<Pick<RunRecord, "exitCode" | "signal" | "error" | "errorCode">> = {}): void {
    const run = this.mustGet(runId);
    if (run.persistenceFailed) return;
    run.status = status;
    run.updatedAt = Date.now();
    Object.assign(run, init);
    this.tryPersistManifest(run);
  }

  addDiagnostic(runId: string, diagnostic: RuntimeDiagnostic): void {
    const run = this.mustGet(runId);
    run.diagnostics.push(diagnostic);
    run.updatedAt = Date.now();
    this.tryPersistManifest(run);
  }

  append(runId: string, event: AgentEvent): ReplayEvent<AgentEvent> {
    const run = this.mustGet(runId);
    if (run.persistenceFailed) return runReplayRecord(run, event);
    const record = runReplayRecord(run, event);
    run.nextEventId += 1;
    run.events.push(record);
    if (run.events.length > this.maxEvents) run.events.splice(0, run.events.length - this.maxEvents);
    run.updatedAt = Date.now();
    if (!this.tryPersistEvent(run, record) || !this.tryPersistManifest(run)) {
      for (const subscriber of run.subscribers) subscriber.push(event);
      this.markPersistenceFailed(run);
      return record;
    }
    for (const subscriber of run.subscribers) subscriber.push(event);
    if (event.type === "run_finished") {
      for (const subscriber of run.subscribers) subscriber.end();
      run.subscribers.clear();
    }
    return record;
  }

  replay(runId: string, afterEventId = 0): ReplayEvent<AgentEvent>[] {
    const run = this.mustGet(runId);
    return run.events
      .filter((event) => event.id > afterEventId)
      .sort(compareReplayEvents);
  }

  events(runId: string, afterEventId = 0): AsyncIterable<AgentEvent> {
    const run = this.mustGet(runId);
    const queue = new AsyncQueue<AgentEvent>();
    for (const record of run.events) {
      if (record.id > afterEventId) queue.push(record.event);
    }
    if (isTerminal(run.status)) {
      queue.end();
      return queue;
    }
    run.subscribers.add(queue);
    return queue;
  }

  hasPersistenceFailed(runId: string): boolean {
    return Boolean(this.runs.get(runId)?.persistenceFailed);
  }

  heartbeatActive(owner: RuntimeOwner): void {
    for (const run of this.runs.values()) {
      if (isTerminal(run.status) || run.persistenceFailed) continue;
      run.owner = { ...owner };
      run.updatedAt = Date.now();
      this.tryPersistManifest(run);
    }
  }

  private mustGet(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  private publicRecord(run: StoredRun): RunRecord {
    const { events, subscribers, nextEventId, persistenceFailed, ...publicRun } = run;
    void events;
    void subscribers;
    void nextEventId;
    void persistenceFailed;
    return { ...publicRun, diagnostics: [...publicRun.diagnostics] };
  }

  private loadFromStorage(): void {
    if (!this.storage) return;
    for (const snapshot of this.storage.listRuns()) {
      const run: StoredRun = {
        ...snapshot.manifest,
        diagnostics: [...snapshot.manifest.diagnostics],
        events: snapshot.events,
        subscribers: new Set(),
        nextEventId: nextEventId(snapshot.events),
      };
      if (snapshot.manifestError && !run.diagnostics.some((item) => item.code === "AGENT_STORE_RECORD_CORRUPT")) {
        run.diagnostics.push(diagnostic("AGENT_STORE_RECORD_CORRUPT", snapshot.manifestError.message));
      }
      if (snapshot.eventsError) {
        run.diagnostics.push(diagnostic("AGENT_EVENT_LOG_CORRUPT", snapshot.eventsError.message));
        run.events.push({
          id: run.nextEventId++,
          sequence: run.nextEventId - 1,
          runId: run.id,
          timestamp: Date.now(),
          event: {
            type: "error",
            code: "AGENT_EVENT_LOG_CORRUPT",
            message: snapshot.eventsError.message,
            retryable: false,
            timestamp: Date.now(),
          },
        });
      }
      this.runs.set(run.id, run);
      if (!isTerminal(run.status) && this.canRecoverActive(run.owner)) this.markInterrupted(run);
      else if (!snapshot.manifestError) this.tryPersistManifest(run);
    }
  }

  private canRecoverActive(owner: RuntimeOwner | undefined): boolean {
    const inspected = inspectOwner(owner, { staleMs: this.options.staleMs });
    return inspected.status === "missing" || inspected.status === "stale" || inspected.status === "closed" || inspected.status === "invalid";
  }

  private markInterrupted(run: StoredRun): void {
    run.status = "failed";
    run.updatedAt = Date.now();
    run.exitCode = null;
    run.signal = "RUNTIME_RESTART";
    run.error = "Run was active when storage was loaded and cannot be resumed.";
    run.errorCode = "AGENT_RUNTIME_INTERRUPTED";
    run.owner = this.currentOwner();
    run.diagnostics.push(diagnostic("AGENT_RUNTIME_INTERRUPTED", run.error, { signal: run.signal }));
    this.tryPersistManifest(run);
    this.append(run.id, {
      type: "error",
      code: "AGENT_RUNTIME_INTERRUPTED",
      message: run.error,
      retryable: false,
      timestamp: Date.now(),
    });
    this.append(run.id, {
      type: "run_finished",
      result: "failed",
      exitCode: null,
      signal: run.signal,
      timestamp: Date.now(),
    });
  }

  private markPersistenceFailed(run: StoredRun, error?: unknown, options: { persistManifest?: boolean } = {}): void {
    if (run.persistenceFailed) return;
    const message = `Run event persistence failed: ${errorMessage(error)}`;
    run.status = "failed";
    run.updatedAt = Date.now();
    run.exitCode = null;
    run.signal = null;
    run.error = message;
    run.errorCode = "AGENT_EVENT_PERSIST_FAILED";
    run.diagnostics.push(diagnostic("AGENT_EVENT_PERSIST_FAILED", message));
    const errorEvent: ReplayEvent<AgentEvent> = {
      id: run.nextEventId++,
      sequence: run.nextEventId - 1,
      runId: run.id,
      timestamp: Date.now(),
      event: { type: "error", code: "AGENT_EVENT_PERSIST_FAILED", message, retryable: false, timestamp: Date.now() },
    };
    const finishedEvent: ReplayEvent<AgentEvent> = {
      id: run.nextEventId++,
      sequence: run.nextEventId - 1,
      runId: run.id,
      timestamp: Date.now(),
      event: { type: "run_finished", result: "failed", exitCode: null, signal: null, timestamp: Date.now() },
    };
    run.events.push(errorEvent, finishedEvent);
    for (const subscriber of run.subscribers) {
      subscriber.push(errorEvent.event);
      subscriber.push(finishedEvent.event);
      subscriber.end();
    }
    run.subscribers.clear();
    if (options.persistManifest && this.storage) {
      try {
        this.storage.writeRunManifest(this.publicRecord(run));
      } catch {
        // The diagnostic remains visible to current callers even if the failed manifest cannot be persisted.
      }
    }
    run.persistenceFailed = true;
  }

  private tryPersistManifest(run: StoredRun): boolean {
    if (!this.storage || run.persistenceFailed) return true;
    try {
      if (!isTerminal(run.status)) run.owner = this.currentOwner();
      this.storage.writeRunManifest(this.publicRecord(run));
      return true;
    } catch (error) {
      this.markPersistenceFailed(run, error);
      return false;
    }
  }

  private tryPersistEvent(run: StoredRun, record: ReplayEvent<AgentEvent>): boolean {
    if (!this.storage || run.persistenceFailed) return true;
    try {
      this.storage.appendRunEvent(run.id, record);
      return true;
    } catch (error) {
      this.markPersistenceFailed(run, error, { persistManifest: true });
      return false;
    }
  }

  private currentOwner(): RuntimeOwner | undefined {
    const owner = this.options.owner?.();
    return owner ? { ...owner } : undefined;
  }
}

export function isTerminal(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function nextEventId(events: Array<ReplayEvent<AgentEvent>>): number {
  return events.reduce((max, event) => Math.max(max, event.id), 0) + 1;
}

function runReplayRecord(run: StoredRun, event: AgentEvent): ReplayEvent<AgentEvent> {
  return {
    id: run.nextEventId,
    sequence: run.nextEventId,
    runId: run.id,
    event,
    timestamp: Date.now(),
  };
}

function compareReplayEvents(left: ReplayEvent<unknown>, right: ReplayEvent<unknown>): number {
  return (left.sequence - right.sequence) || (left.id - right.id) || (left.timestamp - right.timestamp);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
