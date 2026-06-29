#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const REAL_COMPATIBILITY_EVIDENCE_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityMatrix.v1";
const REAL_COMPATIBILITY_VERIFICATION_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityEvidenceVerification.v1";
const REAL_COMPATIBILITY_MAX_AGE_HOURS = 24;
const REAL_COMPATIBILITY_GATE_COMMAND = `npm run compat:real:evidence:verify -- --target-sha <target_sha> --max-age-hours ${REAL_COMPATIBILITY_MAX_AGE_HOURS} --release-strict`;
const REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_COMMAND = "repo-only real compatibility evidence not refreshed in CI";
const REAL_COMPATIBILITY_LOCAL_STRICT_MODE = "local-strict";
const REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_MODE = "repo-only-skipped";
const REAL_COMPATIBILITY_MODES = new Set([REAL_COMPATIBILITY_LOCAL_STRICT_MODE, REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_MODE]);
const REAL_COMPATIBILITY_REPO_ONLY_STATUS = "repo_only_not_run";
const AUTH_ENV_PATTERN = new RegExp(
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
);

function parseArgs(argv) {
  const options = {
    outDir: undefined,
    keepTemp: false,
    realCompatibilityMode: REAL_COMPATIBILITY_LOCAL_STRICT_MODE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      options.outDir = argv[++i];
    } else if (arg === "--real-compatibility-mode") {
      options.realCompatibilityMode = argv[++i];
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/create-release-candidate.mjs [--out-dir <dir>] [--real-compatibility-mode <local-strict|repo-only-skipped>] [--keep-temp]

Creates a local release-candidate directory without publishing npm.

Options:
  --out-dir <dir>                    Write artifacts to this directory. Defaults to a temp directory.
  --real-compatibility-mode <mode>   local-strict runs the target-SHA/freshness verifier; repo-only-skipped records that CI did not refresh repo-only real CLI evidence.
  --keep-temp                        Print and keep the temp directory when --out-dir is omitted.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!REAL_COMPATIBILITY_MODES.has(options.realCompatibilityMode)) {
    throw new Error(`Invalid --real-compatibility-mode: ${redact(options.realCompatibilityMode)}`);
  }
  return options;
}

function redact(value) {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(AUTH_ENV_PATTERN, "[REDACTED_ENV]=[REDACTED]")
    .replace(/\/(?:private\/)?tmp\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/var\/folders\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/Users\/[^/\s]+/gu, "/" + "Users/[REDACTED]")
    .replace(/\/home\/[^/\s]+/gu, "/" + "home/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gu, "C:" + "\\Users\\[REDACTED]");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stdout.write(redact(result.stdout ?? ""));
    process.stderr.write(redact(result.stderr ?? ""));
    throw new Error(`command failed: ${command} ${args.map((arg) => redact(arg)).join(" ")}`);
  }
  return result.stdout ?? "";
}

function runJsonResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  let summary;
  try {
    summary = JSON.parse(result.stdout ?? "");
  } catch {
    if (result.status !== 0) {
      process.stdout.write(redact(result.stdout ?? ""));
      process.stderr.write(redact(result.stderr ?? ""));
      throw new Error(`command failed: ${command} ${args.map((arg) => redact(arg)).join(" ")}`);
    }
    throw new Error(`command did not produce JSON: ${command} ${args.map((arg) => redact(arg)).join(" ")}`);
  }
  return { status: result.status ?? 1, summary };
}

function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return path.basename(file);
}

function gitHeadSha() {
  return run("git", ["rev-parse", "HEAD"]).trim();
}

function compatibilityGateCommand(targetSha, mode) {
  if (mode === REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_MODE) {
    return {
      name: "real-compatibility-evidence",
      script: "compat:real:evidence:verify",
      command: REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_COMMAND,
      skip: true,
      summary: repoOnlyCompatibilityGateSummary(targetSha),
    };
  }
  return {
    name: "real-compatibility-evidence",
    script: "compat:real:evidence:verify",
    command: REAL_COMPATIBILITY_GATE_COMMAND,
    args: [
      "run",
      "--silent",
      "compat:real:evidence:verify",
      "--",
      "--target-sha",
      targetSha,
      "--max-age-hours",
      String(REAL_COMPATIBILITY_MAX_AGE_HOURS),
      "--release-strict",
    ],
    expectedOutputSchemaVersion: REAL_COMPATIBILITY_VERIFICATION_SCHEMA_VERSION,
    expectedEvidenceSchemaVersion: REAL_COMPATIBILITY_EVIDENCE_SCHEMA_VERSION,
  };
}

function repoOnlyCompatibilityGateSummary(targetSha) {
  return {
    name: "real-compatibility-evidence",
    script: "compat:real:evidence:verify",
    command: REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_COMMAND,
    ok: true,
    outputSchemaVersion: REAL_COMPATIBILITY_VERIFICATION_SCHEMA_VERSION,
    evidenceSchemaVersion: REAL_COMPATIBILITY_EVIDENCE_SCHEMA_VERSION,
    targetSha: {
      expected: targetSha,
      actual: null,
      ok: null,
      status: REAL_COMPATIBILITY_REPO_ONLY_STATUS,
    },
    freshness: {
      maxAgeHours: REAL_COMPATIBILITY_MAX_AGE_HOURS,
      ageHours: null,
      ok: null,
      status: REAL_COMPATIBILITY_REPO_ONLY_STATUS,
    },
    dirtyPolicy: {
      policy: REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_MODE,
      allowDirty: false,
      gitDirty: null,
      inputDirty: null,
      outputDirty: null,
      ok: null,
      status: REAL_COMPATIBILITY_REPO_ONLY_STATUS,
    },
    diagnostics: {
      count: 0,
      codes: [],
    },
    repoOnlyEvidence: {
      status: "not_refreshed_in_ci",
      reason: "real_compatibility_matrix_is_repo_only",
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(options.outDir ?? mkdtempSync(path.join(tmpdir(), "agent-cli-runtime-release-candidate-")));
  mkdirSync(outDir, { recursive: true });

  const packJsonPath = path.join(outDir, "npm-pack.json");
  const packageFilesPath = path.join(outDir, "package-files.txt");
  const gateEvidencePath = path.join(outDir, "gate-evidence.json");
  const verificationPath = path.join(outDir, "release-verification.json");

  try {
    const targetSha = gitHeadSha();
    const gateCommands = [
      {
        name: "daemon-ready",
        script: "daemon:verify",
        command: "npm run daemon:verify",
        args: ["run", "--silent", "daemon:verify"],
      },
      {
        name: "runtime-safety",
        script: "runtime:safety",
        command: "npm run runtime:safety",
        args: ["run", "--silent", "runtime:safety"],
      },
      compatibilityGateCommand(targetSha, options.realCompatibilityMode),
    ];
    const gates = gateCommands.map((gate) => {
      if (gate.skip === true) return gate.summary;
      const { status, summary } = runJsonResult("npm", gate.args);
      const gateSummary = {
        name: gate.name,
        script: gate.script,
        command: gate.command,
        ok: status === 0 && summary.ok === true,
        outputSchemaVersion: typeof summary.schemaVersion === "string" ? summary.schemaVersion : null,
      };
      if (typeof summary.packageSource === "string") gateSummary.packageSource = summary.packageSource;
      if (gate.script === "compat:real:evidence:verify") {
        gateSummary.evidenceSchemaVersion = typeof summary.evidenceSchemaVersion === "string" ? summary.evidenceSchemaVersion : null;
        gateSummary.targetSha = summarizeTargetSha(summary.targetSha);
        gateSummary.freshness = summarizeFreshness(summary.freshness);
        gateSummary.dirtyPolicy = summarizeDirtyPolicy(summary.dirtyPolicy);
        gateSummary.diagnostics = summary.diagnosticSummary ?? summarizeDiagnostics(summary.diagnostics);
        if (gateSummary.outputSchemaVersion !== gate.expectedOutputSchemaVersion) {
          throw new Error(`unexpected compatibility verification schema: ${gateSummary.outputSchemaVersion ?? "null"}`);
        }
        if (gateSummary.evidenceSchemaVersion !== gate.expectedEvidenceSchemaVersion) {
          throw new Error(`unexpected real compatibility evidence schema: ${gateSummary.evidenceSchemaVersion ?? "null"}`);
        }
      }
      return gateSummary;
    });
    const gateEvidence = {
      schemaVersion: "agent-cli-runtime.releaseGateEvidence.v1",
      generatedAt: new Date().toISOString(),
      gates,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
    };
    writeFileSync(gateEvidencePath, `${JSON.stringify(gateEvidence, null, 2)}\n`, "utf8");
    const failedGates = gates.filter((gate) => gate.ok !== true).map((gate) => gate.script);
    if (failedGates.length > 0) {
      throw new Error(`release gate failed: ${failedGates.join(", ")}`);
    }

    const packJson = run("npm", ["pack", "--json", "--pack-destination", outDir]);
    writeFileSync(packJsonPath, packJson, "utf8");
    const packEntries = JSON.parse(packJson);
    const files = packEntries.flatMap((entry) => entry.files.map((file) => file.path)).join("\n");
    writeFileSync(packageFilesPath, `${files}\n`, "utf8");

    run(process.execPath, [
      path.join(process.cwd(), "scripts", "verify-release-artifacts.mjs"),
      "--dir",
      outDir,
      "--output",
      verificationPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const verification = JSON.parse(readFileSync(verificationPath, "utf8"));
    process.stdout.write(`${JSON.stringify({
      ok: true,
      outDir: displayPath(outDir),
      tarball: verification.tarball,
      gateEvidence: path.basename(gateEvidencePath),
      verification: path.basename(verificationPath),
    }, null, 2)}\n`);
  } catch (error) {
    if (!options.outDir && !options.keepTemp) {
      rmSync(outDir, { recursive: true, force: true });
    }
    process.stdout.write(`${JSON.stringify({
      ok: false,
      outDir: displayPath(outDir),
      error: redact(error instanceof Error ? error.message : String(error)),
    }, null, 2)}\n`);
    process.exit(1);
  }
}

main();

function summarizeDiagnostics(diagnostics) {
  const codes = Array.isArray(diagnostics)
    ? [...new Set(diagnostics.map((diagnostic) => diagnostic?.code).filter((code) => typeof code === "string"))].sort()
    : [];
  return {
    count: Array.isArray(diagnostics) ? diagnostics.length : 0,
    codes,
  };
}

function summarizeTargetSha(value) {
  return {
    expected: typeof value?.expected === "string" ? value.expected : null,
    actual: typeof value?.actual === "string" ? value.actual : null,
    ok: typeof value?.ok === "boolean" ? value.ok : null,
    status: typeof value?.status === "string" ? value.status : "unknown",
  };
}

function summarizeFreshness(value) {
  return {
    maxAgeHours: typeof value?.maxAgeHours === "number" ? value.maxAgeHours : null,
    ageHours: typeof value?.ageHours === "number" ? value.ageHours : null,
    ok: typeof value?.ok === "boolean" ? value.ok : null,
    status: typeof value?.status === "string" ? value.status : "unknown",
  };
}

function summarizeDirtyPolicy(value) {
  return {
    policy: typeof value?.policy === "string" ? value.policy : "unknown",
    allowDirty: value?.allowDirty === true,
    gitDirty: typeof value?.gitDirty === "boolean" ? value.gitDirty : null,
    inputDirty: typeof value?.inputDirty === "boolean" ? value.inputDirty : null,
    outputDirty: typeof value?.outputDirty === "boolean" ? value.outputDirty : null,
    ok: typeof value?.ok === "boolean" ? value.ok : false,
    status: typeof value?.status === "string" ? value.status : "unknown",
  };
}
