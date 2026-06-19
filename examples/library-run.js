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
  console.log(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "example run ok: " + input.trim().slice(0, 80) }
  }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 8 } }));
});
`, "utf8");
  await chmod(bin, 0o755);
  return bin;
}

const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-example-run-"));
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
  const agents = await runtime.detect({ includeUnavailable: true });
  const run = await runtime.run({
    agentId: "codex",
    cwd,
    prompt: "Say hello from the library-run example.",
    permissionPolicy: "read-only",
    timeoutMs: 10_000,
  });

  let observedText = "";
  for await (const event of run.events) {
    if (event.type === "text_delta") observedText += event.text;
  }

  const record = await runtime.getRun(run.runId);
  const replay = await runtime.replayRunEvents(run.runId);
  const diagnostics = await runtime.exportDiagnostics({ kind: "run", runId: run.runId });
  const health = await runtime.inspectStore();

  console.log(JSON.stringify({
    detected: agents.map((agent) => ({ id: agent.id, available: agent.available, version: agent.version })),
    run: { id: record?.id, status: record?.status, result: record?.result },
    observedText,
    replayEvents: replay.length,
    diagnosticsSchema: diagnostics.schemaVersion,
    storeOk: health.ok,
  }, null, 2));
} finally {
  await runtime.shutdown("example complete");
}
