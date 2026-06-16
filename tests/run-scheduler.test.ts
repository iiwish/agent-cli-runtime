import { describe, expect, it } from "vitest";
import { access, chmod, readFile, writeFile, mkdir } from "node:fs/promises";
import path, { delimiter } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentRuntime } from "../src/index.js";
import { RunStore } from "../src/runs/run-store.js";
import type { FileStorage } from "../src/storage/storage-types.js";
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
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "failed", errorCode: "AGENT_EXECUTION_FAILED" });
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
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "canceled", errorCode: "AGENT_CANCELLED" });
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
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "failed", errorCode: "AGENT_TIMEOUT" });
  });

  it("does not report success from output emitted after cancellation", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "cancel-then-output" });
    setTimeout(() => void handle.cancel(), 50);
    const events = await collect(handle.events);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "cancelled" });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "run_finished", result: "success" }));
  });

  it("does not report success from output emitted after timeout", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "cancel-then-output", timeoutMs: 50 });
    const events = await collect(handle.events);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "run_finished", result: "success" }));
  });

  it("treats AbortSignal as runtime cancellation", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const controller = new AbortController();
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "cancel", signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const events = await collect(handle.events);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "cancelled" });
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "canceled", errorCode: "AGENT_CANCELLED" });
  });

  it("classifies spawn ENOENT as unavailable", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const broken = path.join(dir, "broken-agent");
    await writeFile(broken, "#!/definitely/missing/interpreter\n", "utf8");
    await chmod(broken, 0o755);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter({ bin: "broken-agent" })],
      env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [dir],
    });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "hello" });
    const events = await collect(handle.events);
    expect(events.some((event) => event.type === "error" && event.code === "AGENT_UNAVAILABLE")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "failed", errorCode: "AGENT_UNAVAILABLE" });
  });

  it("classifies configured non-executable paths as not executable", async () => {
    if (process.platform === "win32") return;
    const dir = await tempDir();
    const cwd = await tempDir();
    const notExecutable = path.join(dir, "not-executable-agent");
    await writeFile(notExecutable, "#!/usr/bin/env node\n", "utf8");
    await chmod(notExecutable, 0o644);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter()],
      env: { PATH: process.env.PATH ?? "", FAKE_BIN: notExecutable },
      searchPath: [],
    });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "hello" });
    const events = await collect(handle.events);
    expect(events.some((event) => event.type === "error" && event.code === "AGENT_NOT_EXECUTABLE")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "failed", errorCode: "AGENT_NOT_EXECUTABLE" });
  });

  it("classifies PATH non-executable candidates as not executable", async () => {
    if (process.platform === "win32") return;
    const dir = await tempDir();
    const cwd = await tempDir();
    const notExecutable = path.join(dir, "path-agent");
    await writeFile(notExecutable, "#!/usr/bin/env node\n", "utf8");
    await chmod(notExecutable, 0o644);
    const runtime = createAgentRuntime({
      adapters: [fakeAdapter({ bin: "path-agent", binEnvVar: undefined })],
      env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
      searchPath: [dir],
    });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "hello" });
    const events = await collect(handle.events);
    expect(events.some((event) => event.type === "error" && event.code === "AGENT_NOT_EXECUTABLE")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "failed", errorCode: "AGENT_NOT_EXECUTABLE" });
  });

  it("best-effort terminates a subprocess tree on POSIX", async () => {
    if (process.platform === "win32") return;
    const dir = await tempDir();
    const cwd = await tempDir();
    const marker = path.join(await tempDir(), "child.pid");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: `tree-child MARKER:${marker}` });
    await waitForFile(marker);
    const childPid = Number((await readFile(marker, "utf8")).trim());
    await handle.cancel();
    await collect(handle.events);
    await delay(100);
    expect(isProcessAlive(childPid)).toBe(false);
  });

  it("emits only one run_finished when process close and error race", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "close-error-race" });
    const events = await collect(handle.events);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("persists run events to JSONL and replays after an event id", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "persist-run" });
    await collect(handle.events);

    const eventsFile = path.join(storageDir, "runs", handle.runId, "events.jsonl");
    const lines = (await readFile(eventsFile, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).id)).toEqual([1, 2, 3]);
    const replayed = await runtime.getRunEvents(handle.runId, { afterEventId: 1 });
    expect(replayed.map((record) => record.id)).toEqual([2, 3]);
    expect(replayed.at(-1)?.event).toMatchObject({ type: "run_finished", result: "success" });
  });

  it("persists cancel and timeout terminal events to replay storage", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const canceled = await runtime.run({ agentId: "fake", cwd, prompt: "cancel" });
    setTimeout(() => void canceled.cancel(), 50);
    await collect(canceled.events);
    const timedOut = await runtime.run({ agentId: "fake", cwd, prompt: "cancel", timeoutMs: 50 });
    await collect(timedOut.events);

    const restarted = createAgentRuntime({ storageDir });
    expect(await restarted.getRun(canceled.runId)).toMatchObject({ status: "canceled", errorCode: "AGENT_CANCELLED" });
    expect((await restarted.getRunEvents(canceled.runId)).at(-1)?.event).toMatchObject({ type: "run_finished", result: "cancelled" });
    expect(await restarted.getRun(timedOut.runId)).toMatchObject({ status: "failed", errorCode: "AGENT_TIMEOUT" });
    expect((await restarted.getRunEvents(timedOut.runId)).at(-1)?.event).toMatchObject({ type: "run_finished", result: "failed" });
  });

  it("shutdown cancels active runs and clears active state", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "cancel" });
    await runtime.shutdown("test shutdown");
    const events = await collect(handle.events);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "cancelled" });
    expect(await runtime.getRun(handle.runId)).toMatchObject({ status: "canceled", errorCode: "AGENT_CANCELLED" });
    expect(await runtime.listRuns({ status: "active" })).toEqual([]);
    const restarted = createAgentRuntime({ storageDir });
    expect(await restarted.getRun(handle.runId)).toMatchObject({ status: "canceled" });
  });

  it("redacts stderr tail diagnostics for failed runs", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "secret-stderr" });
    await collect(handle.events);
    const manifest = await readFile(path.join(storageDir, "runs", handle.runId, "manifest.json"), "utf8");
    expect(manifest).not.toContain(`sk${"A".repeat(20)}`);
    expect(manifest).toContain("[REDACTED]");
  });

  it("loads terminal runs from a new runtime using the same storage dir", async () => {
    const dir = await tempDir();
    const cwd = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    await writeExecutable(dir, "fake-agent", fakeCliBody);
    const runtime = createAgentRuntime({ adapters: [fakeAdapter()], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir], storageDir });
    const handle = await runtime.run({ agentId: "fake", cwd, prompt: "persist-terminal" });
    await collect(handle.events);

    const restarted = createAgentRuntime({ storageDir });
    expect(await restarted.getRun(handle.runId)).toMatchObject({ id: handle.runId, status: "succeeded" });
    const runs = await restarted.listRuns({ status: "succeeded" });
    expect(runs.map((run) => run.id)).toContain(handle.runId);
  });

  it("marks active runs as failed with a diagnostic when storage is loaded", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_active_test";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), `${JSON.stringify({ id: 1, timestamp: Date.now(), event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp", timestamp: Date.now() } })}\n`, "utf8");

    const runtime = createAgentRuntime({ storageDir });
    const run = await runtime.getRun(runId);
    const events = await runtime.getRunEvents(runId);
    expect(run).toMatchObject({ id: runId, status: "failed", errorCode: "AGENT_RUNTIME_INTERRUPTED" });
    expect(run?.diagnostics.some((item) => item.code === "AGENT_RUNTIME_INTERRUPTED")).toBe(true);
    expect(events.at(-1)?.event).toMatchObject({ type: "run_finished", result: "failed" });
  });

  it("fails a run and emits diagnostics when event persistence fails", async () => {
    const store = new RunStore(2_000, throwingRunEventStorage());
    const run = store.create({ agentId: "fake", cwd: await tempDir() });
    const pendingEvents = collect(store.events(run.id));

    store.append(run.id, { type: "status", label: "persist me", timestamp: Date.now() });

    const record = store.get(run.id);
    const events = await pendingEvents;
    expect(record).toMatchObject({ status: "failed", errorCode: "AGENT_EVENT_PERSIST_FAILED" });
    expect(record?.diagnostics.some((item) => item.code === "AGENT_EVENT_PERSIST_FAILED")).toBe(true);
    expect(events.some((event) => event.type === "error" && event.code === "AGENT_EVENT_PERSIST_FAILED")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", result: "failed" });
    expect(record).not.toHaveProperty("persistenceFailed");
  });

  it("emits a replay error event when stored run JSONL is corrupt", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_corrupt_test";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: await tempDir(),
      status: "succeeded",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: 0,
      signal: null,
      error: null,
      errorCode: null,
      diagnostics: [],
    }), "utf8");
    await writeFile(
      path.join(runDir, "events.jsonl"),
      `${JSON.stringify({ id: 1, timestamp: Date.now(), event: { type: "run_finished", result: "success", timestamp: Date.now() } })}\nnot-json\n`,
      "utf8",
    );

    const runtime = createAgentRuntime({ storageDir });
    const run = await runtime.getRun(runId);
    const events = await runtime.getRunEvents(runId);
    expect(run?.diagnostics.some((item) => item.code === "AGENT_EVENT_LOG_CORRUPT")).toBe(true);
    expect(events.some((record) => record.event.type === "error" && record.event.code === "AGENT_EVENT_LOG_CORRUPT")).toBe(true);
  });
});

async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await access(file);
      return;
    } catch {
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function throwingRunEventStorage(): FileStorage {
  return {
    listRuns: () => [],
    writeRunManifest: () => undefined,
    appendRunEvent: () => {
      throw new Error("disk full");
    },
    listGoals: () => [],
    writeGoalManifest: () => undefined,
    appendGoalEvent: () => undefined,
  };
}
