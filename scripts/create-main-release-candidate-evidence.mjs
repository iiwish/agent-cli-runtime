#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SUMMARY_SCHEMA_VERSION = "agent-cli-runtime.p8MainReleaseCandidateEvidence.v1";
const MATRIX_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityMatrix.v1";
const VERIFIER_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityEvidenceVerification.v1";
const RELEASE_VERIFICATION_SCHEMA_VERSION = "agent-cli-runtime.releaseVerification.v1";
const RELEASE_GATE_EVIDENCE_SCHEMA_VERSION = "agent-cli-runtime.releaseGateEvidence.v1";
const MATRIX_FILE = ".release-evidence/p8-2-real-cli-compatibility-matrix.json";
const DEFAULT_OUTPUT = ".release-evidence/p8-5-main-release-candidate.json";
const COMPAT_VERIFY_COMMAND = "npm run compat:real:evidence:verify -- --target-sha <releaseTargetSha> --max-age-hours 24 --release-strict";
const LOCAL_RELEASE_COMMAND = "npm run release:candidate -- --out-dir <tmp-local-strict>";
const LOCAL_VERIFY_COMMAND = "npm run release:verify -- --dir <tmp-local-strict>";
const DOWNLOADED_VERIFY_COMMAND = "npm run release:verify -- --dir <normalized-downloaded-artifact-dir>";
const REMOTE_REPO_ONLY_SKIPPED_COMMAND = "repo-only real compatibility evidence not refreshed in CI";
const EXPECTED_ARTIFACTS = [
  "agent-cli-runtime-tarball",
  "agent-cli-runtime-pack-metadata",
  "agent-cli-runtime-package-files",
  "agent-cli-runtime-gate-evidence",
  "agent-cli-runtime-release-verification",
];

function parseArgs(argv) {
  const options = {
    releaseTargetSha: null,
    localReleaseDir: null,
    remoteRunJson: null,
    artifactsJson: null,
    downloadedDir: null,
    output: DEFAULT_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--release-target-sha" || arg === "--target-sha") {
      options.releaseTargetSha = requireValue(argv, ++index, arg).toLowerCase();
    } else if (arg === "--local-release-dir") {
      options.localReleaseDir = requireValue(argv, ++index, arg);
    } else if (arg === "--remote-run-json") {
      options.remoteRunJson = requireValue(argv, ++index, arg);
    } else if (arg === "--artifacts-json") {
      options.artifactsJson = requireValue(argv, ++index, arg);
    } else if (arg === "--downloaded-dir") {
      options.downloadedDir = requireValue(argv, ++index, arg);
    } else if (arg === "--out" || arg === "--output") {
      options.output = requireValue(argv, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/create-main-release-candidate-evidence.mjs --release-target-sha <sha> --local-release-dir <dir> [--remote-run-json <file> --artifacts-json <file> --downloaded-dir <dir>] [--out <file>]

Writes repo-only P8-5 main-scoped release-candidate evidence. It summarizes local strict matrix verification, local release artifacts, and optionally a fresh remote workflow run plus downloaded artifact verification.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }
  if (!/^[0-9a-f]{40}$/u.test(options.releaseTargetSha ?? "")) {
    throw new Error("--release-target-sha must be a full lowercase 40-character commit SHA");
  }
  if (!options.localReleaseDir) throw new Error("--local-release-dir is required");
  const remoteArgs = [options.remoteRunJson, options.artifactsJson, options.downloadedDir].filter(Boolean);
  if (remoteArgs.length !== 0 && remoteArgs.length !== 3) {
    throw new Error("--remote-run-json, --artifacts-json, and --downloaded-dir must be provided together");
  }
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
    .replace(authEnvAssignmentPattern("giu"), "[REDACTED_ENV]=[REDACTED]")
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
  if (result.status !== 0) throw new Error(`command failed: ${command} ${args.map(redact).join(" ")}`);
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

function summarizeReleaseVerification(verification, command) {
  return {
    command,
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
        packageSource: typeof gate?.packageSource === "string" ? gate.packageSource : null,
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

function summarizeRemoteRun(remoteRun, releaseTargetSha) {
  return {
    id: typeof remoteRun?.databaseId === "number" ? remoteRun.databaseId : typeof remoteRun?.id === "number" ? remoteRun.id : null,
    url: typeof remoteRun?.url === "string" ? remoteRun.url : null,
    event: typeof remoteRun?.event === "string" ? remoteRun.event : "workflow_dispatch",
    headBranch: typeof remoteRun?.headBranch === "string" ? remoteRun.headBranch : "main",
    headSha: typeof remoteRun?.headSha === "string" ? remoteRun.headSha : null,
    status: typeof remoteRun?.status === "string" ? remoteRun.status : null,
    conclusion: typeof remoteRun?.conclusion === "string" ? remoteRun.conclusion : null,
    createdAt: typeof remoteRun?.createdAt === "string" ? remoteRun.createdAt : null,
    updatedAt: typeof remoteRun?.updatedAt === "string" ? remoteRun.updatedAt : null,
    headShaMatchesReleaseTarget: remoteRun?.headSha === releaseTargetSha,
    jobs: Array.isArray(remoteRun?.jobs)
      ? remoteRun.jobs.map((job) => ({
        name: typeof job?.name === "string" ? job.name : null,
        status: typeof job?.status === "string" ? job.status : null,
        conclusion: typeof job?.conclusion === "string" ? job.conclusion : null,
      }))
      : [],
  };
}

function summarizeArtifacts(payload) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : Array.isArray(payload) ? payload : [];
  const items = artifacts.map((artifact) => ({
    name: typeof artifact?.name === "string" ? artifact.name : null,
    id: typeof artifact?.id === "number" ? artifact.id : null,
    digest: typeof artifact?.digest === "string" ? artifact.digest : null,
  })).filter((artifact) => artifact.name !== null);
  return {
    count: items.length,
    names: items.map((artifact) => artifact.name).sort(),
    items: items.sort((left, right) => String(left.name).localeCompare(String(right.name))),
    expectedNames: [...EXPECTED_ARTIFACTS].sort(),
    complete: EXPECTED_ARTIFACTS.every((name) => items.some((artifact) => artifact.name === name)),
  };
}

function assertSafeEvidence(text) {
  const forbidden = [
    { name: "raw output key", pattern: /"(?:stdout|stderr|rawStdout|rawStderr|rawOutput|fullPrompt|promptText|resolvedExecutablePath|workflowLog|logs)"\s*:/iu },
    { name: "temporary path", pattern: /(?:\/tmp\/|\/private\/tmp\/|\/var\/folders\/)/u },
    { name: "private user path", pattern: /(?:\/Users\/|\/home\/[^<\s/]+|[A-Z]:\\Users\\)/u },
    { name: "OpenAI-style secret", pattern: /sk-[A-Za-z0-9_-]{20,}/u },
    { name: "Bearer value", pattern: /\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/u },
    {
      name: "auth environment assignment value",
      pattern: authEnvAssignmentPattern(),
    },
  ];
  for (const { name, pattern } of forbidden) {
    if (pattern.test(text)) throw new Error(`refusing to write unsafe P8-5 evidence: ${name}`);
  }
}

function authEnvAssignmentPattern(flags = "iu") {
  return new RegExp(
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
    flags,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const releaseTargetSha = options.releaseTargetSha;
  const headSha = runText("git", ["rev-parse", "HEAD"]);
  const originMainSha = runText("git", ["rev-parse", "origin/main"]);
  if (originMainSha !== releaseTargetSha) {
    throw new Error("release target SHA must equal origin/main");
  }
  if (headSha !== releaseTargetSha) {
    throw new Error("local HEAD must equal release target SHA before writing P8-5 main evidence");
  }
  if (!gitIsAncestor(releaseTargetSha, "origin/main")) {
    throw new Error("release target SHA is not in origin/main");
  }

  const matrix = readJson(MATRIX_FILE);
  const compatibilityVerification = runJson("npm", [
    "run",
    "--silent",
    "compat:real:evidence:verify",
    "--",
    "--target-sha",
    releaseTargetSha,
    "--max-age-hours",
    "24",
    "--release-strict",
  ]);
  const localVerification = runJson("npm", [
    "run",
    "--silent",
    "release:verify",
    "--",
    "--dir",
    options.localReleaseDir,
  ]);

  const hasRemoteEvidence = Boolean(options.remoteRunJson);
  const remoteRun = hasRemoteEvidence ? summarizeRemoteRun(readJson(options.remoteRunJson), releaseTargetSha) : null;
  const remoteArtifacts = hasRemoteEvidence ? summarizeArtifacts(readJson(options.artifactsJson)) : {
    count: 0,
    names: [],
    items: [],
    expectedNames: [...EXPECTED_ARTIFACTS].sort(),
    complete: false,
  };
  const downloadedVerification = hasRemoteEvidence
    ? summarizeReleaseVerification(runJson("npm", ["run", "--silent", "release:verify", "--", "--dir", options.downloadedDir]), DOWNLOADED_VERIFY_COMMAND)
    : {
      command: DOWNLOADED_VERIFY_COMMAND,
      schemaVersion: null,
      ok: null,
      diagnosticsCount: null,
      artifactNames: [],
      packageName: null,
      version: null,
      packageFiles: null,
      tarball: { filename: null, exists: false },
      gateEvidence: null,
    };

  const summary = {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    stage: "P8-5",
    evidenceKind: "main-scoped-remote-release-candidate",
    checkedAt: new Date().toISOString(),
    releaseTargetSha,
    targetRef: "main",
    currentHeadSha: headSha,
    originMainShaAtCheck: originMainSha,
    p8_4TargetSha: readJson(".release-evidence/p8-4-release-strict-compatibility.json").targetSha ?? null,
    p8_4TargetInOriginMain: gitIsAncestor(readJson(".release-evidence/p8-4-release-strict-compatibility.json").targetSha, "origin/main"),
    mainEvidence: true,
    branchEvidence: false,
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
      command: LOCAL_RELEASE_COMMAND,
      releaseVerifyCommand: LOCAL_VERIFY_COMMAND,
      verification: summarizeReleaseVerification(localVerification, LOCAL_VERIFY_COMMAND),
    },
    remoteReleaseCandidate: {
      workflow: ".github/workflows/release-candidate.yml",
      ref: "main",
      triggered: hasRemoteEvidence,
      run: remoteRun,
      artifacts: remoteArtifacts,
    },
    downloadedArtifacts: {
      verified: downloadedVerification.ok === true,
      skippedReason: hasRemoteEvidence ? null : "remote_workflow_not_recorded_yet",
      verification: downloadedVerification,
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
      noWorkflowLogs: true,
      noTokenValue: true,
      noBearerValue: true,
      noAuthEnvAssignment: true,
    },
  };

  if (hasRemoteEvidence) {
    if (remoteRun?.headShaMatchesReleaseTarget !== true || remoteRun?.conclusion !== "success") {
      throw new Error("remote workflow run does not prove the release target");
    }
    if (remoteArtifacts.complete !== true) throw new Error("remote workflow artifacts are incomplete");
    if (downloadedVerification.ok !== true) throw new Error("downloaded release artifacts did not verify");
  }

  const text = `${JSON.stringify(summary, null, 2)}\n`;
  assertSafeEvidence(text);
  writeFileSync(path.resolve(options.output), text, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    output: displayOutput(options.output),
    releaseTargetSha,
    mainEvidence: true,
    branchEvidence: false,
    remoteRecorded: hasRemoteEvidence,
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
