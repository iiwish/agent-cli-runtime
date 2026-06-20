#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "agent-cli-runtime.releaseVerification.v1";
const DEFAULT_ARTIFACT_NAMES = [
  "agent-cli-runtime-tarball",
  "agent-cli-runtime-pack-metadata",
  "agent-cli-runtime-package-files",
  "agent-cli-runtime-release-verification",
];

const disallowedPathPatterns = [
  { code: "reference_material", pattern: /^\.reference(?:\/|$)/u },
  { code: "tests", pattern: /^tests(?:\/|$)/u },
  { code: "fixture_material", pattern: /(?:^|\/)fixtures?(?:\/|$)/iu },
  { code: "fault_fixtures", pattern: /(?:^|\/)fault-fixtures(?:\/|$)/u },
  { code: "repair_backups", pattern: /(?:^|\/)repair-backups(?:\/|$)/u },
  { code: "raw_corrupt_samples", pattern: /(?:^|\/)raw-corrupt-samples(?:\/|$)/u },
  { code: "raw_real_cli_output", pattern: /(?:^|\/)raw-real-cli-output(?:\/|$)/u },
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
];

function parseArgs(argv) {
  const options = {
    dir: "release-candidate",
    packJson: undefined,
    packageFiles: undefined,
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
      /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/giu,
      "[REDACTED_ENV]=[REDACTED]",
    )
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
    addDiagnostic(diagnostics, "missing_artifact", `Missing ${label}: ${file}`, { path: safeRelative(baseDir, file) });
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

function validate(options) {
  const diagnostics = [];
  const baseDir = path.resolve(options.dir);
  const packJsonPath = path.resolve(options.packJson ?? path.join(baseDir, "npm-pack.json"));
  const packageFilesPath = path.resolve(options.packageFiles ?? path.join(baseDir, "package-files.txt"));
  const packText = readText(packJsonPath, baseDir, diagnostics, "npm pack metadata");
  const packageFilesText = readText(packageFilesPath, baseDir, diagnostics, "package file list");

  if (packText !== undefined) inspectString(packText, diagnostics, "npm pack metadata");
  if (packageFilesText !== undefined) inspectString(packageFilesText, diagnostics, "package file list");

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
      addDiagnostic(diagnostics, "missing_artifact", `Missing tarball: ${tarballPath}`, { path: safeRelative(baseDir, tarballPath) });
    } else {
      tarballSizeBytes = statSync(tarballPath).size;
    }
  }

  const checkedFiles = {
    packMetadata: safeRelative(baseDir, packJsonPath),
    packageFileList: safeRelative(baseDir, packageFilesPath),
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
      packageName: null,
      version: null,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }
}

main();
