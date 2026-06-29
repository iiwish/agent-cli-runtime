#!/usr/bin/env node
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "agent-cli-runtime.releaseArtifactNormalization.v1";
const EXPECTED_FILES = [
  {
    artifactName: "agent-cli-runtime-pack-metadata",
    label: "npm-pack.json",
    outputName: "npm-pack.json",
    matches: (file) => file === "npm-pack.json",
  },
  {
    artifactName: "agent-cli-runtime-package-files",
    label: "package-files.txt",
    outputName: "package-files.txt",
    matches: (file) => file === "package-files.txt",
  },
  {
    artifactName: "agent-cli-runtime-gate-evidence",
    label: "gate-evidence.json",
    outputName: "gate-evidence.json",
    matches: (file) => file === "gate-evidence.json",
  },
  {
    artifactName: "agent-cli-runtime-release-verification",
    label: "release-verification.json",
    outputName: "release-verification.json",
    matches: (file) => file === "release-verification.json",
  },
  {
    artifactName: "agent-cli-runtime-tarball",
    label: "agent-cli-runtime-*.tgz",
    outputName: null,
    matches: (file) => /^agent-cli-runtime-[^/\\]+\.tgz$/u.test(file),
  },
];

function parseArgs(argv) {
  const options = {
    downloadDir: null,
    outDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--download-dir") {
      options.downloadDir = requireValue(argv, ++index, arg);
    } else if (arg === "--out-dir") {
      options.outDir = requireValue(argv, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/normalize-release-artifacts.mjs --download-dir <dir> --out-dir <dir>

Normalizes GitHub Actions release-candidate artifacts downloaded by gh run download
into one flat directory readable by npm run release:verify.
`);
      process.exit(0);
    } else {
      throw usageError(`Unknown argument: ${redact(arg)}`);
    }
  }

  if (!options.downloadDir) throw usageError("--download-dir is required");
  if (!options.outDir) throw usageError("--out-dir is required");
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw usageError(`${flag} requires a value`);
  return value;
}

function usageError(message) {
  const error = new Error(message);
  error.code = "usage_error";
  return error;
}

function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/sk-[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(authEnvAssignmentPattern(), "[REDACTED_ENV]=[REDACTED]")
    .replace(/\/(?:private\/)?tmp\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/var\/folders\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/Users\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "Users/[REDACTED]")
    .replace(/\/home\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "home/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/gu, "C:" + "\\Users\\[REDACTED]");
}

function authEnvAssignmentPattern(flags = "giu") {
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

function displayDir(dir, externalPlaceholder) {
  const resolved = path.resolve(dir);
  const relative = path.relative(process.cwd(), resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return normalizePath(relative);
  }
  if (resolved === process.cwd()) return ".";
  return externalPlaceholder;
}

function normalizePath(file) {
  return file.split(path.sep).join("/");
}

function relativeTo(baseDir, file) {
  return normalizePath(path.relative(baseDir, file));
}

function walkFiles(dir, diagnostics) {
  if (!existsSync(dir)) {
    diagnostics.push({
      code: "download_dir_missing",
      message: "Downloaded artifact directory does not exist.",
    });
    return [];
  }

  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      } else {
        diagnostics.push({
          code: "unsupported_artifact_entry",
          message: "Downloaded artifact entry is not a regular file.",
          file: relativeTo(dir, full),
        });
      }
    }
  }
  walk(dir);
  return files.sort((left, right) => relativeTo(dir, left).localeCompare(relativeTo(dir, right)));
}

function classifyFiles(downloadDir, files, diagnostics) {
  const matches = new Map(EXPECTED_FILES.map((expected) => [expected.label, []]));
  const unknownFiles = [];

  for (const file of files) {
    const basename = path.basename(file);
    const expected = EXPECTED_FILES.find((candidate) => candidate.matches(basename));
    if (!expected) {
      unknownFiles.push(file);
      continue;
    }
    matches.get(expected.label).push(file);
  }

  for (const expected of EXPECTED_FILES) {
    const candidates = matches.get(expected.label);
    if (candidates.length === 0) {
      diagnostics.push({
        code: "missing_artifact_file",
        message: "Missing expected release artifact file.",
        artifactName: expected.artifactName,
        file: expected.label,
      });
    } else if (candidates.length > 1) {
      diagnostics.push({
        code: "duplicate_artifact_file",
        message: "Duplicate release artifact file.",
        artifactName: expected.artifactName,
        file: expected.label,
        files: candidates.map((candidate) => relativeTo(downloadDir, candidate)),
      });
    }
  }

  for (const file of unknownFiles) {
    diagnostics.push({
      code: "unknown_artifact_file",
      message: "Unknown release artifact file.",
      file: relativeTo(downloadDir, file),
    });
  }

  return EXPECTED_FILES.map((expected) => {
    const file = matches.get(expected.label)[0] ?? null;
    return {
      artifactName: expected.artifactName,
      expectedFile: expected.label,
      source: file === null ? null : relativeTo(downloadDir, file),
      output: file === null ? null : expected.outputName ?? path.basename(file),
      sourcePath: file,
    };
  });
}

function normalizeArtifacts(options) {
  const downloadDir = path.resolve(options.downloadDir);
  const outDir = path.resolve(options.outDir);
  const diagnostics = [];

  if (existsSync(downloadDir)) {
    const stat = lstatSync(downloadDir);
    if (!stat.isDirectory()) {
      diagnostics.push({
        code: "download_dir_not_directory",
        message: "Downloaded artifact path is not a directory.",
      });
    }
  }

  const files = diagnostics.length === 0 ? walkFiles(downloadDir, diagnostics) : [];
  const artifacts = classifyFiles(downloadDir, files, diagnostics);

  if (diagnostics.length === 0) {
    mkdirSync(outDir, { recursive: true });
    for (const artifact of artifacts) {
      copyFileSync(artifact.sourcePath, path.join(outDir, artifact.output));
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    ok: diagnostics.length === 0,
    downloadDir: displayDir(downloadDir, "<external_artifact_dir>"),
    outDir: displayDir(outDir, "<external_output_dir>"),
    artifacts: artifacts.map(({ artifactName, expectedFile, source, output }) => ({
      artifactName,
      expectedFile,
      source,
      output,
    })),
    diagnostics,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const result = normalizeArtifacts(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
  } catch (error) {
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      downloadDir: options?.downloadDir ? displayDir(options.downloadDir, "<external_artifact_dir>") : null,
      outDir: options?.outDir ? displayDir(options.outDir, "<external_output_dir>") : null,
      artifacts: [],
      diagnostics: [{
        code: error?.code === "usage_error" ? "usage_error" : "normalization_error",
        message: redact(error instanceof Error ? error.message : String(error)),
      }],
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }
}

main();
