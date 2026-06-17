import { AdapterRegistry } from "../adapters/registry.js";
import type { AgentAdapterDef, AgentId, DetectedAgent } from "../adapters/adapter-types.js";
import type { ReplayEvent } from "./events.js";
import { detectAgents, detectAgentsStream, type DetectOptions } from "../detection/detect.js";
import { GoalScheduler } from "../goals/goal-scheduler.js";
import { GoalStore } from "../goals/goal-store.js";
import type { CreateGoalRequest, GoalHandle, GoalRecord } from "../goals/goal-types.js";
import { RunScheduler } from "../runs/run-scheduler.js";
import { RunStore } from "../runs/run-store.js";
import type { RunHandle, RunRecord, RunRequest, RuntimeOptions } from "../runs/run-types.js";
import type { AgentEvent, SchedulerEvent } from "./events.js";
import { JsonFileStorage } from "../storage/file-storage.js";
import type { RunStatus } from "../runs/run-result.js";
import {
  exportDiagnosticsBundle,
  inspectStoreDirectory,
  type DiagnosticsBundle,
  type ExportDiagnosticsRequest,
  type InspectStoreOptions,
  type StoreHealth,
} from "../storage/store-inspection.js";

export interface AgentRuntime {
  detect(options?: DetectOptions): Promise<DetectedAgent[]>;
  detectStream(options?: DetectOptions): AsyncIterable<DetectedAgent>;
  run(request: RunRequest): Promise<RunHandle>;
  createGoal(request: CreateGoalRequest): Promise<GoalHandle>;
  cancelRun(runId: string): Promise<void>;
  cancelGoal(goalId: string): Promise<void>;
  shutdown(reason?: string): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  replayRunEvents(runId: string, options?: { afterEventId?: number }): Promise<Array<ReplayEvent<AgentEvent>>>;
  getRunEvents(runId: string, options?: { afterEventId?: number }): Promise<Array<ReplayEvent<AgentEvent>>>;
  listRuns(options?: { status?: "active" | RunStatus }): Promise<RunRecord[]>;
  getGoal(goalId: string): Promise<GoalRecord | null>;
  replayGoalEvents(goalId: string, options?: { afterEventId?: number }): Promise<Array<ReplayEvent<SchedulerEvent>>>;
  getGoalEvents(goalId: string, options?: { afterEventId?: number }): Promise<Array<ReplayEvent<SchedulerEvent>>>;
  listGoals(options?: { status?: "active" | GoalRecord["status"] }): Promise<GoalRecord[]>;
  inspectStore(options?: InspectStoreOptions): Promise<StoreHealth>;
  exportDiagnostics(request: ExportDiagnosticsRequest): Promise<DiagnosticsBundle>;
  getAdapter(id: AgentId): AgentAdapterDef | null;
}

export function createAgentRuntime(options: RuntimeOptions = {}): AgentRuntime {
  const registry = new AdapterRegistry(options.adapters);
  const storage = options.storageDir ? new JsonFileStorage(options.storageDir, { durability: options.storage?.durability }) : undefined;
  const runStore = new RunStore(2_000, storage);
  const runScheduler = new RunScheduler(registry, runStore, {
    env: options.env,
    searchPath: options.searchPath,
  });
  const goalStore = new GoalStore(storage);
  const goalScheduler = new GoalScheduler(runScheduler, goalStore, {
    maxConcurrentTasks: options.maxConcurrentTasks,
  });
  return {
    detect: (detectOptions) => detectAgents({ adapters: registry.list(), env: options.env, searchPath: options.searchPath }, detectOptions),
    detectStream: (detectOptions) => detectAgentsStream({ adapters: registry.list(), env: options.env, searchPath: options.searchPath }, detectOptions),
    run: (request) => runScheduler.startRun(request),
    createGoal: (request) => goalScheduler.createGoal(request),
    cancelRun: (runId) => runScheduler.cancelRun(runId),
    cancelGoal: (goalId) => goalScheduler.cancelGoal(goalId),
    shutdown: async (reason) => {
      await goalScheduler.shutdown(reason);
      await runScheduler.shutdown(reason);
    },
    getRun: async (runId) => runStore.get(runId),
    replayRunEvents: async (runId, eventOptions) => runStore.replay(runId, eventOptions?.afterEventId),
    getRunEvents: async (runId, eventOptions) => runStore.replay(runId, eventOptions?.afterEventId),
    listRuns: async (listOptions) => runStore.list(listOptions),
    getGoal: async (goalId) => goalStore.get(goalId),
    replayGoalEvents: async (goalId, eventOptions) => goalStore.replay(goalId, eventOptions?.afterEventId),
    getGoalEvents: async (goalId, eventOptions) => goalStore.replay(goalId, eventOptions?.afterEventId),
    listGoals: async (listOptions) => goalStore.list(listOptions),
    inspectStore: async (inspectOptions) => inspectStoreDirectory(requiredStorageDir(inspectOptions?.storageDir ?? options.storageDir)),
    exportDiagnostics: async (request) => exportDiagnosticsBundle(request, requiredStorageDir(request.storageDir ?? options.storageDir)),
    getAdapter: (id) => registry.get(id),
  };
}

function requiredStorageDir(storageDir: string | undefined): string {
  if (!storageDir) throw new Error("storageDir is required for store inspection and diagnostics export");
  return storageDir;
}
