#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAgentRuntime } from "../index.js";

interface ParsedArgs {
  command: string;
  flags: Map<string, string | boolean>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const runtime = createAgentRuntime();
  if (!parsed.command || parsed.command === "help" || parsed.flags.has("help")) {
    printHelp();
    return;
  }
  if (parsed.command === "agents") {
    const agents = await runtime.detect({ includeUnavailable: true });
    output(parsed, agents);
    return;
  }
  if (parsed.command === "doctor") {
    const agents = await runtime.detect({ includeUnavailable: true });
    output(parsed, {
      ok: agents.some((agent) => agent.available),
      agents,
    });
    return;
  }
  if (parsed.command === "run") {
    const prompt = await promptFromFlags(parsed);
    const handle = await runtime.run({
      agentId: stringFlag(parsed, "agent") ?? "codex",
      cwd: path.resolve(stringFlag(parsed, "cwd") ?? "."),
      prompt,
      model: stringFlag(parsed, "model"),
      permissionPolicy: permissionFlag(parsed),
      timeoutMs: numberFlag(parsed, "timeout-ms"),
    });
    await streamRun(parsed, handle.events);
    return;
  }
  if (parsed.command === "goal") {
    const prompt = await promptFromFlags(parsed);
    const handle = await runtime.createGoal({
      defaultAgentId: stringFlag(parsed, "agent") ?? "codex",
      cwd: path.resolve(stringFlag(parsed, "cwd") ?? "."),
      objective: prompt,
      permissionPolicy: permissionFlag(parsed),
      timeoutMs: numberFlag(parsed, "timeout-ms"),
    });
    await streamRun(parsed, handle.events);
    return;
  }
  throw new Error(`Unknown command: ${parsed.command}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { command, flags };
}

async function promptFromFlags(parsed: ParsedArgs): Promise<string> {
  const prompt = stringFlag(parsed, "prompt");
  if (prompt) return prompt;
  const promptFile = stringFlag(parsed, "prompt-file");
  if (promptFile) return readFile(path.resolve(promptFile), "utf8");
  throw new Error("--prompt or --prompt-file is required");
}

async function streamRun(parsed: ParsedArgs, events: AsyncIterable<unknown>): Promise<void> {
  if (parsed.flags.get("stream") === "jsonl") {
    for await (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }
  let last: unknown = null;
  for await (const event of events) {
    last = event;
    if (parsed.flags.has("json")) continue;
    if (typeof event === "object" && event && "type" in event) {
      const typed = event as { type: string; text?: string; message?: string; result?: string };
      if (typed.type === "text_delta" && typed.text) process.stdout.write(typed.text);
      else if (typed.type.endsWith("finished")) process.stdout.write(`\n${typed.type}: ${typed.result ?? "done"}\n`);
      else if (typed.type === "error" && typed.message) process.stderr.write(`${typed.message}\n`);
    }
  }
  if (parsed.flags.has("json")) output(parsed, last ?? {});
}

function output(parsed: ParsedArgs, value: unknown): void {
  if (parsed.flags.has("json")) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function stringFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = stringFlag(parsed, key);
  if (!value) return undefined;
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function permissionFlag(parsed: ParsedArgs) {
  return stringFlag(parsed, "permission") as never;
}

function printHelp(): void {
  process.stdout.write(`agent-runtime agents [--json]
agent-runtime doctor [--json]
agent-runtime run --agent codex --cwd . --prompt "..." [--stream jsonl]
agent-runtime goal --agent codex --cwd . --prompt "..." [--stream jsonl]
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
