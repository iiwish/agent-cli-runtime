#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCHEMA_VERSION = "agent-cli-runtime.packageContentEquivalence.v1";
const AUTH_ENV_PATTERN =
  /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/giu;

function parseArgs(argv) {
  const options = {
    baseRef: null,
    headRef: null,
    out: null,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-ref") {
      options.baseRef = requireValue(argv, ++index, arg);
    } else if (arg === "--head-ref") {
      options.headRef = requireValue(argv, ++index, arg);
    } else if (arg === "--out" || arg === "--output") {
      options.out = requireValue(argv, ++index, arg);
    } else if (arg === "--self-test") {
      options.selfTest = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }

  if (options.selfTest) return options;
  if (!options.baseRef) throw new Error("--base-ref is required");
  if (!options.headRef) throw new Error("--head-ref is required");
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/verify-package-content-equivalence.mjs --base-ref <sha-or-ref> --head-ref <sha-or-ref> [--out <file>]

Compares npm package-visible file lists and file content for two git refs. The result is repo-only release evidence and does not publish npm, create GitHub Releases, configure npm credentials, or run authenticated agents.

Options:
  --base-ref <sha-or-ref>  Git ref used as the existing release evidence target.
  --head-ref <sha-or-ref>  Git ref used as the newer repo state.
  --out <file>            Optional output file for the redacted JSON result.
  --self-test             Run offline verifier fixtures without git worktrees or npm commands.
`);
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
    .replace(AUTH_ENV_PATTERN, "[REDACTED_ENV]=[REDACTED]")
    .replace(/\/(?:private\/)?tmp\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/var\/folders\/[^\s"']*/gu, "<temp-path>")
    .replace(/\/Users\/[^/\s"']+(?:\/[^\s"']*)?/gu, "<home-path>")
    .replace(/\/home\/[^/\s"']+(?:\/[^\s"']*)?/gu, "<home-path>")
    .replace(/[A-Z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/gu, "<home-path>");
}

function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runChecked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const error = new Error(options.message ?? `command failed: ${command}`);
    error.code = options.code ?? "command_failed";
    throw error;
  }
  return result.stdout;
}

function resolveCommit(ref) {
  const stdout = runChecked("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    code: "invalid_git_ref",
    message: "Unable to resolve git ref to a commit.",
  });
  const sha = stdout.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(sha)) {
    const error = new Error("Git ref did not resolve to a full commit SHA.");
    error.code = "invalid_git_ref";
    throw error;
  }
  return sha;
}

function collectPackageSnapshot(refLabel, sha, repoRoot) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "agent-cli-runtime-package-content-"));
  const worktreeDir = path.join(tempRoot, "checkout");
  let worktreeAdded = false;

  try {
    runChecked("git", ["worktree", "add", "--detach", "--quiet", worktreeDir, sha], {
      cwd: repoRoot,
      code: "worktree_checkout_failed",
      message: `Unable to create temporary checkout for ${refLabel}.`,
    });
    worktreeAdded = true;

    ensureNodeModules(worktreeDir, repoRoot);
    runChecked("npm", ["run", "--silent", "build"], {
      cwd: worktreeDir,
      code: "package_build_failed",
      message: `Unable to build package artifacts for ${refLabel}.`,
    });

    const packText = runChecked("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: worktreeDir,
      code: "npm_pack_failed",
      message: `Unable to collect npm package file list for ${refLabel}.`,
    });
    const packEntries = parsePackJson(packText);
    const entry = packEntries[0];
    const files = entry.files.map((file) => {
      const filePath = normalizePackagePath(file.path);
      const bytes = readFileSync(path.join(worktreeDir, filePath));
      return {
        path: filePath,
        size: bytes.length,
        mode: typeof file.mode === "number" ? file.mode : null,
        sha256: sha256(bytes),
      };
    }).sort((left, right) => left.path.localeCompare(right.path));

    return snapshotFromFiles({
      ref: refLabel,
      sha,
      packageName: typeof entry.name === "string" ? entry.name : null,
      packageVersion: typeof entry.version === "string" ? entry.version : null,
      files,
    });
  } finally {
    if (worktreeAdded) {
      run("git", ["worktree", "remove", "--force", worktreeDir], { cwd: repoRoot });
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function ensureNodeModules(worktreeDir, repoRoot) {
  const worktreeNodeModules = path.join(worktreeDir, "node_modules");
  if (existsSync(worktreeNodeModules)) return;
  const repoNodeModules = path.join(repoRoot, "node_modules");
  if (existsSync(repoNodeModules)) {
    const type = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(repoNodeModules, worktreeNodeModules, type);
    return;
  }
  runChecked("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: worktreeDir,
    code: "npm_ci_failed",
    message: "Unable to install package dependencies in temporary checkout.",
  });
}

function parsePackJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const error = new Error("npm pack did not produce valid JSON.");
    error.code = "invalid_pack_json";
    throw error;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !Array.isArray(parsed[0]?.files)) {
    const error = new Error("npm pack JSON must contain one package entry with a files array.");
    error.code = "invalid_pack_json";
    throw error;
  }
  return parsed;
}

function normalizePackagePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0 || path.isAbsolute(filePath) || filePath.includes("..") || filePath.includes("\\")) {
    const error = new Error("npm pack reported an unsafe package path.");
    error.code = "unsafe_package_path";
    throw error;
  }
  return filePath.split("/").filter(Boolean).join("/");
}

function snapshotFromFiles({ ref, sha, packageName, packageVersion, files }) {
  const digestInput = files.map((file) => ({
    path: file.path,
    mode: file.mode,
    size: file.size,
    sha256: file.sha256,
  }));
  const digest = sha256(Buffer.from(JSON.stringify(digestInput), "utf8"));
  return {
    ref,
    sha,
    packageName,
    packageVersion,
    fileCount: files.length,
    digest,
    files,
  };
}

function compareSnapshots(base, head, repoChangedFiles = []) {
  const baseFiles = new Map(base.files.map((file) => [file.path, file]));
  const headFiles = new Map(head.files.map((file) => [file.path, file]));
  const allPaths = [...new Set([...baseFiles.keys(), ...headFiles.keys()])].sort();
  const changedPackageFiles = [];

  for (const filePath of allPaths) {
    const baseFile = baseFiles.get(filePath);
    const headFile = headFiles.get(filePath);
    if (!baseFile && headFile) {
      changedPackageFiles.push({
        path: filePath,
        status: "added",
        baseSha256: null,
        headSha256: headFile.sha256,
      });
    } else if (baseFile && !headFile) {
      changedPackageFiles.push({
        path: filePath,
        status: "removed",
        baseSha256: baseFile.sha256,
        headSha256: null,
      });
    } else if (baseFile && headFile && (baseFile.sha256 !== headFile.sha256 || baseFile.mode !== headFile.mode || baseFile.size !== headFile.size)) {
      changedPackageFiles.push({
        path: filePath,
        status: "modified",
        baseSha256: baseFile.sha256,
        headSha256: headFile.sha256,
      });
    }
  }

  const packageContentEqual = changedPackageFiles.length === 0 && base.digest === head.digest;
  return {
    packageContentEqual,
    changedPackageFiles,
    evidenceOnlyDrift: packageContentEqual && repoChangedFiles.length > 0,
    freshReleaseCandidateRequired: !packageContentEqual,
  };
}

function repoChangedFiles(baseSha, headSha) {
  if (baseSha === headSha) return [];
  const stdout = runChecked("git", ["diff", "--name-only", `${baseSha}..${headSha}`], {
    code: "git_diff_failed",
    message: "Unable to inspect changed repository files between refs.",
  });
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !path.isAbsolute(file) && !file.includes(".."))
    .sort();
}

function buildResult(options) {
  const repoRoot = process.cwd();
  const baseRef = redact(options.baseRef);
  const headRef = redact(options.headRef);
  const baseSha = resolveCommit(options.baseRef);
  const headSha = resolveCommit(options.headRef);
  const changedRepoFiles = repoChangedFiles(baseSha, headSha);
  const base = collectPackageSnapshot(baseRef, baseSha, repoRoot);
  const head = collectPackageSnapshot(headRef, headSha, repoRoot);
  const comparison = compareSnapshots(base, head, changedRepoFiles);
  const diagnostics = [];
  if (comparison.freshReleaseCandidateRequired) {
    diagnostics.push({
      code: "package_content_drift",
      severity: "decision",
      message: "Package-visible content differs between refs; fresh release-candidate evidence is required before treating the head ref as a release target.",
    });
  } else if (comparison.evidenceOnlyDrift) {
    diagnostics.push({
      code: "evidence_only_drift",
      severity: "decision",
      message: "Repository changes are outside the npm package content; fresh release-candidate evidence is not required for package equivalence.",
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    baseRef,
    headRef,
    baseSha,
    headSha,
    packageName: head.packageName ?? base.packageName,
    packageVersion: head.packageVersion ?? base.packageVersion,
    basePackageName: base.packageName,
    headPackageName: head.packageName,
    basePackageVersion: base.packageVersion,
    headPackageVersion: head.packageVersion,
    packageContentEqual: comparison.packageContentEqual,
    basePackageDigest: base.digest,
    headPackageDigest: head.digest,
    baseFileCount: base.fileCount,
    headFileCount: head.fileCount,
    changedPackageFiles: comparison.changedPackageFiles,
    evidenceOnlyDrift: comparison.evidenceOnlyDrift,
    freshReleaseCandidateRequired: comparison.freshReleaseCandidateRequired,
    repoChangedFileCount: changedRepoFiles.length,
    diagnostics,
    boundary: {
      repoOnlyEvidence: true,
      comparedNpmPackageContentOnly: true,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
      noGithubRelease: true,
      noTarballGzipDigestDecision: true,
      noRawStdoutStderr: true,
      noRawCliOutput: true,
      noPrivatePath: true,
      noLocalTempPath: true,
      noTokenValue: true,
      noBearerValue: true,
      noAuthEnvAssignment: true,
    },
  };
}

function selfTestResult() {
  const base = fixtureSnapshot("base", {
    "package.json": "{\"name\":\"agent-cli-runtime\",\"version\":\"0.1.0-alpha.3\"}\n",
    "README.md": "runtime docs\n",
    "docs/ssot.md": "ssot\n",
    "dist/index.js": "export const value = 1;\n",
  });
  const same = fixtureSnapshot("same", Object.fromEntries(base.files.map((file) => [file.path, file.fixtureText])));
  const readmeDrift = fixtureSnapshot("readme-drift", {
    "package.json": "{\"name\":\"agent-cli-runtime\",\"version\":\"0.1.0-alpha.3\"}\n",
    "README.md": "runtime docs changed\n",
    "docs/ssot.md": "ssot\n",
    "dist/index.js": "export const value = 1;\n",
  });
  const docsDrift = fixtureSnapshot("docs-drift", {
    "package.json": "{\"name\":\"agent-cli-runtime\",\"version\":\"0.1.0-alpha.3\"}\n",
    "README.md": "runtime docs\n",
    "docs/ssot.md": "ssot changed\n",
    "dist/index.js": "export const value = 1;\n",
  });
  const packageJsonDrift = fixtureSnapshot("package-json-drift", {
    "package.json": "{\"name\":\"agent-cli-runtime\",\"version\":\"0.1.0-alpha.4\"}\n",
    "README.md": "runtime docs\n",
    "docs/ssot.md": "ssot\n",
    "dist/index.js": "export const value = 1;\n",
  });

  const sameComparison = compareSnapshots(base, same, []);
  const evidenceOnlyComparison = compareSnapshots(base, same, [".release-evidence/p8-8-package-content-equivalence.json"]);
  const readmeComparison = compareSnapshots(base, readmeDrift, ["README.md"]);
  const docsComparison = compareSnapshots(base, docsDrift, ["docs/ssot.md"]);
  const packageJsonComparison = compareSnapshots(base, packageJsonDrift, ["package.json"]);
  const authEnvAssignment = `${"NODE_" + "AUTH_TOKEN"}=secret`;
  const userPath = `/${"Users"}/example/leak`;
  const leaked = redact(`/tmp/leak /private/tmp/leak /var/folders/leak ${userPath} Bearer ${"B".repeat(20)} sk-${"A".repeat(24)} ${authEnvAssignment}`);

  const cases = [
    {
      name: "same ref package content is equal",
      ok: sameComparison.packageContentEqual === true && sameComparison.freshReleaseCandidateRequired === false,
    },
    {
      name: "release evidence only fixture is package-content equal",
      ok: evidenceOnlyComparison.packageContentEqual === true && evidenceOnlyComparison.evidenceOnlyDrift === true && evidenceOnlyComparison.freshReleaseCandidateRequired === false,
    },
    {
      name: "README fixture reports package-content drift",
      ok: readmeComparison.packageContentEqual === false && readmeComparison.changedPackageFiles.some((file) => file.path === "README.md"),
    },
    {
      name: "docs fixture reports package-content drift",
      ok: docsComparison.packageContentEqual === false && docsComparison.changedPackageFiles.some((file) => file.path === "docs/ssot.md"),
    },
    {
      name: "package.json fixture reports package-content drift",
      ok: packageJsonComparison.packageContentEqual === false && packageJsonComparison.changedPackageFiles.some((file) => file.path === "package.json"),
    },
    {
      name: "redaction removes local paths and credentials",
      ok: !/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|Bearer\s+[A-Za-z0-9+/_=-]{10,}|sk-[A-Za-z0-9_-]{20,}|NODE_AUTH_TOKEN=/u.test(leaked),
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    ok: cases.every((testCase) => testCase.ok),
    baseRef: "self-test-base",
    headRef: "self-test-head",
    baseSha: null,
    headSha: null,
    packageName: "agent-cli-runtime",
    packageVersion: "0.1.0-alpha.3",
    basePackageName: "agent-cli-runtime",
    headPackageName: "agent-cli-runtime",
    basePackageVersion: "0.1.0-alpha.3",
    headPackageVersion: "0.1.0-alpha.3",
    packageContentEqual: true,
    basePackageDigest: base.digest,
    headPackageDigest: same.digest,
    baseFileCount: base.fileCount,
    headFileCount: same.fileCount,
    changedPackageFiles: [],
    evidenceOnlyDrift: false,
    freshReleaseCandidateRequired: false,
    repoChangedFileCount: 0,
    diagnostics: [],
    selfTest: { cases },
    boundary: {
      repoOnlyEvidence: true,
      comparedNpmPackageContentOnly: true,
      noAuthenticatedRealRun: true,
      noNpmPublish: true,
      noNpmToken: true,
      noGithubRelease: true,
      noTarballGzipDigestDecision: true,
      noRawStdoutStderr: true,
      noRawCliOutput: true,
      noPrivatePath: true,
      noLocalTempPath: true,
      noTokenValue: true,
      noBearerValue: true,
      noAuthEnvAssignment: true,
    },
  };
}

function fixtureSnapshot(ref, filesByPath) {
  const files = Object.entries(filesByPath).map(([filePath, text]) => {
    const bytes = Buffer.from(text, "utf8");
    return {
      path: filePath,
      size: bytes.length,
      mode: 420,
      sha256: sha256(bytes),
      fixtureText: text,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const packageJson = JSON.parse(filesByPath["package.json"]);
  return snapshotFromFiles({
    ref,
    sha: null,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    files,
  });
}

function failureResult(options, diagnostics) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    baseRef: options?.baseRef ? redact(options.baseRef) : null,
    headRef: options?.headRef ? redact(options.headRef) : null,
    baseSha: null,
    headSha: null,
    packageName: null,
    packageVersion: null,
    packageContentEqual: false,
    basePackageDigest: null,
    headPackageDigest: null,
    baseFileCount: 0,
    headFileCount: 0,
    changedPackageFiles: [],
    evidenceOnlyDrift: false,
    freshReleaseCandidateRequired: true,
    diagnostics,
  };
}

function writeResult(result, out) {
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (out) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out, json, "utf8");
  }
  process.stdout.write(json);
}

function diagnosticFromError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "verification_error",
    message: redact(error instanceof Error ? error.message : String(error)),
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const result = options.selfTest ? selfTestResult() : buildResult(options);
    writeResult(result, options.out);
    if (!result.ok) process.exit(1);
  } catch (error) {
    const result = failureResult(options, [diagnosticFromError(error)]);
    writeResult(result, options?.out);
    process.exit(1);
  }
}

main();
