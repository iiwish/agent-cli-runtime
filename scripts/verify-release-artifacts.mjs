#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "agent-cli-runtime.releaseVerification.v1";
const DEFAULT_ARTIFACT_NAMES = [
  "agent-cli-runtime-tarball",
  "agent-cli-runtime-pack-metadata",
  "agent-cli-runtime-package-files",
  "agent-cli-runtime-gate-evidence",
  "agent-cli-runtime-release-verification",
];
const GATE_EVIDENCE_SCHEMA_VERSION = "agent-cli-runtime.releaseGateEvidence.v1";
const REAL_COMPATIBILITY_EVIDENCE_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityMatrix.v1";
const REAL_COMPATIBILITY_VERIFICATION_SCHEMA_VERSION = "agent-cli-runtime.realCompatibilityEvidenceVerification.v1";
const REAL_COMPATIBILITY_MAX_AGE_HOURS = 24;
const REAL_COMPATIBILITY_GATE_COMMAND = `npm run compat:real:evidence:verify -- --target-sha <target_sha> --max-age-hours ${REAL_COMPATIBILITY_MAX_AGE_HOURS} --release-strict`;
const REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_COMMAND = "repo-only real compatibility evidence not refreshed in CI";
const REAL_COMPATIBILITY_REPO_ONLY_STATUS = "repo_only_not_run";
const COMPATIBILITY_GATE_ALLOWED_KEYS = new Set([
  "name",
  "script",
  "command",
  "ok",
  "outputSchemaVersion",
  "evidenceSchemaVersion",
  "targetSha",
  "freshness",
  "dirtyPolicy",
  "diagnostics",
  "repoOnlyEvidence",
]);
const REQUIRED_GATE_EVIDENCE = [
  {
    name: "daemon-ready",
    script: "daemon:verify",
    command: "npm run daemon:verify",
    outputSchemaVersion: "agent-runtime.daemonVerification.v1",
    packageSource: "installed-tarball",
  },
  {
    name: "runtime-safety",
    script: "runtime:safety",
    command: "npm run runtime:safety",
    outputSchemaVersion: "agent-runtime.runtimeSafety.v1",
    packageSource: "installed-tarball",
  },
  {
    name: "real-compatibility-evidence",
    script: "compat:real:evidence:verify",
    command: [REAL_COMPATIBILITY_GATE_COMMAND, REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_COMMAND],
    outputSchemaVersion: REAL_COMPATIBILITY_VERIFICATION_SCHEMA_VERSION,
    evidenceSchemaVersion: REAL_COMPATIBILITY_EVIDENCE_SCHEMA_VERSION,
  },
];

const disallowedPathPatterns = [
  { code: "volatile_release_evidence", pattern: /^\.release-evidence(?:\/|$)/u },
  { code: "reference_material", pattern: /^\.reference(?:\/|$)/u },
  { code: "tests", pattern: /^tests(?:\/|$)/u },
  { code: "fixture_material", pattern: /fixtures?/iu },
  { code: "fault_fixtures", pattern: /(?:^|\/)fault-fixtures(?:\/|$)/u },
  { code: "repair_backups", pattern: /(?:^|\/)repair-backups(?:\/|$)/u },
  { code: "raw_corrupt_samples", pattern: /(?:^|\/)raw-corrupt-samples(?:\/|$)/u },
  { code: "raw_real_cli_output", pattern: /(?:^|\/)raw-real-cli-output(?:\/|$)/u },
  { code: "repo_only_real_compatibility_script", pattern: /^scripts\/(?:create-real-compatibility-evidence|verify-real-compatibility-evidence)\.mjs$/u },
];

const secretPatterns = [
  { code: "private_user_path", pattern: /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)/u },
  { code: "openai_style_secret", pattern: /sk-[A-Za-z0-9_-]{20,}/u },
  { code: "bearer_value", pattern: /\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/u },
  {
    code: "auth_env_assignment",
    pattern:
      /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/iu,
  },
  { code: "npm_token_reference", pattern: /\b(?:NODE_AUTH_TOKEN|NPM_TOKEN)\b/u },
];

function parseArgs(argv) {
  const options = {
    dir: "release-candidate",
    packJson: undefined,
    packageFiles: undefined,
    gateEvidence: undefined,
    output: undefined,
    artifactNames: [...DEFAULT_ARTIFACT_NAMES],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      options.dir = argv[++i];
    } else if (arg === "--pack-json") {
      options.packJson = argv[++i];
    } else if (arg === "--package-files") {
      options.packageFiles = argv[++i];
    } else if (arg === "--gate-evidence") {
      options.gateEvidence = argv[++i];
    } else if (arg === "--output") {
      options.output = argv[++i];
    } else if (arg === "--artifact-name") {
      options.artifactNames.push(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }

  for (const [name, value] of [
    ["--dir", options.dir],
    ["--pack-json", options.packJson],
    ["--package-files", options.packageFiles],
    ["--gate-evidence", options.gateEvidence],
    ["--output", options.output],
  ]) {
    if (value === undefined && argv.includes(name)) throw new Error(`Missing value for ${name}`);
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/verify-release-artifacts.mjs [--dir <release-candidate-dir>] [--output <file>]

Validates release candidate artifacts created locally or downloaded from GitHub Actions.

Options:
  --dir <path>             Directory containing npm-pack.json, package-files.txt, and tarball.
  --pack-json <path>       Override pack metadata path.
  --package-files <path>   Override package file list path.
  --gate-evidence <path>   Override daemon-ready gate evidence path.
  --output <path>          Write stable verification JSON to a file.
  --artifact-name <name>   Add an expected artifact name to the JSON summary.
`);
}

function redact(value) {
  if (typeof value !== "string") return value;
  const redactedUsersPath = "/" + "Users/[REDACTED]";
  const redactedHomePath = "/" + "home/[REDACTED]";
  const redactedWindowsUsersPath = "C:" + "\\Users\\[REDACTED]";
  return value
    .replace(/sk-[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(
      /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/giu,
      "[REDACTED_ENV]=[REDACTED]",
    )
    .replace(/\b(?:NODE_AUTH_TOKEN|NPM_TOKEN)\b/gu, "[REDACTED_NPM_TOKEN_REF]")
    .replace(/\/Users\/[^/\s]+/gu, redactedUsersPath)
    .replace(/\/home\/[^/\s]+/gu, redactedHomePath)
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gu, redactedWindowsUsersPath);
}

function safeRelative(baseDir, file) {
  const relative = path.relative(baseDir, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return path.basename(file);
  return relative.split(path.sep).join("/");
}

function addDiagnostic(diagnostics, code, message, details = {}) {
  diagnostics.push({
    code,
    message: redact(message),
    ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, typeof value === "string" ? redact(value) : value])),
  });
}

function readText(file, baseDir, diagnostics, label) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    const relative = safeRelative(baseDir, file);
    addDiagnostic(diagnostics, "missing_artifact", `Missing ${label}: ${relative}`, { path: relative });
    return undefined;
  }
}

function parsePackMetadata(packText, diagnostics) {
  if (packText === undefined) return [];
  try {
    const data = JSON.parse(packText);
    if (!Array.isArray(data) || data.length !== 1) {
      addDiagnostic(diagnostics, "invalid_pack_metadata", "npm pack metadata must be an array with exactly one entry.");
      return [];
    }
    return data;
  } catch {
    addDiagnostic(diagnostics, "invalid_pack_metadata", "npm pack metadata is not valid JSON.");
    return [];
  }
}

function expectedTarballFilename(name, version) {
  return `${name.replace(/^@/u, "").replace(/\//gu, "-")}-${version}.tgz`;
}

function normalizePackageFileList(packageFilesText) {
  if (packageFilesText === undefined) return [];
  return packageFilesText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inspectString(value, diagnostics, location) {
  for (const { code, pattern } of secretPatterns) {
    if (pattern.test(value)) {
      addDiagnostic(diagnostics, code, `Secret-looking or private value detected in ${location}.`, { location });
    }
  }
}

function inspectPackagePath(filePath, diagnostics) {
  if (path.isAbsolute(filePath) || filePath.includes("..")) {
    addDiagnostic(diagnostics, "unsafe_package_path", `Package path must be relative and normalized: ${filePath}`, {
      path: filePath,
    });
  }
  inspectString(filePath, diagnostics, `package path ${filePath}`);
  for (const { code, pattern } of disallowedPathPatterns) {
    if (pattern.test(filePath)) {
      addDiagnostic(diagnostics, code, `Disallowed package artifact path: ${filePath}`, { path: filePath });
    }
  }
}

function compareLists(expected, actual, diagnostics) {
  const expectedSorted = [...new Set(expected)].sort();
  const actualSorted = [...new Set(actual)].sort();
  if (expectedSorted.length !== expected.length) {
    addDiagnostic(diagnostics, "duplicate_pack_file", "npm pack metadata contains duplicate file paths.");
  }
  if (actualSorted.length !== actual.length) {
    addDiagnostic(diagnostics, "duplicate_package_file", "package-files.txt contains duplicate file paths.");
  }

  const missing = expectedSorted.filter((file) => !actualSorted.includes(file));
  const extra = actualSorted.filter((file) => !expectedSorted.includes(file));
  for (const file of missing) {
    addDiagnostic(diagnostics, "package_file_list_missing", `package-files.txt is missing ${file}`, { path: file });
  }
  for (const file of extra) {
    addDiagnostic(diagnostics, "package_file_list_extra", `package-files.txt includes ${file} that is absent from npm pack metadata`, {
      path: file,
    });
  }
}

function parseJsonArtifact(text, diagnostics, label) {
  if (text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `${label} is not valid JSON.`);
    return null;
  }
}

function validateGateEvidence(gateEvidenceText, baseDir, gateEvidencePath, diagnostics) {
  if (gateEvidenceText !== undefined) inspectString(gateEvidenceText, diagnostics, "release gate evidence");
  const evidence = parseJsonArtifact(gateEvidenceText, diagnostics, "Release gate evidence");
  if (evidence === null) {
    return {
      path: safeRelative(baseDir, gateEvidencePath),
      schemaVersion: null,
      gates: [],
      commands: [],
    };
  }

  if (evidence.schemaVersion !== GATE_EVIDENCE_SCHEMA_VERSION) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", "Release gate evidence schema version is missing or unsupported.", {
      expected: GATE_EVIDENCE_SCHEMA_VERSION,
      actual: typeof evidence.schemaVersion === "string" ? evidence.schemaVersion : null,
    });
  }

  const gates = Array.isArray(evidence.gates) ? evidence.gates : [];
  if (!Array.isArray(evidence.gates)) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", "Release gate evidence must contain a gates array.");
  }

  if (evidence.noAuthenticatedRealRun !== true) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", "Release gate evidence must explicitly avoid authenticated real runs.");
  }
  if (evidence.noNpmPublish !== true) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", "Release gate evidence must explicitly avoid npm publish.");
  }
  if (evidence.noNpmToken !== true) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", "Release gate evidence must explicitly avoid npm token requirements.");
  }

  for (const required of REQUIRED_GATE_EVIDENCE) {
    const gate = gates.find((candidate) => candidate?.script === required.script || candidate?.name === required.name);
    if (!gate) {
      addDiagnostic(diagnostics, "missing_gate_evidence", `Missing release gate evidence for ${required.script}.`, {
        script: required.script,
      });
      continue;
    }
    if (gate.name !== required.name) {
      addDiagnostic(diagnostics, "invalid_gate_evidence", `Unexpected gate evidence name for ${required.script}.`, {
        expected: required.name,
        actual: typeof gate.name === "string" ? gate.name : null,
      });
    }
    const expectedCommands = Array.isArray(required.command) ? required.command : [required.command];
    if (!expectedCommands.includes(gate.command)) {
      addDiagnostic(diagnostics, "invalid_gate_evidence", `Unexpected command for ${required.script}.`, {
        expected: expectedCommands.join(" | "),
        actual: typeof gate.command === "string" ? gate.command : null,
      });
    }
    if (gate.ok !== true) {
      addDiagnostic(diagnostics, "failed_gate_evidence", `Gate ${required.script} did not record ok: true.`, {
        script: required.script,
      });
    }
    if (gate.outputSchemaVersion !== required.outputSchemaVersion) {
      addDiagnostic(diagnostics, "invalid_gate_evidence", `Unexpected output schema for ${required.script}.`, {
        expected: required.outputSchemaVersion,
        actual: typeof gate.outputSchemaVersion === "string" ? gate.outputSchemaVersion : null,
      });
    }
    if ("packageSource" in required) {
      if (gate.packageSource !== required.packageSource) {
        addDiagnostic(diagnostics, "invalid_gate_evidence", `Gate ${required.script} must verify the installed tarball path.`, {
          script: required.script,
        });
      }
    }
    if ("evidenceSchemaVersion" in required) {
      validateCompatibilityGate(gate, required, diagnostics);
    }
  }

  return {
    path: safeRelative(baseDir, gateEvidencePath),
    schemaVersion: typeof evidence.schemaVersion === "string" ? evidence.schemaVersion : null,
    gates: gates.map((gate) => ({
      name: typeof gate?.name === "string" ? redact(gate.name) : null,
      script: typeof gate?.script === "string" ? redact(gate.script) : null,
      command: typeof gate?.command === "string" ? redact(gate.command) : null,
      ok: gate?.ok === true,
      outputSchemaVersion: typeof gate?.outputSchemaVersion === "string" ? redact(gate.outputSchemaVersion) : null,
      packageSource: typeof gate?.packageSource === "string" ? redact(gate.packageSource) : null,
      evidenceSchemaVersion: typeof gate?.evidenceSchemaVersion === "string" ? redact(gate.evidenceSchemaVersion) : null,
      targetSha: summarizeGateTargetSha(gate?.targetSha, diagnostics),
      freshness: summarizeGateFreshness(gate?.freshness, diagnostics),
      dirtyPolicy: summarizeGateDirtyPolicy(gate?.dirtyPolicy, diagnostics),
      diagnostics: summarizeGateDiagnostics(gate?.diagnostics, diagnostics),
      repoOnlyEvidence: summarizeGateRepoOnlyEvidence(gate?.repoOnlyEvidence, diagnostics),
    })),
    commands: gates.map((gate) => typeof gate?.command === "string" ? redact(gate.command) : null).filter(Boolean),
    noAuthenticatedRealRun: evidence.noAuthenticatedRealRun === true,
    noNpmPublish: evidence.noNpmPublish === true,
    noNpmToken: evidence.noNpmToken === true,
  };
}

function validateCompatibilityGate(gate, required, diagnostics) {
  const extraKeys = Object.keys(gate ?? {}).filter((key) => !COMPATIBILITY_GATE_ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    addDiagnostic(diagnostics, "unsafe_gate_evidence", `Compatibility verification gate includes fields outside the redacted summary allowlist.`, {
      script: required.script,
    });
  }
  if (gate.evidenceSchemaVersion !== required.evidenceSchemaVersion) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Unexpected verified evidence schema for ${required.script}.`, {
      expected: required.evidenceSchemaVersion,
      actual: typeof gate.evidenceSchemaVersion === "string" ? gate.evidenceSchemaVersion : null,
    });
  }
  if (gate.command === REAL_COMPATIBILITY_REPO_ONLY_SKIPPED_COMMAND) {
    validateCompatibilityRepoOnlySkipGate(gate, required, diagnostics);
    return;
  }
  if (gate.command !== REAL_COMPATIBILITY_GATE_COMMAND) return;
  if ("repoOnlyEvidence" in gate) {
    addDiagnostic(diagnostics, "unsafe_gate_evidence", `Strict compatibility verification gate must not include repo-only skip fields.`, {
      script: required.script,
    });
  }
  validateCompatibilityTargetSha(gate.targetSha, required, diagnostics);
  validateCompatibilityFreshness(gate.freshness, required, diagnostics);
  validateCompatibilityDirtyPolicy(gate.dirtyPolicy, required, diagnostics);
  validateCompatibilityDiagnosticSummary(gate.diagnostics, required, diagnostics);
}

function validateCompatibilityRepoOnlySkipGate(gate, required, diagnostics) {
  validateCompatibilityRepoOnlyTargetSha(gate.targetSha, required, diagnostics);
  validateCompatibilityRepoOnlyFreshness(gate.freshness, required, diagnostics);
  validateCompatibilityRepoOnlyDirtyPolicy(gate.dirtyPolicy, required, diagnostics);
  validateCompatibilityDiagnosticSummary(gate.diagnostics, required, diagnostics);
  if (gate.diagnostics?.count !== 0 || !Array.isArray(gate.diagnostics?.codes) || gate.diagnostics.codes.length !== 0) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Repo-only compatibility skip diagnostics for ${required.script} must be empty.`, {
      script: required.script,
    });
  }
  const summary = gate.repoOnlyEvidence;
  const summaryKeys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    summary.status !== "not_refreshed_in_ci" ||
    summary.reason !== "real_compatibility_matrix_is_repo_only" ||
    summaryKeys.some((key) => !["status", "reason"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Repo-only compatibility evidence summary for ${required.script} must record the fixed CI skip reason.`, {
      script: required.script,
    });
  }
}

function validateCompatibilityDiagnosticSummary(summary, required, diagnostics) {
  const summaryKeys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    typeof summary.count !== "number" ||
    !Array.isArray(summary.codes) ||
    summaryKeys.some((key) => !["count", "codes"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Compatibility verification diagnostics for ${required.script} must be summarized as count and codes only.`, {
      script: required.script,
    });
    return;
  }
  for (const code of summary.codes) {
    if (typeof code !== "string" || !/^[a-z0-9_]+$/u.test(code)) {
      addDiagnostic(diagnostics, "unsafe_gate_evidence", `Compatibility verification diagnostics for ${required.script} contain a non-redacted code.`, {
        script: required.script,
      });
    }
  }
  const diagnosticsText = JSON.stringify(summary);
  if (/"(?:message|stdout|stderr|rawStdout|rawStderr|rawOutput|prompt|fullPrompt|file|path)"\s*:/iu.test(diagnosticsText)) {
    addDiagnostic(diagnostics, "unsafe_gate_evidence", `Compatibility verification diagnostics for ${required.script} include details beyond codes/count.`, {
      script: required.script,
    });
  }
}

function validateCompatibilityRepoOnlyTargetSha(summary, required, diagnostics) {
  const keys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    typeof summary.expected !== "string" ||
    summary.actual !== null ||
    summary.ok !== null ||
    summary.status !== REAL_COMPATIBILITY_REPO_ONLY_STATUS ||
    keys.some((key) => !["expected", "actual", "ok", "status"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Repo-only compatibility target SHA summary for ${required.script} must record the workflow head SHA as expected and mark verifier not run.`, {
      script: required.script,
    });
    return;
  }
  if (!/^[0-9a-f]{40}$/u.test(summary.expected)) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Repo-only compatibility target SHA summary for ${required.script} must use a full target SHA.`, {
      script: required.script,
    });
  }
}

function validateCompatibilityRepoOnlyFreshness(summary, required, diagnostics) {
  const keys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    summary.maxAgeHours !== REAL_COMPATIBILITY_MAX_AGE_HOURS ||
    summary.ageHours !== null ||
    summary.ok !== null ||
    summary.status !== REAL_COMPATIBILITY_REPO_ONLY_STATUS ||
    keys.some((key) => !["maxAgeHours", "ageHours", "ok", "status"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Repo-only compatibility freshness summary for ${required.script} must mark verifier not run in CI.`, {
      script: required.script,
    });
  }
}

function validateCompatibilityRepoOnlyDirtyPolicy(summary, required, diagnostics) {
  const keys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    summary.policy !== "repo-only-skipped" ||
    summary.allowDirty !== false ||
    summary.gitDirty !== null ||
    summary.inputDirty !== null ||
    summary.outputDirty !== null ||
    summary.ok !== null ||
    summary.status !== REAL_COMPATIBILITY_REPO_ONLY_STATUS ||
    keys.some((key) => !["policy", "allowDirty", "gitDirty", "inputDirty", "outputDirty", "ok", "status"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Repo-only compatibility dirty-policy summary for ${required.script} must mark verifier not run in CI.`, {
      script: required.script,
    });
  }
}

function validateCompatibilityTargetSha(summary, required, diagnostics) {
  const keys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    typeof summary.expected !== "string" ||
    typeof summary.actual !== "string" ||
    summary.ok !== true ||
    summary.status !== "matched" ||
    keys.some((key) => !["expected", "actual", "ok", "status"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Compatibility verification target SHA summary for ${required.script} must record a matched target SHA only.`, {
      script: required.script,
    });
    return;
  }
  if (!/^[0-9a-f]{40}$/u.test(summary.expected) || !/^[0-9a-f]{40}$/u.test(summary.actual) || summary.expected !== summary.actual) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Compatibility verification target SHA summary for ${required.script} is not a full matching SHA.`, {
      script: required.script,
    });
  }
}

function validateCompatibilityFreshness(summary, required, diagnostics) {
  const keys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    summary.maxAgeHours !== REAL_COMPATIBILITY_MAX_AGE_HOURS ||
    typeof summary.ageHours !== "number" ||
    summary.ok !== true ||
    summary.status !== "fresh" ||
    keys.some((key) => !["maxAgeHours", "ageHours", "ok", "status"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Compatibility verification freshness summary for ${required.script} must record fresh max-age status.`, {
      script: required.script,
    });
  }
}

function validateCompatibilityDirtyPolicy(summary, required, diagnostics) {
  const keys = Object.keys(summary ?? {});
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    summary.policy !== "release-strict" ||
    typeof summary.allowDirty !== "boolean" ||
    typeof summary.gitDirty !== "boolean" ||
    typeof summary.inputDirty !== "boolean" ||
    typeof summary.outputDirty !== "boolean" ||
    summary.ok !== true ||
    (summary.status !== "clean" && summary.status !== "self_dirty_only" && summary.status !== "dirty_allowed") ||
    keys.some((key) => !["policy", "allowDirty", "gitDirty", "inputDirty", "outputDirty", "ok", "status"].includes(key))
  ) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Compatibility verification dirty-policy summary for ${required.script} must record release-strict clean, self-output-only dirty, or explicitly allowed dirty evidence.`, {
      script: required.script,
    });
    return;
  }
  if (summary.status === "self_dirty_only" && (summary.inputDirty !== false || summary.outputDirty !== true || summary.gitDirty !== false)) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Compatibility verification dirty-policy summary for ${required.script} has self_dirty_only without clean input evidence.`, {
      script: required.script,
    });
  }
  if (summary.status === "dirty_allowed" && summary.allowDirty !== true) {
    addDiagnostic(diagnostics, "invalid_gate_evidence", `Compatibility verification dirty-policy summary for ${required.script} has dirty_allowed without allowDirty.`, {
      script: required.script,
    });
  }
}

function summarizeGateDiagnostics(summary, diagnostics) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const result = {
    count: typeof summary.count === "number" ? summary.count : null,
    codes: Array.isArray(summary.codes) ? summary.codes.filter((code) => typeof code === "string").map(redact) : [],
  };
  inspectString(JSON.stringify(result), diagnostics, "release gate diagnostics summary");
  return result;
}

function summarizeGateTargetSha(summary, diagnostics) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const result = {
    expected: typeof summary.expected === "string" ? redact(summary.expected) : null,
    actual: typeof summary.actual === "string" ? redact(summary.actual) : null,
    ok: typeof summary.ok === "boolean" ? summary.ok : null,
    status: typeof summary.status === "string" ? redact(summary.status) : null,
  };
  inspectString(JSON.stringify(result), diagnostics, "release gate target SHA summary");
  return result;
}

function summarizeGateFreshness(summary, diagnostics) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const result = {
    maxAgeHours: typeof summary.maxAgeHours === "number" ? summary.maxAgeHours : null,
    ageHours: typeof summary.ageHours === "number" ? summary.ageHours : null,
    ok: typeof summary.ok === "boolean" ? summary.ok : null,
    status: typeof summary.status === "string" ? redact(summary.status) : null,
  };
  inspectString(JSON.stringify(result), diagnostics, "release gate freshness summary");
  return result;
}

function summarizeGateDirtyPolicy(summary, diagnostics) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const result = {
    policy: typeof summary.policy === "string" ? redact(summary.policy) : null,
    allowDirty: typeof summary.allowDirty === "boolean" ? summary.allowDirty : null,
    gitDirty: typeof summary.gitDirty === "boolean" ? summary.gitDirty : null,
    inputDirty: typeof summary.inputDirty === "boolean" ? summary.inputDirty : null,
    outputDirty: typeof summary.outputDirty === "boolean" ? summary.outputDirty : null,
    ok: typeof summary.ok === "boolean" ? summary.ok : null,
    status: typeof summary.status === "string" ? redact(summary.status) : null,
  };
  inspectString(JSON.stringify(result), diagnostics, "release gate dirty-policy summary");
  return result;
}

function summarizeGateRepoOnlyEvidence(summary, diagnostics) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const result = {
    status: typeof summary.status === "string" ? redact(summary.status) : null,
    reason: typeof summary.reason === "string" ? redact(summary.reason) : null,
  };
  inspectString(JSON.stringify(result), diagnostics, "release gate repo-only evidence summary");
  return result;
}

function validate(options) {
  const diagnostics = [];
  const baseDir = path.resolve(options.dir);
  const packJsonPath = path.resolve(options.packJson ?? path.join(baseDir, "npm-pack.json"));
  const packageFilesPath = path.resolve(options.packageFiles ?? path.join(baseDir, "package-files.txt"));
  const gateEvidencePath = path.resolve(options.gateEvidence ?? path.join(baseDir, "gate-evidence.json"));
  const packText = readText(packJsonPath, baseDir, diagnostics, "npm pack metadata");
  const packageFilesText = readText(packageFilesPath, baseDir, diagnostics, "package file list");
  const gateEvidenceText = readText(gateEvidencePath, baseDir, diagnostics, "release gate evidence");

  if (packText !== undefined) inspectString(packText, diagnostics, "npm pack metadata");
  if (packageFilesText !== undefined) inspectString(packageFilesText, diagnostics, "package file list");
  const gateEvidence = validateGateEvidence(gateEvidenceText, baseDir, gateEvidencePath, diagnostics);

  const packEntries = parsePackMetadata(packText, diagnostics);
  const packageFiles = normalizePackageFileList(packageFilesText);
  const entry = packEntries[0];
  const packedFiles = entry?.files?.map((file) => file?.path).filter((file) => typeof file === "string") ?? [];

  if (entry && (!Array.isArray(entry.files) || packedFiles.length !== entry.files.length)) {
    addDiagnostic(diagnostics, "invalid_pack_metadata", "npm pack metadata entry files must be objects with string path values.");
  }

  for (const file of packedFiles) inspectPackagePath(file, diagnostics);
  for (const file of packageFiles) inspectPackagePath(file, diagnostics);
  if (packedFiles.length > 0 || packageFiles.length > 0) compareLists(packedFiles, packageFiles, diagnostics);

  const packageName = typeof entry?.name === "string" ? entry.name : null;
  const version = typeof entry?.version === "string" ? entry.version : null;
  const filename = typeof entry?.filename === "string" ? entry.filename : null;
  if (entry && packageName === null) addDiagnostic(diagnostics, "invalid_pack_metadata", "npm pack metadata is missing package name.");
  if (entry && version === null) addDiagnostic(diagnostics, "invalid_pack_metadata", "npm pack metadata is missing package version.");
  if (entry && filename === null) addDiagnostic(diagnostics, "invalid_pack_metadata", "npm pack metadata is missing tarball filename.");

  if (filename !== null) {
    inspectString(filename, diagnostics, "tarball filename");
    if (path.isAbsolute(filename) || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      addDiagnostic(diagnostics, "unsafe_tarball_filename", `Tarball filename must be a basename: ${filename}`, { tarball: filename });
    }
    if (packageName !== null && version !== null && filename !== expectedTarballFilename(packageName, version)) {
      addDiagnostic(diagnostics, "unexpected_tarball_filename", `Unexpected tarball filename: ${filename}`, {
        expected: expectedTarballFilename(packageName, version),
        tarball: filename,
      });
    }
  }

  const tarballPath = filename === null ? null : path.join(baseDir, filename);
  let tarballExists = false;
  let tarballSizeBytes = null;
  if (tarballPath !== null) {
    tarballExists = existsSync(tarballPath);
    if (!tarballExists) {
      const relativeTarballPath = safeRelative(baseDir, tarballPath);
      addDiagnostic(diagnostics, "missing_artifact", `Missing tarball: ${relativeTarballPath}`, { path: relativeTarballPath });
    } else {
      tarballSizeBytes = statSync(tarballPath).size;
    }
  }

  const checkedFiles = {
    packMetadata: safeRelative(baseDir, packJsonPath),
    packageFileList: safeRelative(baseDir, packageFilesPath),
    gateEvidence: safeRelative(baseDir, gateEvidencePath),
    packageFiles: packedFiles.length,
  };
  const tarball = {
    filename: filename === null ? null : redact(filename),
    path: tarballPath === null ? null : safeRelative(baseDir, tarballPath),
    exists: tarballExists,
    sizeBytes: tarballSizeBytes,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    ok: diagnostics.length === 0,
    checkedFiles,
    tarball,
    diagnostics,
    artifactNames: [...new Set(options.artifactNames)],
    gateEvidence,
    packageName,
    version,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      checkedFiles: {},
      tarball: null,
      diagnostics: [{ code: "usage_error", message: redact(error instanceof Error ? error.message : String(error)) }],
      artifactNames: DEFAULT_ARTIFACT_NAMES,
      gateEvidence: null,
      packageName: null,
      version: null,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  try {
    const result = validate(options);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      writeFileSync(options.output, json, "utf8");
    }
    process.stdout.write(json);
    if (!result.ok) process.exit(1);
  } catch (error) {
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      checkedFiles: {},
      tarball: null,
      diagnostics: [{ code: "verification_error", message: redact(error instanceof Error ? error.message : String(error)) }],
      artifactNames: DEFAULT_ARTIFACT_NAMES,
      gateEvidence: null,
      packageName: null,
      version: null,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }
}

main();
