import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import path, { delimiter } from "node:path";
import { createAgentRuntime } from "../src/index.js";
import {
  CLI_SCHEMA_INVENTORY,
  EVENT_TERMINAL_REASONS,
  SMOKE_CONFORMANCE_CLASSIFICATIONS,
} from "../src/core/schema-contract.js";
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
const releaseVerifier = path.join(root, "scripts", "verify-release-artifacts.mjs");
const releaseCandidateCreator = path.join(root, "scripts", "create-release-candidate.mjs");
const daemonVerifier = path.join(root, "scripts", "verify-daemon-ready.mjs");
const runtimeSafetyVerifier = path.join(root, "scripts", "verify-runtime-safety.mjs");
const runInstalledPackageContractTests = process.env.AGENT_RUNTIME_RUN_INSTALLED_PACKAGE_TESTS === "1";
const expectedReleaseCandidateArtifacts = [
  "agent-cli-runtime-tarball",
  "agent-cli-runtime-pack-metadata",
  "agent-cli-runtime-package-files",
  "agent-cli-runtime-gate-evidence",
  "agent-cli-runtime-release-verification",
];

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

async function execCliFailureViaNode(
  args: string[],
  options?: Parameters<typeof execFileP>[2],
): Promise<{ stdout: string; stderr: string; code: number | string | undefined }> {
  try {
    await execFileP(process.execPath, args, options);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      code: failure.code,
    };
  }
  throw new Error(`expected Node command failure for ${args.join(" ")}`);
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
  it("keeps daemon-facing schema fixtures versioned and redacted", async () => {
    const fixtures = {
      event: {
        schemaVersion: "agent-runtime.event.v1",
        id: 1,
        sequence: 1,
        timestamp: 1760000000000,
        scope: { kind: "run", id: "run_fixture" },
        event: { type: "run_finished", result: "success", timestamp: 1760000000000 },
        terminal: { result: "success", reason: "success" },
      },
      diagnostics: {
        schemaVersion: "agent-runtime.diagnostics.v1",
        exportedAt: 1760000000000,
        storageDir: "<storageDir>",
        subject: { kind: "run", id: "run_fixture" },
        manifest: { id: "run_fixture", cwd: "<cwd>", status: "succeeded", diagnostics: [] },
        events: { total: 2, retained: 2, terminalEvent: true, eventTypes: { run_started: 1, run_finished: 1 } },
        diagnostics: [],
        storageDiagnostics: [],
        consistencyWarnings: [],
        supervisorSummary: { kind: "run", terminalReason: "success", terminalEventCount: 1 },
        adapterSummary: { kind: "run", agentId: "fake", status: "succeeded" },
      },
      conformance: {
        schemaVersion: "agent-runtime.conformance.v1",
        ok: true,
        mode: "fake",
        agents: [{ adapter: "codex", runClassification: "success", observedTextTail: "<redacted>", diagnostics: [] }],
      },
      storeHealth: {
        schemaVersion: "agent-runtime.storeHealth.v1",
        ok: true,
        storageDir: "<storageDir>",
        checkedAt: 1760000000000,
        lock: { file: "runtime.lock.json", status: "missing", staleMs: 30000, diagnostics: [] },
        totals: { runs: 0, goals: 0, corruptEventLogLines: 0, partialEventLogTails: 0, activeRecords: 0 },
        corruptManifests: [],
        corruptEventLogs: [],
        partialTails: [],
        activeRecords: [],
        activeInterrupted: [],
        warnings: [],
        storageDiagnostics: [],
        diagnostics: { total: 0, byCode: {} },
      },
      storeRepair: {
        schemaVersion: "agent-runtime.storeRepair.v1",
        storageDir: "<storageDir>",
        checkedAt: 1760000000000,
        dryRun: true,
        applied: false,
        ok: true,
        actions: [],
        diagnostics: { total: 0, byCode: {} },
      },
      cliError: {
        schemaVersion: "agent-runtime.cliError.v1",
        ok: false,
        error: { code: "CLI_USAGE_ERROR", message: "storageDir is required" },
      },
    };
    const text = JSON.stringify(fixtures);

    expect(fixtures.event.schemaVersion).toBe("agent-runtime.event.v1");
    expect(fixtures.diagnostics.schemaVersion).toBe("agent-runtime.diagnostics.v1");
    expect(fixtures.conformance.schemaVersion).toBe("agent-runtime.conformance.v1");
    expect(fixtures.storeHealth.schemaVersion).toBe("agent-runtime.storeHealth.v1");
    expect(fixtures.storeRepair.schemaVersion).toBe("agent-runtime.storeRepair.v1");
    expect(fixtures.cliError.schemaVersion).toBe("agent-runtime.cliError.v1");
    for (const forbidden of [
      process.env.HOME,
      root,
      "/Users/",
      "Bearer ",
      "ANTHROPIC_AUTH_TOKEN",
      "sk-",
      "raw corrupt",
      "prompt",
    ].filter(Boolean)) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("keeps API schema contract docs aligned with runtime schema inventory", async () => {
    const apiContract = await readFile(path.join(root, "docs", "api-schema-contract.md"), "utf8");
    const daemonContract = await readFile(path.join(root, "docs", "daemon-ready-contract.md"), "utf8");
    const productionReadiness = await readFile(path.join(root, "docs", "production-readiness.md"), "utf8");
    const releaseReport = await readFile(path.join(root, "docs", "release-report.md"), "utf8");
    const releaseChecklist = await readFile(path.join(root, "docs", "release-checklist.md"), "utf8");
    const releaseVerifierText = await readFile(releaseVerifier, "utf8");
    const releaseCandidateCreatorText = await readFile(releaseCandidateCreator, "utf8");
    const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { files: string[] };

    expect(packageManifest.files).toContain("docs/api-schema-contract.md");
    expect(apiContract).toContain("createAgentRuntime");
    expect(apiContract).toContain("Internal but packaged files under `dist/**`");
    expect(apiContract).toContain("Adding optional fields is allowed within the same schema version");
    expect(apiContract).toContain("Removing a field, renaming a field, changing a field type, or changing field semantics requires a schema version bump");
    expect(apiContract).toContain("Changing terminal reason or classification vocabulary requires docs, tests, and a migration note");

    for (const contract of CLI_SCHEMA_INVENTORY) {
      expect(apiContract).toContain(contract.schemaVersion);
      expect(daemonContract).toContain(contract.schemaVersion);
      for (const field of contract.requiredTopLevelFields) {
        expect(apiContract).toContain(field);
      }
      for (const field of contract.classificationFields) {
        expect(apiContract).toContain(field);
      }
    }

    for (const reason of EVENT_TERMINAL_REASONS) {
      expect(apiContract).toContain(`\`${reason}\``);
      expect(daemonContract).toContain(`\`${reason}\``);
    }
    for (const classification of SMOKE_CONFORMANCE_CLASSIFICATIONS) {
      expect(apiContract).toContain(`\`${classification}\``);
      expect(releaseChecklist).toContain(`\`${classification}\``);
    }

    expect(apiContract).toContain("`skipped` is not `success`");
    expect(apiContract).toContain("`auth_missing` is not `unavailable`");
    expect(apiContract).toContain("`needs_verification` must not be guessed");
    expect(productionReadiness).toContain("docs/api-schema-contract.md");
    expect(releaseReport).toContain("docs/api-schema-contract.md");
    expect(releaseVerifierText).toContain("agent-cli-runtime.releaseVerification.v1");
    expect(releaseVerifierText).toContain("agent-cli-runtime.releaseGateEvidence.v1");
    expect(releaseCandidateCreatorText).toContain("agent-cli-runtime.releaseGateEvidence.v1");
  });

  it("keeps public docs from over-claiming API stability or hosted daemon readiness", async () => {
    const docs = [
      "README.md",
      "README.zh-CN.md",
      "docs/api-schema-contract.md",
      "docs/compatibility.md",
      "docs/daemon-ready-contract.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/ssot.md",
    ];

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).not.toContain("stable API release");
      expect(text).not.toContain("production-ready hosted daemon");
    }
  });

  it("keeps installed-package daemon and runtime safety gates out of the default test matrix", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const daemonScript = await readFile(daemonVerifier, "utf8");
    const runtimeSafetyScript = await readFile(runtimeSafetyVerifier, "utf8");

    expect(manifest.scripts.test).not.toContain("daemon:verify");
    expect(manifest.scripts.test).not.toContain("runtime:safety");
    expect(manifest.scripts.ci).not.toContain("daemon:verify");
    expect(manifest.scripts.ci).not.toContain("runtime:safety");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run daemon:verify");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run runtime:safety");

    expect(daemonScript).toContain("agent-runtime.daemonVerification.v1");
    expect(daemonScript).toContain("installed-tarball");
    expect(daemonScript).toContain("\"pack\", \"--json\", \"--ignore-scripts\"");
    expect(daemonScript).toContain("\"conformance\", \"--mode\", \"fake\", \"--json\"");
    expect(daemonScript).not.toContain("--allow-real-run");
    expect(daemonScript).not.toMatch(/\bnpm publish\b/u);
    expect(daemonScript).not.toContain("NODE_AUTH_TOKEN");

    expect(runtimeSafetyScript).toContain("agent-runtime.runtimeSafety.v1");
    expect(runtimeSafetyScript).toContain("installed-tarball");
    expect(runtimeSafetyScript).toContain("\"pack\", \"--json\", \"--ignore-scripts\"");
    expect(runtimeSafetyScript).toContain("repeatedShutdownStable");
    expect(runtimeSafetyScript).not.toContain("--allow-real-run");
    expect(runtimeSafetyScript).not.toMatch(/\bnpm publish\b/u);
    expect(runtimeSafetyScript).not.toContain("NODE_AUTH_TOKEN");
  });

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

  it("keeps npm package metadata complete without widening the public entrypoint", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      name: string;
      version: string;
      description: string;
      license: string;
      type: string;
      bin: Record<string, string>;
      main: string;
      types: string;
      exports: Record<string, { import: string; types: string }>;
      files: string[];
      engines: Record<string, string>;
      repository: { type: string; url: string };
      homepage: string;
      bugs: { url: string };
      keywords: string[];
      publishConfig: { tag: string };
    };

    expect(manifest).toMatchObject({
      name: "agent-cli-runtime",
      version: "0.1.0-alpha.0",
      license: "Apache-2.0",
      type: "module",
      bin: { "agent-runtime": "dist/cli/main.js" },
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      repository: {
        type: "git",
        url: "git+https://github.com/iiwish/agent-cli-runtime.git",
      },
      homepage: "https://github.com/iiwish/agent-cli-runtime#readme",
      bugs: { url: "https://github.com/iiwish/agent-cli-runtime/issues" },
      engines: { node: ">=20" },
      publishConfig: { tag: "alpha" },
    });
    expect(manifest.description).toContain("Local-first TypeScript runtime");
    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    });
    expect(manifest.files).toContain("docs/release-publish-runbook.md");
    expect(manifest.files).toContain("docs/api-schema-contract.md");
    expect(manifest.keywords).toEqual(expect.arrayContaining(["agent", "cli", "codex", "claude", "opencode", "runtime"]));
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
      schemaVersion: "agent-runtime.storeHealth.v1",
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
      const parsed = JSON.parse(failure.stdout) as { schemaVersion: string; ok: false; error: { code: string; message: string } };
      const text = `${failure.stdout}\n${failure.stderr}`;
      expect(failure.code).toBe(1);
      expect(failure.stderr).toBe("");
      expect(parsed).toMatchObject({
        schemaVersion: "agent-runtime.cliError.v1",
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
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("mystery-runtime build local"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-drift", display_name: "GPT Drift" }] })); process.exit(0); }
console.error("real run should not launch for needs_verification");
process.exit(66);
`);
    const conformance = await execCliJson<{
      agents: Array<{
        runClassification: string;
        skippedReason: string | null;
        diagnostics: Array<{ code: string; actionableHints?: string[] }>;
        argvProfile: { needsVerification: Array<{ mapsTo: string }> };
      }>;
    }>([
      "conformance",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(conformance.agents[0]).toMatchObject({
      runClassification: "needs_verification",
      skippedReason: "needs_verification",
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

  it("maps real conformance execution failures into the frozen classification vocabulary", async () => {
    const binDir = await tempDir();
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli conformance-failure"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] })); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.error("synthetic conformance failure");
  process.exit(7);
});
`);
    const conformance = await execCliJson<{
      agents: Array<{
        runClassification: string;
        failureReason: string | null;
        diagnostics: Array<{ code: string }>;
      }>;
    }>([
      "conformance",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });
    const summary = conformance.agents[0]!;
    const frozen = new Set(SMOKE_CONFORMANCE_CLASSIFICATIONS);

    expect(summary).toMatchObject({
      runClassification: "failed",
      failureReason: "failed",
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "AGENT_EXECUTION_FAILED" })]),
    });
    expect(frozen.has(summary.runClassification)).toBe(true);
    expect(summary.failureReason === null || frozen.has(summary.failureReason)).toBe(true);
    expect(summary.runClassification).not.toBe("AGENT_EXECUTION_FAILED");
    expect(summary.failureReason).not.toBe("AGENT_EXECUTION_FAILED");
  }, 30_000);

  it("classifies real smoke profile drift as needs_verification without launching", async () => {
    const binDir = await tempDir();
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("mystery-runtime smoke local"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-drift", display_name: "GPT Drift" }] })); process.exit(0); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  console.error("real smoke should not launch for needs_verification");
  process.exit(66);
});
`);
    const smoke = await execCliJson<{
      runClassification: string;
      skippedReason: string | null;
      diagnostics: Array<{ code: string; actionableHints?: string[] }>;
    }>([
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
      schemaVersion: "agent-runtime.realSmoke.v1",
      ok: false,
      adapter: "codex",
      runClassification: "needs_verification",
      skippedReason: "needs_verification",
      failureReason: null,
      observedTextTail: null,
      cwdMutationChecked: false,
    });
    expect(smoke.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "needs_verification",
        actionableHints: expect.arrayContaining([expect.stringContaining("Verify this CLI version output manually")]),
      }),
    ]));
  }, 30_000);

  it("certifies real smoke preflight without launching runs unless --allow-real-run is explicit", async () => {
    const binDir = await tempDir();
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli smoke-preflight"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-smoke-preflight", display_name: "GPT Smoke Preflight" }] })); process.exit(0); }
console.error("real smoke should not launch without --allow-real-run");
process.exit(66);
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      schemaVersion: "agent-runtime.realSmoke.v1",
      type: "real_smoke_summary",
      ok: false,
      mode: "real",
      adapter: "codex",
      version: "codex-cli smoke-preflight",
      auth: "unknown",
      modelsSource: "live",
      runClassification: "real_run_skipped",
      expectedTextRequired: true,
      expectedTextMatched: null,
      observedTextDeltaCount: 0,
      observedTextTail: null,
      cwdMutationChecked: false,
      cwdMutated: null,
      diagnosticsCount: 0,
      skippedReason: "real_run_not_allowed",
      failureReason: null,
    });
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

    expect(smoke).toMatchObject({
      schemaVersion: "agent-runtime.realSmoke.v1",
      ok: false,
      mode: "real",
      adapter: "codex",
      runClassification: "unexpected_output",
      expectedTextRequired: true,
      expectedTextMatched: null,
      failureReason: "unexpected_output",
    });
    expect(JSON.stringify(smoke)).not.toContain(longPrompt);
    expect(JSON.stringify(smoke)).not.toContain("run_");
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
      schemaVersion: "agent-runtime.realSmoke.v1",
      ok: true,
      mode: "real",
      adapter: "codex",
      runClassification: "success",
      expectedTextRequired: true,
      expectedTextMatched: true,
      observedTextTail: "agent-runtime codex smoke ok",
      cwdMutationChecked: true,
      cwdMutated: false,
      diagnosticsCount: 0,
      skippedReason: null,
      failureReason: null,
    });
    expect(JSON.stringify(smoke)).not.toContain("run_");
  }, 30_000);

  it("uses --expect-text as the default safe prompt when no prompt is supplied", async () => {
    const binDir = await tempDir();
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli test"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] })); process.exit(0); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (!input.includes("Reply exactly: agent-runtime real smoke ok.")) {
    console.error("safe expected text was not used as the prompt");
    process.exit(65);
  }
  if (input.includes("agent-runtime codex smoke ok")) {
    console.error("default adapter expected text leaked into custom expected smoke");
    process.exit(66);
  }
  console.log(JSON.stringify({ type: "thread.started" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime real smoke ok" } }));
});
`);
    const smoke = await execCliJson([
      "smoke",
      "--mode",
      "real",
      "--agent",
      "codex",
      "--allow-real-run",
      "--expect-text",
      "agent-runtime real smoke ok",
      "--json",
    ], {
      env: fakeCliEnv(binDir, { CODEX_BIN: path.join(binDir, "codex") }),
    });

    expect(smoke).toMatchObject({
      ok: true,
      adapter: "codex",
      runClassification: "success",
      expectedTextMatched: true,
      observedTextTail: "agent-runtime real smoke ok",
      failureReason: null,
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
      runClassification: "unexpected_output",
      expectedTextRequired: true,
      expectedTextMatched: false,
      observedTextDeltaCount: 0,
      observedTextTail: "",
      failureReason: "unexpected_output",
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
      runClassification: "unexpected_output",
      expectedTextMatched: false,
      observedTextTail: "not the expected smoke text",
      failureReason: "unexpected_output",
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
      runClassification: "cwd_mutated",
      expectedTextMatched: true,
      cwdMutationChecked: true,
      cwdMutated: true,
      cwdMutationCount: 1,
      cwdMutationSample: [{ path: "smoke-output.txt", action: "created" }],
      failureReason: "cwd_mutated",
    });
  }, 30_000);

  it("does not pass prompt-file real smoke without --expect-text", async () => {
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
      ok: false,
      runClassification: "unexpected_output",
      expectedTextRequired: true,
      expectedTextMatched: null,
      observedTextTail: "custom prompt-file response",
      failureReason: "unexpected_output",
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
      runClassification: "success",
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
      schemaVersion: "agent-runtime.realSmoke.v1",
      type: "real_smoke_summary",
      runClassification: "cwd_mutated",
      cwdMutationSample: [{ path: "token-[REDACTED].txt", action: "created" }],
      failureReason: "cwd_mutated",
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(privateCwd);
    expect(text).not.toContain("expected ");
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
      schemaVersion: "agent-runtime.realSmoke.v1",
      ok: false,
      mode: "real",
      adapter: "claude",
      runClassification: "auth_missing",
      auth: "missing",
      observedTextTail: null,
      cwdMutationChecked: false,
      cwdMutated: null,
      skippedReason: "auth_missing",
      failureReason: null,
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
      schemaVersion: "agent-runtime.realSmoke.v1",
      ok: false,
      mode: "real",
      adapter: "codex",
      runClassification: "unavailable_executable",
      observedTextTail: null,
      cwdMutationChecked: false,
      cwdMutated: null,
      skippedReason: "unavailable_executable",
      failureReason: null,
    });
    expect(smoke.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "not_installed" })]));
  }, 30_000);

  it("maps real smoke execution failures into the frozen classification vocabulary", async () => {
    const binDir = await tempDir();
    await writeExecutable(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli execution-failure"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-test", display_name: "GPT Test" }] })); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.error("synthetic execution failure");
  process.exit(7);
});
`);
    const smoke = await execCliJson<{
      schemaVersion: string;
      ok: boolean;
      adapter: string;
      runClassification: string;
      failureReason: string | null;
      diagnostics: Array<{ code: string }>;
    }>([
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
    const frozen = new Set(SMOKE_CONFORMANCE_CLASSIFICATIONS);

    expect(smoke).toMatchObject({
      schemaVersion: "agent-runtime.realSmoke.v1",
      ok: false,
      adapter: "codex",
      runClassification: "failed",
      failureReason: "failed",
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "AGENT_EXECUTION_FAILED" })]),
    });
    expect(frozen.has(smoke.runClassification)).toBe(true);
    expect(smoke.failureReason === null || frozen.has(smoke.failureReason)).toBe(true);
    expect(smoke.runClassification).not.toBe("AGENT_EXECUTION_FAILED");
    expect(smoke.failureReason).not.toBe("AGENT_EXECUTION_FAILED");
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
    const runId = await waitForRunId(storageDir);
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

    expect(smoke).toMatchObject({
      schemaVersion: "agent-runtime.realSmoke.v1",
      ok: false,
      mode: "real",
      adapter: "codex",
      runClassification: "timeout",
      failureReason: "timeout",
    });
    expect(JSON.stringify(smoke)).not.toContain(privateCwd);
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
    expect(files).toContain("docs/release-publish-runbook.md");
    expect(files).toContain("docs/api-schema-contract.md");
    expect(files).not.toContainEqual(expect.stringMatching(/^\.reference\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\/secrets/u));
    expect(files).not.toContainEqual(expect.stringMatching(/^docs\/fixtures\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/fixtures?/iu));
    expect(stdout).not.toContain(`sk${"A".repeat(20)}`);
  });

  it("verifies legal release candidate artifacts with a stable redacted JSON schema", async () => {
    const dir = await tempDir("agent-runtime-release-verify-");
    const pack = [{
      id: "agent-cli-runtime@0.1.0-alpha.0",
      name: "agent-cli-runtime",
      version: "0.1.0-alpha.0",
      filename: "agent-cli-runtime-0.1.0-alpha.0.tgz",
      files: [
        { path: "dist/index.js", size: 1, mode: 420 },
        { path: "README.md", size: 1, mode: 420 },
        { path: "docs/release-report.md", size: 1, mode: 420 },
        { path: "examples/library-run.js", size: 1, mode: 420 },
        { path: "scripts/dogfood.mjs", size: 1, mode: 420 },
      ],
    }];
    await writeFile(path.join(dir, "npm-pack.json"), JSON.stringify(pack, null, 2), "utf8");
    await writeFile(path.join(dir, "package-files.txt"), `${pack[0].files.map((file) => file.path).join("\n")}\n`, "utf8");
    await writeFile(path.join(dir, "gate-evidence.json"), JSON.stringify({
      schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
      generatedAt: "2026-06-22T00:00:00.000Z",
      gates: [
        {
          name: "daemon-ready",
          script: "daemon:verify",
          command: "npm run daemon:verify",
          ok: true,
          outputSchemaVersion: "agent-runtime.daemonVerification.v1",
          packageSource: "installed-tarball",
        },
        {
          name: "runtime-safety",
          script: "runtime:safety",
          command: "npm run runtime:safety",
          ok: true,
          outputSchemaVersion: "agent-runtime.runtimeSafety.v1",
          packageSource: "installed-tarball",
        },
      ],
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    }, null, 2), "utf8");
    await writeFile(path.join(dir, pack[0].filename), "fake tarball", "utf8");
    const output = path.join(dir, "release-verification.json");

    const { stdout } = await execFileP(process.execPath, [
      releaseVerifier,
      "--dir",
      dir,
      "--output",
      output,
    ]);
    const verification = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      checkedFiles: { packMetadata: string; packageFileList: string; gateEvidence: string; packageFiles: number };
      tarball: { filename: string; path: string; exists: boolean; sizeBytes: number };
      diagnostics: unknown[];
      artifactNames: string[];
      gateEvidence: {
        schemaVersion: string;
        gates: Array<{ script: string; command: string; ok: boolean; outputSchemaVersion: string; packageSource: string }>;
        commands: string[];
      };
      packageName: string;
      version: string;
    };
    const written = JSON.parse(await readFile(output, "utf8"));

    expect(written).toEqual(verification);
    expect(verification).toMatchObject({
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: true,
      checkedFiles: { packMetadata: "npm-pack.json", packageFileList: "package-files.txt", gateEvidence: "gate-evidence.json", packageFiles: 5 },
      tarball: {
        filename: "agent-cli-runtime-0.1.0-alpha.0.tgz",
        path: "agent-cli-runtime-0.1.0-alpha.0.tgz",
        exists: true,
        sizeBytes: expect.any(Number),
      },
      diagnostics: [],
      artifactNames: expect.arrayContaining(expectedReleaseCandidateArtifacts),
      gateEvidence: {
        schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
        commands: ["npm run daemon:verify", "npm run runtime:safety"],
      },
      packageName: "agent-cli-runtime",
      version: "0.1.0-alpha.0",
    });
    expect(verification.gateEvidence.gates).toEqual([
      expect.objectContaining({
        script: "daemon:verify",
        command: "npm run daemon:verify",
        ok: true,
        outputSchemaVersion: "agent-runtime.daemonVerification.v1",
        packageSource: "installed-tarball",
      }),
      expect.objectContaining({
        script: "runtime:safety",
        command: "npm run runtime:safety",
        ok: true,
        outputSchemaVersion: "agent-runtime.runtimeSafety.v1",
        packageSource: "installed-tarball",
      }),
    ]);
    expect([...verification.artifactNames].sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(stdout).not.toContain(dir);
  });

  it("keeps release verification error envelopes aligned with the documented schema", async () => {
    const failure = await execCliFailureViaNode([releaseVerifier, "--unknown"]);
    const verification = JSON.parse(failure.stdout) as {
      schemaVersion: string;
      ok: boolean;
      checkedFiles: Record<string, unknown>;
      tarball: null;
      diagnostics: Array<{ code: string; message: string }>;
      artifactNames: string[];
      gateEvidence: null;
      packageName: null;
      version: null;
    };

    expect(failure.code).toBe(1);
    expect(verification).toMatchObject({
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: false,
      checkedFiles: {},
      tarball: null,
      diagnostics: [expect.objectContaining({ code: "usage_error" })],
      artifactNames: expect.arrayContaining(expectedReleaseCandidateArtifacts),
      gateEvidence: null,
      packageName: null,
      version: null,
    });
  });

  it("rejects release artifacts without daemon-ready gate evidence", async () => {
    const dir = await tempDir("agent-runtime-release-missing-gates-");
    const pack = [{
      name: "agent-cli-runtime",
      version: "0.1.0-alpha.0",
      filename: "agent-cli-runtime-0.1.0-alpha.0.tgz",
      files: [{ path: "dist/index.js" }],
    }];
    await writeFile(path.join(dir, "npm-pack.json"), JSON.stringify(pack), "utf8");
    await writeFile(path.join(dir, "package-files.txt"), "dist/index.js\n", "utf8");
    await writeFile(path.join(dir, pack[0].filename), "fake tarball", "utf8");

    const failure = await execCliFailureViaNode([releaseVerifier, "--dir", dir]);
    const verification = JSON.parse(failure.stdout) as { ok: boolean; diagnostics: Array<{ code: string; message: string }> };

    expect(failure.code).toBe(1);
    expect(verification.ok).toBe(false);
    expect(verification.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_artifact" }),
    ]));
    expect(JSON.stringify(verification)).toContain("release gate evidence");
    expect(failure.stdout).not.toContain(dir);
  });

  it("rejects and redacts unsafe daemon-ready gate evidence", async () => {
    const dir = await tempDir("agent-runtime-release-bad-gates-");
    const fakePrivatePath = "/" + "Users/example/gate-output.json";
    const fakeSecret = `sk-${"A".repeat(24)}`;
    const pack = [{
      name: "agent-cli-runtime",
      version: "0.1.0-alpha.0",
      filename: "agent-cli-runtime-0.1.0-alpha.0.tgz",
      files: [{ path: "dist/index.js" }],
    }];
    await writeFile(path.join(dir, "npm-pack.json"), JSON.stringify(pack), "utf8");
    await writeFile(path.join(dir, "package-files.txt"), "dist/index.js\n", "utf8");
    await writeFile(path.join(dir, "gate-evidence.json"), JSON.stringify({
      schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
      generatedAt: "2026-06-22T00:00:00.000Z",
      outputPath: fakePrivatePath,
      note: fakeSecret,
      gates: [
        {
          name: "daemon-ready",
          script: "daemon:verify",
          command: "npm run daemon:verify",
          ok: true,
          outputSchemaVersion: "agent-runtime.daemonVerification.v1",
          packageSource: "installed-tarball",
        },
      ],
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    }), "utf8");
    await writeFile(path.join(dir, pack[0].filename), "fake tarball", "utf8");

    const failure = await execCliFailureViaNode([releaseVerifier, "--dir", dir]);
    const verification = JSON.parse(failure.stdout) as { ok: boolean; diagnostics: Array<{ code: string }> };
    const codes = verification.diagnostics.map((diagnostic) => diagnostic.code);

    expect(failure.code).toBe(1);
    expect(verification.ok).toBe(false);
    expect(codes).toEqual(expect.arrayContaining(["private_user_path", "openai_style_secret", "missing_gate_evidence"]));
    expect(failure.stdout).not.toContain(fakePrivatePath);
    expect(failure.stdout).not.toContain(fakeSecret);
  });

  it("rejects release artifacts containing disallowed package paths and secret-looking values", async () => {
    const dir = await tempDir("agent-runtime-release-bad-");
    const fakeSecret = `sk-${"A".repeat(24)}`;
    const fakePrivatePath = "/" + "Users/example/private-output.json";
    const files = [
      "dist/index.js",
      ".reference/open-design/secret.txt",
      "tests/contract.test.ts",
      "tests/fixtures/streams/raw.jsonl",
      "docs/raw-real-cli-output/capture.json",
      fakePrivatePath,
      `docs/token-${fakeSecret}.txt`,
      `docs/header-Bearer ${"B".repeat(20)}.txt`,
    ];
    const pack = [{
      name: "agent-cli-runtime",
      version: "0.1.0-alpha.0",
      filename: "agent-cli-runtime-0.1.0-alpha.0.tgz",
      files: files.map((file) => ({ path: file })),
    }];
    await writeFile(path.join(dir, "npm-pack.json"), JSON.stringify(pack), "utf8");
    await writeFile(path.join(dir, "package-files.txt"), `${files.join("\n")}\n`, "utf8");
    await writeFile(path.join(dir, pack[0].filename), "fake tarball", "utf8");

    const failure = await execCliFailureViaNode([releaseVerifier, "--dir", dir]);
    const verification = JSON.parse(failure.stdout) as { ok: boolean; diagnostics: Array<{ code: string }> };
    const text = failure.stdout + failure.stderr;
    const codes = verification.diagnostics.map((diagnostic) => diagnostic.code);

    expect(failure.code).toBe(1);
    expect(verification.ok).toBe(false);
    expect(codes).toEqual(expect.arrayContaining([
      "reference_material",
      "tests",
      "fixture_material",
      "raw_real_cli_output",
      "unsafe_package_path",
      "private_user_path",
      "openai_style_secret",
      "bearer_value",
    ]));
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(fakeSecret);
    expect(text).not.toContain(fakePrivatePath);
    expect(text).not.toContain("Bearer " + "B".repeat(20));
  });

  it("keeps the release candidate creator as a local npm pack wrapper without publishing", async () => {
    const script = await readFile(releaseCandidateCreator, "utf8");

    expect(script).toContain("npm");
    expect(script).toContain("pack");
    expect(script).toContain("--pack-destination");
    expect(script).toContain("verify-release-artifacts.mjs");
    expect(script).not.toMatch(/\bnpm publish\b/u);
    expect(script).not.toContain("NODE_AUTH_TOKEN");
    expect(script).not.toContain("--allow-real-run");
  });

  it("keeps remote CI and release-candidate workflows audit-only and artifact-focused", async () => {
    const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const releaseCandidate = await readFile(path.join(root, ".github", "workflows", "release-candidate.yml"), "utf8");
    const creator = await readFile(releaseCandidateCreator, "utf8");
    const manifest = await readFile(path.join(root, "package.json"), "utf8");
    const ciCompact = ci.replace(/\s+/gu, "");
    const releaseArtifactNames = [...releaseCandidate.matchAll(/^\s+name:\s+(agent-cli-runtime-[^\n]+)$/gmu)].map((match) => match[1].trim());

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
    expect(ci).toContain("Release gates on Node.js 22.x");
    expect(ci).toContain("actions/checkout@v5");
    expect(ci).toContain("actions/setup-node@v5");
    expect(ci).not.toMatch(/actions\/(?:checkout|setup-node)@v4/u);
    expect(ci.match(/npm run daemon:verify/gu)).toHaveLength(1);
    expect(ci.match(/npm run runtime:safety/gu)).toHaveLength(1);
    expect(ci.match(/npm run dogfood/gu)).toHaveLength(1);
    const releaseGatesStart = ci.indexOf("release-gates:");
    const releaseGateBuild = ci.indexOf("npm run build", releaseGatesStart);
    const daemonGate = ci.indexOf("npm run daemon:verify");
    expect(releaseGatesStart).toBeGreaterThanOrEqual(0);
    expect(releaseGateBuild).toBeGreaterThanOrEqual(0);
    expect(daemonGate).toBeGreaterThanOrEqual(0);
    expect(releaseGateBuild).toBeLessThan(daemonGate);
    expect(ci).not.toContain("Package install smoke");
    expect(ci).not.toContain("agent-runtime-release-smoke");
    for (const releaseSurface of [ci, releaseCandidate, creator, manifest]) {
      expect(releaseSurface).not.toContain("--allow-real-run");
      expect(releaseSurface).not.toMatch(/\bnpm publish\b/u);
      expect(releaseSurface).not.toContain("NODE_AUTH_TOKEN");
      expect(releaseSurface).not.toContain("NPM_TOKEN");
      expect(releaseSurface).not.toContain("id-token: write");
      expect(releaseSurface).not.toContain("registry-url:");
      expect(releaseSurface).not.toMatch(/trusted[-_ ]?publish(?:ing)?/iu);
    }

    expect(releaseCandidate).toMatch(/on:\n\s+workflow_dispatch:/u);
    expect(releaseCandidate).toContain("npm run ci");
    expect(releaseCandidate).toContain("npm run dogfood");
    expect(releaseCandidate).toContain("npm run release:candidate -- --out-dir release-candidate");
    expect(releaseCandidate).toContain("release-candidate/npm-pack.json");
    expect(releaseCandidate).toContain("release-candidate/package-files.txt");
    expect(releaseCandidate).toContain("release-candidate/gate-evidence.json");
    expect(releaseCandidate).toContain("release-candidate/release-verification.json");
    expect(releaseCandidate).toContain("actions/checkout@v5");
    expect(releaseCandidate).toContain("actions/setup-node@v5");
    expect(releaseCandidate).toContain("actions/upload-artifact@v6");
    expect(releaseCandidate).not.toMatch(/actions\/(?:checkout|setup-node)@v4|actions\/upload-artifact@v[45]/u);
    expect(releaseArtifactNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(releaseCandidate).toContain("retention-days: 14");
    expect(releaseCandidate).not.toMatch(/const disallowed|disallowed package artifact path/u);
  });

  it("keeps prepublish and release candidate gates aligned with daemon-ready scripts", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const creator = await readFile(releaseCandidateCreator, "utf8");
    const dogfood = await readFile(path.join(root, "scripts", "dogfood.mjs"), "utf8");

    expect(manifest.scripts["prepublish:check"]).toContain("npm run daemon:verify");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run runtime:safety");
    expect(manifest.scripts.dogfood).not.toContain("--allow-real-run");
    expect(manifest.scripts["prepublish:check"]).not.toContain("--allow-real-run");
    expect(manifest.scripts["release:candidate"]).not.toContain("--allow-real-run");
    expect(creator).toContain("agent-cli-runtime.releaseGateEvidence.v1");
    expect(creator).toContain("npm run daemon:verify");
    expect(creator).toContain("npm run runtime:safety");
    expect(creator).toContain("gate-evidence.json");
    expect(creator).not.toMatch(/\bnpm publish\b/u);
    expect(creator).not.toContain("NODE_AUTH_TOKEN");
    expect(creator).not.toContain("--allow-real-run");
    expect(dogfood).not.toContain("--allow-real-run");
  });

  it("keeps public docs free of real token and provider-specific secret examples", async () => {
    const docs = [
      "README.md",
      "README.zh-CN.md",
      "docs/api-schema-contract.md",
      "docs/compatibility.md",
      "docs/production-readiness.md",
      "docs/release-report.md",
      "docs/release-checklist.md",
      "docs/ssot.md",
      "docs/daemon-ready-contract.md",
    ];

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).not.toMatch(/\b(?:sk|pk)-[A-Za-z0-9_-]{20,}\b/u);
      expect(text).not.toMatch(/\bBearer\s+[A-Za-z0-9+/_-]{10,}\b/u);
      expect(text).not.toMatch(/\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/iu);
      expect(text).not.toMatch(/api\.deepseek\.com/iu);
      expect(text).not.toMatch(/\bdeepseek-[a-z0-9._:-]+/iu);
    }
  });

  it("documents P3-10 pre-documentation workflow evidence without self-referential current-HEAD reuse", async () => {
    const docs = [
      "README.md",
      "README.zh-CN.md",
      "docs/api-schema-contract.md",
      "docs/compatibility.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/ssot.md",
    ];
    const preDocumentationEvidenceRun = "27945938663";
    const preDocumentationEvidenceSha = "fdba3ebccb2e57a0ad295101028a2a3937a92204";
    const historicalP39Run = "27943672095";
    const historicalP39Sha = "65fac505ca3eb830a06d8656068cf4ed5f6dd46a";
    const historicalP39InterimRun = "27942743285";
    const historicalP39InterimSha = "a0299a7d81bb614661922bebc8c75496cf0a3d11";
    const historicalP38Run = "27940814340";
    const historicalP38Sha = "eb8de0f9b1edfa3f94c35a50b31005c5d3c105d4";
    const historicalP35Run = "27932628093";
    const historicalP35Sha = "8d7bc2a19c626caa1ad5223acbcd35df34aff18e";
    const oldRun = "27869580048";
    const report = await readFile(path.join(root, "docs", "release-report.md"), "utf8");
    const checklist = await readFile(path.join(root, "docs", "release-checklist.md"), "utf8");
    const ssot = await readFile(path.join(root, "docs", "ssot.md"), "utf8");
    expect(report).toContain("pre-documentation");
    expect(report).toContain("committing this packet changes the package shasum");
    expect(report).toContain("must not be used as final post-documentation publish evidence");
    expect(report).toContain("fresh release-candidate workflow after committing this packet");
    expect(report).not.toMatch(new RegExp(`${preDocumentationEvidenceRun}[^\\n]*(?:proves|证明)[^\\n]*(?:current HEAD|当前 HEAD)`, "iu"));

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).not.toContain("remote_evidence`: pending");
      expect(text).not.toMatch(/P3-10[^\n]*(?:pending|待触发|待复验|待闭环)/u);
      expect(text).not.toMatch(new RegExp(`${preDocumentationEvidenceRun}[^\\n]*(?:\\bserves as\\b|\\bproves\\b|证明)[^\\n]*(?:final|post-documentation|最终|提交后)[^\\n]*(?:evidence|证据)`, "iu"));
      expect(text).not.toMatch(new RegExp(`${preDocumentationEvidenceRun}[^\\n]*(?:proves|证明)[^\\n]*(?:current HEAD|当前 HEAD)`, "iu"));
      expect(text).not.toMatch(/P3-9[^\n]*(?:current-HEAD|current HEAD|当前 HEAD|当前证据|current evidence)/iu);
      expect(text).not.toMatch(new RegExp(`(?:current|latest|evidence target|current HEAD) SHA[:：]?\\s*${historicalP39Sha}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标|当前 HEAD) SHA[:：]?\\s*${historicalP39Sha}`, "u"));
      expect(text).not.toMatch(new RegExp(`(?:current|latest|evidence target|current HEAD) run[:：]?\\s*${historicalP39Run}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标|当前 HEAD) run[:：]?\\s*${historicalP39Run}`, "u"));
      expect(text).not.toMatch(new RegExp(`(?:current|latest|evidence target) SHA[:：]?\\s*${historicalP39InterimSha}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标) SHA[:：]?\\s*${historicalP39InterimSha}`, "u"));
      expect(text).not.toMatch(new RegExp(`(?:current|latest|evidence target) run[:：]?\\s*${historicalP39InterimRun}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标) run[:：]?\\s*${historicalP39InterimRun}`, "u"));
      expect(text).not.toMatch(new RegExp(`(?:current|latest|target|evidence target) SHA[:：]?\\s*${historicalP38Sha}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标) SHA[:：]?\\s*${historicalP38Sha}`, "u"));
      expect(text).not.toMatch(new RegExp(`(?:current|latest|target|evidence target) SHA[:：]?\\s*${historicalP35Sha}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标) SHA[:：]?\\s*${historicalP35Sha}`, "u"));
      expect(text).not.toMatch(new RegExp(`(?:current|latest|target|evidence target) run[:：]?\\s*${historicalP38Run}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标) run[:：]?\\s*${historicalP38Run}`, "u"));
      expect(text).not.toMatch(new RegExp(`(?:current|latest|target|evidence target) run[:：]?\\s*${historicalP35Run}`, "iu"));
      expect(text).not.toMatch(new RegExp(`(?:当前|最新|证据目标) run[:：]?\\s*${historicalP35Run}`, "u"));
      expect(text).not.toMatch(new RegExp(`target run[:：]?\\s*${oldRun}`, "iu"));
      expect(text).not.toMatch(new RegExp(`证据目标 run[:：]?\\s*${oldRun}`, "u"));
    }

    for (const text of [report, checklist, ssot]) {
      expect(text).toContain(preDocumentationEvidenceRun);
      expect(text).toContain(preDocumentationEvidenceSha);
      expect(text).toMatch(/pre-documentation SHA|pre-documentation HEAD SHA|target SHA|Target SHA|evidence target SHA|提交证据文档前的 SHA|证据目标 SHA/u);
      expect(text).toMatch(/fresh release-candidate workflow|fresh workflow run|重新触发 fresh release-candidate run|fresh release-candidate run/u);
      expect(text).toMatch(/package shasum|pack shasum|npm pack shasum/u);
      for (const artifact of expectedReleaseCandidateArtifacts) {
        expect(text).toContain(artifact);
      }
      expect(text).toContain("agent-cli-runtime-gate-evidence");
      expect(text).toContain("installed-tarball");
      expect(text).toContain("npm run release:verify -- --dir /tmp/agent-runtime-p3-10-current-head-remote-66VIhN/normalized");
      expect(text).toContain("agent-cli-runtime.releaseVerification.v1");
      expect(text).toContain("npm publish --dry-run --ignore-scripts --tag alpha");
      expect(text).toMatch(/`ok`:\s*`true`|ok: true/u);
      expect(text).toContain("diagnostics");
    }
    expect(report).toContain("Historical P3-9 run `27943672095`");
    expect(report).toContain("Historical P3-9 interim run `27942743285`");
    expect(report).toMatch(/historical P3-8 run `27940814340`/iu);
    expect(report).toMatch(/historical P3-5 run `27932628093`/iu);
    expect(report).toMatch(/historical P2-12 run `27869580048`/iu);
  });

  it("documents publish dry-run with the alpha dist-tag instead of latest", async () => {
    const docs = [
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/api-schema-contract.md",
      "docs/compatibility.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/ssot.md",
    ];

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).not.toMatch(/npm publish --dry-run --ignore-scripts(?! --tag alpha)/u);
    }
  });

  it("documents the alpha publish decision without adding workflow publish credentials", async () => {
    const runbook = await readFile(path.join(root, "docs", "release-publish-runbook.md"), "utf8");
    const releaseCandidate = await readFile(path.join(root, ".github", "workflows", "release-candidate.yml"), "utf8");
    const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");

    expect(runbook).toContain("npm publish --dry-run --ignore-scripts --tag alpha");
    expect(runbook).toContain("npm publish --tag alpha");
    expect(runbook).toContain("npm dist-tag ls agent-cli-runtime");
    expect(runbook).toContain("npm dist-tag add agent-cli-runtime@0.1.0-alpha.0 alpha");
    expect(runbook).toContain("npm unpublish agent-cli-runtime@0.1.0-alpha.0");
    expect(runbook).toContain("2FA");
    expect(runbook).toContain("trusted publishing");
    expect(runbook).toContain("provenance");
    expect(runbook).toContain("not configured");
    expect(runbook).toContain("P3-10 does not publish npm");
    expect(releaseCandidate).not.toMatch(/\bnpm publish\b/u);
    expect(releaseCandidate).not.toContain("NODE_AUTH_TOKEN");
    expect(ci).not.toMatch(/\bnpm publish\b/u);
    expect(ci).not.toContain("NODE_AUTH_TOKEN");
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

  it.skipIf(!runInstalledPackageContractTests)("supports package install smoke from npm pack tarball", async () => {
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
