import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import path, { delimiter } from "node:path";
import { createAgentRuntime } from "../src/index.js";
import type {
  AgentAdapterDef,
  AgentEvent,
  AgentRuntime,
  CreateGoalRequest,
  DetectOptions,
  DetectedAgent,
  GoalHandle,
  GoalRecord,
  ReplayEvent,
  RunHandle,
  RunRecord,
  RunRequest,
  RuntimeDiagnostic,
  RuntimeOptions,
  SchedulerEvent,
  DiagnosticsBundle,
  ExportDiagnosticsRequest,
  InspectStoreOptions,
  StoreHealth,
  StoreRepairAction,
  StoreRepairReport,
  EventScope,
  EventTerminalContract,
  EventTerminalReason,
  VersionedEventEnvelope,
} from "../src/index.js";
import { tempDir, writeExecutable } from "./helpers.js";

const execFileP = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "main.js");

function fakeCliEnv(binDir: string, env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    ...env,
  };
}

async function execCliJson<T = unknown>(
  args: string[],
  options?: Parameters<typeof execFileP>[2],
): Promise<T> {
  const { stdout } = await execFileP(process.execPath, [cli, ...args], options);
  return JSON.parse(stdout) as T;
}

async function execCliFailure(
  args: string[],
  options?: Parameters<typeof execFileP>[2],
): Promise<{ stdout: string; stderr: string; code: number | string | undefined }> {
  try {
    await execFileP(process.execPath, [cli, ...args], options);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      code: failure.code,
    };
  }
  throw new Error(`expected CLI failure for ${args.join(" ")}`);
}

async function execInstalledCliJson<T = unknown>(
  bin: string,
  args: string[],
  options?: Parameters<typeof execFileP>[2],
): Promise<T> {
  const { stdout } = await execFileP(process.execPath, [bin, ...args], options);
  return JSON.parse(stdout) as T;
}

async function waitForRunId(storageDir: string): Promise<string | undefined> {
  const runsDir = path.join(storageDir, "runs");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const runs = JSON.parse((await execFileP(process.execPath, [cli, "runs", "--storage-dir", storageDir, "--json"])).stdout) as Array<{
        id: string;
        errorCode?: string | null;
        status?: string;
      }>;
      const terminalRun = runs.find((run) => run.status === "failed" || run.errorCode === "AGENT_TIMEOUT");
      if (terminalRun?.id) return terminalRun.id;
      if (runs[0]?.id) return runs[0].id;
    } catch {
      void 0;
    }
    try {
      const runIds = (await readdir(runsDir)).filter((entry) => entry.startsWith("run_"));
      if (runIds[0]) return runIds[0];
    } catch {
      void 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

function isLikelyBinary(buffer: Buffer): boolean {
  const maxScan = Math.min(buffer.length, 4096);
  if (buffer.includes(0)) return true;
  let suspiciousBytes = 0;
  for (let i = 0; i < maxScan; i += 1) {
    const byte = buffer[i];
    const isTextish =
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e) ||
      byte >= 0x80;
    if (!isTextish) {
      suspiciousBytes += 1;
    }
  }
  return maxScan > 0 ? suspiciousBytes / maxScan > 0.2 : false;
}

describe("public contract", () => {
  it("keeps the package root focused on the runtime facade and public types", async () => {
    type PublicApiSmoke = {
      adapter: AgentAdapterDef;
      agent: DetectedAgent;
      detect: DetectOptions;
      runtime: AgentRuntime;
      runtimeOptions: RuntimeOptions;
      runRequest: RunRequest;
      runHandle: RunHandle;
      runRecord: RunRecord;
      goalRequest: CreateGoalRequest;
      goalHandle: GoalHandle;
      goalRecord: GoalRecord;
      agentEvent: AgentEvent;
      schedulerEvent: SchedulerEvent;
      replay: ReplayEvent<AgentEvent>;
      diagnostic: RuntimeDiagnostic;
      inspectStoreOptions: InspectStoreOptions;
      storeHealth: StoreHealth;
      storeRepairAction: StoreRepairAction;
      storeRepairReport: StoreRepairReport;
      diagnosticsRequest: ExportDiagnosticsRequest;
      diagnosticsBundle: DiagnosticsBundle;
      eventScope: EventScope;
      eventTerminalContract: EventTerminalContract;
      eventTerminalReason: EventTerminalReason;
      eventEnvelope: VersionedEventEnvelope<AgentEvent>;
    };
    const smoke = undefined as unknown as PublicApiSmoke;
    expect(typeof createAgentRuntime).toBe("function");
    expect(smoke).toBeUndefined();
    expect(Object.keys(await import("../src/index.js"))).toEqual(["createAgentRuntime"]);

    const runtime = createAgentRuntime();
    expect(typeof runtime.replayRunEvents).toBe("function");
    expect(typeof runtime.replayGoalEvents).toBe("function");
  });

  it("keeps the built package root free of internal value exports and storage type re-exports", async () => {
    const built = await import("../dist/index.js");
    const declaration = await readFile(path.join(root, "dist", "index.d.ts"), "utf8");

    expect(Object.keys(built)).toEqual(["createAgentRuntime"]);
    expect(declaration).toContain("./public-types.js");
    expect(declaration).not.toContain("./storage/");
    expect(declaration).not.toContain("./parsers/");
    expect(declaration).not.toContain("./adapters/registry");
  });

  it("prints CLI help with all frozen commands and key flags", async () => {
    const { stdout } = await execFileP(process.execPath, [cli, "help"]);
    for (const word of [
      "agents",
      "doctor",
      "smoke",
      "conformance",
      "run",
      "goal",
      "runs",
      "run-status",
      "replay-run",
      "goals",
      "goal-status",
      "replay-goal",
      "store-health",
      "store-lock",
      "store-repair",
      "diagnostics run",
      "diagnostics goal",
      "--json",
      "--jsonl",
      "--out",
      "--stream jsonl",
      "--diagnostics",
      "--storage-dir",
      "--storage-durability",
      "--dry-run",
      "--status",
      "--after",
      "--max-concurrent-tasks",
      "--max-attempts",
      "--retryable-error-codes",
      "--retry-backoff-ms",
      "--allow-real-run",
      "--expect-text",
      "--prompt-file",
    ]) {
      expect(stdout).toContain(word);
    }
  }, 30_000);

  it("runs offline parser fixture smoke through the CLI", async () => {
    const smoke = JSON.parse((await execFileP(process.execPath, [cli, "smoke", "--mode", "fixtures", "--json"])).stdout);
    expect(smoke).toMatchObject({ ok: true, mode: "fixtures" });
    expect(smoke.fixtures).toHaveLength(24);
  }, 30_000);

  it("runs offline conformance fixtures with stable adapter summaries", async () => {
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "fixtures",
      "--json",
    ])).stdout);

    expect(conformance).toMatchObject({
      schemaVersion: "agent-runtime.conformance.v1",
      ok: true,
      mode: "fixtures",
      agents: [
        {
          adapter: "codex",
          version: null,
          auth: "not_checked",
          modelsSource: "fixtures",
          runClassification: "success",
          expectedTextMatched: null,
          cwdMutated: null,
          diagnosticsCount: 0,
          skippedReason: null,
        },
        expect.objectContaining({ adapter: "claude", runClassification: "success" }),
        expect.objectContaining({ adapter: "opencode", runClassification: "success" }),
      ],
    });
  }, 30_000);

  it("runs fake conformance through real adapter argv and parsers", async () => {
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "fake",
      "--json",
    ])).stdout);

    expect(conformance).toMatchObject({
      schemaVersion: "agent-runtime.conformance.v1",
      ok: true,
      mode: "fake",
      agents: [
        expect.objectContaining({
          adapter: "codex",
          version: "codex-cli fake-conformance",
          auth: "unknown",
          modelsSource: "live",
          runClassification: "success",
          expectedTextMatched: true,
          cwdMutated: false,
          skippedReason: null,
        }),
        expect.objectContaining({
          adapter: "claude",
          auth: "ok",
          modelsSource: "fallback",
          runClassification: "success",
          expectedTextMatched: true,
          cwdMutated: false,
        }),
        expect.objectContaining({
          adapter: "opencode",
          modelsSource: "live",
          runClassification: "success",
          expectedTextMatched: true,
          cwdMutated: false,
        }),
      ],
    });
  }, 30_000);

  it("keeps core CLI --json success contracts parseable", async () => {
    const storageDir = await tempDir("agent-runtime-cli-contract-");

    const agents = await execCliJson<DetectedAgent[]>(["agents", "--json"]);
    const doctor = await execCliJson<{ ok: boolean; agents: DetectedAgent[] }>(["doctor", "--json"]);
    const fixtureConformance = await execCliJson<{ schemaVersion: string; ok: boolean; mode: string }>([
      "conformance",
      "--mode",
      "fixtures",
      "--json",
    ]);
    const fakeConformance = await execCliJson<{ schemaVersion: string; ok: boolean; mode: string }>([
      "conformance",
      "--mode",
      "fake",
      "--json",
    ]);
    const health = await execCliJson<StoreHealth>(["store-health", "--storage-dir", storageDir, "--json"]);
    const repair = await execCliJson<StoreRepairReport>(["store-repair", "--storage-dir", storageDir, "--dry-run", "--json"]);

    expect(Array.isArray(agents)).toBe(true);
    expect(doctor).toMatchObject({ ok: expect.any(Boolean), agents: expect.any(Array) });
    expect(fixtureConformance).toMatchObject({
      schemaVersion: "agent-runtime.conformance.v1",
      ok: true,
      mode: "fixtures",
    });
    expect(fakeConformance).toMatchObject({
      schemaVersion: "agent-runtime.conformance.v1",
      ok: true,
      mode: "fake",
    });
    expect(health).toMatchObject({
      ok: true,
      totals: { runs: 0, goals: 0 },
      lock: { status: "missing" },
    });
    expect(repair).toMatchObject({
      schemaVersion: "agent-runtime.storeRepair.v1",
      dryRun: true,
      applied: false,
      ok: true,
      actions: [],
    });
  }, 60_000);

  it("keeps CLI --json error contracts short, parseable, and redacted", async () => {
    const storageDir = await tempDir("agent-runtime-cli-error-");
    const secret = `sk-${"A".repeat(24)}`;
    const privateCwd = await tempDir("private-cli-error-");
    const failures = [
      await execCliFailure(["run", "--json"]),
      await execCliFailure(["store-health", "--json"]),
      await execCliFailure(["store-repair", "--storage-dir", storageDir, "--apply", "--dry-run", "--json"]),
      await execCliFailure([`unknown-${secret}`, "--prompt", `prompt ${secret} ${privateCwd}`, "--cwd", privateCwd, "--json"]),
    ];

    for (const failure of failures) {
      const parsed = JSON.parse(failure.stdout) as { ok: false; error: { code: string; message: string } };
      const text = `${failure.stdout}\n${failure.stderr}`;
      expect(failure.code).toBe(1);
      expect(failure.stderr).toBe("");
      expect(parsed).toMatchObject({
        ok: false,
        error: {
          code: "CLI_USAGE_ERROR",
          message: expect.any(String),
        },
      });
      expect(parsed.error.message.length).toBeLessThan(240);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(privateCwd);
      expect(text).not.toContain(`prompt ${secret}`);
    }
  }, 30_000);

  it("certifies real conformance preflight without launching runs unless --allow-real-run is explicit", async () => {
    const binDir = await tempDir();
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli preflight"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-preflight", display_name: "GPT Preflight" }] })); process.exit(0); }
console.error("real run should not launch without --allow-real-run");
process.exit(66);
`);
    const conformance = await execCliJson([
      "conformance",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(conformance).toMatchObject({
      schemaVersion: "agent-runtime.conformance.v1",
      ok: true,
      mode: "real",
      agents: [expect.objectContaining({
        adapter: "codex",
        version: "codex-cli preflight",
        resolvedExecutable: expect.any(String),
        auth: "unknown",
        modelsSource: "live",
        capabilities: expect.objectContaining({ streaming: true, prompt: ["stdin"] }),
        argvProfile: expect.objectContaining({
          defaultArgs: expect.arrayContaining(["exec", "--json", "-C", "<cwd>"]),
          knownFlags: expect.arrayContaining([expect.objectContaining({ flag: "--json", status: "known" })]),
          needsVerification: expect.arrayContaining([expect.objectContaining({ mapsTo: "session" })]),
        }),
        promptTransport: "stdin:text",
        parserMode: "codex-json",
        runClassification: "real_run_skipped",
        expectedTextMatched: null,
        observedTextTail: null,
        cwdMutated: null,
        diagnosticsCount: 0,
        diagnostics: [],
        skippedReason: "real_run_not_allowed",
        failureReason: null,
      })],
    });
  }, 30_000);

  it("does not pass real conformance when the selected adapter only skips", async () => {
    const binDir = await tempDir();
    await writeShellExecutable(binDir, "claude", `
if [ "$1" = "--version" ]; then
  echo "2.1.178 (Claude Code)"
  exit 0
fi
if [ "$1" = "-p" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' "--include-partial-messages" "--add-dir"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'
  exit 0
fi
exit 66
`);
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "real",
      "--agent",
      "claude",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_BIN: path.join(binDir, "claude"),
      },
    })).stdout);

    expect(conformance).toMatchObject({
      schemaVersion: "agent-runtime.conformance.v1",
      ok: false,
      mode: "real",
      agents: [expect.objectContaining({
        adapter: "claude",
        runClassification: "auth_missing",
        skippedReason: "auth_missing",
      })],
    });
  }, 60_000);

  it("keeps all-agent conformance summaries when one adapter skips", async () => {
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    await writeShellExecutable(binDir, "claude", `
if [ "$1" = "--version" ]; then
  echo "2.1.178 (Claude Code)"
  exit 0
fi
if [ "$1" = "-p" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' "--include-partial-messages" "--add-dir"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'
  exit 0
fi
exit 66
`);
    const fakeOpenCode = `
if [ "$1" = "--version" ]; then
  echo "opencode test"
  exit 0
fi
if [ "$1" = "models" ]; then
  echo "openai/gpt-test"
  exit 0
fi
echo '{"type":"step_start"}'
`;
    await writeShellExecutable(binDir, "opencode", fakeOpenCode);
    await writeShellExecutable(binDir, "opencode-cli", fakeOpenCode);
    const conformance = JSON.parse((await execFileP(process.execPath, [
      cli,
      "conformance",
      "--mode",
      "real",
      "--agent",
      "all",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CODEX_BIN: path.join(binDir, "codex"),
        CLAUDE_BIN: path.join(binDir, "claude"),
        OPENCODE_BIN: path.join(binDir, "opencode"),
      },
    })).stdout);
    expect(conformance.agents).toHaveLength(3);
    expect(conformance.schemaVersion).toBe("agent-runtime.conformance.v1");
    expect(conformance.agents.find((agent: { adapter: string }) => agent.adapter === "codex")).toMatchObject({
      runClassification: "success",
      skippedReason: null,
    });
    expect(conformance.agents.find((agent: { adapter: string }) => agent.adapter === "claude")).toMatchObject({
      runClassification: "auth_missing",
      skippedReason: "auth_missing",
    });
    expect(conformance.agents.find((agent: { adapter: string }) => agent.adapter === "opencode")).toMatchObject({
      runClassification: "unexpected_output",
      skippedReason: null,
    });
    expect(conformance.ok).toBe(false);
  }, 60_000);

  it("reports unsupported flag drift without crashing all-agent conformance", async () => {
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    await writeShellExecutable(binDir, "claude", `
if [ "$1" = "--version" ]; then
  echo "Claude Code drift-test"
  exit 0
fi
if [ "$1" = "-p" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' "--include-partial-messages"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":true}'
  exit 0
fi
echo "real run should not launch when an unsupported tracked flag is detected" >&2
exit 66
`);
    const conformance = await execCliJson<{
      ok: boolean;
      agents: Array<{ adapter: string; runClassification: string; skippedReason: string | null; diagnostics: Array<{ code: string; actionableHints?: string[] }> }>;
    }>([
      "conformance",
      "--mode",
      "real",
      "--agent",
      "all",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CODEX_BIN: path.join(binDir, "codex"),
        CLAUDE_BIN: path.join(binDir, "claude"),
        OPENCODE_BIN: path.join(binDir, "missing-opencode"),
      },
    });

    const codex = conformance.agents.find((item) => item.adapter === "codex");
    const claude = conformance.agents.find((item) => item.adapter === "claude");
    expect(conformance.ok).toBe(true);
    expect(codex).toMatchObject({ runClassification: "real_run_skipped", skippedReason: "real_run_not_allowed" });
    expect(claude).toMatchObject({ runClassification: "unsupported_flag", skippedReason: "unsupported_flag" });
    expect(claude?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "unsupported_flag",
        actionableHints: expect.arrayContaining([expect.stringContaining("Do not guess")]),
      }),
    ]));
  }, 60_000);

  it("marks unfamiliar version output as needs_verification without inventing new flags", async () => {
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("mystery-runtime build local"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-drift", display_name: "GPT Drift" }] })); process.exit(0); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
});
`);
    const conformance = await execCliJson<{
      agents: Array<{ diagnostics: Array<{ code: string; actionableHints?: string[] }>; argvProfile: { needsVerification: Array<{ mapsTo: string }> } }>;
    }>([
      "conformance",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(conformance.agents[0].diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "needs_verification",
        actionableHints: expect.arrayContaining([expect.stringContaining("Verify this CLI version output manually")]),
      }),
    ]));
    expect(conformance.agents[0].argvProfile.needsVerification).toEqual(expect.arrayContaining([
      expect.objectContaining({ mapsTo: "session" }),
      expect.objectContaining({ mapsTo: "authProbe" }),
    ]));
  }, 30_000);

  it("refuses real smoke unless --allow-real-run is explicit", async () => {
    const failure = await execCliFailure(["smoke", "--mode", "real", "--agent", "codex", "--json"]);
    const parsed = JSON.parse(failure.stdout) as { ok: false; error: { message: string } };
    expect(failure).toMatchObject({ code: 1, stderr: "" });
    expect(parsed.error.message).toContain("smoke --mode real requires --allow-real-run");
  }, 30_000);

  it("runs real smoke with --prompt-file without putting long prompts in argv", async () => {
    const binDir = await tempDir();
    const promptFile = path.join(await tempDir(), "prompt.txt");
    const longPrompt = `agent-runtime prompt-file smoke ${"x".repeat(64 * 1024)}`;
    await writeFile(promptFile, longPrompt, "utf8");
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli test"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] })); process.exit(0); }
if (args.join("\\n").includes("agent-runtime prompt-file smoke")) {
  console.error("prompt leaked into argv");
  process.exit(64);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (!input.includes("agent-runtime prompt-file smoke")) {
    console.error("prompt missing from stdin");
    process.exit(65);
  }
  console.log(JSON.stringify({ type: "thread.started" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
});
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--prompt-file",
      promptFile,
      "--timeout-ms",
      "5000",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({ ok: true, mode: "real", agent: "codex", run: { status: "succeeded" } });
    expect(smoke).toMatchObject({ expectedTextRequired: false, expectedTextMatched: null });
    expect(JSON.stringify(smoke)).not.toContain(longPrompt);
  }, 30_000);

  it("requires default real smoke expected text evidence", async () => {
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      ok: true,
      mode: "real",
      agent: "codex",
      classification: "success",
      expectedText: "agent-runtime codex smoke ok",
      expectedTextRequired: true,
      expectedTextMatched: true,
      observedTextTail: "agent-runtime codex smoke ok",
      cwdMutationChecked: true,
      cwdMutated: false,
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("does not classify status-only real smoke exit 0 as success", async () => {
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      ok: false,
      classification: "unexpected_output",
      expectedTextRequired: true,
      expectedTextMatched: false,
      observedTextDeltaCount: 0,
      observedTextTail: "",
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("classifies wrong real smoke text as unexpected_output", async () => {
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "not the expected smoke text" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      ok: false,
      classification: "unexpected_output",
      expectedTextMatched: false,
      observedTextTail: "not the expected smoke text",
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("classifies default isolated cwd mutation as cwd_mutated", async () => {
    const binDir = await tempDir();
    await writeFakeCodexSmoke(binDir, `
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.cwd(), "smoke-output.txt"), "mutated");
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      ok: false,
      classification: "cwd_mutated",
      expectedTextMatched: true,
      cwdMutationChecked: true,
      cwdMutated: true,
      cwdMutationCount: 1,
      cwdMutationSample: [{ path: "smoke-output.txt", action: "created" }],
      run: { status: "succeeded" },
    });
  }, 30_000);

  it("does not require expected text for prompt-file real smoke unless --expect-text is set", async () => {
    const binDir = await tempDir();
    const promptFile = path.join(await tempDir(), "prompt.txt");
    await writeFile(promptFile, "custom prompt-file smoke", "utf8");
    await writeFakeCodexSmoke(binDir, `
const args = process.argv.slice(2);
if (args.join("\\n").includes("custom prompt-file smoke")) {
  console.error("prompt leaked into argv");
  process.exit(64);
}
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "custom prompt-file response" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--prompt-file",
      promptFile,
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      ok: true,
      classification: "success",
      expectedTextRequired: false,
      expectedTextMatched: null,
      observedTextTail: "custom prompt-file response",
      run: { status: "succeeded" },
    });
    expect(JSON.stringify(smoke)).not.toContain("custom prompt-file smoke");
  }, 30_000);

  it("enforces --prompt-file --expect-text real smoke matching", async () => {
    const binDir = await tempDir();
    const promptFile = path.join(await tempDir(), "prompt.txt");
    await writeFile(promptFile, "custom expect prompt", "utf8");
    await writeFakeCodexSmoke(binDir, `
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "custom expected ok" } }));
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--prompt-file",
      promptFile,
      "--expect-text",
      "custom expected ok",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      ok: true,
      classification: "success",
      expectedText: "custom expected ok",
      expectedTextRequired: true,
      expectedTextMatched: true,
    });
  }, 30_000);

  it("redacts observedTextTail, expected text, mutation samples, and cwd in real smoke summaries", async () => {
    const binDir = await tempDir();
    const privateCwd = await tempDir("private-real-smoke-");
    const secret = `sk${"A".repeat(20)}`;
    await writeFakeCodexSmoke(binDir, `
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.cwd(), "token-sk" + "A".repeat(20) + ".txt"), "secret");
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "wrong token sk" + "A".repeat(20) + " cwd=" + process.cwd() } }));
`);
    const smokeStdout = (await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--cwd",
      privateCwd,
      "--expect-text",
      `expected ${secret}`,
      "--stream",
      "jsonl",
      "--diagnostics",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    })).stdout;
    const smoke = smokeStdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line)).at(-1);
    const text = JSON.stringify(smoke);

    expect(smoke).toMatchObject({
      type: "real_smoke_summary",
      classification: "cwd_mutated",
      expectedText: "expected [REDACTED]",
      cwdMutationSample: [{ path: "token-[REDACTED].txt", action: "created" }],
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(privateCwd);
  }, 30_000);

  it("redacts observed text, prompt, auth env, and cwd in real conformance failures", async () => {
    const binDir = await tempDir();
    const privateCwd = await tempDir("private-conformance-");
    const secret = `sk${"A".repeat(20)}`;
    await writeFakeCodexSmoke(binDir, `
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.cwd(), "token-sk" + "A".repeat(20) + ".txt"), "secret");
console.log(JSON.stringify({ type: "thread.started" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "wrong tail token sk" + "A".repeat(20) + " cwd=" + process.cwd() } }));
`);
    const conformance = await execCliJson<{
      ok: boolean;
      agents: Array<{ runClassification: string; expectedTextMatched: boolean; observedTextTail: string; cwdMutated: boolean; failureReason: string }>;
    }>([
      "conformance",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--cwd",
      privateCwd,
      "--prompt",
      `prompt contains ${secret} and cwd ${privateCwd}`,
      "--expect-text",
      `expected ${secret}`,
      "--json",
    ], {
      env: fakeCliEnv(binDir, {
        CODEX_BIN: path.join(binDir, "codex"),
        ANTHROPIC_AUTH_TOKEN: secret,
      }),
    });
    const text = JSON.stringify(conformance);

    expect(conformance).toMatchObject({
      ok: false,
      agents: [expect.objectContaining({
        runClassification: "cwd_mutated",
        expectedTextMatched: false,
        observedTextTail: expect.stringContaining("[REDACTED]"),
        cwdMutated: true,
        failureReason: "cwd_mutated",
      })],
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(privateCwd);
    expect(text).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(text).not.toContain("prompt contains");
  }, 30_000);

  it("classifies real smoke auth-missing preflight without launching Claude", async () => {
    const binDir = await tempDir();
    await writeExecutable(binDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.178 (Claude Code)"); process.exit(0); }
if (args[0] === "-p" && args[1] === "--help") { console.log("--include-partial-messages\\n--add-dir"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }));
  process.exit(0);
}
console.error("real run should not launch when auth is missing");
process.exit(66);
`);
    const smoke = JSON.parse((await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "claude",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_BIN: path.join(binDir, "claude"),
      },
    })).stdout);

    expect(smoke).toMatchObject({
      ok: false,
      mode: "real",
      agent: "claude",
      classification: "auth_missing",
      skipped: true,
      detection: { available: true, authStatus: "missing" },
    });
    expect(smoke.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "auth_missing" })]));
  }, 30_000);

  it("classifies real smoke unavailable executables before launch", async () => {
    const missing = path.join(await tempDir(), "missing-codex");
    const smoke = JSON.parse((await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: {
        ...process.env,
        PATH: "",
        CODEX_BIN: missing,
      },
    })).stdout);

    expect(smoke).toMatchObject({
      ok: false,
      mode: "real",
      agent: "codex",
      classification: "unavailable_executable",
      skipped: true,
      detection: { available: false },
    });
    expect(smoke.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "not_installed" })]));
  }, 30_000);

  it("keeps Claude auth missing as a doctor diagnostic without failing doctor", async () => {
    const binDir = await tempDir();
    await writeShellExecutable(binDir, "claude", `
if [ "$1" = "--version" ]; then
  echo "2.1.178 (Claude Code)"
  exit 0
fi
if [ "$1" = "-p" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' "--include-partial-messages" "--add-dir"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'
  exit 0
fi
exit 0
`);
    const doctor = JSON.parse((await execFileP(process.execPath, [cli, "doctor", "--json"], {
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_BIN: path.join(binDir, "claude"),
        CODEX_BIN: path.join(binDir, "missing-codex"),
        OPENCODE_BIN: path.join(binDir, "missing-opencode"),
      },
    })).stdout);
    const claude = doctor.agents.find((agent: { id: string }) => agent.id === "claude");
    expect(doctor.ok).toBe(true);
    expect(claude).toMatchObject({ available: true, authStatus: "missing" });
    expect(claude.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "auth_missing" })]));
  }, 30_000);

  it("prints final run records and JSONL diagnostics without requiring a real CLI", async () => {
    const cwd = await tempDir();
    const jsonRun = JSON.parse((await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      "missing-adapter",
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--json",
    ])).stdout) as RunRecord;
    const jsonl = (await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      "missing-adapter",
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--stream",
      "jsonl",
      "--diagnostics",
    ])).stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as { type?: string; event?: { type?: string }; summary?: RunRecord });

    expect(jsonRun).toMatchObject({ agentId: "missing-adapter", status: "failed", errorCode: "AGENT_UNAVAILABLE" });
    expect(jsonl.some((event) => event.event?.type === "run_finished")).toBe(true);
    expect(jsonl.find((event) => event.event?.type === "run_finished")).toMatchObject({
      schemaVersion: "agent-runtime.event.v1",
      scope: { kind: "run" },
      terminal: { result: "failed", reason: "unavailable" },
    });
    expect(jsonl.at(-1)).toMatchObject({ type: "run_summary", summary: { status: "failed", errorCode: "AGENT_UNAVAILABLE" } });
  }, 30_000);

  it("redacts concise CLI errors", async () => {
    const secretCommand = `unknown-${"sk" + "A".repeat(20)}`;
    await expect(execFileP(process.execPath, [cli, secretCommand])).rejects.toMatchObject({
      stderr: expect.stringContaining("[REDACTED]"),
    });
  }, 30_000);

  it("redacts runtime-emitted CLI errors and summaries", async () => {
    const cwd = await tempDir();
    const secretAgent = `missing-${"sk" + "A".repeat(20)}`;
    const human = await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      secretAgent,
      "--cwd",
      cwd,
      "--prompt",
      "hello",
    ]);
    const json = await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      secretAgent,
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--json",
    ]);
    const jsonl = await execFileP(process.execPath, [
      cli,
      "run",
      "--agent",
      secretAgent,
      "--cwd",
      cwd,
      "--prompt",
      "hello",
      "--stream",
      "jsonl",
      "--diagnostics",
    ]);

    for (const output of [`${human.stdout}\n${human.stderr}`, json.stdout, jsonl.stdout]) {
      expect(output).toContain("[REDACTED]");
      expect(output).not.toContain(secretAgent);
    }
  }, 30_000);

  it("writes diagnostics bundles through --out without leaking secrets", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_cli_bundle";
    const runDir = path.join(storageDir, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "fake",
      cwd: "/tmp/private-cli-tail",
      status: "failed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: 1,
      signal: null,
      error: "Bearer " + "B".repeat(20),
      errorCode: "AGENT_EXECUTION_FAILED",
      diagnostics: [{ code: "AGENT_EXECUTION_FAILED", message: "ANTHROPIC_AUTH_TOKEN=secret-value" }],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), "", "utf8");
    const outFile = path.join(await tempDir("agent-runtime-out-"), "bundle.json");
    const health = JSON.parse((await execFileP(process.execPath, [
      cli,
      "store-health",
      "--storage-dir",
      storageDir,
      "--json",
    ])).stdout) as StoreHealth;
    const lock = JSON.parse((await execFileP(process.execPath, [
      cli,
      "store-lock",
      "--storage-dir",
      storageDir,
      "--json",
    ])).stdout);

    const stdout = JSON.parse((await execFileP(process.execPath, [
      cli,
      "diagnostics",
      "run",
      runId,
      "--storage-dir",
      storageDir,
      "--json",
      "--out",
      outFile,
    ])).stdout) as DiagnosticsBundle;
    const writtenText = await readFile(outFile, "utf8");
    const written = JSON.parse(writtenText) as DiagnosticsBundle;
    const leftovers = await readdir(path.dirname(outFile));

    expect(health).toMatchObject({ totals: { runs: 1, goals: 0 }, lock: { status: "missing" } });
    expect(lock).toMatchObject({ status: "missing", file: "runtime.lock.json" });
    expect(written).toMatchObject({ subject: { kind: "run", id: runId } });
    expect(stdout.subject).toEqual(written.subject);
    expect(leftovers).toEqual(["bundle.json"]);
    expect(writtenText).toContain("[REDACTED]");
    expect(writtenText).not.toContain("Bearer");
    expect(writtenText).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(writtenText).not.toContain("private-cli-tail");
  }, 30_000);

  it("prints redacted store-repair dry-run actions without applying changes", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_cli_repair";
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
    const eventsFile = path.join(runDir, "events.jsonl");
    const original = `${JSON.stringify({ id: 1, sequence: 1, timestamp: Date.now(), event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp/private-cli-repair", timestamp: Date.now() } })}\n{"id":2,"token":"Bearer ${"B".repeat(20)}","cwd":"/tmp/private-cli-repair"`;
    await writeFile(eventsFile, original, "utf8");

    const repair = JSON.parse((await execFileP(process.execPath, [
      cli,
      "store-repair",
      "--storage-dir",
      storageDir,
      "--dry-run",
      "--json",
    ])).stdout);
    const after = await readFile(eventsFile, "utf8");
    const text = JSON.stringify(repair);

    expect(repair).toMatchObject({
      schemaVersion: "agent-runtime.storeRepair.v1",
      dryRun: true,
      applied: false,
      ok: false,
      actions: expect.arrayContaining([expect.objectContaining({ action: "truncate_partial_tail", id: runId, applied: false })]),
    });
    expect(after).toBe(original);
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("private-cli-repair");
  }, 30_000);

  it("applies store-repair from the CLI only when --apply is explicit", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_cli_repair_apply";
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
    const eventsFile = path.join(runDir, "events.jsonl");
    const first = JSON.stringify({ id: 1, sequence: 1, timestamp: Date.now(), event: { type: "run_started", runId, agentId: "fake", cwd: "/tmp/private-cli-apply", timestamp: Date.now() } });
    const second = JSON.stringify({ id: 2, sequence: 2, timestamp: Date.now(), event: { type: "run_finished", result: "success", exitCode: 0, signal: null, timestamp: Date.now() } });
    const original = `${first}\n${second}\n{"id":3,"token":"Bearer ${"B".repeat(20)}","cwd":"/tmp/private-cli-apply"`;
    await writeFile(eventsFile, original, "utf8");

    const dryRun = JSON.parse((await execFileP(process.execPath, [
      cli,
      "store-repair",
      "--storage-dir",
      storageDir,
      "--json",
    ])).stdout) as StoreRepairReport;
    const afterDryRun = await readFile(eventsFile, "utf8");
    const apply = JSON.parse((await execFileP(process.execPath, [
      cli,
      "store-repair",
      "--storage-dir",
      storageDir,
      "--apply",
      "--json",
    ])).stdout) as StoreRepairReport;
    const afterApply = await readFile(eventsFile, "utf8");

    expect(dryRun).toMatchObject({
      schemaVersion: "agent-runtime.storeRepair.v1",
      dryRun: true,
      applied: false,
      actions: expect.arrayContaining([expect.objectContaining({ action: "truncate_partial_tail", applied: false })]),
    });
    expect(afterDryRun).toBe(original);
    expect(apply).toMatchObject({
      dryRun: false,
      applied: true,
      ok: true,
      actions: [expect.objectContaining({ applied: true, backupPath: expect.stringContaining("repair-backups/") })],
    });
    expect(afterApply).toBe(`${first}\n${second}\n`);
  }, 30_000);

  it("redacts diagnostics bundle secret tails deterministically", async () => {
    const storageDir = await tempDir("agent-runtime-storage-");
    const runId = "run_cli_bundle_redaction";
    const runDir = path.join(storageDir, "runs", runId);
    const privateCwd = await tempDir("private-diagnostics-");
    const secret = `sk${"A".repeat(20)}`;
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "manifest.json"), JSON.stringify({
      id: runId,
      agentId: "codex",
      cwd: privateCwd,
      status: "failed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: null,
      signal: "SIGTERM",
      error: `Run timed out with token ${secret}`,
      errorCode: "AGENT_TIMEOUT",
      diagnostics: [{
        code: "AGENT_TIMEOUT",
        message: `timeout cwd=${privateCwd} token ${secret}`,
        stdoutTail: `stdout ${secret}`,
        stderrTail: `stderr cwd=${privateCwd} Bearer ${"B".repeat(20)}`,
        argv: ["exec", "--cwd", privateCwd, secret],
      }],
    }), "utf8");
    await writeFile(path.join(runDir, "events.jsonl"), "", "utf8");

    const bundle = await execCliJson<DiagnosticsBundle>([
      "diagnostics",
      "run",
      runId,
      "--storage-dir",
      storageDir,
      "--json",
    ]);
    const text = JSON.stringify(bundle);

    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(privateCwd);
    expect(text).not.toContain("Bearer");
  }, 30_000);

  it("exports redacted diagnostics for a real smoke timeout run", async () => {
    const binDir = await tempDir();
    const storageDir = await tempDir("agent-runtime-storage-");
    const privateCwd = await tempDir("private-real-smoke-");
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli test"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] })); process.exit(0); }
console.log(JSON.stringify({ type: "thread.started" }));
  require("node:fs").writeSync(2, "network ETIMEDOUT cwd=" + process.cwd() + " token sk" + "A".repeat(20) + "\\n");
setInterval(() => {}, 1000);
`);
    const smoke = JSON.parse((await execFileP(process.execPath, [
      cli,
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--cwd",
      privateCwd,
      "--timeout-ms",
      "300",
      "--storage-dir",
      storageDir,
      "--json",
      "--diagnostics",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
      timeout: 10_000,
    })).stdout);
    const runId = smoke.run?.id ?? (await waitForRunId(storageDir));
    if (runId === undefined) {
      throw new Error("Expected a run id from real smoke output or storage scan");
    }
    const bundle = JSON.parse((await execFileP(process.execPath, [
      cli,
      "diagnostics",
      "run",
      runId,
      "--storage-dir",
      storageDir,
      "--json",
    ])).stdout) as DiagnosticsBundle;
    const text = JSON.stringify(bundle);

    expect(smoke).toMatchObject({ ok: false, mode: "real", run: { status: "failed", errorCode: "AGENT_TIMEOUT" } });
    expect(bundle.adapterSummary).toMatchObject({
      kind: "run",
      agentId: "codex",
      status: "failed",
      errorCode: "AGENT_TIMEOUT",
      promptTransport: "stdin:text",
      parsedEventCount: expect.any(Number),
    });
    expect(text).not.toContain(privateCwd);
    expect(text).not.toContain(`sk${"A".repeat(20)}`);
  }, 30_000);

  it("keeps reference material out of the npm package dry-run", async () => {
    const { stdout } = await execFileP("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root });
    const packed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = packed.flatMap((entry) => entry.files.map((file) => file.path));
    expect(files).toContain("LICENSE");
    expect(files).toContain("README.md");
    expect(files).toContain("examples/library-run.js");
    expect(files).toContain("examples/library-goal.js");
    expect(files).toContain("examples/cli-dogfood.md");
    expect(files).toContain("docs/production-readiness.md");
    expect(files).toContain("docs/release-report.md");
    expect(files).not.toContainEqual(expect.stringMatching(/^\.reference\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\/secrets/u));
    expect(files).not.toContainEqual(expect.stringMatching(/^docs\/fixtures\//u));
    expect(stdout).not.toContain(`sk${"A".repeat(20)}`);
  });

  it("keeps remote CI and release-candidate workflows audit-only and artifact-focused", async () => {
    const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const releaseCandidate = await readFile(path.join(root, ".github", "workflows", "release-candidate.yml"), "utf8");
    const ciCompact = ci.replace(/\s+/gu, "");

    expect(ciCompact).toContain("node-version:[20.x,22.x,24.x]");
    for (const requiredStep of [
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run build",
      "npm audit --omit=dev",
      "npm run package:check",
      "npm pack --dry-run",
    ]) {
      expect(ci).toContain(requiredStep);
    }
    expect(ci.match(/npm run dogfood/gu)).toHaveLength(1);
    expect(ci).toContain("Dogfood gate on Node.js 22.x");
    expect(ci).not.toContain("--allow-real-run");
    expect(ci).not.toMatch(/\bnpm publish\b/u);
    expect(ci).not.toContain("NODE_AUTH_TOKEN");

    expect(releaseCandidate).toMatch(/on:\n\s+workflow_dispatch:/u);
    expect(releaseCandidate).toContain("npm run ci");
    expect(releaseCandidate).toContain("npm run dogfood");
    expect(releaseCandidate).toContain("npm pack --json");
    expect(releaseCandidate).toContain("release-candidate/npm-pack.json");
    expect(releaseCandidate).toContain("release-candidate/package-files.txt");
    expect(releaseCandidate).toContain("Validate package file list");
    expect(releaseCandidate).toContain("actions/upload-artifact@v4");
    expect(releaseCandidate).toContain("agent-cli-runtime-tarball");
    expect(releaseCandidate).toContain("agent-cli-runtime-pack-metadata");
    expect(releaseCandidate).toContain("agent-cli-runtime-package-files");
    expect(releaseCandidate).toContain("retention-days: 14");
    expect(releaseCandidate).not.toMatch(/\bnpm publish\b/u);
    expect(releaseCandidate).not.toContain("NODE_AUTH_TOKEN");
    expect(releaseCandidate).not.toContain("--allow-real-run");
  });

  it("documents publish dry-run with the alpha dist-tag instead of latest", async () => {
    const docs = [
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/compatibility.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/ssot.md",
    ];

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).not.toMatch(/npm publish --dry-run --ignore-scripts(?! --tag alpha)/u);
    }
  });

  it("runs the shipped library examples without real agent credentials", async () => {
    const run = JSON.parse((await execFileP(process.execPath, [path.join(root, "examples", "library-run.js")], { cwd: root })).stdout);
    const goal = JSON.parse((await execFileP(process.execPath, [path.join(root, "examples", "library-goal.js")], { cwd: root })).stdout);

    expect(run).toMatchObject({
      run: { status: "succeeded" },
      diagnosticsSchema: "agent-runtime.diagnostics.v1",
      storeOk: true,
    });
    expect(run.detected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "codex", available: true }),
      expect.objectContaining({ id: "claude", available: false }),
      expect.objectContaining({ id: "opencode", available: false }),
    ]));
    expect(goal).toMatchObject({
      goal: { status: "succeeded", result: "success" },
      diagnosticsSchema: "agent-runtime.diagnostics.v1",
    });
    expect(goal.tasks).toEqual([expect.objectContaining({ id: "T001", status: "succeeded", attempts: 1 })]);
  }, 60_000);

  it("supports package install smoke from npm pack tarball", async () => {
    const tempProject = await tempDir("agent-runtime-install-smoke-");
    const packInfoText = (await execFileP("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tempProject], { cwd: root }))
      .stdout.trim();
    const [packInfo] = JSON.parse(packInfoText) as Array<{ filename: string }>;
    const tarball = path.join(tempProject, packInfo.filename);
    const tarEntries = (await execFileP("tar", ["-tf", packInfo.filename], { cwd: tempProject })).stdout.split(/\r?\n/u);

    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/\.reference\//u));
    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/tests\//u));
    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/tests\/fixtures\//u));
    expect(tarEntries).not.toContainEqual(expect.stringMatching(/^package\/docs\/fixtures\//u));

    await execFileP("npm", ["init", "-y"], { cwd: tempProject });
    await execFileP("npm", ["install", tarball, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tempProject });
    const installedFakeBinDir = path.join(tempProject, "fake-bin");
    await mkdir(installedFakeBinDir, { recursive: true });
    await writeShellExecutable(installedFakeBinDir, "codex", `
if [ "$1" = "--version" ]; then
  echo "codex-cli install-smoke"
  exit 0
fi
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  echo '{"models":[{"slug":"gpt-install-smoke","display_name":"GPT Install Smoke"}]}'
  exit 0
fi
exit 0
`);
    await writeShellExecutable(installedFakeBinDir, "claude", `
if [ "$1" = "--version" ]; then
  echo "Claude Code install-smoke"
  exit 0
fi
if [ "$1" = "-p" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' "--include-partial-messages" "--add-dir"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":true}'
  exit 0
fi
exit 0
`);
    const installedOpenCode = `
if [ "$1" = "--version" ]; then
  echo "opencode install-smoke"
  exit 0
fi
if [ "$1" = "models" ]; then
  echo "openai/gpt-install-smoke"
  exit 0
fi
exit 0
`;
    await writeShellExecutable(installedFakeBinDir, "opencode", installedOpenCode);
    await writeShellExecutable(installedFakeBinDir, "opencode-cli", installedOpenCode);
    await writeExecutable(installedFakeBinDir, "consumer-agent", `
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("consumer-agent 1.0.0");
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (input.includes("Return strict JSON")) {
    console.log(JSON.stringify({ tasks: [
      { id: "T001", title: "Consumer task", objective: "consumer task run", dependencies: [], validationCommands: ["node -e \\"process.exit(0)\\""] }
    ] }));
    return;
  }
  console.log("consumer fake run ok");
});
`);
    const installedEnv = {
      ...process.env,
      PATH: `${installedFakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      CODEX_BIN: path.join(installedFakeBinDir, "codex"),
      CLAUDE_BIN: path.join(installedFakeBinDir, "claude"),
      OPENCODE_BIN: path.join(installedFakeBinDir, "opencode"),
    };

    const imported = await execFileP(process.execPath, [
      "-e",
      "import('agent-cli-runtime').then((m) => {\n" +
        "if (typeof m.createAgentRuntime !== 'function') process.exit(1);\n" +
        "console.log(typeof m.createAgentRuntime);\n" +
        "}).catch(() => process.exit(1));\n",
    ], {
      cwd: tempProject,
    });
    await writeFile(path.join(tempProject, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        lib: ["ES2022", "DOM"],
        noEmit: true,
      },
      include: ["consumer.ts"],
    }, null, 2), "utf8");
    await writeFile(path.join(tempProject, "consumer.ts"), `
import {
  createAgentRuntime,
  type AgentAdapterDef,
  type AgentEvent,
  type CreateGoalRequest,
  type DiagnosticsBundle,
  type ReplayEvent,
  type RunRequest,
  type RuntimeOptions,
  type StoreHealth,
} from "agent-cli-runtime";

const adapter: AgentAdapterDef = {
  id: "consumer-fake",
  displayName: "Consumer Fake",
  bin: "consumer-agent",
  versionArgs: ["--version"],
  fallbackModels: [{ id: "default", label: "Default" }],
  buildArgs: () => [],
  promptTransport: { kind: "stdin", inputFormat: "text" },
  stream: {
    create: () => ({
      parse: (chunk: string) => [{ type: "text_delta", text: chunk }],
      flush: () => [],
    }),
  },
};

const runRequest: RunRequest = {
  agentId: "consumer-fake",
  cwd: ".",
  prompt: "consumer run",
};
const goalRequest: CreateGoalRequest = {
  defaultAgentId: "consumer-fake",
  cwd: ".",
  objective: "consumer goal",
};
const options: RuntimeOptions = {
  adapters: [adapter],
  searchPath: ["."],
  storageDir: "./consumer-store",
};
const runtime = createAgentRuntime(options);
const health: Promise<StoreHealth> = runtime.inspectStore();
const diagnostics: Promise<DiagnosticsBundle> = runtime.exportDiagnostics({ kind: "run", runId: "run_missing" });
const replay: ReplayEvent<AgentEvent>[] = [];

void runRequest;
void goalRequest;
void health;
void diagnostics;
void replay;
void runtime.shutdown();
`, "utf8");
    await writeFile(path.join(tempProject, "consumer.mjs"), `
import { createAgentRuntime } from "agent-cli-runtime";

const fakeBin = ${JSON.stringify(installedFakeBinDir)};
const cwd = process.cwd();
const storageDir = cwd + "/consumer-store";

const adapter = {
  id: "consumer-fake",
  displayName: "Consumer Fake",
  bin: "consumer-agent",
  versionArgs: ["--version"],
  fallbackModels: [{ id: "default", label: "Default" }],
  buildArgs: () => [],
  promptTransport: { kind: "stdin", inputFormat: "text" },
  stream: {
    create: () => ({
      parse: (chunk) => chunk.split(/\\r?\\n/u).filter(Boolean).map((line) => ({ type: "text_delta", text: line + "\\n" })),
      flush: () => [],
    }),
  },
};

const runtime = createAgentRuntime({
  adapters: [adapter],
  searchPath: [fakeBin],
  storageDir,
});

const runHandle = await runtime.run({ agentId: "consumer-fake", cwd, prompt: "consumer run" });
for await (const _event of runHandle.events) {}
const run = await runtime.getRun(runHandle.runId);
const runReplay = await runtime.replayRunEvents(runHandle.runId);
const runDiagnostics = await runtime.exportDiagnostics({ kind: "run", runId: runHandle.runId });

const goalHandle = await runtime.createGoal({ defaultAgentId: "consumer-fake", cwd, objective: "consumer goal" });
for await (const _event of goalHandle.events) {}
const goal = await runtime.getGoal(goalHandle.goalId);
const goalReplay = await runtime.replayGoalEvents(goalHandle.goalId);
const goalDiagnostics = await runtime.exportDiagnostics({ kind: "goal", goalId: goalHandle.goalId });
const health = await runtime.inspectStore();
await runtime.shutdown("consumer smoke complete");

console.log(JSON.stringify({
  run,
  goal,
  runReplayCount: runReplay.length,
  goalReplayCount: goalReplay.length,
  runDiagnosticsSchema: runDiagnostics.schemaVersion,
  goalDiagnosticsSchema: goalDiagnostics.schemaVersion,
  healthOk: health.ok,
}));
`, "utf8");
    await execFileP(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { cwd: tempProject });
    const installedCli = path.join(tempProject, "node_modules", ".bin", "agent-runtime");
    const agents = await execInstalledCliJson<DetectedAgent[]>(installedCli, ["agents", "--json"], { cwd: tempProject, env: installedEnv });
    const doctor = await execInstalledCliJson<{ ok: boolean }>(installedCli, ["doctor", "--json"], { cwd: tempProject, env: installedEnv });
    const smoke = await execInstalledCliJson<{ ok: true; mode: string }>(installedCli, ["smoke", "--mode", "fixtures", "--json"], {
      cwd: tempProject,
      env: installedEnv,
    });
    const conformance = await execInstalledCliJson<{ ok: true; mode: string }>(installedCli, ["conformance", "--mode", "fixtures", "--json"], {
      cwd: tempProject,
      env: installedEnv,
    });
    const fakeConformance = await execInstalledCliJson<{ ok: true; mode: string }>(installedCli, ["conformance", "--mode", "fake", "--json"], {
      cwd: tempProject,
      env: installedEnv,
    });
    const consumer = JSON.parse((await execFileP(process.execPath, ["consumer.mjs"], {
      cwd: tempProject,
      env: installedEnv,
    })).stdout) as {
      run: RunRecord;
      goal: GoalRecord;
      runReplayCount: number;
      goalReplayCount: number;
      runDiagnosticsSchema: string;
      goalDiagnosticsSchema: string;
      healthOk: boolean;
    };

    expect(imported.stdout.trim()).toBe("function");
    expect(agents.length).toBeGreaterThan(0);
    expect(doctor.ok).toBe(true);
    expect(smoke).toMatchObject({ ok: true, mode: "fixtures" });
    expect(conformance).toMatchObject({ ok: true, mode: "fixtures" });
    expect(fakeConformance).toMatchObject({ ok: true, mode: "fake" });
    expect(consumer).toMatchObject({
      run: { status: "succeeded" },
      goal: { status: "succeeded" },
      runDiagnosticsSchema: "agent-runtime.diagnostics.v1",
      goalDiagnosticsSchema: "agent-runtime.diagnostics.v1",
      healthOk: true,
    });
    expect(consumer.runReplayCount).toBeGreaterThan(0);
    expect(consumer.goalReplayCount).toBeGreaterThan(0);
  }, 120_000);

  it("does not ship docs examples or fixtures with raw auth token patterns", async () => {
    const scanDirs = [
      path.join(root, "examples"),
      path.join(root, "docs", "fixtures"),
    ];
    for (const docsFixtureDir of scanDirs) {
      try {
        await lstat(docsFixtureDir);
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") continue;
        throw error;
      }

      const entries = await readdir(docsFixtureDir, { recursive: true });
      const fixtureFiles = entries.filter((entry) => typeof entry === "string");
      for (const entry of fixtureFiles) {
        const full = path.join(docsFixtureDir, entry);
        const stat = await lstat(full);
        if (!stat.isFile()) continue;
        const bytes = await readFile(full);
        if (isLikelyBinary(bytes)) continue;
        const text = bytes.toString("utf8");
        expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
        expect(text).not.toMatch(/\bBearer\s+[A-Za-z0-9+/_-]{10,}\b/gu);
        expect(text).not.toMatch(/\bANTHROPIC_AUTH_TOKEN\b/gu);
        expect(text).not.toMatch(/\bOPENAI_API_KEY\b/gu);
      }
    }
  });
});

async function writeFakeCodexSmoke(binDir: string, runBody: string): Promise<void> {
  await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli test"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") {
  console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] }));
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
${runBody}
});
`);
}

async function writeShellExecutable(binDir: string, name: string, body: string): Promise<void> {
  const file = path.join(binDir, name);
  await writeFile(file, `#!/bin/sh\n${body}`, "utf8");
  await chmod(file, 0o755);
}
