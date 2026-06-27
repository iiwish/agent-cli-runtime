#!/usr/bin/env node
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCHEMA_VERSION = "agent-cli-runtime.publishedUsability.v1";
const DEFAULT_PACKAGE = "agent-cli-runtime";
const DEFAULT_OUT_FILE = ".release-evidence/p8-1-published-usability.json";
const node = process.execPath;

function parseArgs(argv) {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const options = {
    packageName: DEFAULT_PACKAGE,
    version: manifest.version,
    outFile: DEFAULT_OUT_FILE,
    keepTemp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package") options.packageName = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--out-file") options.outFile = argv[++i];
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/create-published-usability-evidence.mjs [--version <version>] [--out-file <file>]

Installs the published npm package into a clean temporary consumer and writes a
repo-safe usability evidence summary. The summary records command names,
ok/fail state, schema versions where present, and redacted diagnostics only.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }
  for (const [name, value] of [
    ["--package", options.packageName],
    ["--version", options.version],
    ["--out-file", options.outFile],
  ]) {
    if (value === undefined && argv.includes(name)) throw new Error(`Missing value for ${name}`);
  }
  return options;
}

function redact(value) {
  return String(value)
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
  ].filter(Boolean).some((needle) => text.includes(needle)) ||
    /\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/iu.test(text) ||
    /\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Z]:\\Users\\/u.test(text);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function commandResult({ name, command, run, summarize }) {
  const started = Date.now();
  const result = run();
  const durationMs = Date.now() - started;
  const parsed = parseJson(result.stdout ?? "");
  const ok = result.status === 0 && (parsed?.ok === undefined || parsed.ok === true);
  const diagnostics = ok
    ? []
    : [{
        code: `${name}_failed`,
        message: `${command} did not pass`,
        exitCode: result.status ?? null,
        signal: result.signal ?? null,
      }];
  return {
    name,
    command,
    ok,
    schemaVersion: typeof parsed?.schemaVersion === "string" ? parsed.schemaVersion : null,
    durationMs,
    summary: sanitize(summarize?.(parsed) ?? {}),
    diagnostics,
  };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function npmVersion() {
  const result = run("npm", ["--version"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function writeNodeBin(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, `#!${node}\n${body}`, "utf8");
  chmodSync(file, 0o755);
  return file;
}

function createFakeCodexBin(consumerDir) {
  const binDir = path.join(consumerDir, "fake-bin");
  writeNodeBin(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli p8-usability-fake");
  process.exit(0);
}
if (args[0] === "debug" && args[1] === "models") {
  console.log(JSON.stringify({ models: [{ slug: "gpt-p8-fake", display_name: "GPT P8 Fake" }] }));
  process.exit(0);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started" }));
  console.log(JSON.stringify({ type: "turn.started" }));
  if (input.includes("Return strict JSON")) {
    console.log(JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({ tasks: [
          { id: "T001", title: "P8 minimal task", objective: "p8 fake task run", dependencies: [], validationCommands: ["node -e \\"process.exit(0)\\""] }
        ] })
      }
    }));
  } else {
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "p8 fake codex run ok" } }));
  }
  console.log(JSON.stringify({ type: "turn.completed" }));
});
`);
  return binDir;
}

function writeEvidence(file, evidence) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (containsUnsafe(evidence)) throw new Error("published usability evidence contains unsafe unredacted content");
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const spec = `${options.packageName}@${options.version}`;
  const consumerDir = mkdtempSync(path.join(tmpdir(), "agent-runtime-p8-usability-"));
  const commands = [];
  let blocker = null;

  try {
    writeFileSync(path.join(consumerDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2), "utf8");
    commands.push(commandResult({
      name: "npm_install",
      command: `npm install ${spec}`,
      run: () => run("npm", ["install", spec, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: consumerDir }),
      summarize: () => ({ packageSource: "npm-registry" }),
    }));

    const cliPath = path.join(consumerDir, "node_modules", ".bin", "agent-runtime");
    const fakeBin = createFakeCodexBin(consumerDir);
    const fakeEnv = {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      CODEX_BIN: path.join(fakeBin, "codex"),
    };

    commands.push(commandResult({
      name: "esm_import",
      command: "node -e import createAgentRuntime",
      run: () => run(node, ["-e", "import('agent-cli-runtime').then((m) => { console.log(JSON.stringify({ ok: typeof m.createAgentRuntime === 'function' })); }).catch(() => process.exit(1));"], { cwd: consumerDir }),
      summarize: (payload) => ({ createAgentRuntime: payload?.ok === true }),
    }));
    commands.push(commandResult({
      name: "cli_agents_json",
      command: "agent-runtime agents --json",
      run: () => run(node, [cliPath, "agents", "--json"], { cwd: consumerDir, env: fakeEnv }),
      summarize: (payload) => ({ agentsCount: Array.isArray(payload) ? payload.length : null }),
    }));
    commands.push(commandResult({
      name: "cli_doctor_json",
      command: "agent-runtime doctor --json",
      run: () => run(node, [cliPath, "doctor", "--json"], { cwd: consumerDir, env: fakeEnv }),
      summarize: (payload) => ({ ok: payload?.ok === true, agentsCount: Array.isArray(payload?.agents) ? payload.agents.length : null }),
    }));
    commands.push(commandResult({
      name: "cli_conformance_fake",
      command: "agent-runtime conformance --mode fake --json",
      run: () => run(node, [cliPath, "conformance", "--mode", "fake", "--json"], { cwd: consumerDir }),
      summarize: (payload) => ({
        ok: payload?.ok === true,
        summaries: Array.isArray(payload?.summaries) ? payload.summaries.length : Array.isArray(payload?.agents) ? payload.agents.length : null,
      }),
    }));
    commands.push(commandResult({
      name: "cli_run_fake_codex",
      command: "agent-runtime run --agent codex --json",
      run: () => run(node, [cliPath, "run", "--agent", "codex", "--cwd", consumerDir, "--prompt", "p8 run smoke", "--timeout-ms", "5000", "--json"], { cwd: consumerDir, env: fakeEnv }),
      summarize: (payload) => ({ status: payload?.status ?? null, agentId: payload?.agentId ?? null }),
    }));
    commands.push(commandResult({
      name: "cli_goal_fake_codex",
      command: "agent-runtime goal --agent codex --json",
      run: () => run(node, [cliPath, "goal", "--agent", "codex", "--cwd", consumerDir, "--prompt", "p8 minimal goal", "--timeout-ms", "5000", "--json"], { cwd: consumerDir, env: fakeEnv }),
      summarize: (payload) => ({ status: payload?.status ?? null, taskCount: Array.isArray(payload?.tasks) ? payload.tasks.length : null }),
    }));
  } catch (error) {
    blocker = { code: "published_usability_audit_error", message: redact(error instanceof Error ? error.message : String(error)) };
  } finally {
    if (!options.keepTemp) rmSync(consumerDir, { recursive: true, force: true });
  }

  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    ok: blocker === null && commands.every((command) => command.ok),
    packageName: options.packageName,
    version: options.version,
    packageSource: "npm-registry",
    checkedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      npm: npmVersion(),
    },
    cleanTempConsumer: true,
    noLocalSourcePath: true,
    commands,
    diagnostics: sanitize([
      ...(blocker ? [blocker] : []),
      ...commands.flatMap((command) => command.ok ? [] : command.diagnostics),
    ]),
    noAuthenticatedRealRun: true,
    noNpmPublish: true,
    noNpmToken: true,
  };

  writeEvidence(path.resolve(options.outFile), evidence);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    ok: evidence.ok,
    packageName: evidence.packageName,
    version: evidence.version,
    commands: evidence.commands.map((command) => ({ name: command.name, ok: command.ok, schemaVersion: command.schemaVersion })),
    diagnosticsCount: evidence.diagnostics.length,
  }, null, 2)}\n`);
  if (!evidence.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    diagnostics: [{ code: "published_usability_error", message: redact(error instanceof Error ? error.message : String(error)) }],
    noAuthenticatedRealRun: true,
    noNpmPublish: true,
    noNpmToken: true,
  }, null, 2)}\n`);
  process.exit(1);
}
