#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCHEMA_VERSION = "agent-cli-runtime.publishedVerification.v1";
const PACKAGE_SOURCE = "npm-registry";
const DEFAULT_OUT_DIR = "published-verification";

const gateCommands = [
  {
    name: "published-smoke",
    script: "smoke:published",
    command: "npm run smoke:published",
    args: ["run", "--silent", "smoke:published"],
  },
  {
    name: "published-daemon",
    script: "published:daemon:verify",
    command: "npm run published:daemon:verify",
    args: ["run", "--silent", "published:daemon:verify"],
  },
  {
    name: "published-adapters",
    script: "published:adapters:verify",
    command: "npm run published:adapters:verify",
    args: ["run", "--silent", "published:adapters:verify"],
  },
  {
    name: "post-alpha-release",
    script: "release:post-alpha:verify",
    command: "npm run release:post-alpha:verify",
    args: ["run", "--silent", "release:post-alpha:verify"],
  },
];

function parseArgs(argv) {
  const options = { outDir: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      options.outDir = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/create-published-verification-evidence.mjs [--out-dir <dir>]

Runs post-publish verification gates against the npm registry package and writes
a redacted summary artifact. The workflow is audit-only and never performs a
registry write or authenticated real agent run.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }
  if (argv.includes("--out-dir") && !options.outDir) throw new Error("Missing value for --out-dir");
  return options;
}

function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/sk-?[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=.:-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(/\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/giu, "[REDACTED_ENV]=[REDACTED]")
    .replace(/\/private\/tmp\/[^\s"']+/gu, "<path>")
    .replace(/\/tmp\/[^\s"']+/gu, "<path>")
    .replace(/\/var\/folders\/[^\s"']+/gu, "<path>")
    .replace(/\/Users\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "Users/[REDACTED]")
    .replace(/\/home\/[^/\s"']+(?:\/[^\s"']*)?/gu, "/" + "home/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/gu, "C:" + "\\Users\\[REDACTED]");
}

function sanitize(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), sanitize(item)]));
  }
  return value;
}

function containsUnsafe(value) {
  const text = JSON.stringify(value);
  return [
    process.cwd(),
    process.env.HOME,
    "/tmp/",
    "/private/tmp/",
    "/var/folders/",
    "Bearer " + "B".repeat(20),
    "sk-" + "A".repeat(24),
    "P5_PUBLISHED_ADAPTER_COMPAT_PROMPT_",
  ].filter(Boolean).some((needle) => text.includes(needle)) ||
    /\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/iu.test(text) ||
    /\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Z]:\\Users\\/u.test(text);
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function runGate(gate) {
  const started = Date.now();
  const result = spawnSync("npm", gate.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const durationMs = Date.now() - started;
  const payload = parseJson(result.stdout ?? "");
  const diagnostics = payload?.diagnostics === undefined
    ? []
    : Array.isArray(payload.diagnostics)
      ? payload.diagnostics
      : [payload.diagnostics];
  const ok = result.status === 0 && payload?.ok === true;
  return {
    name: gate.name,
    script: gate.script,
    command: gate.command,
    ok,
    schemaVersion: typeof payload?.schemaVersion === "string" ? payload.schemaVersion : null,
    durationMs,
    packageSource: typeof payload?.packageSource === "string" ? payload.packageSource : null,
    summary: summarizeGatePayload(payload),
    diagnostics: sanitize(diagnostics),
  };
}

function summarizeGatePayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const summary = {
    packageName: payload.packageName ?? undefined,
    version: payload.version ?? undefined,
    packageSource: payload.packageSource ?? undefined,
    checks: payload.checks ?? undefined,
    agents: Array.isArray(payload.agents)
      ? payload.agents.map((agent) => ({
          adapter: agent.adapter,
          terminalStatus: agent.terminalStatus,
          expectedTextMatched: agent.expectedTextMatched,
          invocationShapeMatched: agent.invocationShapeMatched,
          promptInArgv: agent.promptInArgv,
          diagnosticsCount: agent.diagnosticsCount,
        }))
      : undefined,
    npm: payload.npm
      ? {
          distTags: payload.npm.distTags,
          registryShasumMatches: payload.npm.registryShasumMatches,
          registryIntegrityPresent: payload.npm.registryIntegrityPresent,
          dist: payload.npm.dist
            ? {
                tarball: typeof payload.npm.dist.tarball === "string" ? path.basename(new URL(payload.npm.dist.tarball).pathname) : null,
                shasumPresent: typeof payload.npm.dist.shasum === "string",
                integrityPresent: typeof payload.npm.dist.integrity === "string",
              }
            : undefined,
        }
      : undefined,
    githubRelease: payload.githubRelease
      ? {
          tagName: payload.githubRelease.tagName,
          isPrerelease: payload.githubRelease.isPrerelease,
          isDraft: payload.githubRelease.isDraft,
          tarballAsset: payload.githubRelease.tarballAsset,
        }
      : undefined,
    comparison: payload.comparison
      ? {
          gzipHashesMatch: payload.comparison.gzipHashesMatch,
          expectedDifferentGzipPackaging: payload.comparison.expectedDifferentGzipPackaging,
          acceptable: payload.comparison.acceptable,
          unpackedPackage: payload.comparison.unpackedPackage,
        }
      : undefined,
    noAuthenticatedRealRun: payload.noAuthenticatedRealRun ?? undefined,
  };
  return sanitize(Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined)));
}

function runRegistryView(packageName, version) {
  const command = `npm view ${packageName}@${version} version dist-tags dist --json`;
  const started = Date.now();
  const result = spawnSync("npm", ["view", `${packageName}@${version}`, "version", "dist-tags", "dist", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const durationMs = Date.now() - started;
  const payload = parseJson(result.stdout ?? "");
  return {
    command,
    ok: result.status === 0 && payload !== null,
    durationMs,
    summary: normalizeRegistryPayload(payload),
    diagnostics: result.status === 0
      ? []
      : [{ code: "npm_view_failed", message: "npm registry metadata lookup failed" }],
  };
}

function runRegistryPackageDocsInspection(packageName, version) {
  const packageSpec = `${packageName}@${version}`;
  const command = `node ./scripts/check-packaged-docs.mjs --package-spec ${packageSpec}`;
  const started = Date.now();
  const result = spawnSync(process.execPath, ["./scripts/check-packaged-docs.mjs", "--package-spec", packageSpec], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const durationMs = Date.now() - started;
  const payload = parseJson(result.stdout ?? "");
  return {
    command,
    ok: result.status === 0 && payload?.ok === true,
    durationMs,
    schemaVersion: typeof payload?.schemaVersion === "string" ? payload.schemaVersion : null,
    packageSource: typeof payload?.packageSource === "string" ? payload.packageSource : null,
    version: typeof payload?.version === "string" ? payload.version : null,
    inspectedDocs: Array.isArray(payload?.docs) ? payload.docs.map((doc) => ({ path: doc.path, ok: doc.ok })) : [],
    diagnostics: sanitize(payload?.diagnostics ?? [{ code: "registry_packaged_docs_failed", message: "registry package docs inspection failed" }]),
    noAlpha3UnpublishedClaim: payload?.noAlpha3UnpublishedClaim === true,
    noDryRunStopPoint: payload?.noDryRunStopPoint === true,
    noPublishReadyCandidate: payload?.noPublishReadyCandidate === true,
    noOldDistTagClaim: payload?.noOldDistTagClaim === true,
  };
}

function normalizeRegistryPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return sanitize({
    version: payload.version ?? null,
    distTags: payload["dist-tags"] ?? payload.distTags ?? null,
    dist: payload.dist
      ? {
          fileCount: payload.dist.fileCount ?? null,
          shasumPresent: typeof payload.dist.shasum === "string",
          integrityPresent: typeof payload.dist.integrity === "string",
          tarball: typeof payload.dist.tarball === "string" ? path.basename(new URL(payload.dist.tarball).pathname) : null,
        }
      : null,
  });
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return path.basename(file);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const gates = gateCommands.map(runGate);
  const registry = runRegistryView(packageJson.name, packageJson.version);
  const registryPackageDocsInspection = runRegistryPackageDocsInspection(packageJson.name, packageJson.version);
  const diagnostics = [
    ...gates.flatMap((gate) => gate.ok ? [] : [{ code: "gate_failed", message: `${gate.command} did not pass`, gate: gate.name }]),
    ...registry.diagnostics,
    ...(registryPackageDocsInspection.ok ? [] : [{ code: "registry_packaged_docs_failed", message: "Published package docs inspection did not pass" }]),
  ];
  const summary = {
    schemaVersion: SCHEMA_VERSION,
    ok: gates.every((gate) => gate.ok) && registry.ok && registryPackageDocsInspection.ok,
    packageName: packageJson.name,
    version: packageJson.version,
    gitSha: gitSha(),
    checkedAt: new Date().toISOString(),
    packageSource: PACKAGE_SOURCE,
    gates,
    registry,
    registryPackageDocsInspection,
    diagnostics: sanitize(diagnostics),
    noAuthenticatedRealRun: true,
    noNpmPublish: true,
    noNpmToken: true,
  };
  if (containsUnsafe(summary)) throw new Error("published verification summary contains unsafe unredacted content");
  const summaryPath = path.join(outDir, "published-verification.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: summary.ok,
    outDir: displayPath(outDir),
    summary: path.basename(summaryPath),
    schemaVersion: summary.schemaVersion,
  }, null, 2)}\n`);
  if (!summary.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    diagnostics: [{ code: "published_verification_error", message: redact(error instanceof Error ? error.message : String(error)) }],
    noAuthenticatedRealRun: true,
    noNpmPublish: true,
    noNpmToken: true,
  }, null, 2)}\n`);
  process.exit(1);
}
