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
  "docs/release-report.md",
  "docs/release-publish-runbook.md",
  "docs/api-schema-contract.md",
  "docs/daemon-ready-contract.md",
  "docs/ssot.md",
  "docs/production-readiness.md",
  "docs/compatibility.md",
  "examples/cli-dogfood.md",
  "scripts/dogfood.mjs",
];

for (const required of requiredFiles) {
  if (!packedFiles.includes(required)) fail(`package boundary violation: missing ${required}`);
}

const disallowedPathPatterns = [
  /^\.release-evidence(?:\/|$)/u,
  /^published-verification(?:\/|$)/u,
  /^\.reference(?:\/|$)/u,
  /^tests(?:\/|$)/u,
  /fixtures?/iu,
  /(?:^|\/)fault-fixtures(?:\/|$)/u,
  /(?:^|\/)repair-backups(?:\/|$)/u,
  /(?:^|\/)raw-corrupt-samples(?:\/|$)/u,
  /(?:^|\/)raw-real-cli-output(?:\/|$)/u,
  /^scripts\/(?:create-real-compatibility-evidence|verify-real-compatibility-evidence|verify-package-content-equivalence)\.mjs$/u,
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

const packageTextFiles = packedFiles
  .filter((file) => !file.startsWith("dist/"))
  .map((file) => path.join(root, file))
  .filter((file) => {
    try {
      const stat = statSync(file);
      return stat.isFile();
    } catch (error) {
      return false;
    }
  });
const scanRoots = ["examples", "scripts", "docs"].map((dir) => path.join(root, dir));
const textFiles = [...new Set([...packageTextFiles, ...scanRoots.flatMap(walk)])].filter((file) => {
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

const publishOverclaimPatterns = [
  {
    name: "published alpha described as unpublished",
    pattern:
      /(?:0\.1\.0-alpha\.1|alpha\.1)[^\n]*(?:not published|unpublished|has not occurred|未发布|尚未发布|尚未发生)/iu,
  },
  {
    name: "published GitHub release described as forbidden",
    pattern: /(?:do not publish|don't publish|不要发布|不发布)[^\n]*(?:GitHub release|GitHub pre-release)/iu,
  },
  {
    name: "dry-run described as real publish",
    pattern: /npm publish --dry-run[^\n]*(?:really published|published to npm|真实发布成功|已经发布到 npm|已发布到 npm)/iu,
  },
  {
    name: "alpha.3 described as unpublished",
    pattern:
      /(?:0\.1\.0-alpha\.3|alpha\.3)[^\n]*(?:not published|unpublished|has not occurred|not yet published|未发布|尚未发布|尚未发生)/iu,
  },
  {
    name: "alpha.3 kept as current corrective line after alpha.4 prep",
    pattern:
      /(?:Status:[^\n]*0\.1\.0-alpha\.3[^\n]*corrective pre-alpha release|Corrective package line:\s*`?agent-cli-runtime@0\.1\.0-alpha\.3`?|Version\s+`?0\.1\.0-alpha\.3`?\s+is the corrective pre-alpha release for package consumers|`?0\.1\.0-alpha\.3`?\s+是面向 package consumer 的 corrective pre-alpha release|`?0\.1\.0-alpha\.3`?\s+是 corrective pre-alpha release)/iu,
  },
  {
    name: "alpha.4 described as already published during release prep",
    pattern:
      /(?:0\.1\.0-alpha\.4|alpha\.4)[^\n]{0,120}(?:is already published|is published on npm|published on npm|has GitHub pre-release|已发布到 npm|已经发布到 npm)/iu,
  },
  {
    name: "self-expiring dry-run stop point",
    pattern: /dry-run stop point|stop point.*dry-run|停在\s*dry-run/iu,
  },
  {
    name: "publish-ready release candidate wording",
    pattern: /publish-ready release candidate|publish ready release candidate/iu,
  },
  {
    name: "old current alpha dist-tag claim",
    pattern:
      /(?:current npm dist-tags|current registry state|当前 npm dist-tags|当前 registry)[^\n]*(?:alpha\s*(?:->|:|为)\s*`?0\.1\.0-alpha\.2`?)/iu,
  },
  {
    name: "release-candidate workflow described as publishing",
    pattern: /release-candidate workflow[^\n]*(?:publishes npm|published npm|发布到 npm)/iu,
  },
  {
    name: "current-head evidence stored inside package docs",
    pattern: /P3-11[^\n]*(?:current HEAD|当前 HEAD)[^\n]*(?:run `?\d{8,}`?|artifact digest|tarball shasum|npm pack shasum|包 shasum|证据 run)/iu,
  },
];

for (const file of textFiles) {
  const relativeFile = path.relative(root, file);
  const bytes = readFileSync(file);
  if (isLikelyBinary(bytes)) continue;
  const text = bytes.toString("utf8");
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(text)) {
      fail(`package boundary violation: ${name} in ${relativeFile}`);
    }
  }
  if (/^(?:README(?:\.zh-CN)?\.md|docs\/.+\.md)$/u.test(relativeFile)) {
    for (const { name, pattern } of publishOverclaimPatterns) {
      if (pattern.test(text)) {
        fail(`package boundary violation: ${name} in ${relativeFile}`);
      }
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`package boundary ok: ${packedFiles.length} files checked`);
