import type { CreateGoalRequest, ScheduledTask } from "./goal-types.js";

export function createPlannerPrompt(request: CreateGoalRequest): string {
  return [
    "You are the planner for Agent CLI Runtime.",
    "Return strict JSON only. Do not wrap it in Markdown.",
    "Schema: {\"tasks\":[{\"id\":\"T001\",\"title\":\"...\",\"objective\":\"...\",\"dependencies\":[],\"allowedFiles\":[\"...\"],\"validationCommands\":[\"...\"],\"agentId\":\"codex\"}]}",
    "Create 4-8 small tasks when the objective is broad; create fewer when the objective is already narrow.",
    "Each task objective must be self-contained and executable by a local coding agent.",
    "Do not require external secrets. Do not modify .reference/.",
    `Default agent id: ${request.defaultAgentId}`,
    `Objective:\n${request.objective}`,
  ].join("\n\n");
}

export function createTaskPrompt(goalObjective: string, task: ScheduledTask): string {
  const chunks = [
    `Goal objective:\n${goalObjective}`,
    `Task ${task.id}: ${task.title}`,
    task.objective,
  ];
  if (task.allowedFiles?.length) chunks.push(`Allowed files:\n${task.allowedFiles.map((file) => `- ${file}`).join("\n")}`);
  if (task.validationCommands?.length) chunks.push(`Validation commands:\n${task.validationCommands.map((cmd) => `- ${cmd}`).join("\n")}`);
  chunks.push("Implement only this task. Stream progress normally and summarize evidence at the end.");
  return chunks.join("\n\n");
}
