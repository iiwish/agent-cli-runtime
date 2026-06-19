import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentRuntime } from "agent-cli-runtime";

async function writeFakeCodex(binDir) {
  const bin = path.join(binDir, "codex");
  await writeFile(bin, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli example-fake");
  process.exit(0);
}
if (args[0] === "debug" && args[1] === "models") {
  console.log(JSON.stringify({ models: [{ slug: "gpt-example", display_name: "GPT Example" }] }));
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started" }));
  if (input.includes("Return strict JSON only")) {
    const nodeCommand = JSON.stringify(process.execPath) + ' -e "process.exit(0)"';
    const graph = {
      tasks: [
        {
          id: "T001",
          title: "Run fake task",
          objective: "Complete the local fake task without editing files.",
          dependencies: [],
          allowedFiles: [],
          validationCommands: [nodeCommand],
          agentId: "codex"
        }
      ]
    };
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(graph) } }));
  } else {
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "fake task completed" } }));
  }
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 10 } }));
});
`, "utf8");
  await chmod(bin, 0o755);
  return bin;
}

const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-example-goal-"));
const binDir = path.join(root, "bin");
const cwd = path.join(root, "work");
const storageDir = path.join(root, "store");
await Promise.all([
  mkdir(binDir, { recursive: true }),
  mkdir(cwd, { recursive: true }),
]);
const codexBin = await writeFakeCodex(binDir);

const runtime = createAgentRuntime({
  storageDir,
  env: {
    ...process.env,
    PATH: binDir,
    CODEX_BIN: codexBin,
  },
  searchPath: [binDir],
});

try {
  const goal = await runtime.createGoal({
    cwd,
    objective: "Dogfood the goal scheduler with one fake task.",
    defaultAgentId: "codex",
    permissionPolicy: "read-only",
    timeoutMs: 10_000,
  });

  const eventTypes = [];
  for await (const event of goal.events) eventTypes.push(event.type);

  const record = await runtime.getGoal(goal.goalId);
  const replay = await runtime.replayGoalEvents(goal.goalId);
  const diagnostics = await runtime.exportDiagnostics({ kind: "goal", goalId: goal.goalId });

  console.log(JSON.stringify({
    goal: { id: record?.id, status: record?.status, result: record?.result },
    tasks: record?.tasks.map((task) => ({ id: task.id, status: task.status, attempts: task.evidence.attempts?.length ?? 0 })),
    eventTypes,
    replayEvents: replay.length,
    diagnosticsSchema: diagnostics.schemaVersion,
  }, null, 2));
} finally {
  await runtime.shutdown("example complete");
}
