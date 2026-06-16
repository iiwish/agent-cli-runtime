import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentAdapterDef, BuildArgsInput } from "../src/adapters/adapter-types.js";
import type { AgentEventInput } from "../src/core/events.js";
import { LineBuffer, isRecord, safeJsonParse } from "../src/parsers/line-buffer.js";

export async function tempDir(prefix = "agent-runtime-test-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeExecutable(dir: string, name: string, body: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, `#!/usr/bin/env node\n${body}`, "utf8");
  await chmod(file, 0o755);
  return file;
}

export function fakeAdapter(init: Partial<AgentAdapterDef> = {}): AgentAdapterDef {
  return {
    id: "fake",
    displayName: "Fake Agent",
    bin: "fake-agent",
    binEnvVar: "FAKE_BIN",
    versionArgs: ["--version"],
    fallbackModels: [{ id: "default", label: "Default" }],
    buildArgs(input: BuildArgsInput) {
      return ["run", input.model ?? ""].filter(Boolean);
    },
    promptTransport: { kind: "stdin", inputFormat: "text" },
    stream: { create: () => new FakeJsonOrTextParser() },
    capabilities: { streaming: true, tools: false, models: false },
    ...init,
  };
}

export const fakeCliBody = `
process.on("SIGTERM", () => {
  if (process.env.FAKE_IGNORE_SIGTERM === "1") return;
  process.exit(143);
});
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("fake 1.0.0");
  process.exit(0);
}
if (args[0] === "models") {
  console.log("fake/default");
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (input.includes("Return strict JSON")) {
    if (input.includes("parallel-ready")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "First independent", objective: "parallel-slow T001", dependencies: [] },
        { id: "T002", title: "Second independent", objective: "parallel-slow T002", dependencies: [] }
      ] }));
      return;
    }
    if (input.includes("dependency-wait")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "Slow dependency", objective: "parallel-slow T001", dependencies: [] },
        { id: "T002", title: "Dependent", objective: "do second", dependencies: ["T001"] }
      ] }));
      return;
    }
    if (input.includes("retry-task")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "Retryable", objective: "retryable-fail-once", dependencies: [] }
      ] }));
      return;
    }
    if (input.includes("non-retry-task")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "Non retryable", objective: "fail-task", dependencies: [] }
      ] }));
      return;
    }
    if (input.includes("invalid-task-graph")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "Invalid", objective: "invalid", dependencies: [], validationCommands: "npm test" }
      ] }));
      return;
    }
    if (input.includes("fail-upstream")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "Upstream failure", objective: "fail-task", dependencies: [] },
        { id: "T002", title: "Blocked dependent", objective: "do second", dependencies: ["T001"] }
      ] }));
      return;
    }
    if (input.includes("cancel-ready-queue")) {
      console.log(JSON.stringify({ tasks: [
        { id: "T001", title: "First running", objective: "parallel-slow T001 cancel", dependencies: [] },
        { id: "T002", title: "Second running", objective: "parallel-slow T002 cancel", dependencies: [] },
        { id: "T003", title: "Queued", objective: "parallel-slow T003 cancel", dependencies: [] }
      ] }));
      return;
    }
    const firstTaskObjective = input.includes("cancel-first") ? "cancel" : "do first";
    const taskObjective = input.includes("task-timeout") ? "cancel" : input.includes("fail-task") ? "fail-task" : "do second";
    const validationCommand = input.includes("secret-validation")
      ? "node -e \\"console.log('s' + 'k' + 'A'.repeat(20)); console.error('Bearer ' + 'B'.repeat(20))\\""
      : input.includes("bad-validation")
      ? "node -e \\"process.exit(7)\\""
      : "node -e \\"process.exit(0)\\"";
    console.log(JSON.stringify({ tasks: [
      { id: "T001", title: "First", objective: firstTaskObjective, dependencies: [], validationCommands: [validationCommand] },
      { id: "T002", title: "Second", objective: taskObjective, dependencies: ["T001"], validationCommands: ["node -e \\"process.exit(0)\\""] }
    ] }));
  } else if (input.includes("parallel-slow")) {
    console.log("parallel started");
    setTimeout(() => {
      console.log("parallel finished");
      process.exit(0);
    }, 250);
  } else if (input.includes("retryable-fail-once")) {
    const fs = require("node:fs");
    const path = require("node:path");
    const marker = path.join(process.cwd(), ".fake-retry-marker");
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, "1");
      console.log(JSON.stringify({ type: "error", message: "retryable boom" }));
      process.exit(0);
    }
    console.log("retry succeeded");
  } else if (input.includes("cancel-then-output")) {
    setTimeout(() => console.log("late success"), 250);
    setInterval(() => {}, 1000);
  } else if (input.includes("tree-child")) {
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");
    const marker = input.match(/MARKER:([^\\s]+)/)?.[1];
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: false, stdio: "ignore" });
    child.unref();
    if (marker) fs.writeFileSync(marker, String(child.pid));
    setInterval(() => {}, 1000);
  } else if (input.includes("timeout-diagnostic")) {
    console.log("diagnostic started");
    console.error("network ECONNRESET token sk" + "A".repeat(20) + " cwd=" + process.cwd() + " home=" + (process.env.HOME || ""));
    setInterval(() => {}, 1000);
  } else if (input.includes("close-error-race")) {
    console.log("ok:race");
    process.exit(0);
  } else if (input.includes("cancel")) setInterval(() => {}, 1000);
  else if (input.includes("structured-error")) {
    console.log(JSON.stringify({ type: "error", message: "structured boom" }));
  } else if (input.includes("fail-task")) {
    console.log("task failed");
    process.exit(2);
  } else if (input.includes("secret-stderr")) {
    console.error("token sk" + "A".repeat(20));
    process.exit(2);
  } else {
    console.log("ok:" + input.length);
  }
});
`;

class FakeJsonOrTextParser {
  private readonly lines = new LineBuffer();

  parse(chunk: string): AgentEventInput[] {
    return this.lines.push(chunk).flatMap((line) => this.parseLine(line));
  }

  flush(): AgentEventInput[] {
    return this.lines.flush().flatMap((line) => this.parseLine(line));
  }

  private parseLine(line: string): AgentEventInput[] {
    const parsed = safeJsonParse(line);
    if (isRecord(parsed) && parsed.type === "error") {
      return [{ type: "error", code: "AGENT_EXECUTION_FAILED", message: typeof parsed.message === "string" ? parsed.message : "fake error" }];
    }
    return [{ type: "text_delta", text: `${line}\n` }];
  }
}
