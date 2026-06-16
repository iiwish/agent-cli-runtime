import { AdapterRegistry } from "../adapters/registry.js";
import type { AgentAdapterDef, AgentId, DetectedAgent } from "../adapters/adapter-types.js";
import { detectAgents, detectAgentsStream, type DetectOptions } from "../detection/detect.js";
import { GoalScheduler } from "../goals/goal-scheduler.js";
import type { CreateGoalRequest, GoalHandle } from "../goals/goal-types.js";
import { RunScheduler } from "../runs/run-scheduler.js";
import { RunStore } from "../runs/run-store.js";
import type { RunHandle, RunRequest, RuntimeOptions } from "../runs/run-types.js";

export interface AgentRuntime {
  detect(options?: DetectOptions): Promise<DetectedAgent[]>;
  detectStream(options?: DetectOptions): AsyncIterable<DetectedAgent>;
  run(request: RunRequest): Promise<RunHandle>;
  createGoal(request: CreateGoalRequest): Promise<GoalHandle>;
  cancelRun(runId: string): Promise<void>;
  cancelGoal(goalId: string): Promise<void>;
  getAdapter(id: AgentId): AgentAdapterDef | null;
}

export function createAgentRuntime(options: RuntimeOptions = {}): AgentRuntime {
  const registry = new AdapterRegistry(options.adapters);
  const runStore = new RunStore();
  const runScheduler = new RunScheduler(registry, runStore, {
    env: options.env,
    searchPath: options.searchPath,
  });
  const goalScheduler = new GoalScheduler(runScheduler);
  return {
    detect: (detectOptions) => detectAgents({ adapters: registry.list(), env: options.env, searchPath: options.searchPath }, detectOptions),
    detectStream: (detectOptions) => detectAgentsStream({ adapters: registry.list(), env: options.env, searchPath: options.searchPath }, detectOptions),
    run: (request) => runScheduler.startRun(request),
    createGoal: (request) => goalScheduler.createGoal(request),
    cancelRun: (runId) => runScheduler.cancelRun(runId),
    cancelGoal: (goalId) => goalScheduler.cancelGoal(goalId),
    getAdapter: (id) => registry.get(id),
  };
}
