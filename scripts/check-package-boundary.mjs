#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`command failed: ${command} ${args.join(" ")}`);
  }
  return result.stdout ?? "";
}

function walk(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    if (entry.isFile()) files.push(full);
  }
  return files;
}

function isLikelyBinary(buffer) {
  const maxScan = Math.min(buffer.length, 4096);
  if (buffer.includes(0)) return true;
  let suspiciousBytes = 0;
  for (let i = 0; i < maxScan; i += 1) {
    const byte = buffer[i];
    const isTextish =
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e) ||
      byte >= 0x80;
    if (!isTextish) suspiciousBytes += 1;
  }
  return maxScan > 0 ? suspiciousBytes / maxScan > 0.2 : false;
}

const packText = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]);
const packEntries = JSON.parse(packText);
const packedFiles = packEntries.flatMap((entry) => entry.files.map((file) => file.path));

const requiredFiles = [
  "dist/index.js",
  "dist/cli/main.js",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "docs/release-checklist.md",
  "docs/production-readiness.md",
  "docs/compatibility.md",
  "examples/cli-dogfood.md",
  "scripts/dogfood.mjs",
];

for (const required of requiredFiles) {
  if (!packedFiles.includes(required)) fail(`package boundary violation: missing ${required}`);
}

const disallowedPathPatterns = [
  /^\.reference(?:\/|$)/u,
  /^tests(?:\/|$)/u,
  /(?:^|\/)fixtures(?:\/|$)/u,
  /(?:^|\/)fault-fixtures(?:\/|$)/u,
  /(?:^|\/)repair-backups(?:\/|$)/u,
  /(?:^|\/)raw-corrupt-samples(?:\/|$)/u,
  /(?:^|\/)raw-real-cli-output(?:\/|$)/u,
  /\/Users\//u,
  /\/home\/[^/\s]+/u,
  /[A-Z]:\\Users\\/u,
  /sk-[A-Za-z0-9_-]{20,}/u,
  /\bBearer\b/u,
];

for (const file of packedFiles) {
  for (const pattern of disallowedPathPatterns) {
    if (pattern.test(file)) fail(`package boundary violation: disallowed packed path ${file}`);
  }
}

const scanRoots = ["examples", "scripts", "docs"].map((dir) => path.join(root, dir));
const textFiles = scanRoots.flatMap(walk).filter((file) => {
  const stat = statSync(file);
  return stat.isFile();
});

const secretPatterns = [
  { name: "OpenAI-style secret", pattern: /sk-[A-Za-z0-9_-]{20,}/u },
  { name: "Bearer value", pattern: /\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/u },
  {
    name: "auth environment assignment value",
    pattern:
      /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/iu,
  },
  { name: "private user path", pattern: /(?:\/Users\/|\/home\/[^<\s/]+|[A-Z]:\\Users\\)/u },
];

for (const file of textFiles) {
  const bytes = readFileSync(file);
  if (isLikelyBinary(bytes)) continue;
  const text = bytes.toString("utf8");
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(text)) {
      fail(`package boundary violation: ${name} in ${path.relative(root, file)}`);
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`package boundary ok: ${packedFiles.length} files checked`);
