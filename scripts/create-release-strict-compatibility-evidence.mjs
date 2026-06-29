#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SUMMARY_SCHEMA_VERSION = "agent-cli-runtime.p8ReleaseStrictCompatibilityEvidence.v1";
const MATRIX_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityMatrix.v1";
const VERIFIER_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityEvidenceVerification.v1";
const RELEASE_VERIFICATION_SCHEMA_VERSION = "agent-cli-runtime.releaseVerification.v1";
const RELEASE_GATE_EVIDENCE_SCHEMA_VERSION = "agent-cli-runtime.releaseGateEvidence.v1";
const MATRIX_FILE = ".release-evidence/p8-2-real-cli-compatibility-matrix.json";
const DEFAULT_OUTPUT = ".release-evidence/p8-4-release-strict-compatibility.json";
const RELEASE_VERIFY_DOWNLOADED_COMMAND = "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>";
const RELEASE_VERIFY_LOCAL_COMMAND = "npm run release:verify -- --dir <tmp-local-strict>";
const RELEASE_CANDIDATE_LOCAL_COMMAND = "npm run release:candidate -- --out-dir <tmp-local-strict>";
const COMPAT_VERIFY_COMMAND = "npm run compat:real:evidence:verify -- --target-sha <target-sha> --max-age-hours 24 --release-strict";

function parseArgs(argv) {
  const options = {
    targetSha: null,
    localReleaseDir: null,
    output: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target-sha") {
      options.targetSha = requireValue(argv, ++index, arg).toLowerCase();
    } else if (arg === "--local-release-dir") {
      options.localReleaseDir = requireValue(argv, ++index, arg);
    } else if (arg === "--out" || arg === "--output") {
      options.output = requireValue(argv, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/create-release-strict-compatibility-evidence.mjs --target-sha <sha> --local-release-dir <dir> [--out <file>]

Writes a repo-only P8-4 release-strict compatibility evidence summary. It reads the checked-in P8-2 matrix, reruns the offline strict compatibility verifier, reruns release artifact verification for an existing local strict release-candidate directory, and records whether the target SHA is main-scoped or branch-only evidence.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }

  if (!options.targetSha) throw new Error("--target-sha is required");
  if (!/^[0-9a-f]{40}$/u.test(options.targetSha)) throw new Error("--target-sha must be a full lowercase 40-character commit SHA");
  if (!options.localReleaseDir) throw new Error("--local-release-dir is required");

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/sk-[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(
      new RegExp(
        `\\b(?:${[
          "ANTHROPIC_AUTH_TOKEN",
          "ANTHROPIC_API_KEY",
          "OPENAI_API_KEY",
          "OPENAI_AUTH_TOKEN",
          "CLAUDE_AUTH_TOKEN",
          "CODEX_AUTH_TOKEN",
          "OPENCODE_AUTH_TOKEN",
          "NODE_" + "AUTH_TOKEN",
          "NPM_" + "TOKEN",
        ].join("|")})\\s*=\\s*(?!<|\\$|\\$\\{|\\[REDACTED\\]|redacted\\b)[^\\s#'"]{4,}`,
        "giu",
      ),
      "[REDACTED_ENV]=[REDACTED]",
    )
    .replace(/\/(?:private\/)?tmp\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/var\/folders\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/Users\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "Users/[REDACTED]")
    .replace(/\/home\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "home/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/gu, "C:" + "\\Users\\[REDACTED]");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runText(command, args) {
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.map(redact).join(" ")}`);
  }
  return result.stdout.trim();
}

function runJson(command, args) {
  const result = run(command, args);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`command did not produce JSON: ${command} ${args.map(redact).join(" ")}`);
  }
  if (result.status !== 0 || parsed?.ok !== true) {
    throw new Error(`command failed JSON gate: ${command} ${args.map(redact).join(" ")}`);
  }
  return parsed;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function gitIsAncestor(ancestorSha, ref) {
  return run("git", ["merge-base", "--is-ancestor", ancestorSha, ref]).status === 0;
}

function summarizeMatrix(matrix) {
  return {
    path: MATRIX_FILE,
    schemaVersion: matrix.schemaVersion ?? null,
    checkedAt: matrix.checkedAt ?? null,
    packageVersion: matrix.packageVersion ?? null,
    gitSha: matrix.gitSha ?? null,
    gitInputDirty: typeof matrix.gitInputDirty === "boolean" ? matrix.gitInputDirty : null,
    gitOutputDirty: typeof matrix.gitOutputDirty === "boolean" ? matrix.gitOutputDirty : null,
    dirtySummary: {
      inputAfterWrite: summarizeDirtyState(matrix.dirtySummary?.inputAfterWrite),
      outputAfterWrite: summarizeDirtyState(matrix.dirtySummary?.outputAfterWrite),
    },
    adapters: Object.fromEntries(
      Object.entries(matrix.adapters ?? {}).map(([id, adapter]) => [id, {
        version: typeof adapter?.version === "string" ? adapter.version : null,
        auth: typeof adapter?.auth?.status === "string" ? adapter.auth.status : null,
        safePreflight: typeof adapter?.safePreflight?.runClassification === "string" ? adapter.safePreflight.runClassification : null,
        optionalSmoke: typeof adapter?.optionalSmoke?.status === "string" ? adapter.optionalSmoke.status : null,
        needsVerification: Array.isArray(adapter?.needsVerification)
          ? adapter.needsVerification.map((item) => item?.mapsTo).filter((item) => typeof item === "string")
          : [],
      }]),
    ),
  };
}

function summarizeDirtyState(state) {
  return {
    dirty: typeof state?.dirty === "boolean" ? state.dirty : null,
    changedFilesCount: typeof state?.changedFilesCount === "number" ? state.changedFilesCount : null,
  };
}

function summarizeCompatibilityVerification(verification) {
  return {
    command: COMPAT_VERIFY_COMMAND,
    schemaVersion: verification.schemaVersion ?? null,
    ok: verification.ok === true,
    evidenceSchemaVersion: verification.evidenceSchemaVersion ?? null,
    targetSha: summarizeStatusObject(verification.targetSha),
    freshness: summarizeFreshness(verification.freshness),
    dirtyPolicy: summarizeDirtyPolicy(verification.dirtyPolicy),
    diagnosticSummary: {
      count: typeof verification.diagnosticSummary?.count === "number" ? verification.diagnosticSummary.count : null,
      codes: Array.isArray(verification.diagnosticSummary?.codes)
        ? verification.diagnosticSummary.codes.filter((code) => typeof code === "string")
        : [],
    },
  };
}

function summarizeStatusObject(value) {
  return {
    expected: typeof value?.expected === "string" ? value.expected : null,
    actual: typeof value?.actual === "string" ? value.actual : null,
    ok: typeof value?.ok === "boolean" ? value.ok : null,
    status: typeof value?.status === "string" ? value.status : null,
  };
}

function summarizeFreshness(value) {
  return {
    maxAgeHours: typeof value?.maxAgeHours === "number" ? value.maxAgeHours : null,
    ageHours: typeof value?.ageHours === "number" ? value.ageHours : null,
    ok: typeof value?.ok === "boolean" ? value.ok : null,
    status: typeof value?.status === "string" ? value.status : null,
  };
}

function summarizeDirtyPolicy(value) {
  return {
    policy: typeof value?.policy === "string" ? value.policy : null,
    allowDirty: typeof value?.allowDirty === "boolean" ? value.allowDirty : null,
    gitDirty: typeof value?.gitDirty === "boolean" ? value.gitDirty : null,
    inputDirty: typeof value?.inputDirty === "boolean" ? value.inputDirty : null,
    outputDirty: typeof value?.outputDirty === "boolean" ? value.outputDirty : null,
    ok: typeof value?.ok === "boolean" ? value.ok : null,
    status: typeof value?.status === "string" ? value.status : null,
  };
}

function summarizeReleaseVerification(verification) {
  return {
    command: RELEASE_VERIFY_LOCAL_COMMAND,
    schemaVersion: verification.schemaVersion ?? null,
    ok: verification.ok === true,
    diagnosticsCount: Array.isArray(verification.diagnostics) ? verification.diagnostics.length : null,
    artifactNames: Array.isArray(verification.artifactNames) ? verification.artifactNames.filter((name) => typeof name === "string").sort() : [],
    packageName: typeof verification.packageName === "string" ? verification.packageName : null,
    version: typeof verification.version === "string" ? verification.version : null,
    packageFiles: typeof verification.checkedFiles?.packageFiles === "number" ? verification.checkedFiles.packageFiles : null,
    tarball: {
      filename: typeof verification.tarball?.filename === "string" ? verification.tarball.filename : null,
      exists: verification.tarball?.exists === true,
    },
    gateEvidence: summarizeReleaseGateEvidence(verification.gateEvidence),
  };
}

function summarizeReleaseGateEvidence(gateEvidence) {
  return {
    schemaVersion: gateEvidence?.schemaVersion ?? null,
    gates: Array.isArray(gateEvidence?.gates)
      ? gateEvidence.gates.map((gate) => ({
        script: typeof gate?.script === "string" ? gate.script : null,
        command: typeof gate?.command === "string" ? gate.command : null,
        ok: gate?.ok === true,
        outputSchemaVersion: typeof gate?.outputSchemaVersion === "string" ? gate.outputSchemaVersion : null,
        evidenceSchemaVersion: typeof gate?.evidenceSchemaVersion === "string" ? gate.evidenceSchemaVersion : null,
        targetSha: summarizeStatusObject(gate?.targetSha),
        freshness: summarizeFreshness(gate?.freshness),
        dirtyPolicy: summarizeDirtyPolicy(gate?.dirtyPolicy),
        diagnostics: {
          count: typeof gate?.diagnostics?.count === "number" ? gate.diagnostics.count : null,
          codes: Array.isArray(gate?.diagnostics?.codes) ? gate.diagnostics.codes.filter((code) => typeof code === "string") : [],
        },
        repoOnlyEvidence: gate?.repoOnlyEvidence
          ? {
            status: typeof gate.repoOnlyEvidence.status === "string" ? gate.repoOnlyEvidence.status : null,
            reason: typeof gate.repoOnlyEvidence.reason === "string" ? gate.repoOnlyEvidence.reason : null,
          }
          : null,
      }))
      : [],
    noAuthenticatedRealRun: gateEvidence?.noAuthenticatedRealRun === true,
    noNpmPublish: gateEvidence?.noNpmPublish === true,
    noNpmToken: gateEvidence?.noNpmToken === true,
  };
}

function assertSafeEvidence(text) {
  const forbidden = [
    { name: "raw output key", pattern: /"(?:stdout|stderr|rawStdout|rawStderr|rawOutput|fullPrompt|promptText|resolvedExecutablePath)"\s*:/iu },
    { name: "temporary path", pattern: /(?:\/tmp\/|\/private\/tmp\/|\/var\/folders\/)/u },
    { name: "private user path", pattern: /(?:\/Users\/|\/home\/[^<\s/]+|[A-Z]:\\Users\\)/u },
    { name: "OpenAI-style secret", pattern: /sk-[A-Za-z0-9_-]{20,}/u },
    { name: "Bearer value", pattern: /\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/u },
    {
      name: "auth environment assignment value",
      pattern:
        /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/iu,
    },
  ];
  for (const { name, pattern } of forbidden) {
    if (pattern.test(text)) throw new Error(`refusing to write unsafe P8-4 evidence: ${name}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetSha = options.targetSha;
  const branch = runText("git", ["branch", "--show-current"]) || null;
  const headSha = runText("git", ["rev-parse", "HEAD"]);
  const originMainSha = runText("git", ["rev-parse", "origin/main"]);
  const targetShaInOriginMain = gitIsAncestor(targetSha, "origin/main");

  const matrix = readJson(MATRIX_FILE);
  const compatibilityVerification = runJson("npm", [
    "run",
    "--silent",
    "compat:real:evidence:verify",
    "--",
    "--target-sha",
    targetSha,
    "--max-age-hours",
    "24",
    "--release-strict",
  ]);
  const releaseVerification = runJson("npm", [
    "run",
    "--silent",
    "release:verify",
    "--",
    "--dir",
    options.localReleaseDir,
  ]);

  const summary = {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    stage: "P8-4",
    evidenceKind: targetShaInOriginMain ? "main-eligible-local-release-strict-compatibility" : "branch-local-release-strict-compatibility",
    checkedAt: new Date().toISOString(),
    targetSha,
    targetRef: branch,
    currentHeadSha: headSha,
    originMainShaAtCheck: originMainSha,
    branchEvidence: !targetShaInOriginMain,
    mainEvidence: false,
    schemas: {
      matrix: MATRIX_SCHEMA_VERSION,
      verifier: VERIFIER_SCHEMA_VERSION,
      releaseVerification: RELEASE_VERIFICATION_SCHEMA_VERSION,
      releaseGateEvidence: RELEASE_GATE_EVIDENCE_SCHEMA_VERSION,
    },
    matrix: summarizeMatrix(matrix),
    compatibilityVerification: summarizeCompatibilityVerification(compatibilityVerification),
    localReleaseCandidate: {
      mode: "local-strict",
      command: RELEASE_CANDIDATE_LOCAL_COMMAND,
      releaseVerifyCommand: RELEASE_VERIFY_LOCAL_COMMAND,
      verification: summarizeReleaseVerification(releaseVerification),
    },
    remoteReleaseCandidate: {
      workflow: ".github/workflows/release-candidate.yml",
      eligibleForMainWorkflow: targetShaInOriginMain,
      triggered: false,
      triggerSkippedReason: targetShaInOriginMain ? "not_triggered_by_this_local_summary" : "target_sha_not_in_origin_main",
      ref: targetShaInOriginMain ? "main" : null,
      run: {
        id: null,
        url: null,
        headSha: null,
        conclusion: null,
      },
      artifacts: {
        count: 0,
        names: [],
      },
    },
    downloadedArtifacts: {
      verified: false,
      skippedReason: "remote_workflow_not_triggered",
      command: RELEASE_VERIFY_DOWNLOADED_COMMAND,
      schemaVersion: null,
      ok: null,
    },
    noAuthenticatedRealRun: true,
    noNpmPublish: true,
    noNpmToken: true,
    boundary: {
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
    },
  };

  const text = `${JSON.stringify(summary, null, 2)}\n`;
  assertSafeEvidence(text);
  writeFileSync(path.resolve(options.output), text, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    output: displayOutput(options.output),
    targetSha,
    branchEvidence: summary.branchEvidence,
    mainEvidence: summary.mainEvidence,
  }, null, 2)}\n`);
}

function displayOutput(file) {
  const relative = path.relative(process.cwd(), path.resolve(file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "<external_evidence_file>";
  return relative.split(path.sep).join("/");
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    error: redact(error instanceof Error ? error.message : String(error)),
  }, null, 2)}\n`);
  process.exit(1);
}
