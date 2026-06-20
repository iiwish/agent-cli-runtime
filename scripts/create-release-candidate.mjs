#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const options = { outDir: undefined, keepTemp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      options.outDir = argv[++i];
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/create-release-candidate.mjs [--out-dir <dir>] [--keep-temp]

Creates a local release-candidate directory without publishing npm.

Options:
  --out-dir <dir>   Write artifacts to this directory. Defaults to a temp directory.
  --keep-temp       Print and keep the temp directory when --out-dir is omitted.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stdout.write(redact(result.stdout ?? ""));
    process.stderr.write(redact(result.stderr ?? ""));
    throw new Error(`command failed: ${command} ${args.map((arg) => redact(arg)).join(" ")}`);
  }
  return result.stdout ?? "";
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
  const outDir = path.resolve(options.outDir ?? mkdtempSync(path.join(tmpdir(), "agent-cli-runtime-release-candidate-")));
  mkdirSync(outDir, { recursive: true });

  const packJsonPath = path.join(outDir, "npm-pack.json");
  const packageFilesPath = path.join(outDir, "package-files.txt");
  const verificationPath = path.join(outDir, "release-verification.json");

  try {
    const packJson = run("npm", ["pack", "--json", "--pack-destination", outDir]);
    writeFileSync(packJsonPath, packJson, "utf8");
    const packEntries = JSON.parse(packJson);
    const files = packEntries.flatMap((entry) => entry.files.map((file) => file.path)).join("\n");
    writeFileSync(packageFilesPath, `${files}\n`, "utf8");

    run(process.execPath, [
      path.join(process.cwd(), "scripts", "verify-release-artifacts.mjs"),
      "--dir",
      outDir,
      "--output",
      verificationPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const verification = JSON.parse(readFileSync(verificationPath, "utf8"));
    process.stdout.write(`${JSON.stringify({
      ok: true,
      outDir: displayPath(outDir),
      tarball: verification.tarball,
      verification: path.basename(verificationPath),
    }, null, 2)}\n`);
  } catch (error) {
    if (!options.outDir && !options.keepTemp) {
      rmSync(outDir, { recursive: true, force: true });
    }
    process.stdout.write(`${JSON.stringify({
      ok: false,
      outDir: displayPath(outDir),
      error: redact(error instanceof Error ? error.message : String(error)),
    }, null, 2)}\n`);
    process.exit(1);
  }
}

main();
