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
  if (input.includes("cancel")) setInterval(() => {}, 1000);
  else if (input.includes("structured-error")) {
    console.log(JSON.stringify({ type: "error", message: "structured boom" }));
  } else if (input.includes("Return strict JSON")) {
    const validationCommand = input.includes("bad-validation")
      ? "node -e \\"process.exit(7)\\""
      : "node -e \\"process.exit(0)\\"";
    console.log(JSON.stringify({ tasks: [
      { id: "T001", title: "First", objective: "do first", dependencies: [], validationCommands: [validationCommand] },
      { id: "T002", title: "Second", objective: input.includes("fail-task") ? "fail-task" : "do second", dependencies: ["T001"], validationCommands: ["node -e \\"process.exit(0)\\""] }
    ] }));
  } else if (input.includes("fail-task")) {
    console.log("task failed");
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
