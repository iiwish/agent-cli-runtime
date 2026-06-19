#!/usr/bin/env node
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const node = process.execPath;

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`command failed: ${command} ${args.join(" ")}`);
  }
  return result.stdout ?? "";
}

function writeNodeBin(dir, name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!${node}\n${body}`, "utf8");
  chmodSync(file, 0o755);
  return file;
}

function createFakeBins(parent) {
  const binDir = path.join(parent, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const codex = writeNodeBin(binDir, "codex", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli dogfood-fake"); process.exit(0); }
if (args[0] === "debug" && args[1] === "models") { console.log(JSON.stringify({ models: [{ slug: "gpt-dogfood", display_name: "GPT Dogfood" }] })); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "thread.started" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "agent-runtime codex smoke ok" } }));
});
`);
  const claude = writeNodeBin(binDir, "claude", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Claude Code dogfood-fake"); process.exit(0); }
if (args[0] === "-p" && args[1] === "--help") { console.log("--include-partial-messages\\n--add-dir"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "system" }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "agent-runtime claude smoke ok" }] } }));
});
`);
  const opencode = writeNodeBin(binDir, "opencode", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("opencode dogfood-fake"); process.exit(0); }
if (args[0] === "models") { console.log("openai/gpt-dogfood"); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "step_start" }));
  console.log(JSON.stringify({ type: "text", part: { text: "agent-runtime opencode smoke ok" } }));
});
`);
  writeNodeBin(binDir, "opencode-cli", `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("opencode dogfood-fake"); process.exit(0); }
if (args[0] === "models") { console.log("openai/gpt-dogfood"); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "step_start" }));
  console.log(JSON.stringify({ type: "text", part: { text: "agent-runtime opencode smoke ok" } }));
});
`);
  return {
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    CODEX_BIN: codex,
    CLAUDE_BIN: claude,
    OPENCODE_BIN: opencode,
  };
}

function runCli(args, options = {}) {
  return run(node, ["./dist/cli/main.js", ...args], options);
}

function installSmoke() {
  const tmp = mkdtempSync(path.join(tmpdir(), "agent-runtime-dogfood-"));
  const packText = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp], { capture: true });
  const [packInfo] = JSON.parse(packText);
  const tarball = path.join(tmp, packInfo.filename);
  run("npm", ["init", "-y"], { cwd: tmp, capture: true });
  run("npm", ["install", tarball, "--no-save", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tmp });

  const fakeEnv = { ...process.env, ...createFakeBins(tmp) };
  const installedCli = path.join(tmp, "node_modules", ".bin", "agent-runtime");
  run(node, ["-e", "const m = await import('agent-cli-runtime'); if (typeof m.createAgentRuntime !== 'function') process.exit(1); console.log(typeof m.createAgentRuntime);"], { cwd: tmp });
  run(node, [installedCli, "agents", "--json"], { cwd: tmp, env: fakeEnv });
  run(node, [installedCli, "doctor", "--json"], { cwd: tmp, env: fakeEnv });
  run(node, [installedCli, "smoke", "--mode", "fixtures", "--json"], { cwd: tmp, env: fakeEnv });
  run(node, [installedCli, "conformance", "--mode", "fixtures", "--json"], { cwd: tmp, env: fakeEnv });
  run(node, [installedCli, "conformance", "--mode", "fake", "--json"], { cwd: tmp, env: fakeEnv });
}

run("npm", ["run", "build"]);
runCli(["conformance", "--mode", "fixtures", "--json"]);
runCli(["conformance", "--mode", "fake", "--json"]);
runCli(["conformance", "--mode", "real", "--agent", "all", "--json"]);
runCli(["smoke", "--mode", "fixtures", "--json"]);
runCli(["agents", "--json"]);
runCli(["doctor", "--json"]);
run(node, ["examples/library-run.js"]);
run(node, ["examples/library-goal.js"]);
run("npm", ["pack", "--dry-run"]);
installSmoke();
