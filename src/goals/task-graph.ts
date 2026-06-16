import type { CreateGoalRequest, PlannerOutput, ScheduledTask } from "./goal-types.js";

export function parsePlannerOutput(text: string): PlannerOutput {
  const json = extractJson(text);
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    throw new Error("Planner output must contain tasks array");
  }
  return { tasks: (parsed as PlannerOutput).tasks };
}

export function validateTaskGraph(output: PlannerOutput, request: CreateGoalRequest): ScheduledTask[] {
  const ids = new Set<string>();
  const tasks: ScheduledTask[] = [];
  for (const task of output.tasks) {
    if (!task || typeof task !== "object") throw new Error("Task must be an object");
    if (!task.id || ids.has(task.id)) throw new Error(`Duplicate or missing task id: ${task.id}`);
    if (!task.title || !task.objective) throw new Error(`Task ${task.id} must include title and objective`);
    ids.add(task.id);
    tasks.push({
      id: task.id,
      title: task.title,
      objective: task.objective,
      status: "pending",
      dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
      agentId: task.agentId,
      cwd: request.cwd,
      permissionPolicy: request.permissionPolicy ?? "agent-default",
      allowedFiles: task.allowedFiles,
      validationCommands: task.validationCommands,
      retryPolicy: task.retryPolicy,
    });
  }
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) throw new Error(`Task ${task.id} depends on unknown task ${dep}`);
    }
  }
  assertAcyclic(tasks);
  return tasks;
}

export function dependencyOrder(tasks: ScheduledTask[]): ScheduledTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set<string>();
  const ordered: ScheduledTask[] = [];
  while (ordered.length < tasks.length) {
    const ready = tasks.find((task) => !done.has(task.id) && task.dependencies.every((dep) => done.has(dep)));
    if (!ready) throw new Error("Task graph has no ready task");
    ordered.push(ready);
    done.add(ready.id);
  }
  return ordered.map((task) => byId.get(task.id) as ScheduledTask);
}

function assertAcyclic(tasks: ScheduledTask[]): void {
  dependencyOrder(tasks);
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("Planner output did not contain JSON");
}
