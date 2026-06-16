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

export interface AgentRuntime {
  detect(options?: DetectOptions): Promise<DetectedAgent[]>;
  detectStream(options?: DetectOptions): AsyncIterable<DetectedAgent>;
  run(request: RunRequest): Promise<RunHandle>;
  createGoal(request: CreateGoalRequest): Promise<GoalHandle>;
  cancelRun(runId: string): Promise<void>;
  cancelGoal(goalId: string): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  getRunEvents(runId: string, options?: { afterEventId?: number }): Promise<Array<ReplayEvent<AgentEvent>>>;
  listRuns(options?: { status?: "active" | RunStatus }): Promise<RunRecord[]>;
  getGoal(goalId: string): Promise<GoalRecord | null>;
  getGoalEvents(goalId: string, options?: { afterEventId?: number }): Promise<Array<ReplayEvent<SchedulerEvent>>>;
  listGoals(options?: { status?: "active" | GoalRecord["status"] }): Promise<GoalRecord[]>;
  getAdapter(id: AgentId): AgentAdapterDef | null;
}

export function createAgentRuntime(options: RuntimeOptions = {}): AgentRuntime {
  const registry = new AdapterRegistry(options.adapters);
  const storage = options.storageDir ? new JsonFileStorage(options.storageDir) : undefined;
  const runStore = new RunStore(2_000, storage);
  const runScheduler = new RunScheduler(registry, runStore, {
    env: options.env,
    searchPath: options.searchPath,
  });
  const goalStore = new GoalStore(storage);
  const goalScheduler = new GoalScheduler(runScheduler, goalStore);
  return {
    detect: (detectOptions) => detectAgents({ adapters: registry.list(), env: options.env, searchPath: options.searchPath }, detectOptions),
    detectStream: (detectOptions) => detectAgentsStream({ adapters: registry.list(), env: options.env, searchPath: options.searchPath }, detectOptions),
    run: (request) => runScheduler.startRun(request),
    createGoal: (request) => goalScheduler.createGoal(request),
    cancelRun: (runId) => runScheduler.cancelRun(runId),
    cancelGoal: (goalId) => goalScheduler.cancelGoal(goalId),
    getRun: async (runId) => runStore.get(runId),
    getRunEvents: async (runId, eventOptions) => runStore.replay(runId, eventOptions?.afterEventId),
    listRuns: async (listOptions) => runStore.list(listOptions),
    getGoal: async (goalId) => goalStore.get(goalId),
    getGoalEvents: async (goalId, eventOptions) => goalStore.replay(goalId, eventOptions?.afterEventId),
    listGoals: async (listOptions) => goalStore.list(listOptions),
    getAdapter: (id) => registry.get(id),
  };
}
