import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, readdir, rm, writeFile, lstat, stat, utimes } from "node:fs/promises";
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
const postAlphaVerifier = path.join(root, "scripts", "verify-post-alpha-release.mjs");
const publishedSmoke = path.join(root, "scripts", "smoke-published.mjs");
const publishedDaemonConsumerVerifier = path.join(root, "scripts", "verify-published-daemon-consumer.mjs");
const publishedAdaptersVerifier = path.join(root, "scripts", "verify-published-adapters.mjs");
const publishedVerificationCreator = path.join(root, "scripts", "create-published-verification-evidence.mjs");
const publishedVerificationVerifier = path.join(root, "scripts", "verify-published-verification-evidence.mjs");
const packagedDocsChecker = path.join(root, "scripts", "check-packaged-docs.mjs");
const realCompatibilityEvidenceCreator = path.join(root, "scripts", "create-real-compatibility-evidence.mjs");
const realCompatibilityEvidenceVerifier = path.join(root, "scripts", "verify-real-compatibility-evidence.mjs");
const releaseStrictCompatibilityEvidenceCreator = path.join(root, "scripts", "create-release-strict-compatibility-evidence.mjs");
const mainReleaseCandidateEvidenceCreator = path.join(root, "scripts", "create-main-release-candidate-evidence.mjs");
const releaseCandidateCreator = path.join(root, "scripts", "create-release-candidate.mjs");
const releaseArtifactNormalizer = path.join(root, "scripts", "normalize-release-artifacts.mjs");
const packageContentEquivalenceVerifier = path.join(root, "scripts", "verify-package-content-equivalence.mjs");
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
const expectedPublishedVerificationArtifacts = [
  "agent-cli-runtime-published-verification",
];
const fixtureSha = "0123456789abcdef0123456789abcdef01234567";
const releaseCompatibilityGateCommand = "npm run compat:real:evidence:verify -- --target-sha <target_sha> --max-age-hours 24 --release-strict";
const releaseCompatibilityRepoOnlySkippedCommand = "repo-only real compatibility evidence not refreshed in CI";

function releaseCompatibilityGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "real-compatibility-evidence",
    script: "compat:real:evidence:verify",
    command: releaseCompatibilityGateCommand,
    ok: true,
    outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
    evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
    targetSha: { expected: fixtureSha, actual: fixtureSha, ok: true, status: "matched" },
    freshness: { maxAgeHours: 24, ageHours: 1.25, ok: true, status: "fresh" },
    dirtyPolicy: { policy: "release-strict", allowDirty: false, gitDirty: false, inputDirty: false, outputDirty: true, ok: true, status: "self_dirty_only" },
    diagnostics: { count: 0, codes: [] },
    ...overrides,
  };
}

function releaseCompatibilityRepoOnlySkippedGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "real-compatibility-evidence",
    script: "compat:real:evidence:verify",
    command: releaseCompatibilityRepoOnlySkippedCommand,
    ok: true,
    outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
    evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
    targetSha: { expected: fixtureSha, actual: null, ok: null, status: "repo_only_not_run" },
    freshness: { maxAgeHours: 24, ageHours: null, ok: null, status: "repo_only_not_run" },
    dirtyPolicy: {
      policy: "repo-only-skipped",
      allowDirty: false,
      gitDirty: null,
      inputDirty: null,
      outputDirty: null,
      ok: null,
      status: "repo_only_not_run",
    },
    diagnostics: { count: 0, codes: [] },
    repoOnlyEvidence: {
      status: "not_refreshed_in_ci",
      reason: "real_compatibility_matrix_is_repo_only",
    },
    ...overrides,
  };
}

function releaseArtifactFixture(): { pack: Array<{ filename: string; files: Array<{ path: string; size: number; mode: number }> }>; files: Record<string, string> } {
  const pack = [{
    id: "agent-cli-runtime@0.1.0-alpha.0",
    name: "agent-cli-runtime",
    version: "0.1.0-alpha.0",
    filename: "agent-cli-runtime-0.1.0-alpha.0.tgz",
    files: [
      { path: "dist/index.js", size: 1, mode: 420 },
      { path: "README.md", size: 1, mode: 420 },
      { path: "docs/release-report.md", size: 1, mode: 420 },
    ],
  }];
  const gateEvidence = {
    schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
    generatedAt: "2026-06-29T00:00:00.000Z",
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
      releaseCompatibilityRepoOnlySkippedGate(),
    ],
    noAuthenticatedRealRun: true,
    noNpmPublish: true,
    noNpmToken: true,
  };
  return {
    pack,
    files: {
      "npm-pack.json": JSON.stringify(pack, null, 2),
      "package-files.txt": `${pack[0].files.map((file) => file.path).join("\n")}\n`,
      "gate-evidence.json": JSON.stringify(gateEvidence, null, 2),
      "release-verification.json": JSON.stringify({ schemaVersion: "agent-cli-runtime.releaseVerification.v1", ok: true }, null, 2),
      [pack[0].filename]: "fake tarball",
    },
  };
}

async function writeDownloadedReleaseArtifactFixture(downloadDir: string): Promise<{ tarball: string }> {
  const fixture = releaseArtifactFixture();
  const placements: Array<[string, string]> = [
    ["agent-cli-runtime-pack-metadata", "npm-pack.json"],
    ["agent-cli-runtime-package-files", "package-files.txt"],
    ["agent-cli-runtime-gate-evidence", "gate-evidence.json"],
    ["agent-cli-runtime-release-verification", "release-verification.json"],
    ["agent-cli-runtime-tarball", fixture.pack[0].filename],
  ];

  for (const [artifactDir, file] of placements) {
    const dir = path.join(downloadDir, artifactDir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), fixture.files[file], "utf8");
  }

  return { tarball: fixture.pack[0].filename };
}

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

function expectNoLocalOrSecretLeak(text: string): void {
  expect(text).not.toContain(process.env.HOME ?? "__no_home__");
  expect(text).not.toContain("/Users/");
  expect(text).not.toContain("/tmp/");
  expect(text).not.toContain("/private/tmp/");
  expect(text).not.toContain("/var/folders/");
  expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
  expect(text).not.toMatch(/\bBearer\s+[A-Za-z0-9+/_=-]{10,}\b/u);
  expect(text).not.toMatch(/\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=/iu);
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

async function digest(file: string, algorithm: "sha1" | "sha256"): Promise<string> {
  return createHash(algorithm).update(await readFile(file)).digest("hex");
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
    const compatibility = await readFile(path.join(root, "docs", "compatibility.md"), "utf8");
    expect(compatibility).toContain("## P8-2 Current Real CLI Compatibility Matrix");
    expect(compatibility).toContain("P6-1 safe preflight command results");
    expect(compatibility).toContain("P6-1 adapter evidence");
    expect(compatibility).not.toContain("Current safe preflight command results");
    expect(compatibility).not.toContain("Current adapter evidence");
    expect(releaseVerifierText).toContain("agent-cli-runtime.releaseVerification.v1");
    expect(releaseVerifierText).toContain("agent-cli-runtime.releaseGateEvidence.v1");
    expect(releaseCandidateCreatorText).toContain("agent-cli-runtime.releaseGateEvidence.v1");
    expect(apiContract).toContain("agent-cli-runtime.publishedVerification.v1");
    expect(apiContract).toContain("agent-cli-runtime.realCompatibilityMatrix.v1");
    expect(apiContract).toContain("gitSha");
    expect(apiContract).toContain("gitInputDirty");
    expect(apiContract).toContain("gitOutputDirty");
    expect(apiContract).toContain("dirtySummary");
    expect(apiContract).toContain("targetSha");
    expect(apiContract).toContain("freshness");
    expect(apiContract).toContain("dirtyPolicy");
    expect(apiContract).toContain("repoOnlyEvidence");
    expect(apiContract).toContain(releaseCompatibilityGateCommand);
    expect(apiContract).toContain(releaseCompatibilityRepoOnlySkippedCommand);
    expect(apiContract).toContain("repo-only-skipped");
    expect(apiContract).toContain("not_refreshed_in_ci");
    expect(apiContract).not.toContain("Repo-only real compatibility evidence uses `agent-cli-runtime.realCompatibilityEvidence.v1`");
    expect(apiContract).not.toContain("`gitHeadSha`, `gitDirty`, `gitStatusBeforeWrite`, and `gitStatusAfterWrite`");
    expect(apiContract).not.toContain('command: "npm run compat:real:evidence:verify"');
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
      files: string[];
    };
    const daemonScript = await readFile(daemonVerifier, "utf8");
    const runtimeSafetyScript = await readFile(runtimeSafetyVerifier, "utf8");
    const publishedDaemonScript = await readFile(publishedDaemonConsumerVerifier, "utf8");
    const publishedAdaptersScript = await readFile(publishedAdaptersVerifier, "utf8");
    const publishedVerificationScript = await readFile(publishedVerificationCreator, "utf8");
    const publishedVerificationVerifierScript = await readFile(publishedVerificationVerifier, "utf8");
    const realCompatibilityEvidenceScript = await readFile(realCompatibilityEvidenceCreator, "utf8");
    const realCompatibilityEvidenceVerifierScript = await readFile(realCompatibilityEvidenceVerifier, "utf8");
    const packageContentEquivalenceScript = await readFile(packageContentEquivalenceVerifier, "utf8");

    expect(manifest.scripts.test).not.toContain("daemon:verify");
    expect(manifest.scripts.test).not.toContain("runtime:safety");
    expect(manifest.scripts.test).not.toContain("published:daemon:verify");
    expect(manifest.scripts.test).not.toContain("published:adapters:verify");
    expect(manifest.scripts.test).not.toContain("published:verify");
    expect(manifest.scripts.test).not.toContain("compat:real:evidence");
    expect(manifest.scripts.ci).not.toContain("daemon:verify");
    expect(manifest.scripts.ci).not.toContain("runtime:safety");
    expect(manifest.scripts.ci).not.toContain("published:daemon:verify");
    expect(manifest.scripts.ci).not.toContain("published:adapters:verify");
    expect(manifest.scripts.ci).not.toContain("published:verify");
    expect(manifest.scripts.ci).not.toContain("compat:real:evidence");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run daemon:verify");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run runtime:safety");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run package:check");
    expect(manifest.scripts["package:check"]).toContain("check-packaged-docs.mjs");
    expect(manifest.scripts["package:docs:check"]).toBe("node ./scripts/check-packaged-docs.mjs");
    expect(manifest.scripts["prepublish:check"]).not.toContain("published:daemon:verify");
    expect(manifest.scripts["prepublish:check"]).not.toContain("published:adapters:verify");
    expect(manifest.scripts["prepublish:check"]).not.toContain("published:verify");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run compat:real:evidence:verify");
    expect(manifest.scripts["prepublish:check"]).not.toContain("npm run compat:real:evidence &&");
    expect(manifest.scripts.dogfood).not.toContain("compat:real:evidence:verify");

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

    expect(manifest.scripts["published:daemon:verify"]).toBe("node ./scripts/verify-published-daemon-consumer.mjs");
    expect(publishedDaemonScript).toContain("agent-runtime.publishedDaemonConsumer.v1");
    expect(publishedDaemonScript).toContain("packageSource: \"npm-registry\"");
    expect(publishedDaemonScript).toContain("\"install\", spec");
    expect(publishedDaemonScript).toContain("createAgentRuntime");
    expect(publishedDaemonScript).toContain("secondWriterRefusal");
    expect(publishedDaemonScript).toContain("staleOwnerRecovery");
    expect(publishedDaemonScript).not.toContain("--allow-real-run");
    expect(publishedDaemonScript).not.toMatch(/\bnpm publish\b/u);
    expect(publishedDaemonScript).not.toContain("NODE_AUTH_TOKEN");

    expect(manifest.scripts["published:adapters:verify"]).toBe("node ./scripts/verify-published-adapters.mjs");
    expect(manifest.files).not.toContain("scripts/verify-published-adapters.mjs");
    expect(publishedAdaptersScript).toContain("agent-runtime.publishedAdapters.v1");
    expect(publishedAdaptersScript).toContain("packageSource: \"npm-registry\"");
    expect(publishedAdaptersScript).toContain("\"install\", spec");
    expect(publishedAdaptersScript).toContain("createAgentRuntime");
    expect(publishedAdaptersScript).toContain("conformance");
    expect(publishedAdaptersScript).toContain("failureIsolation");
    expect(publishedAdaptersScript).toContain("promptNotInArgv");
    expect(publishedAdaptersScript).not.toContain("--allow-real-run");
    expect(publishedAdaptersScript).not.toMatch(/\bnpm publish\b/u);
    expect(publishedAdaptersScript).not.toContain("NODE_AUTH_TOKEN");

    expect(manifest.scripts["published:verify"]).toBe("node ./scripts/create-published-verification-evidence.mjs");
    expect(manifest.scripts["published:verify:evidence"]).toBe("node ./scripts/verify-published-verification-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/create-published-verification-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/verify-published-verification-evidence.mjs");
    expect(publishedVerificationScript).toContain("agent-cli-runtime.publishedVerification.v1");
    expect(publishedVerificationScript).toContain("npm run smoke:published");
    expect(publishedVerificationScript).toContain("npm run published:daemon:verify");
    expect(publishedVerificationScript).toContain("npm run published:adapters:verify");
    expect(publishedVerificationScript).toContain("npm run release:post-alpha:verify");
    expect(publishedVerificationScript).toContain("npm view");
    expect(publishedVerificationScript).toContain("check-packaged-docs.mjs");
    expect(publishedVerificationScript).toContain("registryPackageDocsInspection");
    expect(publishedVerificationScript).toContain("noAuthenticatedRealRun: true");
    expect(publishedVerificationScript).toContain("noNpmPublish: true");
    expect(publishedVerificationScript).toContain("noNpmToken: true");
    expect(publishedVerificationScript).toContain("digestMatchesDownloadedSha256");
    expect(publishedVerificationScript).not.toContain("sizeBytes: payload.githubRelease.tarballAsset.sizeBytes");
    expect(publishedVerificationScript).not.toContain("digest: payload.githubRelease.tarballAsset.digest");
    expect(publishedVerificationScript).toContain("outDir: displayPath(outDir)");
    expect(publishedVerificationScript).toContain("return path.basename(file)");
    expect(publishedVerificationScript).not.toMatch(/\bnpm publish\b/u);
    expect(publishedVerificationScript).not.toContain("--allow-real-run");
    expect(publishedVerificationVerifierScript).toContain("agent-cli-runtime.publishedVerification.v1");
    expect(publishedVerificationVerifierScript).toContain("agent-cli-runtime.packagedDocsVerification.v1");
    expect(publishedVerificationVerifierScript).toContain("registryPackageDocsInspection");
    expect(publishedVerificationVerifierScript).toContain("failedGateRejected");
    expect(publishedVerificationVerifierScript).toContain("unsafeContentRejected");
    expect(publishedVerificationVerifierScript).not.toMatch(/\bnpm publish\b/u);
    expect(publishedVerificationVerifierScript).not.toContain("--allow-real-run");

    expect(manifest.scripts["compat:real:evidence"]).toBe("node ./scripts/create-real-compatibility-evidence.mjs");
    expect(manifest.scripts["compat:real:evidence:verify"]).toBe("node ./scripts/verify-real-compatibility-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/create-real-compatibility-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/verify-real-compatibility-evidence.mjs");
    expect(realCompatibilityEvidenceScript).toContain("agent-cli-runtime.realCompatibilityMatrix.v1");
    expect(realCompatibilityEvidenceScript).toContain("agent-cli-runtime.realCompatibilityEvidence.v1");
    expect(realCompatibilityEvidenceScript).toContain("p8-2-real-cli-compatibility-matrix.json");
    expect(realCompatibilityEvidenceScript).toContain("buildCompatibilityMatrix");
    expect(realCompatibilityEvidenceScript).toContain("safePreflightOnly");
    expect(realCompatibilityEvidenceScript).toContain("noAuthenticatedRealRunByDefault");
    expect(realCompatibilityEvidenceScript).toContain("gitDirty");
    expect(realCompatibilityEvidenceScript).toContain("dirtySummary");
    expect(realCompatibilityEvidenceScript).toContain("gitStatusBeforeWrite");
    expect(realCompatibilityEvidenceScript).toContain("gitStatusAfterWrite");
    expect(realCompatibilityEvidenceScript).toContain("HEAD commit only");
    expect(realCompatibilityEvidenceScript).toContain("--allow-real-run requires");
    expect(realCompatibilityEvidenceScript).toContain("--expect-text is required");
    expect(realCompatibilityEvidenceScript).toContain("needsVerificationAudit");
    expect(realCompatibilityEvidenceScript).not.toMatch(/\bnpm publish\b/u);
    expect(realCompatibilityEvidenceScript).not.toContain("NODE_AUTH_TOKEN");
    expect(realCompatibilityEvidenceVerifierScript).toContain("agent-cli-runtime.realCompatibilityEvidenceVerification.v1");
    expect(realCompatibilityEvidenceVerifierScript).toContain("agent-cli-runtime.realCompatibilityMatrix.v1");
    expect(realCompatibilityEvidenceVerifierScript).toContain("--target-sha");
    expect(realCompatibilityEvidenceVerifierScript).toContain("--max-age-hours");
    expect(realCompatibilityEvidenceVerifierScript).toContain("--allow-dirty");
    expect(realCompatibilityEvidenceVerifierScript).toContain("--release-strict");
    expect(realCompatibilityEvidenceVerifierScript).toContain("invalid_schema");
    expect(realCompatibilityEvidenceVerifierScript).toContain("unsafe_content");
    expect(realCompatibilityEvidenceVerifierScript).toContain("missing_dirty_state");
    expect(realCompatibilityEvidenceVerifierScript).toContain("target_sha_mismatch");
    expect(realCompatibilityEvidenceVerifierScript).toContain("evidence_too_old");
    expect(realCompatibilityEvidenceVerifierScript).toContain("dirty_evidence_not_allowed");
    expect(realCompatibilityEvidenceVerifierScript).toContain("skip_state_claimed_as_success");
    expect(realCompatibilityEvidenceVerifierScript).toContain("authenticated_success_incomplete");
    expect(realCompatibilityEvidenceVerifierScript).toContain("needs_verification_missing");
    expect(realCompatibilityEvidenceVerifierScript).toContain("package_boundary_invalid");
    expect(realCompatibilityEvidenceVerifierScript).not.toMatch(/\bnpm publish\b/u);
    expect(realCompatibilityEvidenceVerifierScript).not.toContain("NODE_AUTH_TOKEN");
    expect(realCompatibilityEvidenceVerifierScript).not.toContain("--allow-real-run");

    expect(manifest.scripts["release:package-content:verify"]).toBe("node ./scripts/verify-package-content-equivalence.mjs");
    expect(manifest.files).not.toContain("scripts/verify-package-content-equivalence.mjs");
    expect(packageContentEquivalenceScript).toContain("agent-cli-runtime.packageContentEquivalence.v1");
    expect(packageContentEquivalenceScript).toContain("--base-ref");
    expect(packageContentEquivalenceScript).toContain("--head-ref");
    expect(packageContentEquivalenceScript).toContain("worktree");
    expect(packageContentEquivalenceScript).toContain("freshReleaseCandidateRequired");
    expect(packageContentEquivalenceScript).toContain("evidenceOnlyDrift");
    expect(packageContentEquivalenceScript).not.toMatch(/\bnpm publish\b/u);
    expect(packageContentEquivalenceScript).not.toContain("NODE_AUTH_TOKEN=secret");
    expect(packageContentEquivalenceScript).not.toContain("--allow-real-run");
  });

  it("keeps published verification evidence verifier strict, redacted, and offline testable", async () => {
    const { stdout } = await execFileP(process.execPath, [publishedVerificationVerifier, "--self-test"]);
    const result = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      checks: {
        validSummaryAccepted: boolean;
        failedGateRejected: boolean;
        unsafeContentRejected: boolean;
        safetyFlagsChecked: boolean;
        packagedDocsChecked: boolean;
      };
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
    };

    expect(result).toMatchObject({
      schemaVersion: "agent-cli-runtime.publishedVerification.v1",
      ok: true,
      checks: {
        validSummaryAccepted: true,
        failedGateRejected: true,
        unsafeContentRejected: true,
        safetyFlagsChecked: true,
        packagedDocsChecked: true,
      },
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
  });

  it("reports missing default published verification evidence as actionable redacted JSON", async () => {
    const isolatedCwd = await tempDir("agent-runtime-published-verification-missing-");
    const failure = await execCliFailureViaNode([publishedVerificationVerifier], { cwd: isolatedCwd });
    const payload = JSON.parse(failure.stdout) as {
      schemaVersion: string;
      ok: boolean;
      diagnostics: Array<{ code: string; message: string; expectedFile?: string; nextCommands?: string[]; githubArtifactHint?: string }>;
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
    };

    expect(failure.code).toBe(1);
    expect(payload).toMatchObject({
      schemaVersion: "agent-cli-runtime.publishedVerification.v1",
      ok: false,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
    expect(payload.diagnostics[0]).toMatchObject({
      code: "missing_default_evidence_file",
      expectedFile: "published-verification/published-verification.json",
      nextCommands: [
        "npm run published:verify -- --out-dir published-verification",
        "npm run published:verify:evidence -- --dir published-verification",
      ],
      githubArtifactHint: "For GitHub artifact verification, download agent-cli-runtime-published-verification and pass --dir <downloaded-artifact-dir>.",
    });
    expect(payload.diagnostics[0]?.message).toContain("published:verify:evidence is a verifier");
    expect(failure.stdout).not.toContain(isolatedCwd);
    expect(failure.stdout).not.toContain(root);
    expect(failure.stdout).not.toContain(process.env.HOME ?? "__no_home__");
    expect(failure.stdout).not.toContain("/tmp/");
    expect(failure.stdout).not.toContain("/private/tmp/");
    expect(failure.stdout).not.toContain("/var/folders/");
  });

  it("accepts published verification evidence from an explicit --dir", async () => {
    const evidenceDir = await tempDir("agent-runtime-published-verification-valid-");
    const summary = {
      schemaVersion: "agent-cli-runtime.publishedVerification.v1",
      ok: true,
      packageName: "agent-cli-runtime",
      version: "0.1.0-alpha.3",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      checkedAt: "2026-06-26T00:00:00.000Z",
      packageSource: "npm-registry",
      gates: [
        { script: "smoke:published", command: "npm run smoke:published", ok: true, schemaVersion: "agent-cli-runtime.publishedSmoke.v1", durationMs: 1 },
        { script: "published:daemon:verify", command: "npm run published:daemon:verify", ok: true, schemaVersion: "agent-runtime.publishedDaemonConsumer.v1", durationMs: 1 },
        { script: "published:adapters:verify", command: "npm run published:adapters:verify", ok: true, schemaVersion: "agent-runtime.publishedAdapters.v1", durationMs: 1 },
        { script: "release:post-alpha:verify", command: "npm run release:post-alpha:verify", ok: true, schemaVersion: "agent-cli-runtime.postAlphaEvidence.v1", durationMs: 1 },
      ],
      registry: {
        command: "npm view agent-cli-runtime@0.1.0-alpha.3 version dist-tags dist --json",
        ok: true,
        durationMs: 1,
        summary: { version: "0.1.0-alpha.3", distTags: { alpha: "0.1.0-alpha.3" }, dist: { tarball: "agent-cli-runtime-0.1.0-alpha.3.tgz" } },
        diagnostics: [],
      },
      registryPackageDocsInspection: {
        command: "node ./scripts/check-packaged-docs.mjs --package-spec agent-cli-runtime@0.1.0-alpha.3",
        ok: true,
        durationMs: 1,
        schemaVersion: "agent-cli-runtime.packagedDocsVerification.v1",
        packageSource: "npm-registry",
        version: "0.1.0-alpha.3",
        inspectedDocs: [{ path: "README.md", ok: true }],
        diagnostics: [],
        noAlpha3UnpublishedClaim: true,
        noDryRunStopPoint: true,
        noPublishReadyCandidate: true,
        noOldDistTagClaim: true,
      },
      diagnostics: [],
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    };
    await writeFile(path.join(evidenceDir, "published-verification.json"), `${JSON.stringify(summary)}\n`, "utf8");

    const { stdout } = await execFileP(process.execPath, [publishedVerificationVerifier, "--dir", evidenceDir]);
    const payload = JSON.parse(stdout) as { ok: boolean; checkedGates: string[]; diagnostics: unknown[] };

    expect(payload.ok).toBe(true);
    expect(payload.checkedGates.sort()).toEqual([
      "published:adapters:verify",
      "published:daemon:verify",
      "release:post-alpha:verify",
      "smoke:published",
    ]);
    expect(payload.diagnostics).toEqual([]);
  });

  it("keeps real compatibility evidence creator explicit and offline self-testable", async () => {
    const { stdout } = await execFileP(process.execPath, [realCompatibilityEvidenceCreator, "--self-test"]);
    const result = JSON.parse(stdout) as { schemaVersion: string; ok: boolean };

    expect(result.schemaVersion).toBe("agent-cli-runtime.realCompatibilityMatrix.v1");
    expect(result.ok).toBe(true);

    const missingBoundary = await execCliFailureViaNode([realCompatibilityEvidenceCreator, "--allow-real-run"]);
    expect(missingBoundary.code).toBe(1);
    expect(missingBoundary.stderr).toContain("--allow-real-run requires");

    const missingExpectedText = await execCliFailureViaNode([realCompatibilityEvidenceCreator, "--allow-real-run", "--agent", "codex"]);
    expect(missingExpectedText.code).toBe(1);
    expect(missingExpectedText.stderr).toContain("--agent codex requires");

    const externalOutDir = await tempDir("agent-runtime-real-evidence-external-out-");
    const externalOutFile = path.join(externalOutDir, "real-compatibility.json");
    try {
      const externalStdout = (await execFileP("npm", [
        "run",
        "--silent",
        "compat:real:evidence",
        "--",
        "--out",
        externalOutFile,
      ], {
        cwd: root,
        timeout: 30_000,
      })).stdout;
      const externalOut = JSON.parse(externalStdout) as { ok: boolean; schemaVersion: string; output: string };
      expect(externalOut).toMatchObject({
        ok: true,
        schemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
        output: "<external_evidence_file>",
      });
      expect(externalOut.output).not.toContain("..");
      expect(externalStdout).not.toContain(externalOutDir);
      expect(externalStdout).not.toContain(process.env.HOME ?? "__no_home__");
      expect(externalStdout).not.toContain("/tmp/");
      expect(externalStdout).not.toContain("/private/tmp/");
      expect(externalStdout).not.toContain("/var/folders/");
      expect(externalStdout).not.toContain("..");
    } finally {
      await rm(externalOutDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps real compatibility evidence verifier strict, redacted, and offline testable", async () => {
    const { stdout } = await execFileP(process.execPath, [realCompatibilityEvidenceVerifier, "--self-test"]);
    const result = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      checks: {
        validFixtureAccepted: boolean;
        unsafeContentRejected: boolean;
        rawCommandOutputRejected: boolean;
        missingDirtyStateRejected: boolean;
        skipStateClaimedAsSuccessRejected: boolean;
        authenticatedSuccessIncompleteRejected: boolean;
        nonSuccessAuthenticatedRawOutputRejected: boolean;
        needsVerificationMissingRejected: boolean;
        packageBoundaryInvalidRejected: boolean;
        validMatrixAccepted: boolean;
        targetShaMatchAccepted: boolean;
        targetShaMismatchRejected: boolean;
        staleEvidenceRejected: boolean;
        releaseStrictDirtyRejected: boolean;
        releaseStrictDirtyAllowed: boolean;
        releaseStrictSelfDirtyAccepted: boolean;
        matrixSkipStateClaimedAsSuccessRejected: boolean;
        matrixMissingAdapterRejected: boolean;
        matrixUnredactedExecutableRejected: boolean;
        matrixTemporaryPathRejected: boolean;
      };
    };

    expect(result).toMatchObject({
      schemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      ok: true,
      checks: {
        validFixtureAccepted: true,
        unsafeContentRejected: true,
        rawCommandOutputRejected: true,
        missingDirtyStateRejected: true,
        skipStateClaimedAsSuccessRejected: true,
        authenticatedSuccessIncompleteRejected: true,
        nonSuccessAuthenticatedRawOutputRejected: true,
        needsVerificationMissingRejected: true,
        packageBoundaryInvalidRejected: true,
        validMatrixAccepted: true,
        targetShaMatchAccepted: true,
        targetShaMismatchRejected: true,
        staleEvidenceRejected: true,
        releaseStrictDirtyRejected: true,
        releaseStrictDirtyAllowed: true,
        releaseStrictSelfDirtyAccepted: true,
        matrixSkipStateClaimedAsSuccessRejected: true,
        matrixMissingAdapterRejected: true,
        matrixUnredactedExecutableRejected: true,
        matrixTemporaryPathRejected: true,
      },
    });

    const valid = JSON.parse((await execFileP(process.execPath, [realCompatibilityEvidenceVerifier])).stdout) as {
      schemaVersion: string;
      ok: boolean;
      evidenceSchemaVersion: string;
      targetSha: { status: string; ok: boolean | null };
      freshness: { status: string; ok: boolean | null };
      dirtyPolicy: { status: string; ok: boolean };
      diagnosticSummary: { count: number; codes: string[] };
      diagnostics: Array<{ code: string; message: string }>;
    };
    expect(valid).toMatchObject({
      schemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      ok: true,
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      targetSha: { status: "not_requested", ok: null },
      freshness: { status: "not_requested", ok: null },
      dirtyPolicy: { ok: true },
      diagnosticSummary: { count: 0, codes: [] },
      diagnostics: [],
    });

    const dir = await tempDir("agent-runtime-real-evidence-verify-");
    const validFixture = {
      schemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1",
      gitHeadSha: "0123456789abcdef0123456789abcdef01234567",
      gitDirty: true,
      gitStatusBeforeWrite: { headSha: "0123456789abcdef0123456789abcdef01234567", dirty: true, changedFilesCount: 1, changedFiles: [] },
      gitStatusAfterWrite: { headSha: "0123456789abcdef0123456789abcdef01234567", dirty: true, changedFilesCount: 1, changedFiles: [] },
      commands: [{ command: "node ./dist/cli/main.js agents --json", exitCode: 0, schemaVersion: null, ok: null, summary: {} }],
      safeRealSmokes: {
        codex: { ok: false, runClassification: "real_run_skipped" },
        claude: { ok: false, runClassification: "auth_missing" },
        opencode: { ok: false, runClassification: "real_run_skipped" },
      },
      authenticatedRealSmokes: [],
      needsVerificationAudit: [
        { adapter: "codex", items: [{ mapsTo: "session" }, { mapsTo: "authProbe" }] },
        { adapter: "claude", items: [{ mapsTo: "session.id" }, { mapsTo: "reasoning" }] },
        { adapter: "opencode", items: [{ mapsTo: "extraAllowedDirs" }, { mapsTo: "session" }, { mapsTo: "permissionPolicy.read-only" }] },
      ],
      packageBoundary: { releaseEvidenceIsRepoOnly: true },
    };
    const unsafeFile = path.join(dir, "unsafe.json");
    await writeFile(unsafeFile, JSON.stringify({
      ...validFixture,
      commands: [{ ...validFixture.commands[0], summary: { token: `sk-${"A".repeat(24)}` } }],
    }), "utf8");
    const failure = await execCliFailureViaNode([realCompatibilityEvidenceVerifier, "--file", unsafeFile]);
    const failurePayload = JSON.parse(failure.stdout) as { ok: boolean; diagnostics: Array<{ code: string; message: string }> };
    expect(failure.code).toBe(1);
    expect(failurePayload.ok).toBe(false);
    expect(failurePayload.diagnostics.some((diagnostic) => diagnostic.code === "unsafe_content")).toBe(true);
    expect(failure.stdout).not.toContain(`sk-${"A".repeat(24)}`);

    const rawOutputFile = path.join(dir, "raw-output.json");
    await writeFile(rawOutputFile, JSON.stringify({
      ...validFixture,
      commands: [{ ...validFixture.commands[0], summary: { nested: { rawStdout: "raw cli output without secrets" } } }],
    }), "utf8");
    const rawOutputFailure = await execCliFailureViaNode([realCompatibilityEvidenceVerifier, "--file", rawOutputFile]);
    const rawOutputPayload = JSON.parse(rawOutputFailure.stdout) as { ok: boolean; diagnostics: Array<{ code: string; message: string }> };
    expect(rawOutputFailure.code).toBe(1);
    expect(rawOutputPayload.ok).toBe(false);
    expect(rawOutputPayload.diagnostics.some((diagnostic) => diagnostic.code === "unsafe_content")).toBe(true);

    const tempPathLeakFile = path.join(dir, "temp-path-leak.json");
    await writeFile(tempPathLeakFile, JSON.stringify({
      ...validFixture,
      commands: [{ ...validFixture.commands[0], summary: { message: "leaked " + "/" + "var/folders/example/runtime" } }],
    }), "utf8");
    const tempPathLeakFailure = await execCliFailureViaNode([realCompatibilityEvidenceVerifier, "--file", tempPathLeakFile]);
    const tempPathLeakPayload = JSON.parse(tempPathLeakFailure.stdout) as { ok: boolean; file: string; diagnostics: Array<{ code: string; message: string }> };
    expect(tempPathLeakFailure.code).toBe(1);
    expect(tempPathLeakPayload.ok).toBe(false);
    expect(tempPathLeakPayload.file).toBe("<external_evidence_file>");
    expect(tempPathLeakPayload.diagnostics.some((diagnostic) => diagnostic.code === "unsafe_content")).toBe(true);
    expect(tempPathLeakFailure.stdout).not.toContain(dir);
    expect(tempPathLeakFailure.stdout).not.toContain("/tmp/");
    expect(tempPathLeakFailure.stdout).not.toContain("/private/tmp/");
    expect(tempPathLeakFailure.stdout).not.toContain("/var/folders/");

    const nonSuccessAuthenticatedRawOutputFile = path.join(dir, "non-success-auth-raw-output.json");
    await writeFile(nonSuccessAuthenticatedRawOutputFile, JSON.stringify({
      ...validFixture,
      authenticatedRealSmokes: [{ agent: "claude", ok: false, runClassification: "auth_missing", rawStdout: "raw cli output should be rejected" }],
    }), "utf8");
    const nonSuccessAuthenticatedRawOutputFailure = await execCliFailureViaNode([
      realCompatibilityEvidenceVerifier,
      "--file",
      nonSuccessAuthenticatedRawOutputFile,
    ]);
    const nonSuccessAuthenticatedRawOutputPayload = JSON.parse(nonSuccessAuthenticatedRawOutputFailure.stdout) as {
      ok: boolean;
      diagnostics: Array<{ code: string; message: string }>;
    };
    expect(nonSuccessAuthenticatedRawOutputFailure.code).toBe(1);
    expect(nonSuccessAuthenticatedRawOutputPayload.ok).toBe(false);
    expect(nonSuccessAuthenticatedRawOutputPayload.diagnostics.some((diagnostic) => diagnostic.code === "unsafe_content")).toBe(true);

    const matrixText = await readFile(path.join(root, ".release-evidence", "p8-2-real-cli-compatibility-matrix.json"), "utf8");
    const matrix = JSON.parse(matrixText) as {
      gitSha: string;
      gitDirty: boolean;
      checkedAt: string;
      dirtySummary: {
        beforeWrite: { dirty: boolean; changedFilesCount: number; changedFiles: unknown[]; truncated?: boolean };
        afterWrite: { dirty: boolean; changedFilesCount: number; changedFiles: unknown[]; truncated?: boolean };
      };
    };
    const targetMatch = JSON.parse((await execFileP(process.execPath, [
      realCompatibilityEvidenceVerifier,
      "--target-sha",
      matrix.gitSha,
    ])).stdout) as {
      ok: boolean;
      targetSha: { expected: string; actual: string; ok: boolean; status: string };
      diagnosticSummary: { count: number; codes: string[] };
    };
    expect(targetMatch).toMatchObject({
      ok: true,
      targetSha: { expected: matrix.gitSha, actual: matrix.gitSha, ok: true, status: "matched" },
      diagnosticSummary: { count: 0, codes: [] },
    });

    const targetMismatchFailure = await execCliFailureViaNode([
      realCompatibilityEvidenceVerifier,
      "--target-sha",
      "f".repeat(40),
    ]);
    const targetMismatch = JSON.parse(targetMismatchFailure.stdout) as {
      ok: boolean;
      targetSha: { expected: string; actual: string; ok: boolean; status: string };
      diagnostics: Array<{ code: string }>;
      diagnosticSummary: { count: number; codes: string[] };
    };
    expect(targetMismatchFailure.code).toBe(1);
    expect(targetMismatch).toMatchObject({
      ok: false,
      targetSha: { expected: "f".repeat(40), actual: matrix.gitSha, ok: false, status: "mismatched" },
    });
    expect(targetMismatch.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "target_sha_mismatch" }),
    ]));
    expect(targetMismatch.diagnosticSummary.codes).toContain("target_sha_mismatch");
    expectNoLocalOrSecretLeak(targetMismatchFailure.stdout + targetMismatchFailure.stderr);

    const staleMatrixFile = path.join(dir, "stale-matrix.json");
    await writeFile(staleMatrixFile, JSON.stringify({
      ...matrix,
      checkedAt: "2000-01-01T00:00:00.000Z",
    }), "utf8");
    const staleFailure = await execCliFailureViaNode([
      realCompatibilityEvidenceVerifier,
      "--file",
      staleMatrixFile,
      "--max-age-hours",
      "1",
    ]);
    const stale = JSON.parse(staleFailure.stdout) as {
      ok: boolean;
      freshness: { maxAgeHours: number; ok: boolean; status: string; ageHours: number };
      diagnostics: Array<{ code: string }>;
    };
    expect(staleFailure.code).toBe(1);
    expect(stale.ok).toBe(false);
    expect(stale.freshness).toMatchObject({ maxAgeHours: 1, ok: false, status: "expired" });
    expect(stale.freshness.ageHours).toBeGreaterThan(1);
    expect(stale.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "evidence_too_old" }),
    ]));
    expectNoLocalOrSecretLeak(staleFailure.stdout + staleFailure.stderr);

    const dirtyMatrixFile = path.join(dir, "dirty-matrix.json");
    const dirtyState = { dirty: true, changedFilesCount: 1, changedFiles: [{ status: "M", path: "README.md" }], truncated: false };
    await writeFile(dirtyMatrixFile, JSON.stringify({
      ...matrix,
      gitDirty: true,
      gitInputDirty: true,
      gitOutputDirty: false,
      dirtySummary: {
        outputPath: ".release-evidence/p8-2-real-cli-compatibility-matrix.json",
        beforeWrite: dirtyState,
        afterWrite: dirtyState,
        inputBeforeWrite: dirtyState,
        inputAfterWrite: dirtyState,
        outputBeforeWrite: { dirty: false, changedFilesCount: 0, changedFiles: [], truncated: false },
        outputAfterWrite: { dirty: false, changedFilesCount: 0, changedFiles: [], truncated: false },
      },
    }), "utf8");
    const dirtyStrictFailure = await execCliFailureViaNode([
      realCompatibilityEvidenceVerifier,
      "--file",
      dirtyMatrixFile,
      "--release-strict",
    ]);
    const dirtyStrict = JSON.parse(dirtyStrictFailure.stdout) as {
      ok: boolean;
      dirtyPolicy: { policy: string; allowDirty: boolean; gitDirty: boolean; ok: boolean; status: string };
      diagnostics: Array<{ code: string }>;
    };
    expect(dirtyStrictFailure.code).toBe(1);
    expect(dirtyStrict).toMatchObject({
      ok: false,
      dirtyPolicy: {
        policy: "release-strict",
        allowDirty: false,
        gitDirty: true,
        ok: false,
        status: "dirty_requires_allow",
      },
    });
    expect(dirtyStrict.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dirty_evidence_not_allowed" }),
    ]));
    expectNoLocalOrSecretLeak(dirtyStrictFailure.stdout + dirtyStrictFailure.stderr);

    const dirtyAllowed = JSON.parse((await execFileP(process.execPath, [
      realCompatibilityEvidenceVerifier,
      "--file",
      dirtyMatrixFile,
      "--release-strict",
      "--allow-dirty",
    ])).stdout) as {
      ok: boolean;
      dirtyPolicy: { policy: string; allowDirty: boolean; gitDirty: boolean; ok: boolean; status: string };
      diagnostics: unknown[];
    };
    expect(dirtyAllowed).toMatchObject({
      ok: true,
      dirtyPolicy: {
        policy: "release-strict",
        allowDirty: true,
        gitDirty: true,
        ok: true,
        status: "dirty_allowed",
      },
      diagnostics: [],
    });

    const evidenceOutputPath = ".release-evidence/p8-2-real-cli-compatibility-matrix.json";
    const selfDirtyState = { dirty: true, changedFilesCount: 1, changedFiles: [{ status: "M", path: evidenceOutputPath }], truncated: false };
    const cleanInputState = { dirty: false, changedFilesCount: 0, changedFiles: [], truncated: false };
    const selfDirtyMatrixFile = path.join(dir, "self-dirty-matrix.json");
    await writeFile(selfDirtyMatrixFile, JSON.stringify({
      ...matrix,
      gitDirty: false,
      gitInputDirty: false,
      gitOutputDirty: true,
      dirtySummary: {
        outputPath: evidenceOutputPath,
        beforeWrite: cleanInputState,
        afterWrite: selfDirtyState,
        inputBeforeWrite: cleanInputState,
        inputAfterWrite: cleanInputState,
        outputBeforeWrite: cleanInputState,
        outputAfterWrite: selfDirtyState,
      },
    }), "utf8");
    const selfDirtyStrict = JSON.parse((await execFileP(process.execPath, [
      realCompatibilityEvidenceVerifier,
      "--file",
      selfDirtyMatrixFile,
      "--target-sha",
      matrix.gitSha,
      "--max-age-hours",
      "24",
      "--release-strict",
    ])).stdout) as {
      ok: boolean;
      dirtyPolicy: { policy: string; allowDirty: boolean; gitDirty: boolean; inputDirty: boolean; outputDirty: boolean; ok: boolean; status: string };
      diagnosticSummary: { count: number; codes: string[] };
      diagnostics: unknown[];
    };
    expect(selfDirtyStrict).toMatchObject({
      ok: true,
      dirtyPolicy: {
        policy: "release-strict",
        allowDirty: false,
        gitDirty: false,
        inputDirty: false,
        outputDirty: true,
        ok: true,
        status: "self_dirty_only",
      },
      diagnosticSummary: { count: 0, codes: [] },
      diagnostics: [],
    });
  });

  it("keeps package content equivalence verification repo-only, redacted, and offline testable", async () => {
    const { stdout } = await execFileP(process.execPath, [packageContentEquivalenceVerifier, "--self-test"]);
    const selfTest = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      packageContentEqual: boolean;
      freshReleaseCandidateRequired: boolean;
      selfTest: { cases: Array<{ name: string; ok: boolean }> };
      boundary: Record<string, boolean>;
    };
    expect(selfTest).toMatchObject({
      schemaVersion: "agent-cli-runtime.packageContentEquivalence.v1",
      ok: true,
      packageContentEqual: true,
      freshReleaseCandidateRequired: false,
      boundary: {
        repoOnlyEvidence: true,
        comparedNpmPackageContentOnly: true,
        noAuthenticatedRealRun: true,
        noNpmPublish: true,
        noNpmToken: true,
      },
    });
    expect(selfTest.selfTest.cases.map((testCase) => testCase.name).sort()).toEqual([
      "README fixture reports package-content drift",
      "docs fixture reports package-content drift",
      "package.json fixture reports package-content drift",
      "redaction removes local paths and credentials",
      "release evidence only fixture is package-content equal",
      "same ref package content is equal",
    ].sort());
    expect(selfTest.selfTest.cases.every((testCase) => testCase.ok)).toBe(true);
    expectNoLocalOrSecretLeak(stdout);

    const sameRef = JSON.parse((await execFileP(process.execPath, [
      packageContentEquivalenceVerifier,
      "--base-ref",
      "HEAD",
      "--head-ref",
      "HEAD",
    ], { timeout: 60_000 })).stdout) as {
      schemaVersion: string;
      ok: boolean;
      packageContentEqual: boolean;
      basePackageDigest: string;
      headPackageDigest: string;
      baseFileCount: number;
      headFileCount: number;
      changedPackageFiles: unknown[];
      evidenceOnlyDrift: boolean;
      freshReleaseCandidateRequired: boolean;
      boundary: Record<string, boolean>;
    };
    expect(sameRef).toMatchObject({
      schemaVersion: "agent-cli-runtime.packageContentEquivalence.v1",
      ok: true,
      packageContentEqual: true,
      changedPackageFiles: [],
      evidenceOnlyDrift: false,
      freshReleaseCandidateRequired: false,
      boundary: {
        comparedNpmPackageContentOnly: true,
        noTarballGzipDigestDecision: true,
      },
    });
    expect(sameRef.basePackageDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(sameRef.headPackageDigest).toBe(sameRef.basePackageDigest);
    expect(sameRef.baseFileCount).toBeGreaterThan(0);
    expect(sameRef.headFileCount).toBe(sameRef.baseFileCount);

    const invalid = await execCliFailureViaNode([
      packageContentEquivalenceVerifier,
      "--base-ref",
      `/tmp/leak/sk-${"A".repeat(24)}`,
      "--head-ref",
      "HEAD",
    ]);
    const invalidPayload = JSON.parse(invalid.stdout) as {
      ok: boolean;
      diagnostics: Array<{ code: string; message: string }>;
    };
    expect(invalid.code).toBe(1);
    expect(invalidPayload.ok).toBe(false);
    expect(invalidPayload.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_git_ref" }),
    ]));
    expectNoLocalOrSecretLeak(invalid.stdout + invalid.stderr);
  }, 90_000);

  it("keeps published verification creator stdout from leaking external temp paths on usage errors", async () => {
    const externalOutDir = path.join(await tempDir("agent-runtime-published-verification-out-"), "evidence");
    const failure = await execCliFailureViaNode([
      publishedVerificationCreator,
      "--out-dir",
      externalOutDir,
      "--unknown",
    ]);
    const payload = JSON.parse(failure.stdout) as {
      schemaVersion: string;
      ok: boolean;
      diagnostics: Array<{ code: string; message: string }>;
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
    };

    expect(failure.code).toBe(1);
    expect(payload).toMatchObject({
      schemaVersion: "agent-cli-runtime.publishedVerification.v1",
      ok: false,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
    expect(failure.stdout).not.toContain(externalOutDir);
    expect(failure.stdout).not.toContain("/tmp/");
    expect(failure.stdout).not.toContain("/private/tmp/");
    expect(failure.stdout).not.toContain("/var/folders/");
  });

  it("keeps published adapters verifier schema, redaction, and failure isolation stable", async () => {
    const { stdout } = await execFileP(process.execPath, [publishedAdaptersVerifier, "--self-test"]);
    const payload = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      packageName: string;
      version: string;
      packageSource: string;
      checks: Record<string, boolean>;
      agents: Array<{ adapter: string; promptInArgv: boolean; invocationShapeMatched: boolean; argvShape: string[]; stdinBytesObserved: boolean; stdinFormatMatched: boolean }>;
      diagnostics: { conformanceSchemaVersion: string; failureIsolation: { agents: Array<{ adapter: string; terminalStatus: string }> } };
      noAuthenticatedRealRun: boolean;
    };
    const text = JSON.stringify(payload);

    expect(payload).toMatchObject({
      schemaVersion: "agent-runtime.publishedAdapters.v1",
      ok: true,
      packageName: "agent-cli-runtime",
      packageSource: "npm-registry",
      noAuthenticatedRealRun: true,
    });
    expect(payload.checks).toMatchObject({
      cliAgentsDetectsFakeAdapters: true,
      conformanceFakeSchema: true,
      summariesForAllAdapters: true,
      invocationShapeMatched: true,
      promptNotInArgv: true,
      parserExpectedText: true,
      diagnosticsRedacted: true,
      failureIsolation: true,
      packageBoundaryRepoOnly: true,
    });
    expect(payload.agents.map((agent) => agent.adapter).sort()).toEqual(["claude", "codex", "opencode"]);
    expect(payload.agents.every((agent) => agent.invocationShapeMatched && agent.promptInArgv === false && agent.stdinBytesObserved && agent.stdinFormatMatched)).toBe(true);
    expect(payload.agents.find((agent) => agent.adapter === "codex")?.argvShape).toEqual(["exec", "--json", "--skip-git-repo-check", "-C", "<cwd>"]);
    expect(payload.agents.find((agent) => agent.adapter === "claude")?.argvShape).toEqual(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]);
    expect(payload.agents.find((agent) => agent.adapter === "opencode")?.argvShape).toEqual(["run", "--format", "json", "--dir", "<cwd>"]);
    expect(payload.diagnostics.conformanceSchemaVersion).toBe("agent-runtime.conformance.v1");
    expect(payload.diagnostics.failureIsolation.agents).toEqual(expect.arrayContaining([
      { adapter: "claude", terminalStatus: "failed", diagnosticsCount: 1 },
      { adapter: "codex", terminalStatus: "succeeded", diagnosticsCount: 0 },
      { adapter: "opencode", terminalStatus: "succeeded", diagnosticsCount: 0 },
    ]));
    for (const forbidden of ["/tmp/", "/private/tmp/", "/var/folders/", process.env.HOME, "P5_PUBLISHED_ADAPTER_COMPAT_PROMPT_", "Bearer ", "ANTHROPIC_AUTH_TOKEN=", "sk-"].filter(Boolean)) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("keeps published daemon consumer verifier error JSON stable and redacted", async () => {
    const failure = await execCliFailureViaNode([
      publishedDaemonConsumerVerifier,
      "/tmp/leak sk-" + "A".repeat(24) + " Bearer " + "B".repeat(20) + " /private/tmp/leak /var/folders/leak /Users/example/leak",
    ]);
    const payload = JSON.parse(failure.stdout) as {
      schemaVersion: string;
      ok: boolean;
      packageSource: string;
      version: string | null;
      checks: Record<string, unknown>;
      diagnostics: Array<{ message?: string }>;
      noAuthenticatedRealRun: boolean;
    };
    const text = JSON.stringify(payload);

    expect(failure.code).toBe(1);
    expect(payload).toMatchObject({
      schemaVersion: "agent-runtime.publishedDaemonConsumer.v1",
      ok: false,
      packageSource: "npm-registry",
      version: null,
      checks: {},
      noAuthenticatedRealRun: true,
    });
    for (const forbidden of ["/tmp/", "/private/tmp/", "/var/folders/", "/Users/example", "sk-" + "A".repeat(24), "Bearer " + "B".repeat(20)]) {
      expect(text).not.toContain(forbidden);
    }
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
      version: "0.1.0-alpha.3",
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

  it("keeps alpha.3 package metadata aligned with the corrective release state", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      name: string;
      version: string;
      publishConfig: { tag: string };
    };
    const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8")) as {
      name: string;
      version: string;
      packages: Record<string, { version?: string }>;
    };
    const docs = [
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/release-publish-runbook.md",
      "docs/release-report.md",
      "docs/release-checklist.md",
      "docs/production-readiness.md",
      "docs/compatibility.md",
      "docs/ssot.md",
    ];

    expect(manifest).toMatchObject({
      name: "agent-cli-runtime",
      version: "0.1.0-alpha.3",
      publishConfig: { tag: "alpha" },
    });
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[""].version).toBe(manifest.version);

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).toContain("0.1.0-alpha.3");
      expect(text, `${doc} must record the alpha.2 stale-docs incident`).toMatch(
        /0\.1\.0-alpha\.2[^\n]*(?:stale|pre-publish|过期|发布前)/iu,
      );
      expect(text, `${doc} must not describe alpha.3 as unpublished`).not.toMatch(
        /(?:0\.1\.0-alpha\.3|alpha\.3)[^\n]*(?:not published|unpublished|has not occurred|not yet published|未发布|尚未发布|尚未发生)/iu,
      );
    }
  });

  it("checks stale release-state wording in the locally packed tarball docs", async () => {
    const { stdout } = await execFileP(process.execPath, [packagedDocsChecker], { cwd: root });
    const result = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      packageSource: string;
      version: string;
      docs: Array<{ path: string; ok: boolean }>;
      noAlpha3UnpublishedClaim: boolean;
      noDryRunStopPoint: boolean;
      noPublishReadyCandidate: boolean;
      noOldDistTagClaim: boolean;
    };

    expect(result).toMatchObject({
      schemaVersion: "agent-cli-runtime.packagedDocsVerification.v1",
      ok: true,
      packageSource: "local-pack",
      version: "0.1.0-alpha.3",
      noAlpha3UnpublishedClaim: true,
      noDryRunStopPoint: true,
      noPublishReadyCandidate: true,
      noOldDistTagClaim: true,
    });
    expect(result.docs.map((doc) => doc.path).sort()).toEqual([
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/compatibility.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-publish-runbook.md",
      "docs/release-report.md",
      "docs/ssot.md",
    ].sort());
    expect(result.docs.every((doc) => doc.ok)).toBe(true);
  }, 60_000);

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
      timeout: 20_000,
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
  }, 45_000);

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
    expect(files).toContain("docs/ssot.md");
    expect(files).not.toContainEqual(expect.stringMatching(/^published-verification\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^\.release-evidence\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^\.reference\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/^tests\/fixtures\/secrets/u));
    expect(files).not.toContainEqual(expect.stringMatching(/^docs\/fixtures\//u));
    expect(files).not.toContainEqual(expect.stringMatching(/fixtures?/iu));
    expect(files).not.toContain("scripts/create-real-compatibility-evidence.mjs");
    expect(files).not.toContain("scripts/verify-real-compatibility-evidence.mjs");
    expect(files).not.toContain("scripts/create-release-strict-compatibility-evidence.mjs");
    expect(files).not.toContain("scripts/verify-package-content-equivalence.mjs");
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
        releaseCompatibilityGate(),
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
        gates: Array<{
          script: string;
          command: string;
          ok: boolean;
          outputSchemaVersion: string;
          packageSource: string | null;
          evidenceSchemaVersion: string | null;
          targetSha: { expected: string; actual: string; ok: boolean; status: string } | null;
          freshness: { maxAgeHours: number; ageHours: number; ok: boolean; status: string } | null;
          dirtyPolicy: { policy: string; allowDirty: boolean; gitDirty: boolean; inputDirty: boolean; outputDirty: boolean; ok: boolean; status: string } | null;
          diagnostics: { count: number | null; codes: string[] } | null;
        }>;
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
        commands: ["npm run daemon:verify", "npm run runtime:safety", releaseCompatibilityGateCommand],
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
      expect.objectContaining({
        script: "compat:real:evidence:verify",
        command: releaseCompatibilityGateCommand,
        ok: true,
        outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
        evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
        targetSha: { expected: fixtureSha, actual: fixtureSha, ok: true, status: "matched" },
        freshness: { maxAgeHours: 24, ageHours: 1.25, ok: true, status: "fresh" },
        dirtyPolicy: { policy: "release-strict", allowDirty: false, gitDirty: false, inputDirty: false, outputDirty: true, ok: true, status: "self_dirty_only" },
        diagnostics: { count: 0, codes: [] },
      }),
    ]);
    expect([...verification.artifactNames].sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(stdout).not.toContain(dir);
  });

  it("verifies remote release candidate artifacts with an explicit repo-only real compatibility skip summary", async () => {
    const dir = await tempDir("agent-runtime-release-verify-remote-");
    const pack = [{
      id: "agent-cli-runtime@0.1.0-alpha.0",
      name: "agent-cli-runtime",
      version: "0.1.0-alpha.0",
      filename: "agent-cli-runtime-0.1.0-alpha.0.tgz",
      files: [
        { path: "dist/index.js", size: 1, mode: 420 },
        { path: "README.md", size: 1, mode: 420 },
        { path: "docs/release-report.md", size: 1, mode: 420 },
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
        releaseCompatibilityRepoOnlySkippedGate(),
      ],
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    }, null, 2), "utf8");
    await writeFile(path.join(dir, pack[0].filename), "fake tarball", "utf8");

    const { stdout } = await execFileP(process.execPath, [releaseVerifier, "--dir", dir]);
    const verification = JSON.parse(stdout) as {
      ok: boolean;
      diagnostics: unknown[];
      gateEvidence: {
        commands: string[];
        gates: Array<{
          script: string;
          command: string;
          ok: boolean;
          targetSha: { expected: string; actual: null; ok: null; status: string } | null;
          freshness: { maxAgeHours: number; ageHours: null; ok: null; status: string } | null;
          dirtyPolicy: {
            policy: string;
            allowDirty: boolean;
            gitDirty: null;
            inputDirty: null;
            outputDirty: null;
            ok: null;
            status: string;
          } | null;
          diagnostics: { count: number | null; codes: string[] } | null;
          repoOnlyEvidence: { status: string; reason: string } | null;
        }>;
      };
    };

    expect(verification.ok).toBe(true);
    expect(verification.diagnostics).toEqual([]);
    expect(verification.gateEvidence.commands).toEqual([
      "npm run daemon:verify",
      "npm run runtime:safety",
      releaseCompatibilityRepoOnlySkippedCommand,
    ]);
    expect(verification.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify")).toMatchObject({
      command: releaseCompatibilityRepoOnlySkippedCommand,
      ok: true,
      targetSha: { expected: fixtureSha, actual: null, ok: null, status: "repo_only_not_run" },
      freshness: { maxAgeHours: 24, ageHours: null, ok: null, status: "repo_only_not_run" },
      dirtyPolicy: {
        policy: "repo-only-skipped",
        allowDirty: false,
        gitDirty: null,
        inputDirty: null,
        outputDirty: null,
        ok: null,
        status: "repo_only_not_run",
      },
      diagnostics: { count: 0, codes: [] },
      repoOnlyEvidence: {
        status: "not_refreshed_in_ci",
        reason: "real_compatibility_matrix_is_repo_only",
      },
    });
    expect(stdout).not.toContain(dir);
    expect(stdout).not.toContain("/Users/");
    expect(stdout).not.toContain("/private/tmp/");
    expect(stdout).not.toContain("/var/folders/");
  });

  it("normalizes downloaded release candidate artifacts into a release:verify-ready directory", async () => {
    const downloadDir = await tempDir("agent-runtime-release-download-");
    const outDir = await tempDir("agent-runtime-release-normalized-");
    const { tarball } = await writeDownloadedReleaseArtifactFixture(downloadDir);

    const { stdout } = await execFileP(process.execPath, [
      releaseArtifactNormalizer,
      "--download-dir",
      downloadDir,
      "--out-dir",
      outDir,
    ]);
    const result = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      downloadDir: string;
      outDir: string;
      artifacts: Array<{ artifactName: string; expectedFile: string; source: string; output: string }>;
      diagnostics: unknown[];
    };

    expect(result).toMatchObject({
      schemaVersion: "agent-cli-runtime.releaseArtifactNormalization.v1",
      ok: true,
      downloadDir: "<external_artifact_dir>",
      outDir: "<external_output_dir>",
      diagnostics: [],
    });
    expect(result.artifacts.map((artifact) => artifact.artifactName).sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactName: "agent-cli-runtime-pack-metadata",
        source: "agent-cli-runtime-pack-metadata/npm-pack.json",
      }),
      expect.objectContaining({
        artifactName: "agent-cli-runtime-package-files",
        source: "agent-cli-runtime-package-files/package-files.txt",
      }),
      expect.objectContaining({
        artifactName: "agent-cli-runtime-gate-evidence",
        source: "agent-cli-runtime-gate-evidence/gate-evidence.json",
      }),
      expect.objectContaining({
        artifactName: "agent-cli-runtime-release-verification",
        source: "agent-cli-runtime-release-verification/release-verification.json",
      }),
      expect.objectContaining({
        artifactName: "agent-cli-runtime-tarball",
        source: `agent-cli-runtime-tarball/${tarball}`,
      }),
    ]));
    expect(result.artifacts.map((artifact) => artifact.output).sort()).toEqual([
      "gate-evidence.json",
      tarball,
      "npm-pack.json",
      "package-files.txt",
      "release-verification.json",
    ].sort());
    expect(stdout).not.toContain(downloadDir);
    expect(stdout).not.toContain(outDir);
    expectNoLocalOrSecretLeak(stdout);

    const normalizedFiles = await readdir(outDir);
    expect(normalizedFiles.sort()).toEqual([
      "gate-evidence.json",
      tarball,
      "npm-pack.json",
      "package-files.txt",
      "release-verification.json",
    ].sort());

    const verification = JSON.parse((await execFileP(process.execPath, [releaseVerifier, "--dir", outDir])).stdout) as {
      ok: boolean;
      diagnostics: unknown[];
    };
    expect(verification.ok).toBe(true);
    expect(verification.diagnostics).toEqual([]);
  });

  it("rejects downloaded release artifact directories with missing, duplicate, unknown, or misplaced files", async () => {
    const missingDir = await tempDir("agent-runtime-release-download-missing-");
    const duplicateDir = await tempDir("agent-runtime-release-download-duplicate-");
    const unknownDir = await tempDir("agent-runtime-release-download-unknown-");
    const misplacedDir = await tempDir("agent-runtime-release-download-misplaced-");
    const outDir = await tempDir("agent-runtime-release-normalized-fail-");
    await writeDownloadedReleaseArtifactFixture(missingDir);
    await writeDownloadedReleaseArtifactFixture(duplicateDir);
    await writeDownloadedReleaseArtifactFixture(unknownDir);
    await writeDownloadedReleaseArtifactFixture(misplacedDir);
    await rm(path.join(missingDir, "agent-cli-runtime-release-verification", "release-verification.json"));
    await writeFile(path.join(duplicateDir, "agent-cli-runtime-tarball", "agent-cli-runtime-extra.tgz"), "fake duplicate tarball", "utf8");
    await mkdir(path.join(unknownDir, "agent-cli-runtime-pack-metadata"), { recursive: true });
    await writeFile(path.join(unknownDir, "agent-cli-runtime-pack-metadata", "extra.txt"), "extra\n", "utf8");
    await rm(path.join(misplacedDir, "agent-cli-runtime-pack-metadata", "npm-pack.json"));
    await mkdir(path.join(misplacedDir, "bad-pack"), { recursive: true });
    await writeFile(path.join(misplacedDir, "bad-pack", "npm-pack.json"), "[]\n", "utf8");

    for (const [dir, code] of [
      [missingDir, "missing_artifact_file"],
      [duplicateDir, "duplicate_artifact_file"],
      [unknownDir, "unknown_artifact_file"],
      [misplacedDir, "unexpected_artifact_path"],
    ] as Array<[string, string]>) {
      const failure = await execCliFailureViaNode([
        releaseArtifactNormalizer,
        "--download-dir",
        dir,
        "--out-dir",
        outDir,
      ]);
      const result = JSON.parse(failure.stdout) as {
        schemaVersion: string;
        ok: boolean;
        diagnostics: Array<{ code: string; file?: string; files?: string[]; actual?: string; expected?: string }>;
      };

      expect(failure.code).toBe(1);
      expect(result.schemaVersion).toBe("agent-cli-runtime.releaseArtifactNormalization.v1");
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code }));
      if (code === "unexpected_artifact_path") {
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
          code,
          actual: "bad-pack/npm-pack.json",
          expected: "agent-cli-runtime-pack-metadata/npm-pack.json",
        }));
      }
      expect(failure.stdout).not.toContain(dir);
      expect(failure.stdout).not.toContain(outDir);
      expectNoLocalOrSecretLeak(failure.stdout);
    }
  });

  it("accepts different npm and GitHub tarball gzip hashes when unpacked package content matches", async () => {
    const dir = await tempDir("agent-runtime-post-alpha-fixture-");
    const npmRoot = path.join(dir, "npm-root", "package");
    const githubRoot = path.join(dir, "github-root", "package");
    for (const packageRoot of [npmRoot, githubRoot]) {
      await mkdir(path.join(packageRoot, "dist"), { recursive: true });
      await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
        name: "agent-cli-runtime",
        version: "0.1.0-alpha.1",
        type: "module",
      }, null, 2), "utf8");
      await writeFile(path.join(packageRoot, "README.md"), "published alpha package docs\n", "utf8");
      await writeFile(path.join(packageRoot, "dist", "index.js"), "export function createAgentRuntime() {}\n", "utf8");
    }
    const future = new Date("2030-01-01T00:00:00.000Z");
    await utimes(path.join(githubRoot, "README.md"), future, future);

    const npmTgz = path.join(dir, "npm-registry.tgz");
    const githubTgz = path.join(dir, "github-release.tgz");
    await execFileP("tar", ["-czf", npmTgz, "-C", path.join(dir, "npm-root"), "package"]);
    await execFileP("tar", ["-czf", githubTgz, "-C", path.join(dir, "github-root"), "package"]);

    const npmDistJson = path.join(dir, "npm-dist.json");
    const githubReleaseJson = path.join(dir, "github-release.json");
    const distTagsJson = path.join(dir, "dist-tags.json");
    await writeFile(npmDistJson, JSON.stringify({
      dist: {
        shasum: await digest(npmTgz, "sha1"),
        integrity: "sha512-fixture",
        tarball: "https://registry.npmjs.org/agent-cli-runtime/-/agent-cli-runtime-0.1.0-alpha.1.tgz",
        fileCount: 3,
        unpackedSize: 123,
      },
    }), "utf8");
    await writeFile(githubReleaseJson, JSON.stringify({
      tagName: "v0.1.0-alpha.1",
      targetCommitish: "e173d65f0abc2aaf070ca27debb97178d30092d4",
      isPrerelease: true,
      isDraft: false,
      assets: [{
        name: "agent-cli-runtime-0.1.0-alpha.1.tgz",
        size: (await stat(githubTgz)).size,
        digest: `sha256:${await digest(githubTgz, "sha256")}`,
        url: "https://github.com/iiwish/agent-cli-runtime/releases/download/v0.1.0-alpha.1/agent-cli-runtime-0.1.0-alpha.1.tgz",
      }],
    }), "utf8");
    await writeFile(distTagsJson, JSON.stringify({
      alpha: "0.1.0-alpha.1",
      latest: "0.1.0-alpha.1",
    }), "utf8");

    const { stdout } = await execFileP(process.execPath, [
      postAlphaVerifier,
      "--version",
      "0.1.0-alpha.1",
      "--npm-tarball",
      npmTgz,
      "--github-tarball",
      githubTgz,
      "--npm-dist-json",
      npmDistJson,
      "--github-release-json",
      githubReleaseJson,
      "--dist-tags-json",
      distTagsJson,
    ]);
    const result = JSON.parse(stdout) as {
      schemaVersion: string;
      ok: boolean;
      npm: { distTags: Record<string, string>; registryShasumMatches: boolean };
      githubRelease: { tarballAsset: { digestMatchesDownloadedSha256: boolean } };
      comparison: {
        gzipHashesMatch: boolean;
        expectedDifferentGzipPackaging: boolean;
        acceptable: boolean;
        rule: string;
        contentBoundary: string;
        unpackedPackage: { match: boolean; fileCount: number; changed: string[] };
      };
    };

    expect(result).toMatchObject({
      schemaVersion: "agent-cli-runtime.postAlphaEvidence.v1",
      ok: true,
      npm: {
        distTags: { alpha: "0.1.0-alpha.1", latest: "0.1.0-alpha.1" },
        registryShasumMatches: true,
      },
      githubRelease: {
        tarballAsset: { digestMatchesDownloadedSha256: true },
      },
      comparison: {
        gzipHashesMatch: false,
        expectedDifferentGzipPackaging: true,
        acceptable: true,
        unpackedPackage: { match: true, fileCount: 3, changed: [] },
      },
    });
    expect(result.comparison.rule).toContain("gzip tarball hashes may differ");
    expect(result.comparison.contentBoundary).toContain("npm registry shasum/integrity");
    expect(stdout).not.toContain(dir);
  });

  it("fails post-alpha verification when unpacked npm and GitHub package content differs", async () => {
    const dir = await tempDir("agent-runtime-post-alpha-mismatch-");
    const npmRoot = path.join(dir, "npm-root", "package");
    const githubRoot = path.join(dir, "github-root", "package");
    for (const packageRoot of [npmRoot, githubRoot]) {
      await mkdir(packageRoot, { recursive: true });
      await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "agent-cli-runtime", version: "0.1.0-alpha.1" }), "utf8");
    }
    await writeFile(path.join(npmRoot, "README.md"), "npm registry content\n", "utf8");
    await writeFile(path.join(githubRoot, "README.md"), "different release content\n", "utf8");
    const npmTgz = path.join(dir, "npm-registry.tgz");
    const githubTgz = path.join(dir, "github-release.tgz");
    await execFileP("tar", ["-czf", npmTgz, "-C", path.join(dir, "npm-root"), "package"]);
    await execFileP("tar", ["-czf", githubTgz, "-C", path.join(dir, "github-root"), "package"]);
    const npmDistJson = path.join(dir, "npm-dist.json");
    const githubReleaseJson = path.join(dir, "github-release.json");
    const distTagsJson = path.join(dir, "dist-tags.json");
    await writeFile(npmDistJson, JSON.stringify({ dist: { shasum: await digest(npmTgz, "sha1"), integrity: "sha512-fixture" } }), "utf8");
    await writeFile(githubReleaseJson, JSON.stringify({
      tagName: "v0.1.0-alpha.1",
      assets: [{ name: "agent-cli-runtime-0.1.0-alpha.1.tgz", digest: `sha256:${await digest(githubTgz, "sha256")}` }],
    }), "utf8");
    await writeFile(distTagsJson, JSON.stringify({ alpha: "0.1.0-alpha.1", latest: "0.1.0-alpha.1" }), "utf8");

    const failure = await execCliFailureViaNode([
      postAlphaVerifier,
      "--version",
      "0.1.0-alpha.1",
      "--npm-tarball",
      npmTgz,
      "--github-tarball",
      githubTgz,
      "--npm-dist-json",
      npmDistJson,
      "--github-release-json",
      githubReleaseJson,
      "--dist-tags-json",
      distTagsJson,
    ]);
    const result = JSON.parse(failure.stdout) as {
      ok: boolean;
      diagnostics: Array<{ code: string }>;
      comparison: { acceptable: boolean; unpackedPackage: { match: boolean; changed: string[] } };
    };

    expect(failure.code).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.comparison.acceptable).toBe(false);
    expect(result.comparison.unpackedPackage.match).toBe(false);
    expect(result.comparison.unpackedPackage.changed).toContain("README.md");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unpacked_package_content_mismatch" }),
    ]));
    expect(failure.stdout).not.toContain(dir);
  });

  it("redacts post-alpha verifier failed input paths and temp paths without stack traces", async () => {
    const dir = await tempDir("agent-runtime-post-alpha-redaction-");
    const missingTarball = path.join(dir, "does-not-exist.tgz");
    const npmDistJson = path.join(dir, "npm-dist.json");
    const githubReleaseJson = path.join(dir, "github-release.json");
    const distTagsJson = path.join(dir, "dist-tags.json");
    await writeFile(npmDistJson, JSON.stringify({
      dist: {
        shasum: "fixture-shasum",
        integrity: "sha512-fixture",
        tarball: "https://registry.npmjs.org/agent-cli-runtime/-/agent-cli-runtime-0.1.0-alpha.1.tgz",
      },
    }), "utf8");
    await writeFile(githubReleaseJson, JSON.stringify({
      tagName: "v0.1.0-alpha.1",
      assets: [{ name: "agent-cli-runtime-0.1.0-alpha.1.tgz", digest: "sha256:fixture" }],
    }), "utf8");
    await writeFile(distTagsJson, JSON.stringify({ alpha: "0.1.0-alpha.1", latest: "0.1.0-alpha.1" }), "utf8");

    const failure = await execCliFailureViaNode([
      postAlphaVerifier,
      "--version",
      "0.1.0-alpha.1",
      "--npm-tarball",
      missingTarball,
      "--github-tarball",
      missingTarball,
      "--npm-dist-json",
      npmDistJson,
      "--github-release-json",
      githubReleaseJson,
      "--dist-tags-json",
      distTagsJson,
    ]);
    const result = JSON.parse(failure.stdout) as { ok: boolean; diagnostics: Array<{ code: string; message: string }> };

    expect(failure.code).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "post_alpha_verification_error",
        message: expect.any(String),
      }),
    ]);
    expect(failure.stdout).not.toContain(dir);
    expect(failure.stdout).not.toContain(missingTarball);
    expect(failure.stdout).not.toContain("/tmp/agent-runtime-post-alpha-");
    expect(failure.stdout).not.toContain("/private/tmp/");
    expect(failure.stdout).not.toContain("/var/folders/");
    expect(failure.stdout).not.toMatch(/\n\s+at\s+/u);
    expect(failure.stderr).toBe("");
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

  it("rejects release artifacts missing the offline real compatibility verification gate", async () => {
    const dir = await tempDir("agent-runtime-release-missing-compat-gate-");
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
      generatedAt: "2026-06-24T00:00:00.000Z",
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
    }), "utf8");
    await writeFile(path.join(dir, pack[0].filename), "fake tarball", "utf8");

    const failure = await execCliFailureViaNode([releaseVerifier, "--dir", dir]);
    const verification = JSON.parse(failure.stdout) as { ok: boolean; diagnostics: Array<{ code: string; script?: string }> };

    expect(failure.code).toBe(1);
    expect(verification.ok).toBe(false);
    expect(verification.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_gate_evidence", script: "compat:real:evidence:verify" }),
    ]));
  });

  it("rejects failed or non-redacted offline real compatibility verification gate summaries", async () => {
    const dir = await tempDir("agent-runtime-release-failed-compat-gate-");
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
      generatedAt: "2026-06-24T00:00:00.000Z",
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
        releaseCompatibilityGate({
          ok: false,
          diagnostics: { count: 1, codes: ["unsafe_content"], message: "raw details must not be stored" },
        }),
      ],
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    }), "utf8");
    await writeFile(path.join(dir, pack[0].filename), "fake tarball", "utf8");

    const failure = await execCliFailureViaNode([releaseVerifier, "--dir", dir]);
    const verification = JSON.parse(failure.stdout) as { ok: boolean; diagnostics: Array<{ code: string; script?: string }> };
    const codes = verification.diagnostics.map((diagnostic) => diagnostic.code);

    expect(failure.code).toBe(1);
    expect(verification.ok).toBe(false);
    expect(codes).toEqual(expect.arrayContaining(["failed_gate_evidence", "invalid_gate_evidence"]));
    expect(failure.stdout).not.toContain("raw details must not be stored");
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
      ".release-evidence/current-head.local.json",
      ".reference/open-design/secret.txt",
      "tests/contract.test.ts",
      "tests/fixtures/streams/raw.jsonl",
      "docs/raw-real-cli-output/capture.json",
      "scripts/create-real-compatibility-evidence.mjs",
      "scripts/verify-real-compatibility-evidence.mjs",
      "scripts/verify-package-content-equivalence.mjs",
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
      "volatile_release_evidence",
      "raw_real_cli_output",
      "repo_only_real_compatibility_script",
      "repo_only_package_content_script",
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
    expect(script).toContain("npm run compat:real:evidence:verify");
    expect(script).toContain("agent-cli-runtime.realCompatibilityEvidenceVerification.v1");
    expect(script).toContain("agent-cli-runtime.realCompatibilityMatrix.v1");
    expect(script).toContain("--target-sha");
    expect(script).toContain("--max-age-hours");
    expect(script).toContain("--release-strict");
    expect(script).toContain("--real-compatibility-mode");
    expect(script).toContain("repo-only-skipped");
    expect(script).toContain("p8-2-real-cli-compatibility-matrix.json");
    expect(script).toContain("realCompatibilityMatrixTargetSha");
    expect(script).toContain("releaseTargetSha");
    expect(script).toContain(releaseCompatibilityRepoOnlySkippedCommand);
    expect(script).toContain("targetSha");
    expect(script).toContain("freshness");
    expect(script).toContain("dirtyPolicy");
    expect(script).toContain("repoOnlyEvidence");
    expect(script).toContain("summarizeDiagnostics");
    expect(script).not.toMatch(/\bnpm publish\b/u);
    expect(script).not.toContain("NODE_AUTH_TOKEN");
    expect(script).not.toContain("--allow-real-run");
  });

  it("keeps remote CI and release-candidate workflows audit-only and artifact-focused", async () => {
    const ci = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const releaseCandidate = await readFile(path.join(root, ".github", "workflows", "release-candidate.yml"), "utf8");
    const publishedPackageVerification = await readFile(path.join(root, ".github", "workflows", "published-package-verification.yml"), "utf8");
    const creator = await readFile(releaseCandidateCreator, "utf8");
    const publishedCreator = await readFile(publishedVerificationCreator, "utf8");
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
    for (const releaseSurface of [ci, releaseCandidate, publishedPackageVerification, creator, publishedCreator, manifest]) {
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
    expect(releaseCandidate).toContain("npm run release:candidate -- --out-dir release-candidate --real-compatibility-mode repo-only-skipped");
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

    expect(publishedPackageVerification).toMatch(/on:\n\s+workflow_dispatch:/u);
    expect(publishedPackageVerification).toContain("node-version: 22.x");
    expect(publishedPackageVerification).toContain("npm ci");
    expect(publishedPackageVerification).toContain("npm run published:verify -- --out-dir published-verification");
    expect(publishedPackageVerification).toContain("npm run published:verify:evidence -- --dir published-verification");
    expect(publishedPackageVerification).toContain("actions/checkout@v5");
    expect(publishedPackageVerification).toContain("actions/setup-node@v5");
    expect(publishedPackageVerification).toContain("actions/upload-artifact@v6");
    expect(publishedPackageVerification).toContain("name: agent-cli-runtime-published-verification");
    expect(publishedPackageVerification).toContain("path: published-verification");
    expect(publishedPackageVerification).toContain("retention-days: 14");
    const publishedArtifactNames = [...publishedPackageVerification.matchAll(/^\s+name:\s+(agent-cli-runtime-[^\n]+)$/gmu)].map((match) => match[1].trim());
    expect(publishedArtifactNames.sort()).toEqual([...expectedPublishedVerificationArtifacts].sort());
  });

  it("keeps prepublish and release candidate gates aligned with daemon-ready scripts", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const creator = await readFile(releaseCandidateCreator, "utf8");
    const dogfood = await readFile(path.join(root, "scripts", "dogfood.mjs"), "utf8");
    const postAlpha = await readFile(postAlphaVerifier, "utf8");
    const smokePublished = await readFile(publishedSmoke, "utf8");

    expect(manifest.scripts["prepublish:check"]).toContain("npm run daemon:verify");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run runtime:safety");
    expect(manifest.scripts["prepublish:check"]).toContain("npm run compat:real:evidence:verify");
    expect(manifest.scripts["prepublish:check"]).not.toContain("npm run compat:real:evidence &&");
    expect(manifest.scripts["release:post-alpha:verify"]).toBe("node ./scripts/verify-post-alpha-release.mjs");
    expect(manifest.scripts["release:artifacts:normalize"]).toBe("node ./scripts/normalize-release-artifacts.mjs");
    expect(manifest.scripts["release:main-candidate:evidence"]).toBe("node ./scripts/create-main-release-candidate-evidence.mjs");
    expect(manifest.scripts["smoke:published"]).toBe("node ./scripts/smoke-published.mjs");
    expect(manifest.scripts["published:verify"]).toBe("node ./scripts/create-published-verification-evidence.mjs");
    expect(manifest.scripts["published:verify:evidence"]).toBe("node ./scripts/verify-published-verification-evidence.mjs");
    expect(manifest.scripts.dogfood).not.toContain("--allow-real-run");
    expect(manifest.scripts.dogfood).not.toContain("compat:real:evidence:verify");
    expect(manifest.scripts["prepublish:check"]).not.toContain("--allow-real-run");
    expect(manifest.scripts["release:candidate"]).not.toContain("--allow-real-run");
    expect(creator).toContain("agent-cli-runtime.releaseGateEvidence.v1");
    expect(creator).toContain("npm run daemon:verify");
    expect(creator).toContain("npm run runtime:safety");
    expect(creator).toContain("npm run compat:real:evidence:verify");
    expect(creator).toContain("gate-evidence.json");
    expect(creator).not.toMatch(/\bnpm publish\b/u);
    expect(creator).not.toContain("NODE_AUTH_TOKEN");
    expect(creator).not.toContain("--allow-real-run");
    expect(dogfood).not.toContain("--allow-real-run");
    expect(postAlpha).toContain("agent-cli-runtime.postAlphaEvidence.v1");
    expect(postAlpha).toContain("gzip tarball hashes may differ");
    expect(postAlpha).toContain("api.github.com");
    expect(postAlpha).not.toContain("gh\", [");
    expect(postAlpha).not.toContain("release\",");
    expect(postAlpha).not.toMatch(/\bnpm publish\b/u);
    expect(postAlpha).not.toContain("NODE_AUTH_TOKEN");
    expect(postAlpha).not.toContain("--allow-real-run");
    expect(smokePublished).toContain("agent-cli-runtime.publishedSmoke.v1");
    expect(smokePublished).toContain("agent-runtime");
    expect(smokePublished).toContain("agents");
    expect(smokePublished).not.toMatch(/\bnpm publish\b/u);
    expect(smokePublished).not.toContain("NODE_AUTH_TOKEN");
    expect(smokePublished).not.toContain("--allow-real-run");
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

  it("keeps volatile current-head release evidence outside packaged docs", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { files: string[] };
    const boundary = await readFile(path.join(root, "scripts", "check-package-boundary.mjs"), "utf8");
    const verifier = await readFile(releaseVerifier, "utf8");
    const evidenceReadme = await readFile(path.join(root, ".release-evidence", "README.md"), "utf8");
    const evidenceIgnore = await readFile(path.join(root, ".release-evidence", ".gitignore"), "utf8");
    const p5EvidenceText = await readFile(path.join(root, ".release-evidence", "p5-4-published-verification.json"), "utf8");
    const p6EvidenceText = await readFile(path.join(root, ".release-evidence", "p6-4-remote-release-candidate.json"), "utf8");
    const p6MainEvidenceText = await readFile(path.join(root, ".release-evidence", "p6-5-main-release-candidate.json"), "utf8");
    const p6MainHeadEvidenceText = await readFile(
      path.join(root, ".release-evidence", "p6-6-main-head-release-candidate.json"),
      "utf8",
    );
    const p7MainEvidenceText = await readFile(
      path.join(root, ".release-evidence", "p7-2-alpha-2-main-release-candidate.json"),
      "utf8",
    );
    const p5Evidence = JSON.parse(p5EvidenceText) as {
      stage: string;
      targetSha: string;
      runId: number;
      artifact: { id: number; digest: string };
      downloadedVerification: { schemaVersion: string; ok: boolean };
      checkedGates: Array<{ script: string; ok: boolean }>;
      registry: { version: string; distTags: Record<string, string> };
      localVerificationCommand: string;
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
    };
    const p6Evidence = JSON.parse(p6EvidenceText) as {
      stage: string;
      evidenceKind: string;
      targetRef: string;
      targetSha: string;
      originMainShaAtTrigger: string;
      mainEvidence: boolean;
      p6_3MergedToMainAtTrigger: boolean;
      run: { id: number; headSha: string; status: string; conclusion: string };
      artifacts: { count: number; names: string[]; items: Array<{ id: number; digest: string }> };
      downloadedVerification: { command: string; schemaVersion: string; ok: boolean; diagnosticsCount: number };
      gateEvidence: {
        schemaVersion: string;
        gates: Array<{
          script: string;
          ok: boolean;
          outputSchemaVersion: string;
          evidenceSchemaVersion?: string;
          diagnostics?: { count: number; codes: string[] };
        }>;
        noAuthenticatedRealRun: boolean;
        noNpmPublish: boolean;
        noNpmToken: boolean;
      };
    };
    const p6MainEvidence = JSON.parse(p6MainEvidenceText) as {
      stage: string;
      evidenceKind: string;
      targetRef: string;
      targetSha: string;
      mainEvidence: boolean;
      p6_4BranchEvidenceCommit: string;
      p6_3GateCommit: string;
      p6_4MergedToMainAtTrigger: boolean;
      merge: { method: string; pr: number; mergeCommit: string; url: string };
      run: { id: number; headBranch: string; headSha: string; status: string; conclusion: string };
      artifacts: { count: number; names: string[]; items: Array<{ id: number; digest: string }> };
      downloadedVerification: { command: string; schemaVersion: string; ok: boolean; diagnosticsCount: number; packageFiles: number };
      gateEvidence: {
        schemaVersion: string;
        gates: Array<{
          script: string;
          ok: boolean;
          outputSchemaVersion: string;
          evidenceSchemaVersion?: string;
          diagnostics?: { count: number; codes: string[] };
        }>;
        noAuthenticatedRealRun: boolean;
        noNpmPublish: boolean;
        noNpmToken: boolean;
      };
      boundary: Record<string, boolean>;
    };
    const p6MainHeadEvidence = JSON.parse(p6MainHeadEvidenceText) as {
      stage: string;
      evidenceKind: string;
      targetRef: string;
      targetSha: string;
      mainEvidence: boolean;
      p6_4BranchEvidenceCommit: string;
      p6_5MainEvidenceCommit: string;
      p6_5MergedToMainAtTrigger: boolean;
      run: { id: number; headBranch: string; headSha: string; status: string; conclusion: string };
      job: { id: number; name: string; status: string; conclusion: string };
      artifacts: { count: number; names: string[]; items: Array<{ id: number; digest: string }> };
      downloadedVerification: {
        command: string;
        schemaVersion: string;
        ok: boolean;
        diagnosticsCount: number;
        packageFiles: number;
        tarball?: { filename?: string; sizeBytes?: number; shasum?: string };
        shasum?: string;
        integrity?: string;
      };
      gateEvidence: {
        schemaVersion: string;
        gates: Array<{
          script: string;
          ok: boolean;
          outputSchemaVersion: string;
          evidenceSchemaVersion?: string;
          diagnostics?: { count: number; codes: string[] };
        }>;
        noAuthenticatedRealRun: boolean;
        noNpmPublish: boolean;
        noNpmToken: boolean;
      };
      boundary: Record<string, boolean>;
    };
    const p7MainEvidence = JSON.parse(p7MainEvidenceText) as {
      stage: string;
      evidenceKind: string;
      targetRef: string;
      targetSha: string;
      mainEvidence: boolean;
      packageName: string;
      packageVersion: string;
      p6_6Commit: string;
      p7_1FirstCommit: string;
      p6_6MergedToMainAtTrigger: boolean;
      p7_1MergedToMainAtTrigger: boolean;
      p7_1Merge: { method: string; pr: number; mergeCommit: string; url: string; mergedAt: string };
      run: { id: number; url: string; event: string; headBranch: string; headSha: string; status: string; conclusion: string };
      job: { id: number; name: string; status: string; conclusion: string };
      artifacts: { count: number; names: string[]; items: Array<{ id: number; digest: string }> };
      downloadedVerification: {
        command: string;
        schemaVersion: string;
        ok: boolean;
        diagnosticsCount: number;
        packageFiles: number;
        packageName: string;
        version: string;
        tarball?: { filename?: string; sizeBytes?: number; shasum?: string };
        shasum?: string;
        integrity?: string;
      };
      gateEvidence: {
        schemaVersion: string;
        gates: Array<{
          script: string;
          ok: boolean;
          outputSchemaVersion: string;
          evidenceSchemaVersion?: string;
          diagnostics?: { count: number; codes: string[] };
        }>;
        noAuthenticatedRealRun: boolean;
        noNpmPublish: boolean;
        noNpmToken: boolean;
      };
      boundary: Record<string, boolean>;
    };
    const packagedDocs = [
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/compatibility.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/production-readiness.md",
      "docs/ssot.md",
    ];

    expect(manifest.files).not.toContain(".release-evidence");
    expect(boundary).toContain("^\\.release-evidence");
    expect(verifier).toContain("volatile_release_evidence");
    expect(evidenceReadme).toContain("outside the npm package boundary");
    expect(evidenceReadme).toContain("GitHub Actions run ids");
    expect(evidenceReadme).toContain("published package verification");
    expect(evidenceReadme).toContain("p6-5-main-release-candidate.json");
    expect(evidenceReadme).toContain("p6-6-main-head-release-candidate.json");
    expect(evidenceReadme).toContain("p7-2-alpha-2-main-release-candidate.json");
    expect(evidenceReadme).toContain("p7-3-alpha-2-publish.json");
    expect(evidenceReadme).toContain("p7-4-alpha-2-final-publish-lock.json");
    expect(evidenceReadme).toContain("p7-4-alpha-2-real-publish-attempt-blocked.json");
    expect(evidenceReadme).toContain("p7-4-alpha-2-post-publish.json");
    expect(evidenceReadme).toContain("p8-7-main-release-candidate.json");
    expect(evidenceIgnore).toContain("*.local.json");
    expect(evidenceIgnore).toContain("*.local.md");
    expect(p5Evidence.stage).toBe("P5-4");
    expect(p5Evidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(p5Evidence.downloadedVerification).toEqual({
      schemaVersion: "agent-cli-runtime.publishedVerification.v1",
      ok: true,
      checkedAt: expect.any(String),
    });
    expect(p5Evidence.checkedGates.map((gate) => gate.script).sort()).toEqual([
      "published:adapters:verify",
      "published:daemon:verify",
      "release:post-alpha:verify",
      "smoke:published",
    ]);
    expect(p5Evidence.checkedGates.every((gate) => gate.ok)).toBe(true);
    expect(p5Evidence.registry.distTags).toMatchObject({ alpha: "0.1.0-alpha.1", latest: "0.1.0-alpha.1" });
    expect(p5Evidence.localVerificationCommand).toBe("npm run published:verify:evidence -- --dir <normalized-downloaded-artifact-dir>");
    expect(p5Evidence.noAuthenticatedRealRun).toBe(true);
    expect(p5Evidence.noNpmPublish).toBe(true);
    expect(p5Evidence.noNpmToken).toBe(true);
    expect(p5EvidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(p6Evidence.stage).toBe("P6-4");
    expect(p6Evidence.evidenceKind).toBe("branch-release-candidate");
    expect(p6Evidence.targetRef).toBe("codex/p6-3-offline-compat-gate");
    expect(p6Evidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(p6Evidence.originMainShaAtTrigger).toMatch(/^[0-9a-f]{40}$/u);
    expect(p6Evidence.mainEvidence).toBe(false);
    expect(p6Evidence.p6_3MergedToMainAtTrigger).toBe(false);
    expect(p6Evidence.run.headSha).toBe(p6Evidence.targetSha);
    expect(p6Evidence.run.status).toBe("completed");
    expect(p6Evidence.run.conclusion).toBe("success");
    expect(p6Evidence.artifacts.count).toBe(5);
    expect(p6Evidence.artifacts.names.sort()).toEqual([
      "agent-cli-runtime-gate-evidence",
      "agent-cli-runtime-pack-metadata",
      "agent-cli-runtime-package-files",
      "agent-cli-runtime-release-verification",
      "agent-cli-runtime-tarball",
    ]);
    expect(p6Evidence.downloadedVerification).toMatchObject({
      command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: true,
      diagnosticsCount: 0,
    });
    expect(p6Evidence.gateEvidence.schemaVersion).toBe("agent-cli-runtime.releaseGateEvidence.v1");
    expect(p6Evidence.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);
    expect(p6Evidence.gateEvidence.gates.every((gate) => gate.ok)).toBe(true);
    expect(p6Evidence.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify")).toMatchObject({
      outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1",
      diagnostics: { count: 0, codes: [] },
    });
    expect(p6Evidence.gateEvidence.noAuthenticatedRealRun).toBe(true);
    expect(p6Evidence.gateEvidence.noNpmPublish).toBe(true);
    expect(p6Evidence.gateEvidence.noNpmToken).toBe(true);
    expect(p6EvidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(p6MainEvidence.stage).toBe("P6-5");
    expect(p6MainEvidence.evidenceKind).toBe("main-release-candidate");
    expect(p6MainEvidence.targetRef).toBe("main");
    expect(p6MainEvidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(p6MainEvidence.mainEvidence).toBe(true);
    expect(p6MainEvidence.p6_4BranchEvidenceCommit).toMatch(/^[0-9a-f]{40}$/u);
    expect(p6MainEvidence.p6_3GateCommit).toBe(p6Evidence.targetSha);
    expect(p6MainEvidence.p6_4MergedToMainAtTrigger).toBe(true);
    expect(p6MainEvidence.merge.method).toBe("pull-request-merge-commit");
    expect(p6MainEvidence.merge.pr).toBe(4);
    expect(p6MainEvidence.merge.mergeCommit).toBe(p6MainEvidence.targetSha);
    expect(p6MainEvidence.run.headBranch).toBe("main");
    expect(p6MainEvidence.run.headSha).toBe(p6MainEvidence.targetSha);
    expect(p6MainEvidence.run.status).toBe("completed");
    expect(p6MainEvidence.run.conclusion).toBe("success");
    expect(p6MainEvidence.artifacts.count).toBe(5);
    expect(p6MainEvidence.artifacts.names.sort()).toEqual([
      "agent-cli-runtime-gate-evidence",
      "agent-cli-runtime-pack-metadata",
      "agent-cli-runtime-package-files",
      "agent-cli-runtime-release-verification",
      "agent-cli-runtime-tarball",
    ]);
    expect(p6MainEvidence.downloadedVerification).toMatchObject({
      command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: true,
      diagnosticsCount: 0,
      packageFiles: 151,
    });
    expect(p6MainEvidence.gateEvidence.schemaVersion).toBe("agent-cli-runtime.releaseGateEvidence.v1");
    expect(p6MainEvidence.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);
    expect(p6MainEvidence.gateEvidence.gates.every((gate) => gate.ok)).toBe(true);
    expect(p6MainEvidence.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify")).toMatchObject({
      outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1",
      diagnostics: { count: 0, codes: [] },
    });
    expect(p6MainEvidence.gateEvidence.noAuthenticatedRealRun).toBe(true);
    expect(p6MainEvidence.gateEvidence.noNpmPublish).toBe(true);
    expect(p6MainEvidence.gateEvidence.noNpmToken).toBe(true);
    expect(p6MainEvidence.boundary.noRawLogs).toBe(true);
    expect(p6MainEvidence.boundary.noRawCliOutput).toBe(true);
    expect(p6MainEvidence.boundary.noFullPrompt).toBe(true);
    expect(p6MainEvidence.boundary.noPrivatePath).toBe(true);
    expect(p6MainEvidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(p6MainHeadEvidence.stage).toBe("P6-6");
    expect(p6MainHeadEvidence.evidenceKind).toBe("main-head-release-candidate");
    expect(p6MainHeadEvidence.targetRef).toBe("main");
    expect(p6MainHeadEvidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(p6MainHeadEvidence.mainEvidence).toBe(true);
    expect(p6MainHeadEvidence.p6_4BranchEvidenceCommit).toBe(p6MainEvidence.p6_4BranchEvidenceCommit);
    expect(p6MainHeadEvidence.p6_5MainEvidenceCommit).toMatch(/^[0-9a-f]{40}$/u);
    expect(p6MainHeadEvidence.p6_5MergedToMainAtTrigger).toBe(true);
    expect(p6MainHeadEvidence.run.headBranch).toBe("main");
    expect(p6MainHeadEvidence.run.headSha).toBe(p6MainHeadEvidence.targetSha);
    expect(p6MainHeadEvidence.run.status).toBe("completed");
    expect(p6MainHeadEvidence.run.conclusion).toBe("success");
    expect(p6MainHeadEvidence.job.name).toBe("Build release candidate artifacts");
    expect(p6MainHeadEvidence.job.status).toBe("completed");
    expect(p6MainHeadEvidence.job.conclusion).toBe("success");
    expect(p6MainHeadEvidence.artifacts.count).toBe(5);
    expect(p6MainHeadEvidence.artifacts.names.sort()).toEqual([
      "agent-cli-runtime-gate-evidence",
      "agent-cli-runtime-pack-metadata",
      "agent-cli-runtime-package-files",
      "agent-cli-runtime-release-verification",
      "agent-cli-runtime-tarball",
    ]);
    expect(p6MainHeadEvidence.downloadedVerification).toMatchObject({
      command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: true,
      diagnosticsCount: 0,
      packageFiles: 151,
    });
    expect(p6MainHeadEvidence.downloadedVerification.tarball?.filename).toBe("agent-cli-runtime-0.1.0-alpha.1.tgz");
    expect(p6MainHeadEvidence.downloadedVerification.tarball?.sizeBytes).toBeUndefined();
    expect(p6MainHeadEvidence.downloadedVerification.tarball?.shasum).toBeUndefined();
    expect(p6MainHeadEvidence.downloadedVerification.shasum).toBeUndefined();
    expect(p6MainHeadEvidence.downloadedVerification.integrity).toBeUndefined();
    expect(p6MainHeadEvidence.gateEvidence.schemaVersion).toBe("agent-cli-runtime.releaseGateEvidence.v1");
    expect(p6MainHeadEvidence.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);
    expect(p6MainHeadEvidence.gateEvidence.gates.every((gate) => gate.ok)).toBe(true);
    expect(p6MainHeadEvidence.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify")).toMatchObject({
      outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1",
      diagnostics: { count: 0, codes: [] },
    });
    expect(p6MainHeadEvidence.gateEvidence.noAuthenticatedRealRun).toBe(true);
    expect(p6MainHeadEvidence.gateEvidence.noNpmPublish).toBe(true);
    expect(p6MainHeadEvidence.gateEvidence.noNpmToken).toBe(true);
    expect(p6MainHeadEvidence.boundary.noRawLogs).toBe(true);
    expect(p6MainHeadEvidence.boundary.noRawCliOutput).toBe(true);
    expect(p6MainHeadEvidence.boundary.noFullPrompt).toBe(true);
    expect(p6MainHeadEvidence.boundary.noPrivatePath).toBe(true);
    expect(p6MainHeadEvidence.boundary.noLocalTempPath).toBe(true);
    expect(p6MainHeadEvidence.boundary.noTarballSize).toBe(true);
    expect(p6MainHeadEvidence.boundary.noTarballShasum).toBe(true);
    expect(p6MainHeadEvidence.boundary.noPackShasum).toBe(true);
    expect(p6MainHeadEvidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(p6MainHeadEvidenceText).not.toMatch(/\b(?:sizeBytes|sizeInBytes|shasum|integrity)\b/u);
    expect(p7MainEvidence.stage).toBe("P7-2");
    expect(p7MainEvidence.evidenceKind).toBe("alpha-2-main-release-candidate");
    expect(p7MainEvidence.targetRef).toBe("main");
    expect(p7MainEvidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(p7MainEvidence.mainEvidence).toBe(true);
    expect(p7MainEvidence.packageName).toBe("agent-cli-runtime");
    expect(p7MainEvidence.packageVersion).toBe("0.1.0-alpha.2");
    expect(p7MainEvidence.p6_6Commit).toMatch(/^[0-9a-f]{40}$/u);
    expect(p7MainEvidence.p7_1FirstCommit).toMatch(/^[0-9a-f]{40}$/u);
    expect(p7MainEvidence.p6_6MergedToMainAtTrigger).toBe(true);
    expect(p7MainEvidence.p7_1MergedToMainAtTrigger).toBe(true);
    expect(p7MainEvidence.p7_1Merge).toMatchObject({
      method: "pull-request-merge-commit",
      pr: 7,
      mergeCommit: p7MainEvidence.targetSha,
      url: "https://github.com/iiwish/agent-cli-runtime/pull/7",
    });
    expect(p7MainEvidence.run.event).toBe("workflow_dispatch");
    expect(p7MainEvidence.run.headBranch).toBe("main");
    expect(p7MainEvidence.run.headSha).toBe(p7MainEvidence.targetSha);
    expect(p7MainEvidence.run.status).toBe("completed");
    expect(p7MainEvidence.run.conclusion).toBe("success");
    expect(p7MainEvidence.job.name).toBe("Build release candidate artifacts");
    expect(p7MainEvidence.job.status).toBe("completed");
    expect(p7MainEvidence.job.conclusion).toBe("success");
    expect(p7MainEvidence.artifacts.count).toBe(5);
    expect(p7MainEvidence.artifacts.names.sort()).toEqual([
      "agent-cli-runtime-gate-evidence",
      "agent-cli-runtime-pack-metadata",
      "agent-cli-runtime-package-files",
      "agent-cli-runtime-release-verification",
      "agent-cli-runtime-tarball",
    ]);
    expect(p7MainEvidence.downloadedVerification).toMatchObject({
      command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: true,
      diagnosticsCount: 0,
      packageFiles: 151,
      packageName: "agent-cli-runtime",
      version: "0.1.0-alpha.2",
    });
    expect(p7MainEvidence.downloadedVerification.tarball?.filename).toBe("agent-cli-runtime-0.1.0-alpha.2.tgz");
    expect(p7MainEvidence.downloadedVerification.tarball?.sizeBytes).toBeUndefined();
    expect(p7MainEvidence.downloadedVerification.tarball?.shasum).toBeUndefined();
    expect(p7MainEvidence.downloadedVerification.shasum).toBeUndefined();
    expect(p7MainEvidence.downloadedVerification.integrity).toBeUndefined();
    expect(p7MainEvidence.gateEvidence.schemaVersion).toBe("agent-cli-runtime.releaseGateEvidence.v1");
    expect(p7MainEvidence.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);
    expect(p7MainEvidence.gateEvidence.gates.every((gate) => gate.ok)).toBe(true);
    expect(p7MainEvidence.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify")).toMatchObject({
      outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1",
      diagnostics: { count: 0, codes: [] },
    });
    expect(p7MainEvidence.gateEvidence.noAuthenticatedRealRun).toBe(true);
    expect(p7MainEvidence.gateEvidence.noNpmPublish).toBe(true);
    expect(p7MainEvidence.gateEvidence.noNpmToken).toBe(true);
    expect(p7MainEvidence.boundary.noAuthenticatedRealRun).toBe(true);
    expect(p7MainEvidence.boundary.noNpmPublish).toBe(true);
    expect(p7MainEvidence.boundary.noGithubRelease).toBe(true);
    expect(p7MainEvidence.boundary.noNpmToken).toBe(true);
    expect(p7MainEvidence.boundary.noTrustedPublishing).toBe(true);
    expect(p7MainEvidence.boundary.noRawLogs).toBe(true);
    expect(p7MainEvidence.boundary.noRawStdoutStderr).toBe(true);
    expect(p7MainEvidence.boundary.noRawCliOutput).toBe(true);
    expect(p7MainEvidence.boundary.noFullPrompt).toBe(true);
    expect(p7MainEvidence.boundary.noPrivatePath).toBe(true);
    expect(p7MainEvidence.boundary.noLocalTempPath).toBe(true);
    expect(p7MainEvidence.boundary.noTokenValue).toBe(true);
    expect(p7MainEvidence.boundary.noBearerValue).toBe(true);
    expect(p7MainEvidence.boundary.noAuthEnvAssignment).toBe(true);
    expect(p7MainEvidence.boundary.noTarballSize).toBe(true);
    expect(p7MainEvidence.boundary.noTarballShasum).toBe(true);
    expect(p7MainEvidence.boundary.noPackShasum).toBe(true);
    expect(p7MainEvidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(p7MainEvidenceText).not.toMatch(/\b(?:sizeBytes|sizeInBytes|shasum|integrity)\b/u);

    for (const doc of packagedDocs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).toContain(".release-evidence/");
      expect(text).not.toContain(String(p5Evidence.runId));
      expect(text).not.toContain(String(p5Evidence.artifact.id));
      expect(text).not.toContain(p5Evidence.artifact.digest);
      for (const artifact of p6Evidence.artifacts.items) {
        expect(text).not.toContain(String(artifact.id));
        expect(text).not.toContain(artifact.digest);
      }
      for (const artifact of p6MainEvidence.artifacts.items) {
        expect(text).not.toContain(String(artifact.id));
        expect(text).not.toContain(artifact.digest);
      }
      expect(text).not.toContain(String(p6MainHeadEvidence.run.id));
      expect(text).not.toContain(String(p6MainHeadEvidence.job.id));
      for (const artifact of p6MainHeadEvidence.artifacts.items) {
        expect(text).not.toContain(String(artifact.id));
        expect(text).not.toContain(artifact.digest);
      }
      expect(text).not.toContain(String(p7MainEvidence.run.id));
      expect(text).not.toContain(String(p7MainEvidence.job.id));
      for (const artifact of p7MainEvidence.artifacts.items) {
        expect(text).not.toContain(String(artifact.id));
        expect(text).not.toContain(artifact.digest);
      }
      expect(text).not.toMatch(/P3-11[^\n]*(?:current HEAD|当前 HEAD)[^\n]*(?:run `?\d{8,}`?|artifact digest|artifact id|tarball shasum|npm pack shasum|包 shasum)/iu);
      expect(text).not.toMatch(/P3-11[^\n]*(?:proves|证明)[^\n]*(?:current HEAD|当前 HEAD)/iu);
      expect(text).not.toMatch(/P5-4[^\n]*(?:proves|证明)(?![^\n]*(?:only|只|不得|must not|not be reused))[^\n]*(?:future commit|未来 commit|future publish|未来 publish)/iu);
      expect(text).not.toMatch(/P6-4[^\n]*(?:proves main|证明 main|main evidence passed|main 证据已通过)/iu);
      expect(text).not.toMatch(/P6-5[^.;\n]*(?:is|as|属于|是)[^.;\n]*(?:branch evidence|branch-only|不是 main evidence|not main evidence)/iu);
      expect(text).not.toMatch(/P6-4[^.;\n]*(?:main-scoped|main release-candidate evidence|main evidence closure|主干证据闭环)/iu);
      expect(text).not.toMatch(/P6-5[^\n]*(?:current HEAD|当前 HEAD)[^\n]*(?:stable|稳定事实|canonical fact)/iu);
      expect(text).not.toMatch(/P6-6[^\n]*(?:run `?\d{8,}`?|artifact digest|artifact id|tarball shasum|npm pack shasum|pack shasum|包 shasum|local temp|临时路径)/iu);
      expect(text).not.toMatch(/P7-2[^\n]*(?:run `?\d{8,}`?|artifact digest|artifact id|tarball shasum|npm pack shasum|pack shasum|包 shasum|local temp|临时路径)/iu);
      expect(text).not.toMatch(/npm publish --dry-run[^\n]*(?:really published|published to npm|真实发布成功|已经发布到 npm|已发布到 npm)/iu);
    }
  });

  it("records P8-1 published usability evidence as repo-safe external consumer proof", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      files: string[];
      scripts: Record<string, string>;
    };
    const script = await readFile(path.join(root, "scripts", "create-published-usability-evidence.mjs"), "utf8");
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    const readmeZh = await readFile(path.join(root, "README.zh-CN.md"), "utf8");
    const productionReadiness = await readFile(path.join(root, "docs", "production-readiness.md"), "utf8");
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p8-1-published-usability.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      ok: boolean;
      packageName: string;
      version: string;
      packageSource: string;
      cleanTempConsumer: boolean;
      noLocalSourcePath: boolean;
      commands: Array<{ name: string; command: string; ok: boolean; schemaVersion: string | null; diagnostics: unknown[] }>;
      diagnostics: unknown[];
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
    };

    expect(manifest.scripts["published:usability:audit"]).toBe("node ./scripts/create-published-usability-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/create-published-usability-evidence.mjs");
    expect(readme).toContain("`published:usability:audit` is a repository-only post-publish audit script.");
    expect(readme).toContain("intentionally excluded from npm package contents");
    expect(readmeZh).toContain("`published:usability:audit` 是 repo-only 的 post-publish 审计脚本。");
    expect(readmeZh).toContain("有意不进入 npm package 内容");
    expect(productionReadiness).toContain("`npm run published:usability:audit` is a repository-only post-publish audit script");
    expect(productionReadiness).toContain("intentionally excluded from npm package contents");
    expect(script).toContain("agent-cli-runtime.publishedUsability.v1");
    expect(script).toContain("npm install");
    expect(script).not.toMatch(/\bnpm publish\b/u);
    expect(script).not.toContain("NODE_AUTH_TOKEN");
    expect(script).not.toContain("--allow-real-run");
    expect(evidence).toMatchObject({
      schemaVersion: "agent-cli-runtime.publishedUsability.v1",
      ok: true,
      packageName: "agent-cli-runtime",
      version: "0.1.0-alpha.3",
      packageSource: "npm-registry",
      cleanTempConsumer: true,
      noLocalSourcePath: true,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
    expect(evidence.commands.map((command) => command.name)).toEqual([
      "npm_install",
      "esm_import",
      "cli_agents_json",
      "cli_doctor_json",
      "cli_conformance_fake",
      "cli_run_fake_codex",
      "cli_goal_fake_codex",
    ]);
    expect(evidence.commands.every((command) => command.ok)).toBe(true);
    expect(evidence.commands.find((command) => command.name === "npm_install")?.command).toBe("npm install agent-cli-runtime@0.1.0-alpha.3");
    expect(evidence.commands.find((command) => command.name === "cli_conformance_fake")?.schemaVersion).toBe("agent-runtime.conformance.v1");
    expect(evidence.diagnostics).toEqual([]);
    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/rawStdout|rawStderr|stdout|stderr|node_modules|p8 run smoke|p8 minimal goal/u);
  });

  it("records P8-2 real CLI compatibility matrix as redacted repo-only evidence", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      files: string[];
      scripts: Record<string, string>;
    };
    const verifierOutput = JSON.parse((await execFileP(process.execPath, [realCompatibilityEvidenceVerifier])).stdout) as {
      schemaVersion: string;
      ok: boolean;
      evidenceSchemaVersion: string;
      diagnostics: unknown[];
    };
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p8-2-real-cli-compatibility-matrix.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      checkedAt: string;
      packageVersion: string;
      gitSha: string;
      gitDirty: boolean;
      dirtySummary: {
        beforeWrite: { dirty: boolean; changedFilesCount: number; changedFiles: unknown[] };
        afterWrite: { dirty: boolean; changedFilesCount: number; changedFiles: unknown[] };
      };
      adapters: Record<string, {
        executable: { status: string; path: string | null; unavailableReason: string | null };
        version: string | null;
        auth: { status: string; diagnosticCodes: string[] };
        modelsSource: { source: string; modelCount: number };
        capabilities: unknown;
        argvProfile: { defaultArgs: string[]; knownFlags: Array<{ status: string; mapsTo: string }>; needsVerification: Array<{ mapsTo: string }> };
        parserMode: string | null;
        promptTransport: string | null;
        safePreflight: { ok: boolean; runClassification: string; skippedReason: string | null };
        optionalSmoke: {
          status: string;
          ok: boolean;
          expectedTextRequired?: boolean;
          expectedTextMatched?: boolean;
          expectedTextSha256?: string;
          cwdMutationChecked?: boolean;
          cwdMutated?: boolean;
        };
        diagnostics: Array<{ code: string; message: string }>;
        needsVerification: Array<{ mapsTo: string }>;
      }>;
      packageBoundary: { releaseEvidenceIsRepoOnly: boolean; expectedExcludedPath: string };
      noRawStdoutStderr: boolean;
      noPromptText: boolean;
      noTokenOrAuthEnv: boolean;
    };

    expect(manifest.scripts["compat:real:evidence"]).toBe("node ./scripts/create-real-compatibility-evidence.mjs");
    expect(manifest.scripts["compat:real:evidence:verify"]).toBe("node ./scripts/verify-real-compatibility-evidence.mjs");
    expect(manifest.files).not.toContain(".release-evidence");
    expect(manifest.files).not.toContain("scripts/create-real-compatibility-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/verify-real-compatibility-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/verify-package-content-equivalence.mjs");
    expect(verifierOutput).toMatchObject({
      schemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      ok: true,
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      diagnostics: [],
    });
    expect(evidence).toMatchObject({
      schemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      packageVersion: "0.1.0-alpha.3",
      packageBoundary: { releaseEvidenceIsRepoOnly: true, expectedExcludedPath: ".release-evidence/" },
      noRawStdoutStderr: true,
      noPromptText: true,
      noTokenOrAuthEnv: true,
    });
    expect(evidence.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(evidence.gitSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(typeof evidence.gitDirty).toBe("boolean");
    expect(evidence.dirtySummary.beforeWrite.changedFiles).toEqual(expect.any(Array));
    expect(evidence.dirtySummary.afterWrite.changedFiles).toEqual(expect.any(Array));

    for (const adapter of ["codex", "claude", "opencode"]) {
      const entry = evidence.adapters[adapter];
      expect(entry, adapter).toBeDefined();
      expect(entry.executable.status).toMatch(/^(resolved|unavailable)$/u);
      if (entry.executable.status === "resolved") expect(entry.executable.path).toBe("<resolved_executable>");
      else expect(entry.executable.unavailableReason).toEqual(expect.any(String));
      expect(entry.auth.status).toEqual(expect.any(String));
      expect(entry.modelsSource.source).toEqual(expect.any(String));
      expect(entry.capabilities).toBeTruthy();
      expect(entry.argvProfile.defaultArgs).toEqual(expect.any(Array));
      expect(entry.argvProfile.needsVerification).toEqual(expect.any(Array));
      expect(entry.parserMode).toEqual(expect.any(String));
      expect(entry.promptTransport).toMatch(/^(stdin:text|stdin:jsonl)$/u);
      expect(entry.safePreflight.runClassification).toEqual(expect.any(String));
      if (entry.safePreflight.runClassification !== "success") expect(entry.safePreflight.ok).toBe(false);
      if (entry.optionalSmoke.status !== "success") expect(entry.optionalSmoke.ok).toBe(false);
      if (entry.optionalSmoke.status === "success") {
        expect(entry.optionalSmoke).toMatchObject({
          ok: true,
          expectedTextRequired: true,
          expectedTextMatched: true,
          cwdMutationChecked: true,
          cwdMutated: false,
        });
        expect(entry.optionalSmoke.expectedTextSha256).toMatch(/^[0-9a-f]{64}$/u);
      }
      expect(entry.diagnostics).toEqual(expect.any(Array));
      expect(entry.needsVerification.map((item) => item.mapsTo)).toEqual(expect.arrayContaining(
        adapter === "codex"
          ? ["session", "authProbe"]
          : adapter === "claude"
            ? ["session.id", "reasoning"]
            : ["extraAllowedDirs", "session", "permissionPolicy.read-only"],
      ));
    }
    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/rawStdout|rawStderr|rawOutput|promptText|fullPrompt|finalRunRecord|Reply exactly|agent-runtime codex smoke ok/u);
  });

  it("records P8-4 release-strict compatibility closure as branch-safe repo-only evidence", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      files: string[];
      scripts: Record<string, string>;
    };
    const script = await readFile(releaseStrictCompatibilityEvidenceCreator, "utf8");
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p8-4-release-strict-compatibility.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      stage: string;
      evidenceKind: string;
      targetSha: string;
      targetRef: string;
      originMainShaAtCheck: string;
      branchEvidence: boolean;
      mainEvidence: boolean;
      schemas: {
        matrix: string;
        verifier: string;
        releaseVerification: string;
        releaseGateEvidence: string;
      };
      matrix: {
        path: string;
        schemaVersion: string;
        gitSha: string;
        gitInputDirty: boolean;
        gitOutputDirty: boolean;
      };
      compatibilityVerification: {
        command: string;
        schemaVersion: string;
        ok: boolean;
        evidenceSchemaVersion: string;
        targetSha: { expected: string; actual: string; ok: boolean; status: string };
        freshness: { maxAgeHours: number; ok: boolean; status: string };
        dirtyPolicy: { policy: string; allowDirty: boolean; gitDirty: boolean; inputDirty: boolean; outputDirty: boolean; ok: boolean; status: string };
        diagnosticSummary: { count: number; codes: string[] };
      };
      localReleaseCandidate: {
        mode: string;
        command: string;
        releaseVerifyCommand: string;
        verification: {
          schemaVersion: string;
          ok: boolean;
          diagnosticsCount: number;
          artifactNames: string[];
          gateEvidence: {
            schemaVersion: string;
            gates: Array<{ script: string; ok: boolean; evidenceSchemaVersion: string | null; diagnostics: { count: number | null; codes: string[] } }>;
            noAuthenticatedRealRun: boolean;
            noNpmPublish: boolean;
            noNpmToken: boolean;
          };
        };
      };
      remoteReleaseCandidate: {
        workflow: string;
        eligibleForMainWorkflow: boolean;
        triggered: boolean;
        triggerSkippedReason: string;
        run: { id: null; url: null; headSha: null; conclusion: null };
        artifacts: { count: number; names: string[] };
      };
      downloadedArtifacts: {
        verified: boolean;
        skippedReason: string;
        command: string;
        schemaVersion: null;
        ok: null;
      };
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
      boundary: Record<string, boolean>;
    };

    expect(manifest.scripts["release:strict-compatibility:evidence"]).toBe("node ./scripts/create-release-strict-compatibility-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/create-release-strict-compatibility-evidence.mjs");
    expect(script).toContain("agent-cli-runtime.p8ReleaseStrictCompatibilityEvidence.v1");
    expect(script).toContain("target_sha_not_in_origin_main");
    expect(script).toContain("release:verify");
    expect(script).not.toMatch(/\bnpm publish\b/u);
    expect(script).not.toContain("--allow-real-run");

    expect(evidence).toMatchObject({
      schemaVersion: "agent-cli-runtime.p8ReleaseStrictCompatibilityEvidence.v1",
      stage: "P8-4",
      evidenceKind: "branch-local-release-strict-compatibility",
      targetShaSource: "p8-2-real-compatibility-matrix",
      currentHeadShaMeaning: "HEAD at summary generation time; release target evidence remains bound to targetSha.",
      branchEvidence: true,
      mainEvidence: false,
      schemas: {
        matrix: "agent-cli-runtime.realCompatibilityMatrix.v1",
        verifier: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
        releaseVerification: "agent-cli-runtime.releaseVerification.v1",
        releaseGateEvidence: "agent-cli-runtime.releaseGateEvidence.v1",
      },
      matrix: {
        path: ".release-evidence/p8-2-real-cli-compatibility-matrix.json",
        schemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
        gitInputDirty: false,
        gitOutputDirty: true,
      },
      compatibilityVerification: {
        command: "npm run compat:real:evidence:verify -- --target-sha <target-sha> --max-age-hours 24 --release-strict",
        schemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
        ok: true,
        evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
        targetSha: { expected: evidence.targetSha, actual: evidence.targetSha, ok: true, status: "matched" },
        freshness: { maxAgeHours: 24, ok: true, status: "fresh" },
        dirtyPolicy: {
          policy: "release-strict",
          allowDirty: false,
          gitDirty: false,
          inputDirty: false,
          outputDirty: true,
          ok: true,
          status: "self_dirty_only",
        },
        diagnosticSummary: { count: 0, codes: [] },
      },
      localReleaseCandidate: {
        mode: "local-strict",
        command: "npm run release:candidate -- --out-dir <tmp-local-strict>",
        releaseVerifyCommand: "npm run release:verify -- --dir <tmp-local-strict>",
        verification: {
          schemaVersion: "agent-cli-runtime.releaseVerification.v1",
          ok: true,
          diagnosticsCount: 0,
          gateEvidence: {
            schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
            noAuthenticatedRealRun: true,
            noNpmPublish: true,
            noNpmToken: true,
          },
        },
      },
      remoteReleaseCandidate: {
        workflow: ".github/workflows/release-candidate.yml",
        eligibleForMainWorkflow: false,
        triggered: false,
        triggerSkippedReason: "target_sha_not_in_origin_main",
        run: { id: null, url: null, headSha: null, conclusion: null },
        artifacts: { count: 0, names: [] },
      },
      downloadedArtifacts: {
        verified: false,
        skippedReason: "remote_workflow_not_triggered",
        command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
        schemaVersion: null,
        ok: null,
      },
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
    expect(evidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.originMainShaAtCheck).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.matrix.gitSha).toBe(evidence.targetSha);
    expect(evidence.localReleaseCandidate.verification.artifactNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.localReleaseCandidate.verification.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);
    expect(evidence.localReleaseCandidate.verification.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify")).toMatchObject({
      ok: true,
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      diagnostics: { count: 0, codes: [] },
    });
    expect(evidence.boundary).toMatchObject({
      repoOnlyEvidence: true,
      noGithubRelease: true,
      noTrustedPublishing: true,
      noRawStdoutStderr: true,
      noRawCliOutput: true,
      noFullPrompt: true,
      noPrivatePath: true,
      noLocalTempPath: true,
      noResolvedExecutablePath: true,
      noTokenValue: true,
      noBearerValue: true,
      noAuthEnvAssignment: true,
    });
    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/rawStdout|rawStderr|rawOutput|stdout|stderr|promptText|fullPrompt|resolvedExecutablePath|<resolved_executable>/u);
    expect(evidenceText).not.toMatch(/"id":\s*\d+|"url":\s*"https:\/\/github\.com\/iiwish\/agent-cli-runtime\/actions\/runs\//u);
  });

  it("records P8-5 main remote release-candidate closure as repo-only evidence", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      files: string[];
      scripts: Record<string, string>;
    };
    const script = await readFile(mainReleaseCandidateEvidenceCreator, "utf8");
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p8-5-main-release-candidate.json"), "utf8");
    const selfTest = JSON.parse((await execFileP(process.execPath, [mainReleaseCandidateEvidenceCreator, "--self-test"])).stdout) as {
      schemaVersion: string;
      ok: boolean;
      cases: Array<{ name: string; ok: boolean; expectedCode: string | null; actualCode: string | null }>;
    };
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      stage: string;
      evidenceKind: string;
      releaseTargetSha: string;
      targetRef: string;
      currentHeadSha: string;
      originMainShaAtCheck: string;
      p8_4TargetInOriginMain: boolean;
      mainEvidence: boolean;
      branchEvidence: boolean;
      matrix: { gitSha: string; gitInputDirty: boolean; gitOutputDirty: boolean };
      compatibilityVerification: {
        ok: boolean;
        evidenceSchemaVersion: string;
        targetSha: { expected: string; actual: string; ok: boolean; status: string };
        freshness: { maxAgeHours: number; ok: boolean; status: string };
        dirtyPolicy: { policy: string; inputDirty: boolean; outputDirty: boolean; ok: boolean; status: string };
        diagnosticSummary: { count: number; codes: string[] };
      };
      localReleaseCandidate: {
        verification: {
          ok: boolean;
          schemaVersion: string;
          artifactNames: string[];
          gateEvidence: { schemaVersion: string; gates: Array<{ script: string; ok: boolean; evidenceSchemaVersion: string | null; diagnostics: { count: number | null; codes: string[] } }> };
        };
      };
      remoteReleaseCandidate: {
        workflow: string;
        ref: string;
        triggered: boolean;
        run: {
          id: number;
          url: string;
          event: string;
          headBranch: string;
          headSha: string;
          status: string;
          conclusion: string;
          headShaMatchesReleaseTarget: boolean;
          jobs: Array<{ name: string; status: string; conclusion: string }>;
        };
        artifacts: {
          count: number;
          names: string[];
          expectedNames: string[];
          complete: boolean;
          items: Array<{ name: string; id: number; digest: string; expired: boolean }>;
        };
      };
      downloadedArtifacts: {
        verified: boolean;
        skippedReason: string | null;
        verification: {
          command: string;
          schemaVersion: string;
          ok: boolean;
          diagnosticsCount: number;
          artifactNames: string[];
          gateEvidence: {
            schemaVersion: string;
            gates: Array<{
              script: string;
              command: string;
              ok: boolean;
              evidenceSchemaVersion: string | null;
              targetSha: { expected: string; actual: string | null; ok: boolean | null; status: string | null };
              freshness: { status: string | null };
              dirtyPolicy: { policy: string | null; status: string | null };
              diagnostics: { count: number | null; codes: string[] };
              repoOnlyEvidence: { status: string; reason: string } | null;
            }>;
            noAuthenticatedRealRun: boolean;
            noNpmPublish: boolean;
            noNpmToken: boolean;
          };
        };
      };
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
      boundary: Record<string, boolean>;
    };

    expect(manifest.files).not.toContain("scripts/create-main-release-candidate-evidence.mjs");
    expect(manifest.files).not.toContain("scripts/normalize-release-artifacts.mjs");
    expect(manifest.scripts["release:main-candidate:evidence"]).toBe("node ./scripts/create-main-release-candidate-evidence.mjs");
    expect(manifest.scripts["release:artifacts:normalize"]).toBe("node ./scripts/normalize-release-artifacts.mjs");
    expect(script).toContain("agent-cli-runtime.p8MainReleaseCandidateEvidence.v1");
    expect(script).toContain("agent-cli-runtime.p8MainReleaseCandidateEvidenceSelfTest.v1");
    expect(script).toContain("releaseTargetSha");
    expect(script).toContain("headShaMatchesReleaseTarget");
    expect(script).toContain("workflow_dispatch");
    expect(script).toContain("remote_run_head_sha_mismatch");
    expect(script).toContain("remote_run_conclusion_not_success");
    expect(script).toContain("missing_remote_artifact");
    expect(script).toContain("remote_artifact_expiration_unverified");
    expect(script).toContain("downloaded_release_artifacts_not_ok");
    expect(script).toContain("release-candidate.yml");
    expect(script).toContain("repo-only real compatibility evidence not refreshed in CI");
    expect(script).not.toMatch(/\bnpm publish\b/u);
    expect(script).not.toContain("--allow-real-run");
    expect(script).not.toContain("NODE_AUTH_TOKEN");

    expect(selfTest).toMatchObject({
      schemaVersion: "agent-cli-runtime.p8MainReleaseCandidateEvidenceSelfTest.v1",
      ok: true,
    });
    expect(selfTest.cases.map((testCase) => testCase.name).sort()).toEqual([
      "P8-7 stage derives reusable output",
      "artifact without explicit non-expired state is rejected",
      "downloaded verification failure is rejected",
      "explicit output is preserved for non-P8-5 stage",
      "failed remote conclusion is rejected",
      "incomplete remote artifact set is rejected",
      "invalid stage is rejected",
      "missing stage keeps P8-5 default output",
      "remote headSha mismatch is rejected",
    ].sort());
    expect(selfTest.cases.filter((testCase) => testCase.expectedCode !== null).map((testCase) => testCase.expectedCode).sort()).toEqual([
      "downloaded_release_artifacts_not_ok",
      "missing_remote_artifact",
      "remote_artifact_expiration_unverified",
      "remote_run_conclusion_not_success",
      "remote_run_head_sha_mismatch",
      "stage_invalid",
    ].sort());
    expect(selfTest.cases.every((testCase) => testCase.ok && testCase.actualCode === testCase.expectedCode)).toBe(true);

    expect(evidence).toMatchObject({
      schemaVersion: "agent-cli-runtime.p8MainReleaseCandidateEvidence.v1",
      stage: "P8-5",
      evidenceKind: "main-scoped-remote-release-candidate",
      targetRef: "main",
      mainEvidence: true,
      branchEvidence: false,
      p8_4TargetInOriginMain: true,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
    expect(evidence.releaseTargetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.currentHeadSha).toBe(evidence.releaseTargetSha);
    expect(evidence.originMainShaAtCheck).toBe(evidence.releaseTargetSha);
    expect(evidence.matrix.gitSha).toBe(evidence.releaseTargetSha);
    expect(evidence.matrix.gitInputDirty).toBe(false);
    expect(evidence.matrix.gitOutputDirty).toBe(true);
    expect(evidence.compatibilityVerification).toMatchObject({
      ok: true,
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      targetSha: { expected: evidence.releaseTargetSha, actual: evidence.releaseTargetSha, ok: true, status: "matched" },
      freshness: { maxAgeHours: 24, ok: true, status: "fresh" },
      dirtyPolicy: { policy: "release-strict", inputDirty: false, outputDirty: true, ok: true, status: "self_dirty_only" },
      diagnosticSummary: { count: 0, codes: [] },
    });
    expect(evidence.localReleaseCandidate.verification).toMatchObject({
      ok: true,
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
    });
    expect(evidence.localReleaseCandidate.verification.artifactNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.localReleaseCandidate.verification.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);

    expect(evidence.remoteReleaseCandidate).toMatchObject({
      workflow: ".github/workflows/release-candidate.yml",
      ref: "main",
      triggered: true,
      run: {
        event: "workflow_dispatch",
        headBranch: "main",
        headSha: evidence.releaseTargetSha,
        status: "completed",
        conclusion: "success",
        headShaMatchesReleaseTarget: true,
      },
      artifacts: {
        count: 5,
        complete: true,
      },
    });
    expect(evidence.remoteReleaseCandidate.run.id).toBeGreaterThan(0);
    expect(evidence.remoteReleaseCandidate.run.url).toMatch(/^https:\/\/github\.com\/iiwish\/agent-cli-runtime\/actions\/runs\/\d+$/u);
    expect(evidence.remoteReleaseCandidate.run.jobs).toEqual([
      { name: "Build release candidate artifacts", status: "completed", conclusion: "success" },
    ]);
    expect(evidence.remoteReleaseCandidate.artifacts.names.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.remoteReleaseCandidate.artifacts.expectedNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.remoteReleaseCandidate.artifacts.items.map((artifact) => artifact.name).sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    for (const artifact of evidence.remoteReleaseCandidate.artifacts.items) {
      expect(artifact.id).toBeGreaterThan(0);
      expect(artifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(artifact.expired).toBe(false);
    }

    expect(evidence.downloadedArtifacts).toMatchObject({
      verified: true,
      skippedReason: null,
      verification: {
        command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
        schemaVersion: "agent-cli-runtime.releaseVerification.v1",
        ok: true,
        diagnosticsCount: 0,
      },
    });
    expect(evidence.downloadedArtifacts.verification.artifactNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.downloadedArtifacts.verification.gateEvidence).toMatchObject({
      schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
    const remoteCompatibilityGate = evidence.downloadedArtifacts.verification.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify");
    expect(remoteCompatibilityGate).toMatchObject({
      command: "repo-only real compatibility evidence not refreshed in CI",
      ok: true,
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      targetSha: { expected: evidence.releaseTargetSha, actual: null, ok: null, status: "repo_only_not_run" },
      freshness: { status: "repo_only_not_run" },
      dirtyPolicy: { policy: "repo-only-skipped", status: "repo_only_not_run" },
      diagnostics: { count: 0, codes: [] },
      repoOnlyEvidence: { status: "not_refreshed_in_ci", reason: "real_compatibility_matrix_is_repo_only" },
    });
    expect(evidence.boundary).toMatchObject({
      repoOnlyEvidence: true,
      noGithubRelease: true,
      noTrustedPublishing: true,
      noRawStdoutStderr: true,
      noRawCliOutput: true,
      noFullPrompt: true,
      noPrivatePath: true,
      noLocalTempPath: true,
      noResolvedExecutablePath: true,
      noWorkflowLogs: true,
      noTokenValue: true,
      noBearerValue: true,
      noAuthEnvAssignment: true,
    });

    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/rawStdout|rawStderr|rawOutput|"stdout"|"stderr"|promptText|fullPrompt|workflowLog|logs|resolvedExecutablePath|<resolved_executable>/u);

    const packagedDocs = [
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/compatibility.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/production-readiness.md",
      "docs/ssot.md",
    ];
    for (const doc of packagedDocs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text, `${doc} must not include P8-5 run id`).not.toContain(String(evidence.remoteReleaseCandidate.run.id));
      expect(text, `${doc} must not include P8-5 run URL`).not.toContain(evidence.remoteReleaseCandidate.run.url);
      for (const artifact of evidence.remoteReleaseCandidate.artifacts.items) {
        expect(text, `${doc} must not include P8-5 artifact id`).not.toContain(String(artifact.id));
      }
      expect(text, `${doc} must not include local artifact paths`).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\//u);
    }
  });

  it("records P8-7 fresh main release-candidate evidence with reusable generator output", async () => {
    const script = await readFile(mainReleaseCandidateEvidenceCreator, "utf8");
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p8-7-main-release-candidate.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      stage: string;
      evidenceKind: string;
      releaseTargetSha: string;
      targetRef: string;
      currentHeadSha: string;
      originMainShaAtCheck: string;
      mainEvidence: boolean;
      branchEvidence: boolean;
      matrix: { gitSha: string; gitInputDirty: boolean; gitOutputDirty: boolean };
      compatibilityVerification: {
        ok: boolean;
        evidenceSchemaVersion: string;
        targetSha: { expected: string; actual: string; ok: boolean; status: string };
        freshness: { maxAgeHours: number; ok: boolean; status: string };
        dirtyPolicy: { policy: string; inputDirty: boolean; outputDirty: boolean; ok: boolean; status: string };
        diagnosticSummary: { count: number; codes: string[] };
      };
      localReleaseCandidate: {
        verification: {
          ok: boolean;
          schemaVersion: string;
          diagnosticsCount: number;
          artifactNames: string[];
          gateEvidence: { schemaVersion: string; gates: Array<{ script: string; ok: boolean; evidenceSchemaVersion: string | null; diagnostics: { count: number | null; codes: string[] } }> };
        };
      };
      remoteReleaseCandidate: {
        workflow: string;
        ref: string;
        triggered: boolean;
        run: {
          id: number;
          url: string;
          event: string;
          headBranch: string;
          headSha: string;
          status: string;
          conclusion: string;
          headShaMatchesReleaseTarget: boolean;
          jobs: Array<{ name: string; status: string; conclusion: string }>;
        };
        artifacts: {
          count: number;
          names: string[];
          expectedNames: string[];
          complete: boolean;
          valid: boolean;
          items: Array<{ name: string; id: number; digest: string; expired: boolean }>;
        };
      };
      downloadedArtifacts: {
        verified: boolean;
        skippedReason: string | null;
        verification: {
          command: string;
          schemaVersion: string;
          ok: boolean;
          diagnosticsCount: number;
          artifactNames: string[];
          gateEvidence: {
            schemaVersion: string;
            gates: Array<{
              script: string;
              command: string;
              ok: boolean;
              evidenceSchemaVersion: string | null;
              targetSha: { expected: string; actual: string | null; ok: boolean | null; status: string | null };
              freshness: { status: string | null };
              dirtyPolicy: { policy: string | null; status: string | null };
              diagnostics: { count: number | null; codes: string[] };
              repoOnlyEvidence: { status: string; reason: string } | null;
            }>;
            noAuthenticatedRealRun: boolean;
            noNpmPublish: boolean;
            noNpmToken: boolean;
          };
        };
      };
      noAuthenticatedRealRun: boolean;
      noNpmPublish: boolean;
      noNpmToken: boolean;
      boundary: Record<string, boolean>;
    };

    expect(script).toContain("--stage <stage>");
    expect(script).toContain("P8-7");
    expect(script).toContain("stage_invalid");
    expect(script).toContain("defaultOutputForStage");
    expect(script).not.toMatch(/\bnpm publish\b/u);
    expect(script).not.toContain("--allow-real-run");
    expect(script).not.toContain("NODE_AUTH_TOKEN");

    expect(evidence).toMatchObject({
      schemaVersion: "agent-cli-runtime.p8MainReleaseCandidateEvidence.v1",
      stage: "P8-7",
      evidenceKind: "main-scoped-remote-release-candidate",
      targetRef: "main",
      mainEvidence: true,
      branchEvidence: false,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    });
    expect(evidence.releaseTargetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.currentHeadSha).toBe(evidence.releaseTargetSha);
    expect(evidence.originMainShaAtCheck).toBe(evidence.releaseTargetSha);
    expect(evidence.matrix.gitSha).toBe(evidence.releaseTargetSha);
    expect(evidence.matrix.gitInputDirty).toBe(false);
    expect(evidence.matrix.gitOutputDirty).toBe(true);
    expect(evidence.compatibilityVerification).toMatchObject({
      ok: true,
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      targetSha: { expected: evidence.releaseTargetSha, actual: evidence.releaseTargetSha, ok: true, status: "matched" },
      freshness: { maxAgeHours: 24, ok: true, status: "fresh" },
      dirtyPolicy: { policy: "release-strict", inputDirty: false, outputDirty: true, ok: true, status: "self_dirty_only" },
      diagnosticSummary: { count: 0, codes: [] },
    });

    expect(evidence.localReleaseCandidate.verification).toMatchObject({
      ok: true,
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      diagnosticsCount: 0,
    });
    expect(evidence.localReleaseCandidate.verification.artifactNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.localReleaseCandidate.verification.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);

    expect(evidence.remoteReleaseCandidate).toMatchObject({
      workflow: ".github/workflows/release-candidate.yml",
      ref: "main",
      triggered: true,
      run: {
        event: "workflow_dispatch",
        headBranch: "main",
        headSha: evidence.releaseTargetSha,
        status: "completed",
        conclusion: "success",
        headShaMatchesReleaseTarget: true,
      },
      artifacts: {
        count: 5,
        complete: true,
        valid: true,
      },
    });
    expect(evidence.remoteReleaseCandidate.run.id).toBeGreaterThan(0);
    expect(evidence.remoteReleaseCandidate.run.url).toMatch(/^https:\/\/github\.com\/iiwish\/agent-cli-runtime\/actions\/runs\/\d+$/u);
    expect(evidence.remoteReleaseCandidate.artifacts.names.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.remoteReleaseCandidate.artifacts.expectedNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.remoteReleaseCandidate.artifacts.items.map((artifact) => artifact.name).sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    for (const artifact of evidence.remoteReleaseCandidate.artifacts.items) {
      expect(artifact.id).toBeGreaterThan(0);
      expect(artifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(artifact.expired).toBe(false);
    }

    expect(evidence.downloadedArtifacts).toMatchObject({
      verified: true,
      skippedReason: null,
      verification: {
        command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
        schemaVersion: "agent-cli-runtime.releaseVerification.v1",
        ok: true,
        diagnosticsCount: 0,
      },
    });
    expect(evidence.downloadedArtifacts.verification.artifactNames.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    const remoteCompatibilityGate = evidence.downloadedArtifacts.verification.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify");
    expect(remoteCompatibilityGate).toMatchObject({
      command: "repo-only real compatibility evidence not refreshed in CI",
      ok: true,
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityMatrix.v1",
      targetSha: { expected: evidence.releaseTargetSha, actual: null, ok: null, status: "repo_only_not_run" },
      freshness: { status: "repo_only_not_run" },
      dirtyPolicy: { policy: "repo-only-skipped", status: "repo_only_not_run" },
      diagnostics: { count: 0, codes: [] },
      repoOnlyEvidence: { status: "not_refreshed_in_ci", reason: "real_compatibility_matrix_is_repo_only" },
    });
    expect(evidence.boundary).toMatchObject({
      repoOnlyEvidence: true,
      proofAppliesToReleaseTargetShaOnly: true,
      evidenceRecordingCommitMayDifferFromReleaseTargetSha: true,
      futureMergeCommitRequiresFreshMainEvidence: true,
      noGithubRelease: true,
      noTrustedPublishing: true,
      noRawStdoutStderr: true,
      noRawCliOutput: true,
      noFullPrompt: true,
      noPrivatePath: true,
      noLocalTempPath: true,
      noResolvedExecutablePath: true,
      noWorkflowLogs: true,
      noTokenValue: true,
      noBearerValue: true,
      noAuthEnvAssignment: true,
    });

    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/rawStdout|rawStderr|rawOutput|"stdout"|"stderr"|promptText|fullPrompt|workflowLog|logs|resolvedExecutablePath|<resolved_executable>/u);

    const packagedDocs = [
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/compatibility.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/production-readiness.md",
      "docs/ssot.md",
    ];
    for (const doc of packagedDocs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text, `${doc} must not include P8-7 run id`).not.toContain(String(evidence.remoteReleaseCandidate.run.id));
      expect(text, `${doc} must not include P8-7 run URL`).not.toContain(evidence.remoteReleaseCandidate.run.url);
      for (const artifact of evidence.remoteReleaseCandidate.artifacts.items) {
        expect(text, `${doc} must not include P8-7 artifact id`).not.toContain(String(artifact.id));
      }
      expect(text, `${doc} must not include local artifact paths`).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\//u);
    }
  });

  it("records P8-8 package content equivalence evidence without over-claiming fresh main evidence", async () => {
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p8-8-package-content-equivalence.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      ok: boolean;
      baseRef: string;
      headRef: string;
      baseSha: string;
      headSha: string;
      packageName: string;
      packageVersion: string;
      packageContentEqual: boolean;
      basePackageDigest: string;
      headPackageDigest: string;
      baseFileCount: number;
      headFileCount: number;
      changedPackageFiles: Array<{ path: string; status: string; baseSha256: string | null; headSha256: string | null }>;
      evidenceOnlyDrift: boolean;
      freshReleaseCandidateRequired: boolean;
      diagnostics: Array<{ code: string; severity: string; message: string }>;
      boundary: Record<string, boolean>;
    };

    expect(evidence).toMatchObject({
      schemaVersion: "agent-cli-runtime.packageContentEquivalence.v1",
      ok: true,
      headRef: "origin/main",
      packageName: "agent-cli-runtime",
      packageVersion: "0.1.0-alpha.3",
      packageContentEqual: false,
      evidenceOnlyDrift: false,
      freshReleaseCandidateRequired: true,
      boundary: {
        repoOnlyEvidence: true,
        comparedNpmPackageContentOnly: true,
        noAuthenticatedRealRun: true,
        noNpmPublish: true,
        noNpmToken: true,
        noGithubRelease: true,
        noTarballGzipDigestDecision: true,
        noRawStdoutStderr: true,
        noPrivatePath: true,
        noLocalTempPath: true,
      },
    });
    expect(evidence.baseRef).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.baseSha).toBe(evidence.baseRef);
    expect(evidence.headSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.basePackageDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(evidence.headPackageDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(evidence.basePackageDigest).not.toBe(evidence.headPackageDigest);
    expect(evidence.baseFileCount).toBeGreaterThan(0);
    expect(evidence.headFileCount).toBe(evidence.baseFileCount);
    expect(evidence.changedPackageFiles.map((file) => file.path).sort()).toEqual([
      "README.md",
      "README.zh-CN.md",
      "docs/production-readiness.md",
      "docs/release-report.md",
      "docs/ssot.md",
    ].sort());
    expect(evidence.changedPackageFiles.every((file) => file.status === "modified")).toBe(true);
    expect(evidence.changedPackageFiles.every((file) => file.baseSha256?.startsWith("sha256:") && file.headSha256?.startsWith("sha256:"))).toBe(true);
    expect(evidence.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "package_content_drift", severity: "decision" }),
    ]));
    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/rawStdout|rawStderr|rawOutput|"stdout"|"stderr"|promptText|fullPrompt|workflowLog|logs|resolvedExecutablePath|<resolved_executable>|worktree/u);
  });

  it("keeps alpha.3 corrective docs stable and package-safe", async () => {
    const docs = [
      "README.md",
      "README.zh-CN.md",
      "docs/compatibility.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/ssot.md",
    ];
    const releaseReport = await readFile(path.join(root, "docs", "release-report.md"), "utf8");
    const releaseChecklist = await readFile(path.join(root, "docs", "release-checklist.md"), "utf8");
    const runbook = await readFile(path.join(root, "docs", "release-publish-runbook.md"), "utf8");

    expect(releaseReport).toContain("0.1.0-alpha.3");
    expect(releaseReport).toContain("corrective pre-alpha release");
    expect(releaseReport).toContain("agent-cli-runtime.releaseVerification.v1");
    expect(releaseReport).toContain("agent-cli-runtime.releaseGateEvidence.v1");
    expect(releaseReport).toContain("compat:real:evidence:verify");
    expect(releaseReport).toContain(".release-evidence/");
    expect(releaseChecklist).toContain("P7-5 Alpha.3 Corrective Release");
    expect(releaseChecklist).toContain("0.1.0-alpha.3");
    expect(runbook).toContain("Corrective package line: `agent-cli-runtime@0.1.0-alpha.3`");

    const productionReadiness = await readFile(path.join(root, "docs", "production-readiness.md"), "utf8");
    const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
    expect(productionReadiness).toContain("0.1.0-alpha.3` is the corrective pre-alpha release");
    expect(productionReadiness).toContain("installed-package CLI smoke");
    expect(changelog).toContain("0.1.0-alpha.3 — corrective pre-alpha release");
    expect(changelog).toContain("P7-5 alpha.3 corrective release");

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).toContain(".release-evidence/");
      expect(text).toContain("npm publish --dry-run --ignore-scripts --tag alpha");
      expect(text, doc + " must not include real local temp paths").not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\//u);
      expect(text, doc + " must not include artifact digests").not.toMatch(/sha256:[0-9a-f]{16,}/iu);
      expect(text, doc + " must not include raw tarball or pack hashes").not.toMatch(/(?:tarball sha256|tarball shasum|npm pack shasum|pack shasum)\s*[:：]?\s*[0-9a-f]{16,}/iu);
      expect(text, doc + " must keep executable shell snippets executable").not.toMatch(/mktemp -d\s+<local-temp-dir>|>\s*<local-temp-dir>|readFileSync\(['"]<local-temp-dir>['"]/u);
      expect(text, doc + " must record alpha.2 stale-docs incident").toMatch(/0\.1\.0-alpha\.2[^\n]*(?:stale|pre-publish|过期|发布前)/iu);
      expect(text, doc + " must not describe alpha.3 as unpublished").not.toMatch(/(?:0\.1\.0-alpha\.3|alpha\.3)[^\n]*(?:not published|unpublished|has not occurred|not yet published|未发布|尚未发布|尚未发生)/iu);
      expect(text).not.toMatch(/P6-6[^\n]*(?:run \d{8,}|artifact digest|artifact id|tarball shasum|npm pack shasum|pack shasum|包 shasum|local temp|临时路径)/iu);
    }

    for (const artifact of expectedReleaseCandidateArtifacts) {
      expect(releaseReport).toContain(artifact);
      expect(releaseChecklist).toContain(artifact);
    }
  });

  it("locks packaged docs to the P7-5 alpha.3 corrective boundary", async () => {
    const packagedDocs = [
      "CHANGELOG.md",
      "README.md",
      "README.zh-CN.md",
      "docs/compatibility.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/ssot.md",
    ];
    const compatibility = await readFile(path.join(root, "docs", "compatibility.md"), "utf8");

    expect(compatibility).toContain("P7-5");
    expect(compatibility).toContain("0.1.0-alpha.3` is the corrective pre-alpha release");
    expect(compatibility).toContain("npm publish --dry-run --ignore-scripts --tag alpha");
    expect(compatibility).toContain("0.1.0-alpha.2");
    expect(compatibility).toContain("stale package docs");

    for (const doc of packagedDocs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text, `${doc} must not describe alpha.3 as a candidate or unpublished package`).not.toMatch(
        /(?:0\.1\.0-alpha\.3|alpha\.3)[^\n]*(?:release candidate|publish-ready|candidate\s*\/\s*prep|not published|unpublished|未发布|候选)/iu,
      );
      expect(text, `${doc} must not use only the P7-1 alpha.2 prep state as current status`).not.toMatch(
        /P7-1 prepares `0\.1\.0-alpha\.2` as a candidate version only/iu,
      );
      expect(text, `${doc} must record alpha.2 stale-docs incident`).toMatch(
        /0\.1\.0-alpha\.2[^\n]*(?:stale|pre-publish|过期|发布前)/iu,
      );
      expect(text, `${doc} must not keep old current dist-tag claims`).not.toMatch(/(?:current npm dist-tags|当前 npm dist-tags)[^\n]*alpha\s*->\s*0\.1\.0-alpha\.2/iu);
    }
  });

  it("records P7-3 alpha.2 publish dry-run evidence without real publish side effects", async () => {
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p7-3-alpha-2-publish.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      stage: string;
      evidenceKind: string;
      targetRef: string;
      targetSha: string;
      mainEvidence: boolean;
      packageName: string;
      packageVersion: string;
      releaseCandidateRun: { id: number; url: string; event: string; headBranch: string; headSha: string; status: string; conclusion: string };
      releaseCandidateJob: { id: number; name: string; status: string; conclusion: string };
      artifacts: { count: number; names: string[]; items: Array<{ name: string; id: number; digest: string }> };
      downloadedVerification: {
        command: string;
        schemaVersion: string;
        ok: boolean;
        diagnosticsCount: number;
        packageFiles: number;
        packageName: string;
        version: string;
        tarball?: { filename?: string; sizeBytes?: number; shasum?: string };
        shasum?: string;
        integrity?: string;
      };
      gateEvidence: {
        schemaVersion: string;
        gates: Array<{
          script: string;
          ok: boolean;
          outputSchemaVersion: string;
          packageSource?: string;
          evidenceSchemaVersion?: string;
          diagnostics?: { count: number; codes: string[] };
        }>;
        noAuthenticatedRealRun: boolean;
        noNpmPublish: boolean;
        noNpmToken: boolean;
      };
      registryBeforePublish: {
        versionExists: boolean;
        errorCode: string;
        distTags: Record<string, string>;
        publishedGithubRelease: { tagName: string; isPrerelease: boolean; url: string };
      };
      prePublishVerification: { commands: Array<{ command: string; ok: boolean; publishTag?: string; dryRun?: boolean }> };
      publishMode: string;
      realPublishAuthorized: boolean;
      npmPublishExecuted: boolean;
      postPublishVerification: { status: string; reason: string };
      githubRelease: { tag: string; created: boolean; url: string | null; reason: string };
      boundary: Record<string, boolean>;
    };

    expect(evidence.schemaVersion).toBe("agent-cli-runtime.publishEvidence.v1");
    expect(evidence.stage).toBe("P7-3");
    expect(evidence.evidenceKind).toBe("alpha-2-publish-dry-run");
    expect(evidence.targetRef).toBe("main");
    expect(evidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.mainEvidence).toBe(true);
    expect(evidence.packageName).toBe("agent-cli-runtime");
    expect(evidence.packageVersion).toBe("0.1.0-alpha.2");
    expect(evidence.releaseCandidateRun.event).toBe("workflow_dispatch");
    expect(evidence.releaseCandidateRun.headBranch).toBe("main");
    expect(evidence.releaseCandidateRun.headSha).toBe(evidence.targetSha);
    expect(evidence.releaseCandidateRun.status).toBe("completed");
    expect(evidence.releaseCandidateRun.conclusion).toBe("success");
    expect(evidence.releaseCandidateJob.name).toBe("Build release candidate artifacts");
    expect(evidence.releaseCandidateJob.status).toBe("completed");
    expect(evidence.releaseCandidateJob.conclusion).toBe("success");
    expect(evidence.artifacts.count).toBe(5);
    expect(evidence.artifacts.names.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    expect(evidence.artifacts.items.map((artifact) => artifact.name).sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    for (const artifact of evidence.artifacts.items) {
      expect(artifact.id).toBeGreaterThan(0);
      expect(artifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
    expect(evidence.downloadedVerification).toMatchObject({
      command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: true,
      diagnosticsCount: 0,
      packageFiles: 151,
      packageName: "agent-cli-runtime",
      version: "0.1.0-alpha.2",
    });
    expect(evidence.downloadedVerification.tarball?.filename).toBe("agent-cli-runtime-0.1.0-alpha.2.tgz");
    expect(evidence.downloadedVerification.tarball?.sizeBytes).toBeUndefined();
    expect(evidence.downloadedVerification.tarball?.shasum).toBeUndefined();
    expect(evidence.downloadedVerification.shasum).toBeUndefined();
    expect(evidence.downloadedVerification.integrity).toBeUndefined();
    expect(evidence.gateEvidence.schemaVersion).toBe("agent-cli-runtime.releaseGateEvidence.v1");
    expect(evidence.gateEvidence.gates.map((gate) => gate.script).sort()).toEqual([
      "compat:real:evidence:verify",
      "daemon:verify",
      "runtime:safety",
    ]);
    expect(evidence.gateEvidence.gates.every((gate) => gate.ok)).toBe(true);
    expect(evidence.gateEvidence.gates.find((gate) => gate.script === "compat:real:evidence:verify")).toMatchObject({
      outputSchemaVersion: "agent-cli-runtime.realCompatibilityEvidenceVerification.v1",
      evidenceSchemaVersion: "agent-cli-runtime.realCompatibilityEvidence.v1",
      diagnostics: { count: 0, codes: [] },
    });
    expect(evidence.gateEvidence.noAuthenticatedRealRun).toBe(true);
    expect(evidence.gateEvidence.noNpmPublish).toBe(true);
    expect(evidence.gateEvidence.noNpmToken).toBe(true);
    expect(evidence.registryBeforePublish.versionExists).toBe(false);
    expect(evidence.registryBeforePublish.errorCode).toBe("E404");
    expect(evidence.registryBeforePublish.distTags).toMatchObject({ alpha: "0.1.0-alpha.1", latest: "0.1.0-alpha.1" });
    expect(evidence.registryBeforePublish.publishedGithubRelease).toMatchObject({
      tagName: "v0.1.0-alpha.1",
      isPrerelease: true,
    });
    expect(evidence.prePublishVerification.commands.find((entry) => entry.command === "npm publish --dry-run --ignore-scripts --tag alpha")).toMatchObject({
      ok: true,
      publishTag: "alpha",
      dryRun: true,
    });
    expect(evidence.publishMode).toBe("dry-run-only");
    expect(evidence.realPublishAuthorized).toBe(false);
    expect(evidence.npmPublishExecuted).toBe(false);
    expect(evidence.postPublishVerification.status).toBe("not-run");
    expect(evidence.githubRelease).toMatchObject({
      tag: "v0.1.0-alpha.2",
      created: false,
      url: null,
    });
    expect(evidence.boundary.noAuthenticatedRealRun).toBe(true);
    expect(evidence.boundary.noNpmPublish).toBe(true);
    expect(evidence.boundary.noGithubRelease).toBe(true);
    expect(evidence.boundary.noNpmToken).toBe(true);
    expect(evidence.boundary.noTrustedPublishing).toBe(true);
    expect(evidence.boundary.noRawLogs).toBe(true);
    expect(evidence.boundary.noRawStdoutStderr).toBe(true);
    expect(evidence.boundary.noRawCliOutput).toBe(true);
    expect(evidence.boundary.noFullPrompt).toBe(true);
    expect(evidence.boundary.noPrivatePath).toBe(true);
    expect(evidence.boundary.noLocalTempPath).toBe(true);
    expect(evidence.boundary.noTokenValue).toBe(true);
    expect(evidence.boundary.noBearerValue).toBe(true);
    expect(evidence.boundary.noAuthEnvAssignment).toBe(true);
    expect(evidence.boundary.noTarballSize).toBe(true);
    expect(evidence.boundary.noTarballShasum).toBe(true);
    expect(evidence.boundary.noPackShasum).toBe(true);
    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/\b(?:sizeBytes|sizeInBytes|shasum|integrity)\b/u);
  });

  it("records P7-4 alpha.2 post-publish evidence without unsafe details", async () => {
    const evidenceText = await readFile(path.join(root, ".release-evidence", "p7-4-alpha-2-post-publish.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as {
      schemaVersion: string;
      stage: string;
      evidenceKind: string;
      targetSha: string;
      packageName: string;
      packageVersion: string;
      authorization: { explicitAuthorizationPhrasePresent: boolean; npmWebLoginCompleted: boolean; npmBrowserPublishAuthorizationCompleted: boolean };
      releaseCandidateRun: { id: number; headSha: string; status: string; conclusion: string; headShaMatchesOriginMain: boolean };
      artifacts: { count: number; names: string[]; items: Array<{ name: string; id: number; digest: string }> };
      downloadedVerification: { command: string; schemaVersion: string; ok: boolean; diagnosticsCount: number; packageFiles: number; version: string; tarball?: { filename?: string; sizeBytes?: number; shasum?: string }; shasum?: string; integrity?: string };
      registryPrePublish: { versionExists: boolean; errorCode: string };
      publish: { command: string; attempted: boolean; succeeded: boolean; tag: string; npmPublishExecuted: boolean };
      registryPostPublish: { version: string; distTags: Record<string, string> };
      installedPackageSmoke: { ok: boolean; agentsCount: number; doctorOk: boolean; doctorAgentsCount: number };
      githubRelease: { tag: string; created: boolean; url: string; targetCommitish: string; isPrerelease: boolean };
      publishMode: string;
      docsUpdatedToPublishedState: boolean;
      boundary: Record<string, boolean>;
    };

    expect(evidence.schemaVersion).toBe("agent-cli-runtime.postPublishEvidence.v1");
    expect(evidence.stage).toBe("P7-4");
    expect(evidence.evidenceKind).toBe("alpha-2-post-publish");
    expect(evidence.targetSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidence.packageName).toBe("agent-cli-runtime");
    expect(evidence.packageVersion).toBe("0.1.0-alpha.2");
    expect(evidence.authorization).toMatchObject({
      explicitAuthorizationPhrasePresent: true,
      npmWebLoginCompleted: true,
      npmBrowserPublishAuthorizationCompleted: true,
    });
    expect(evidence.releaseCandidateRun.headSha).toBe(evidence.targetSha);
    expect(evidence.releaseCandidateRun.status).toBe("completed");
    expect(evidence.releaseCandidateRun.conclusion).toBe("success");
    expect(evidence.releaseCandidateRun.headShaMatchesOriginMain).toBe(true);
    expect(evidence.artifacts.count).toBe(5);
    expect(evidence.artifacts.names.sort()).toEqual([...expectedReleaseCandidateArtifacts].sort());
    for (const artifact of evidence.artifacts.items) {
      expect(artifact.id).toBeGreaterThan(0);
      expect(artifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
    expect(evidence.downloadedVerification).toMatchObject({
      command: "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>",
      schemaVersion: "agent-cli-runtime.releaseVerification.v1",
      ok: true,
      diagnosticsCount: 0,
      packageFiles: 151,
      version: "0.1.0-alpha.2",
    });
    expect(evidence.downloadedVerification.tarball?.filename).toBe("agent-cli-runtime-0.1.0-alpha.2.tgz");
    expect(evidence.downloadedVerification.tarball?.sizeBytes).toBeUndefined();
    expect(evidence.downloadedVerification.tarball?.shasum).toBeUndefined();
    expect(evidence.downloadedVerification.shasum).toBeUndefined();
    expect(evidence.downloadedVerification.integrity).toBeUndefined();
    expect(evidence.registryPrePublish).toMatchObject({ versionExists: false, errorCode: "E404" });
    expect(evidence.publish).toMatchObject({
      command: "npm publish --ignore-scripts --tag alpha",
      attempted: true,
      succeeded: true,
      tag: "alpha",
      npmPublishExecuted: true,
    });
    expect(evidence.registryPostPublish).toMatchObject({
      version: "0.1.0-alpha.2",
      distTags: { alpha: "0.1.0-alpha.2", latest: "0.1.0-alpha.1" },
    });
    expect(evidence.installedPackageSmoke).toMatchObject({
      ok: true,
      agentsCount: 3,
      doctorOk: true,
      doctorAgentsCount: 3,
    });
    expect(evidence.githubRelease).toMatchObject({
      tag: "v0.1.0-alpha.2",
      created: true,
      targetCommitish: evidence.targetSha,
      isPrerelease: true,
    });
    expect(evidence.githubRelease.url).toBe("https://github.com/iiwish/agent-cli-runtime/releases/tag/v0.1.0-alpha.2");
    expect(evidence.publishMode).toBe("authorized-real-publish");
    expect(evidence.docsUpdatedToPublishedState).toBe(true);
    expect(evidence.boundary.noNpmTokenCommitted).toBe(true);
    expect(evidence.boundary.noGithubTokenCommitted).toBe(true);
    expect(evidence.boundary.noRawLogs).toBe(true);
    expect(evidence.boundary.noRawStdoutStderr).toBe(true);
    expect(evidence.boundary.noRawCliOutput).toBe(true);
    expect(evidence.boundary.noFullPrompt).toBe(true);
    expect(evidence.boundary.noPrivatePath).toBe(true);
    expect(evidence.boundary.noLocalTempPath).toBe(true);
    expect(evidence.boundary.noTokenValue).toBe(true);
    expect(evidence.boundary.noBearerValue).toBe(true);
    expect(evidence.boundary.noAuthEnvAssignment).toBe(true);
    expect(evidence.boundary.noTarballSize).toBe(true);
    expect(evidence.boundary.noTarballShasum).toBe(true);
    expect(evidence.boundary.noTarballIntegrity).toBe(true);
    expect(evidence.boundary.noPackShasum).toBe(true);
    expect(evidenceText).not.toMatch(/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=/u);
    expect(evidenceText).not.toMatch(/\b(?:sizeBytes|sizeInBytes|shasum|integrity)\b/u);
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
    expect(runbook).toContain("npm dist-tag add agent-cli-runtime@0.1.0-alpha.3 alpha");
    expect(runbook).toContain("npm unpublish agent-cli-runtime@0.1.0-alpha.3");
    expect(runbook).toContain("2FA");
    expect(runbook).toContain("trusted publishing");
    expect(runbook).toContain("provenance");
    expect(runbook).toContain("not configured");
    expect(runbook).toContain("npm registry metadata and GitHub Releases are the source of truth");
    expect(runbook).toContain("Corrective package line: `agent-cli-runtime@0.1.0-alpha.3`");
    expect(releaseCandidate).not.toMatch(/\bnpm publish\b/u);
    expect(releaseCandidate).not.toContain("NODE_AUTH_TOKEN");
    expect(ci).not.toMatch(/\bnpm publish\b/u);
    expect(ci).not.toContain("NODE_AUTH_TOKEN");
  });

  it("keeps packaged public docs free of stale current publish-state claims", async () => {
    const docs = [
      "README.md",
      "README.zh-CN.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/ssot.md",
    ];
    const staleClaims = [
      /The package is not published to npm/iu,
      /0\.1\.0-alpha\.1[^\n]*(?:not published|unpublished|has not occurred)/iu,
      /alpha\.1[^\n]*(?:未发布|尚未发布|尚未发生)/iu,
      /npm publish has not occurred/iu,
      /npm publish 尚未发生/u,
      /P3-11 does not publish npm/iu,
      /Do not run a real `npm publish` during P3-11/iu,
      /Do not publish a GitHub release/iu,
      /不发布 GitHub release/u,
    ];

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      for (const staleClaim of staleClaims) {
        expect(text, `${doc} contains stale publish-state claim ${staleClaim}`).not.toMatch(staleClaim);
      }
    }
  });

  it("documents alpha.3 registry source-of-truth and stale alpha.2 release reality", async () => {
    const docs = [
      "README.md",
      "README.zh-CN.md",
      "docs/production-readiness.md",
      "docs/release-checklist.md",
      "docs/release-report.md",
      "docs/release-publish-runbook.md",
      "docs/ssot.md",
    ];

    for (const doc of docs) {
      const text = await readFile(path.join(root, doc), "utf8");
      expect(text).toContain("0.1.0-alpha.1");
      expect(text).toContain("0.1.0-alpha.3");
      expect(text).toMatch(/0\.1\.0-alpha\.2[^\n]*(?:stale|pre-publish|过期|发布前)/iu);
      expect(text).toMatch(/(?:npm registry|GitHub)[^\n]*(?:source of truth|authoritative|为准|权威)/iu);
      expect(text).toMatch(/0\.1\.0-alpha\.0[^\n]*(?:deprecated|deprecate|deprecate|已 deprecate|已弃用)/iu);
      expect(text).toMatch(/v0\.1\.0-alpha\.1/u);
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
