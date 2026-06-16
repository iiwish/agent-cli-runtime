import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { createAgentRuntime } from "../src/index.js";
import { fakeAdapter, fakeCliBody, tempDir, writeExecutable } from "./helpers.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

describe("RunScheduler", () => {
  it("sends long prompts through stdin and succeeds", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const adapter = fakeAdapter();
    const runtime = createAgentRuntime({ adapters: [adapter], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const longPrompt = "x".repeat(150_000);
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: longPrompt });
    const events = await collect(handle.events);
    expect(adapter.buildArgs({ prompt: longPrompt, cwd, extraAllowedDirs: [], permissionPolicy: "agent-default" }).join(" ")).not.toContain(longPrompt);
    expect(events.some((event) => event.type === "text_delta" && event.text.includes("ok:150000"))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "success" });
  });

  it("fails on structured stdout error even when exit code is zero", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "structured-error" });
    const events = await collect(handle.events);
    expect(events.some((event) => event.type === "error" && event.message.includes("structured boom"))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
  });

  it("cancels a running process", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "cancel" });
    setTimeout(() => void handle.cancel(), 50);
    const events = await collect(handle.events);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "cancelled" });
  });

  it("fails on timeout", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "cancel", timeoutMs: 50 });
    const events = await collect(handle.events);
    expect(events.some((event) => event.type === "error" && event.code === "AGENT_TIMEOUT")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
  });
});
