#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityEvidence.v1";
const DEFAULT_OUTPUT = ".release-evidence/p6-1-real-cli-compatibility.json";
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
    safePreflightOnly: true,
    commands: [{ command: "node ./dist/cli/main.js smoke --mode real --agent codex --json", exitCode: 0 }],
    authenticatedRealSmokes: [],
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
const generatedAt = new Date().toISOString();
const gitBeforeWrite = gitWorktreeState();
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
  generatedAt,
  gitSha: gitBeforeWrite.headSha,
  gitHeadSha: gitBeforeWrite.headSha,
  gitShaMeaning: "HEAD commit only; see gitDirty and gitStatusBeforeWrite/gitStatusAfterWrite for uncommitted evidence inputs.",
  gitDirty: gitBeforeWrite.dirty,
  gitStatusBeforeWrite: gitBeforeWrite,
  nodeVersion,
  packageVersion: packageVersion(),
  safePreflightOnly: !parsed.allowRealRun,
  noAuthenticatedRealRunByDefault: true,
  noRawStdoutStderr: true,
  noPromptText: true,
  noTokenOrAuthEnv: true,
  commands,
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
evidence.gitDirty = evidence.gitStatusAfterWrite.dirty;
writeEvidence(outputFile, evidence);
process.stdout.write(`${JSON.stringify({ ok: true, schemaVersion: SCHEMA_VERSION, output: path.relative(root, outputFile) })}\n`);

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

Default mode runs only safe real preflight commands and does not launch authenticated real agent runs.
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
  return diagnostics.map((item) => ({
    code: item.code,
    message: item.message,
    probe: item.probe,
    actionableHints: item.actionableHints,
  }));
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

function assertRedacted(text) {
  const forbidden = [
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
