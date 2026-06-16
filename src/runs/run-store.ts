import { AsyncQueue } from "../core/async-queue.js";
import { createId } from "../core/ids.js";
import type { AgentEvent, ReplayEvent } from "../core/events.js";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import type { AgentId } from "../adapters/adapter-types.js";
import type { RunRecord } from "./run-types.js";
import type { RunStatus } from "./run-result.js";

interface StoredRun extends RunRecord {
  events: Array<ReplayEvent<AgentEvent>>;
  subscribers: Set<AsyncQueue<AgentEvent>>;
  nextEventId: number;
}

export class RunStore {
  private readonly runs = new Map<string, StoredRun>();

  constructor(private readonly maxEvents = 2_000) {}

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
      events: [],
      subscribers: new Set(),
      nextEventId: 1,
    };
    this.runs.set(run.id, run);
    return this.publicRecord(run);
  }

  get(runId: string): RunRecord | null {
    const run = this.runs.get(runId);
    return run ? this.publicRecord(run) : null;
  }

  setStatus(runId: string, status: RunStatus, init: Partial<Pick<RunRecord, "exitCode" | "signal" | "error" | "errorCode">> = {}): void {
    const run = this.mustGet(runId);
    run.status = status;
    run.updatedAt = Date.now();
    Object.assign(run, init);
  }

  addDiagnostic(runId: string, diagnostic: RuntimeDiagnostic): void {
    const run = this.mustGet(runId);
    run.diagnostics.push(diagnostic);
    run.updatedAt = Date.now();
  }

  append(runId: string, event: AgentEvent): ReplayEvent<AgentEvent> {
    const run = this.mustGet(runId);
    const record = { id: run.nextEventId++, event, timestamp: Date.now() };
    run.events.push(record);
    if (run.events.length > this.maxEvents) run.events.splice(0, run.events.length - this.maxEvents);
    run.updatedAt = Date.now();
    for (const subscriber of run.subscribers) subscriber.push(event);
    if (event.type === "run_finished") {
      for (const subscriber of run.subscribers) subscriber.end();
      run.subscribers.clear();
    }
    return record;
  }

  replay(runId: string, afterEventId = 0): ReplayEvent<AgentEvent>[] {
    const run = this.mustGet(runId);
    return run.events.filter((event) => event.id > afterEventId);
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

  private mustGet(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  private publicRecord(run: StoredRun): RunRecord {
    const { events, subscribers, nextEventId, ...publicRun } = run;
    void events;
    void subscribers;
    void nextEventId;
    return { ...publicRun, diagnostics: [...publicRun.diagnostics] };
  }
}

export function isTerminal(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}
