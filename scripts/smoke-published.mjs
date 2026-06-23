#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCHEMA_VERSION = "agent-cli-runtime.publishedSmoke.v1";
const DEFAULT_PACKAGE = "agent-cli-runtime";

function parseArgs(argv) {
  const options = { packageName: DEFAULT_PACKAGE, version: undefined, keepTemp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package") options.packageName = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/smoke-published.mjs [--version <version>]

Installs the published npm package into a temporary consumer and verifies:
- ESM import: import { createAgentRuntime } from "agent-cli-runtime"
- CLI JSON parse: agent-runtime agents --json

This smoke does not run real Codex/Claude/OpenCode agent executions.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }
  for (const [name, value] of [
    ["--package", options.packageName],
    ["--version", options.version],
  ]) {
    if (value === undefined && argv.includes(name)) throw new Error(`Missing value for ${name}`);
  }
  return options;
}

function redact(value) {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(/\/Users\/[^/\s]+/gu, "/" + "Users/[REDACTED]")
    .replace(/\/home\/[^/\s]+/gu, "/" + "home/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gu, "C:" + "\\Users\\[REDACTED]");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`command failed: ${command} ${args.map((arg) => redact(arg)).join(" ")}\n${redact(output)}`);
  }
  return result.stdout ?? "";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(run(process.execPath, ["-e", "process.stdout.write(require('node:fs').readFileSync('package.json', 'utf8'))"], {
    cwd: process.cwd(),
  }));
  const version = options.version ?? packageJson.version;
  const spec = `${options.packageName}@${version}`;
  const tmp = mkdtempSync(path.join(tmpdir(), "agent-runtime-published-smoke-"));

  try {
    writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2), "utf8");
    run("npm", ["install", spec, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tmp });
    const importCheck = run(process.execPath, [
      "-e",
      "import('agent-cli-runtime').then((m) => { if (typeof m.createAgentRuntime !== 'function') process.exit(2); console.log('ok'); }).catch(() => process.exit(1));",
    ], { cwd: tmp }).trim();
    const cliPath = path.join(tmp, "node_modules", ".bin", "agent-runtime");
    const agents = JSON.parse(run(process.execPath, [cliPath, "agents", "--json"], { cwd: tmp }));
    const checks = {
      esmImportCreateAgentRuntime: importCheck === "ok",
      cliAgentsJsonParse: Array.isArray(agents),
      cliAgentsCount: Array.isArray(agents) ? agents.length : null,
    };
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: checks.esmImportCreateAgentRuntime && checks.cliAgentsJsonParse,
      packageName: options.packageName,
      version,
      packageSource: "npm-registry",
      checks,
      noAuthenticatedRealRun: true,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
  } finally {
    if (!options.keepTemp) rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    diagnostics: [{ code: "published_smoke_error", message: redact(error instanceof Error ? error.message : String(error)) }],
    noAuthenticatedRealRun: true,
  }, null, 2)}\n`);
  process.exit(1);
}
