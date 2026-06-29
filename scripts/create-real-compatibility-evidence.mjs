#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const LEGACY_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityEvidence.v1";
const SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityMatrix.v1";
const DEFAULT_OUTPUT = ".release-evidence/p8-2-real-cli-compatibility-matrix.json";
const ADAPTERS = ["codex", "claude", "opencode"];
const CLASSIFICATIONS_THAT_ARE_NOT_SUCCESS = new Set([
  "real_run_skipped",
  "auth_missing",
  "unavailable_executable",
  "unsupported_flag",
  "needs_verification",
  "unexpected_output",
  "cwd_mutated",
  "timeout",
  "failed",
]);

const root = process.cwd();
const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  printUsage();
  process.exit(0);
}

if (parsed.selfTest) {
  const sample = {
    schemaVersion: SCHEMA_VERSION,
    checkedAt: "2026-06-27T00:00:00.000Z",
    packageVersion: "0.1.0-alpha.3",
    gitSha: "0123456789abcdef0123456789abcdef01234567",
    gitDirty: false,
    gitInputDirty: false,
    gitOutputDirty: true,
    dirtySummary: {
      outputPath: DEFAULT_OUTPUT,
      beforeWrite: { dirty: false, changedFilesCount: 0, changedFiles: [], truncated: false },
      afterWrite: { dirty: true, changedFilesCount: 1, changedFiles: [{ status: "M", path: DEFAULT_OUTPUT }], truncated: false },
      inputBeforeWrite: { dirty: false, changedFilesCount: 0, changedFiles: [], truncated: false },
      inputAfterWrite: { dirty: false, changedFilesCount: 0, changedFiles: [], truncated: false },
      outputBeforeWrite: { dirty: false, changedFilesCount: 0, changedFiles: [], truncated: false },
      outputAfterWrite: { dirty: true, changedFilesCount: 1, changedFiles: [{ status: "M", path: DEFAULT_OUTPUT }], truncated: false },
    },
    adapters: {
      codex: {
        executable: { status: "resolved", path: "<resolved_executable>", unavailableReason: null },
        version: "codex-cli test",
        auth: { status: "unknown" },
        modelsSource: { source: "live", modelCount: 1 },
        capabilities: { streaming: true, tools: true, models: true, authProbe: false, prompt: ["stdin"] },
        argvProfile: { defaultArgs: ["exec", "--json", "-C", "<cwd>"], knownFlags: [], needsVerification: [{ mapsTo: "session" }, { mapsTo: "authProbe" }] },
        parserMode: "codex-json",
        promptTransport: "stdin:text",
        safePreflight: { command: "node ./dist/cli/main.js conformance --mode real --agent all --json", runClassification: "real_run_skipped", skippedReason: "real_run_not_allowed", ok: false },
        optionalSmoke: { status: "real_run_skipped", reason: "not_requested" },
        diagnostics: [],
        needsVerification: [{ mapsTo: "session" }, { mapsTo: "authProbe" }],
      },
    },
    noRawStdoutStderr: true,
    noPromptText: true,
    noTokenOrAuthEnv: true,
  };
  assertRedacted(JSON.stringify(sample));
  process.stdout.write(`${JSON.stringify({ ok: true, schemaVersion: SCHEMA_VERSION })}\n`);
  process.exit(0);
}

if (parsed.allowRealRun) {
  if (parsed.realRuns.length === 0) {
    fail("--allow-real-run requires at least one --agent <id> --expect-text <text> pair");
  }
  for (const run of parsed.realRuns) {
    if (!ADAPTERS.includes(run.agent)) fail(`--agent must be one of: ${ADAPTERS.join(", ")}`);
    if (!run.expectText) fail(`--expect-text is required for authenticated real run agent ${run.agent}`);
  }
} else if (parsed.realRuns.length > 0) {
  fail("--agent/--expect-text authenticated run pairs require --allow-real-run");
}

const outputFile = path.resolve(root, parsed.output ?? DEFAULT_OUTPUT);
const outputPath = displayEvidenceFile(outputFile);
const checkedAt = new Date().toISOString();
const gitBeforeWrite = gitWorktreeState();
const inputBeforeWrite = dirtyStateExcludingPath(gitBeforeWrite, outputPath);
const outputBeforeWrite = dirtyStateOnlyPath(gitBeforeWrite, outputPath);
const nodeVersion = process.version;

const commands = [];
const agents = runCliJson(["agents", "--json"]);
commands.push(commandSummary("node ./dist/cli/main.js agents --json", agents));
const doctor = runCliJson(["doctor", "--json"]);
commands.push(commandSummary("node ./dist/cli/main.js doctor --json", doctor));
const conformance = runCliJson(["conformance", "--mode", "real", "--agent", "all", "--json"]);
commands.push(commandSummary("node ./dist/cli/main.js conformance --mode real --agent all --json", conformance));

const safeSmokes = {};
for (const agent of ADAPTERS) {
  const smoke = runCliJson(["smoke", "--mode", "real", "--agent", agent, "--json"]);
  commands.push(commandSummary(`node ./dist/cli/main.js smoke --mode real --agent ${agent} --json`, smoke));
  safeSmokes[agent] = summarizeSmoke(smoke);
}

const authenticatedRealSmokes = [];
for (const run of parsed.allowRealRun ? parsed.realRuns : []) {
  const args = [
    "smoke",
    "--mode",
    "real",
    "--agent",
    run.agent,
    "--allow-real-run",
    "--expect-text",
    run.expectText,
    "--timeout-ms",
    String(parsed.timeoutMs),
    "--json",
  ];
  const smoke = runCliJson(args);
  commands.push(commandSummary(
    `node ./dist/cli/main.js smoke --mode real --agent ${run.agent} --allow-real-run --expect-text <expected_text> --timeout-ms ${parsed.timeoutMs} --json`,
    smoke,
  ));
  authenticatedRealSmokes.push({
    agent: run.agent,
    command: `node ./dist/cli/main.js smoke --mode real --agent ${run.agent} --allow-real-run --expect-text <expected_text> --timeout-ms ${parsed.timeoutMs} --json`,
    expectedTextSha256: sha256(run.expectText),
    ...summarizeSmoke(smoke),
  });
}

const evidence = {
  schemaVersion: SCHEMA_VERSION,
  checkedAt,
  gitSha: gitBeforeWrite.headSha,
  gitHeadSha: gitBeforeWrite.headSha,
  gitShaMeaning: "HEAD commit only; see gitInputDirty/gitOutputDirty and dirtySummary for uncommitted input evidence versus evidence-output self writes.",
  gitDirty: inputBeforeWrite.dirty,
  gitInputDirty: inputBeforeWrite.dirty,
  gitOutputDirty: outputBeforeWrite.dirty,
  gitStatusBeforeWrite: gitBeforeWrite,
  dirtySummary: {
    outputPath,
    beforeWrite: dirtySummary(gitBeforeWrite),
    inputBeforeWrite: dirtySummary(inputBeforeWrite),
    outputBeforeWrite: dirtySummary(outputBeforeWrite),
    afterWrite: null,
    inputAfterWrite: null,
    outputAfterWrite: null,
  },
  nodeVersion,
  packageVersion: packageVersion(),
  safePreflightOnly: !parsed.allowRealRun,
  noAuthenticatedRealRunByDefault: true,
  noRawStdoutStderr: true,
  noPromptText: true,
  noTokenOrAuthEnv: true,
  commands,
  adapters: buildCompatibilityMatrix({
    agents: summarizeAgents(agents),
    doctorAgents: summarizeAgents(doctor.agents ?? []),
    conformance: summarizeConformance(conformance),
    safeSmokes,
    authenticatedRealSmokes,
  }),
  agents: summarizeAgents(agents),
  doctor: {
    ok: doctor.ok === true,
    agents: summarizeAgents(doctor.agents ?? []),
  },
  realConformance: summarizeConformance(conformance),
  safeRealSmokes: safeSmokes,
  authenticatedRealSmokes,
  needsVerificationAudit: needsVerificationAudit(conformance),
  driftAnalysis: driftAnalysis(conformance, safeSmokes, authenticatedRealSmokes),
  packageBoundary: {
    releaseEvidenceIsRepoOnly: true,
    expectedExcludedPath: ".release-evidence/",
  },
};

mkdirSync(path.dirname(outputFile), { recursive: true });
writeEvidence(outputFile, evidence);
evidence.gitStatusAfterWrite = gitWorktreeState();
const inputAfterWrite = dirtyStateExcludingPath(evidence.gitStatusAfterWrite, outputPath);
const outputAfterWrite = dirtyStateOnlyPath(evidence.gitStatusAfterWrite, outputPath);
evidence.gitDirty = inputAfterWrite.dirty;
evidence.gitInputDirty = inputAfterWrite.dirty;
evidence.gitOutputDirty = outputAfterWrite.dirty;
evidence.dirtySummary.afterWrite = dirtySummary(evidence.gitStatusAfterWrite);
evidence.dirtySummary.inputAfterWrite = dirtySummary(inputAfterWrite);
evidence.dirtySummary.outputAfterWrite = dirtySummary(outputAfterWrite);
writeEvidence(outputFile, evidence);
process.stdout.write(`${JSON.stringify({ ok: true, schemaVersion: SCHEMA_VERSION, output: outputPath })}\n`);

function parseArgs(argv) {
  const out = {
    output: undefined,
    allowRealRun: false,
    timeoutMs: 120_000,
    realRuns: [],
    help: false,
    selfTest: false,
  };
  let pendingAgent = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--self-test") {
      out.selfTest = true;
      continue;
    }
    if (arg === "--allow-real-run") {
      out.allowRealRun = true;
      continue;
    }
    if (arg === "--out" || arg === "--output") {
      out.output = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--timeout-ms") {
      out.timeoutMs = Number(requireValue(argv, ++index, arg));
      if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) fail("--timeout-ms must be a positive number");
      continue;
    }
    if (arg === "--agent") {
      pendingAgent = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--expect-text") {
      const expectText = requireValue(argv, ++index, arg);
      if (!pendingAgent) fail("--expect-text must follow an --agent <id> for authenticated evidence");
      out.realRuns.push({ agent: pendingAgent, expectText });
      pendingAgent = null;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  if (pendingAgent) fail(`--agent ${pendingAgent} requires a following --expect-text <text>`);
  return out;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

function printUsage() {
  process.stdout.write(`Usage:
  npm run compat:real:evidence
  npm run compat:real:evidence -- --allow-real-run --agent codex --expect-text "agent-runtime codex smoke ok"
  npm run compat:real:evidence -- --allow-real-run --agent codex --expect-text "agent-runtime codex smoke ok" --agent opencode --expect-text "agent-runtime opencode smoke ok"

Default mode writes ${DEFAULT_OUTPUT}, runs only safe real preflight commands, and does not launch authenticated real agent runs.
`);
}

function runCliJson(args) {
  const result = spawnSync(process.execPath, ["./dist/cli/main.js", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`command failed: node ./dist/cli/main.js ${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`command did not emit JSON: node ./dist/cli/main.js ${args.join(" ")}`);
  }
}

function optionalRun(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function gitWorktreeState() {
  const headSha = optionalRun("git", ["rev-parse", "HEAD"]).stdout?.trim() || null;
  const status = optionalRun("git", ["status", "--short", "--untracked-files=all"]);
  const entries = status.status === 0 ? parseGitStatus(status.stdout) : [];
  return {
    headSha,
    dirty: entries.length > 0,
    changedFilesCount: entries.length,
    changedFiles: entries.slice(0, 100),
    truncated: entries.length > 100,
  };
}

function dirtySummary(state) {
  return {
    dirty: state.dirty,
    changedFilesCount: state.changedFilesCount,
    changedFiles: state.changedFiles,
    truncated: state.truncated,
  };
}

function dirtyStateExcludingPath(state, excludedPath) {
  const changedFiles = state.changedFiles.filter((entry) => !matchesGitPath(entry.path, excludedPath));
  return {
    ...state,
    dirty: changedFiles.length > 0,
    changedFilesCount: changedFiles.length,
    changedFiles,
    truncated: state.truncated && changedFiles.length >= state.changedFiles.length,
  };
}

function dirtyStateOnlyPath(state, includedPath) {
  const changedFiles = state.changedFiles.filter((entry) => matchesGitPath(entry.path, includedPath));
  return {
    ...state,
    dirty: changedFiles.length > 0,
    changedFilesCount: changedFiles.length,
    changedFiles,
    truncated: false,
  };
}

function matchesGitPath(candidate, expectedPath) {
  if (!candidate || !expectedPath || expectedPath === "<external_evidence_file>") return false;
  if (candidate === expectedPath) return true;
  return candidate.split(" -> ").some((part) => part === expectedPath);
}

function parseGitStatus(stdout) {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || line.slice(0, 2),
      path: line.slice(3),
    }));
}

function writeEvidence(file, evidence) {
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  assertRedacted(text);
  writeFileSync(file, text, "utf8");
}

function commandSummary(command, output) {
  return {
    command,
    exitCode: 0,
    schemaVersion: output.schemaVersion ?? null,
    ok: typeof output.ok === "boolean" ? output.ok : null,
    summary: summarizeCommandOutput(output),
  };
}

function summarizeCommandOutput(output) {
  if (Array.isArray(output)) {
    return { agents: summarizeAgents(output) };
  }
  if (output?.schemaVersion === "agent-runtime.conformance.v1") {
    return summarizeConformance(output);
  }
  if (output?.schemaVersion === "agent-runtime.realSmoke.v1") {
    return summarizeSmoke(output);
  }
  if (Array.isArray(output?.agents)) {
    return { agents: summarizeAgents(output.agents) };
  }
  return { ok: output?.ok ?? null };
}

function summarizeAgents(agents) {
  return agents.map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    available: agent.available === true,
    version: agent.version ?? null,
    authStatus: agent.authStatus ?? "unknown",
    modelsSource: agent.modelsSource ?? "none",
    modelCount: Array.isArray(agent.models) ? agent.models.length : 0,
    capabilities: agent.capabilities ?? null,
    diagnostics: summarizeDiagnostics(agent.diagnostics ?? []),
  }));
}

function summarizeConformance(report) {
  return {
    schemaVersion: report.schemaVersion,
    ok: report.ok === true,
    mode: report.mode,
    agents: (report.agents ?? []).map((agent) => ({
      adapter: agent.adapter,
      version: agent.version ?? null,
      auth: agent.auth ?? "unknown",
      modelsSource: agent.modelsSource ?? "none",
      runClassification: agent.runClassification,
      expectedTextMatched: agent.expectedTextMatched ?? null,
      cwdMutationChecked: agent.cwdMutationChecked === true,
      cwdMutated: agent.cwdMutated ?? null,
      skippedReason: agent.skippedReason ?? null,
      failureReason: agent.failureReason ?? null,
      diagnosticsCount: agent.diagnosticsCount ?? 0,
      diagnostics: summarizeDiagnostics(agent.diagnostics ?? []),
      argvProfile: agent.argvProfile ? {
        defaultArgs: agent.argvProfile.defaultArgs ?? [],
        knownFlags: (agent.argvProfile.knownFlags ?? []).map((flag) => ({
          flag: flag.flag,
          mapsTo: flag.mapsTo,
          status: flag.status,
        })),
        needsVerification: agent.argvProfile.needsVerification ?? [],
      } : null,
      promptTransport: agent.promptTransport ?? null,
      parserMode: agent.parserMode ?? null,
    })),
  };
}

function summarizeSmoke(smoke) {
  return {
    schemaVersion: smoke.schemaVersion,
    ok: smoke.ok === true,
    adapter: smoke.adapter,
    version: smoke.version ?? null,
    auth: smoke.auth ?? "unknown",
    modelsSource: smoke.modelsSource ?? "none",
    runClassification: smoke.runClassification,
    expectedTextRequired: smoke.expectedTextRequired === true,
    expectedTextMatched: smoke.expectedTextMatched ?? null,
    observedTextDeltaCount: smoke.observedTextDeltaCount ?? 0,
    observedTextTailSha256: smoke.observedTextTail ? sha256(smoke.observedTextTail) : null,
    cwdMutationChecked: smoke.cwdMutationChecked === true,
    cwdMutated: smoke.cwdMutated ?? null,
    cwdMutationCount: smoke.cwdMutationCount ?? null,
    diagnosticsCount: smoke.diagnosticsCount ?? 0,
    diagnostics: summarizeDiagnostics(smoke.diagnostics ?? []),
    skippedReason: smoke.skippedReason ?? null,
    failureReason: smoke.failureReason ?? null,
  };
}

function summarizeDiagnostics(diagnostics) {
  return diagnostics.slice(0, 20).map((item) => ({
    code: item.code,
    message: truncate(item.message, 240),
    probe: item.probe,
    actionableHints: Array.isArray(item.actionableHints) ? item.actionableHints.slice(0, 4).map((hint) => truncate(hint, 200)) : undefined,
  }));
}

function buildCompatibilityMatrix(input) {
  return Object.fromEntries(ADAPTERS.map((adapter) => {
    const detected = input.agents.find((agent) => agent.id === adapter);
    const doctor = input.doctorAgents.find((agent) => agent.id === adapter);
    const conformance = input.conformance.agents.find((agent) => agent.adapter === adapter);
    const safeSmoke = input.safeSmokes[adapter] ?? null;
    const optionalSmoke = input.authenticatedRealSmokes.find((smoke) => smoke.agent === adapter) ?? null;
    const diagnostics = [
      ...(detected?.diagnostics ?? []),
      ...(doctor?.diagnostics ?? []),
      ...(conformance?.diagnostics ?? []),
      ...(safeSmoke?.diagnostics ?? []),
      ...(optionalSmoke?.diagnostics ?? []),
    ];
    const available = detected?.available === true || conformance?.version !== null;
    const unavailableReason = available ? null : firstDiagnosticCode(diagnostics) ?? "unavailable_executable";
    return [adapter, {
      executable: {
        status: available ? "resolved" : "unavailable",
        path: available ? "<resolved_executable>" : null,
        unavailableReason,
      },
      version: conformance?.version ?? detected?.version ?? null,
      auth: {
        status: conformance?.auth ?? detected?.authStatus ?? "unknown",
        diagnosticCodes: uniqueCodes(diagnostics.filter((item) => item.probe === "auth" || item.code === "auth_missing")),
      },
      modelsSource: {
        source: conformance?.modelsSource ?? detected?.modelsSource ?? "none",
        modelCount: detected?.modelCount ?? 0,
      },
      capabilities: conformance?.capabilities ?? detected?.capabilities ?? null,
      argvProfile: conformance?.argvProfile ?? null,
      parserMode: conformance?.parserMode ?? null,
      promptTransport: conformance?.promptTransport ?? null,
      safePreflight: {
        command: "node ./dist/cli/main.js conformance --mode real --agent all --json",
        ok: conformance?.runClassification === "success",
        runClassification: conformance?.runClassification ?? "unavailable_executable",
        expectedTextMatched: conformance?.expectedTextMatched ?? null,
        cwdMutationChecked: conformance?.cwdMutationChecked === true,
        cwdMutated: conformance?.cwdMutated ?? null,
        skippedReason: conformance?.skippedReason ?? null,
        failureReason: conformance?.failureReason ?? null,
      },
      optionalSmoke: optionalSmoke ? {
        status: optionalSmoke.runClassification,
        command: optionalSmoke.command,
        ok: optionalSmoke.ok === true && optionalSmoke.runClassification === "success",
        expectedTextRequired: optionalSmoke.expectedTextRequired === true,
        expectedTextMatched: optionalSmoke.expectedTextMatched ?? null,
        expectedTextSha256: optionalSmoke.expectedTextSha256 ?? null,
        observedTextTailSha256: optionalSmoke.observedTextTailSha256 ?? null,
        cwdMutationChecked: optionalSmoke.cwdMutationChecked === true,
        cwdMutated: optionalSmoke.cwdMutated ?? null,
        cwdMutationCount: optionalSmoke.cwdMutationCount ?? null,
        skippedReason: optionalSmoke.skippedReason ?? null,
        failureReason: optionalSmoke.failureReason ?? null,
      } : {
        status: "real_run_skipped",
        reason: "not_requested",
        ok: false,
      },
      diagnostics: summarizeDiagnostics(diagnostics),
      needsVerification: conformance?.argvProfile?.needsVerification ?? [],
    }];
  }));
}

function firstDiagnosticCode(diagnostics) {
  return diagnostics.find((item) => typeof item?.code === "string")?.code ?? null;
}

function uniqueCodes(diagnostics) {
  return [...new Set(diagnostics.map((item) => item.code).filter(Boolean))];
}

function needsVerificationAudit(conformance) {
  return (conformance.agents ?? []).map((agent) => ({
    adapter: agent.adapter,
    items: agent.argvProfile?.needsVerification ?? [],
    knownFlagsMarkedNeedsVerification: (agent.argvProfile?.knownFlags ?? [])
      .filter((flag) => flag.status === "needs_verification")
      .map((flag) => ({ flag: flag.flag, mapsTo: flag.mapsTo })),
  }));
}

function driftAnalysis(conformance, safeSmokes, authenticatedSmokes) {
  const agents = conformance.agents ?? [];
  return agents.map((agent) => {
    const authenticated = authenticatedSmokes.find((item) => item.agent === agent.adapter);
    const classifications = [
      agent.runClassification,
      safeSmokes[agent.adapter]?.runClassification,
      authenticated?.runClassification,
    ].filter(Boolean);
    return {
      adapter: agent.adapter,
      version: agent.version ?? null,
      auth: agent.auth ?? "unknown",
      modelsSource: agent.modelsSource ?? "none",
      classifications,
      hasUnsupportedFlag: classifications.includes("unsupported_flag"),
      hasNeedsVerificationDiagnostic: classifications.includes("needs_verification"),
      authenticatedRunEvidence: authenticated ? authenticated.runClassification : null,
      conclusion: driftConclusion(agent, authenticated),
    };
  });
}

function driftConclusion(agent, authenticated) {
  if (authenticated?.runClassification === "success") {
    return "authenticated real smoke passed for prompt/stdin/parser/cwd-mutation path; unchanged needsVerification items remain unpromoted";
  }
  if (agent.runClassification === "auth_missing") {
    return "auth missing; no authenticated real run attempted";
  }
  if (CLASSIFICATIONS_THAT_ARE_NOT_SUCCESS.has(agent.runClassification)) {
    return `${agent.runClassification} is recorded as evidence, not success`;
  }
  return "no drift detected in safe preflight";
}

function packageVersion() {
  const result = optionalRun(process.execPath, ["-e", "console.log(JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version)"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(value, max) {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function assertRedacted(text) {
  const forbidden = [
    { name: "temporary path", pattern: /(?:\/tmp\/|\/private\/tmp\/|\/var\/folders\/)/u },
    { name: "private user path", pattern: /(?:\/Users\/|\/home\/[^<\s/]+|[A-Z]:\\Users\\)/u },
    { name: "OpenAI-style secret", pattern: /sk-[A-Za-z0-9_-]{20,}/u },
    { name: "Bearer value", pattern: /\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/u },
    {
      name: "auth environment assignment value",
      pattern:
        /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/iu,
    },
  ];
  for (const { name, pattern } of forbidden) {
    if (pattern.test(text)) fail(`refusing to write unredacted evidence: ${name}`);
  }
}

function displayEvidenceFile(file) {
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "<external_evidence_file>";
  return relative.split(path.sep).join("/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
