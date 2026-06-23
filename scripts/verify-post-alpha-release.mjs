#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCHEMA_VERSION = "agent-cli-runtime.postAlphaEvidence.v1";
const DEFAULT_PACKAGE = "agent-cli-runtime";

function parseArgs(argv) {
  const options = {
    packageName: DEFAULT_PACKAGE,
    version: undefined,
    githubRepo: "iiwish/agent-cli-runtime",
    githubTag: undefined,
    npmTarball: undefined,
    githubTarball: undefined,
    npmDistJson: undefined,
    githubReleaseJson: undefined,
    distTagsJson: undefined,
    output: undefined,
    keepTemp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package") options.packageName = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--github-repo") options.githubRepo = argv[++i];
    else if (arg === "--github-tag") options.githubTag = argv[++i];
    else if (arg === "--npm-tarball") options.npmTarball = argv[++i];
    else if (arg === "--github-tarball") options.githubTarball = argv[++i];
    else if (arg === "--npm-dist-json") options.npmDistJson = argv[++i];
    else if (arg === "--github-release-json") options.githubReleaseJson = argv[++i];
    else if (arg === "--dist-tags-json") options.distTagsJson = argv[++i];
    else if (arg === "--output") options.output = argv[++i];
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }
  for (const [name, value] of [
    ["--package", options.packageName],
    ["--version", options.version],
    ["--github-repo", options.githubRepo],
    ["--github-tag", options.githubTag],
    ["--npm-tarball", options.npmTarball],
    ["--github-tarball", options.githubTarball],
    ["--npm-dist-json", options.npmDistJson],
    ["--github-release-json", options.githubReleaseJson],
    ["--dist-tags-json", options.distTagsJson],
    ["--output", options.output],
  ]) {
    if (value === undefined && argv.includes(name)) throw new Error(`Missing value for ${name}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/verify-post-alpha-release.mjs [--version <version>] [--output <file>]

Downloads and compares the npm registry tarball with the GitHub Release tarball.
The raw gzip tarball hashes may differ; unpacked package file content must match.

Options:
  --package <name>              Package name. Defaults to agent-cli-runtime.
  --version <version>           Package version. Defaults to package.json version.
  --github-repo <owner/repo>    GitHub repository. Defaults to iiwish/agent-cli-runtime.
  --github-tag <tag>            GitHub release tag. Defaults to v<version>.
  --npm-tarball <path>          Use a local npm tarball fixture instead of downloading.
  --github-tarball <path>       Use a local GitHub tarball fixture instead of downloading.
  --npm-dist-json <path>        Use local npm dist metadata JSON.
  --github-release-json <path>  Use local GitHub release JSON.
  --dist-tags-json <path>       Use local npm dist-tags JSON.
  --output <path>               Write the stable JSON result to a file.
`);
}

function redact(value) {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/\bBearer\s+(?!<)[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer [REDACTED]")
    .replace(/\/private\/tmp\/[^\s"']+/gu, "/private/tmp/[REDACTED]")
    .replace(/\/var\/folders\/[^\s"']+/gu, "/var/folders/[REDACTED]")
    .replace(/\/tmp\/[^\s"']+/gu, "/tmp/[REDACTED]")
    .replace(/\/Users\/[^/\s]+/gu, "/" + "Users/[REDACTED]")
    .replace(/\/home\/[^/\s]+/gu, "/" + "home/[REDACTED]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gu, "C:" + "\\Users\\[REDACTED]");
}

function stableErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split(/\r?\n/u).find(Boolean) ?? "post-alpha verification failed";
  const redacted = redact(firstLine);
  if (redacted.startsWith("command failed:")) return "post-alpha verification command failed";
  if (/ENOENT|no such file or directory/iu.test(redacted)) return "post-alpha verification input file was not found";
  return redacted
    .replace(/\s+at\s+.+$/u, "")
    .slice(0, 280);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`command failed: ${command} ${args.map((arg) => redact(arg)).join(" ")}\n${redact(output)}`);
  }
  return result.stdout ?? "";
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function runJson(command, args) {
  const stdout = run(command, args);
  return JSON.parse(stdout);
}

function sha(file, algorithm) {
  return createHash(algorithm).update(readFileSync(file)).digest("hex");
}

function basenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return path.basename(parsed.pathname);
  } catch {
    return path.basename(String(url));
  }
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { "user-agent": "agent-cli-runtime-release-verifier" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        if (redirects > 5) reject(new Error("too many redirects while downloading release asset"));
        else resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`download failed with HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        writeFileSync(destination, Buffer.concat(chunks));
        resolve();
      });
    }).on("error", reject);
  });
}

function normalizeNpmView(data) {
  if (data?.dist) return data;
  return { dist: data };
}

function normalizeGithubRelease(data) {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  return {
    tagName: data?.tagName ?? data?.tag_name ?? null,
    isPrerelease: data?.isPrerelease ?? data?.prerelease ?? null,
    isDraft: data?.isDraft ?? data?.draft ?? null,
    targetCommitish: data?.targetCommitish ?? data?.target_commitish ?? null,
    url: data?.url ?? data?.html_url ?? null,
    assets: assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: asset.digest ?? null,
      url: asset.url ?? asset.browser_download_url ?? null,
    })),
  };
}

function selectReleaseTarballAsset(release, filename) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return (
    assets.find((asset) => asset.name === filename) ??
    assets.find((asset) => typeof asset.name === "string" && asset.name.endsWith(".tgz"))
  );
}

async function resolveInputs(options, tmp) {
  const packageJson = readJson(path.join(process.cwd(), "package.json"));
  const version = options.version ?? packageJson.version;
  const githubTag = options.githubTag ?? `v${version}`;
  const npmView =
    options.npmDistJson !== undefined
      ? normalizeNpmView(readJson(options.npmDistJson))
      : normalizeNpmView(runJson("npm", ["view", `${options.packageName}@${version}`, "dist", "--json"]));
  const distTags =
    options.distTagsJson !== undefined
      ? readJson(options.distTagsJson)
      : runJson("npm", ["view", options.packageName, "dist-tags", "--json"]);
  const release =
    options.githubReleaseJson !== undefined
      ? normalizeGithubRelease(readJson(options.githubReleaseJson))
      : normalizeGithubRelease(runJson("gh", [
          "release",
          "view",
          githubTag,
          "--repo",
          options.githubRepo,
          "--json",
          "tagName,targetCommitish,isPrerelease,isDraft,assets,url",
        ]));

  const filename = `${options.packageName.replace(/^@/u, "").replace(/\//gu, "-")}-${version}.tgz`;
  const npmTarball = path.join(tmp, "npm-registry.tgz");
  const githubTarball = path.join(tmp, "github-release.tgz");
  if (options.npmTarball !== undefined) {
    run(process.execPath, ["-e", "require('node:fs').copyFileSync(process.argv[1], process.argv[2])", options.npmTarball, npmTarball]);
  } else if (typeof npmView.dist?.tarball === "string") {
    await download(npmView.dist.tarball, npmTarball);
  } else {
    throw new Error("npm dist metadata is missing dist.tarball");
  }

  const releaseAsset = selectReleaseTarballAsset(release, filename);
  if (options.githubTarball !== undefined) {
    run(process.execPath, ["-e", "require('node:fs').copyFileSync(process.argv[1], process.argv[2])", options.githubTarball, githubTarball]);
  } else if (typeof releaseAsset?.url === "string") {
    await download(releaseAsset.url, githubTarball);
  } else {
    throw new Error(`GitHub release ${githubTag} is missing a .tgz asset`);
  }

  return {
    packageName: options.packageName,
    version,
    githubTag,
    npmView,
    distTags,
    release,
    releaseAsset,
    files: { npmTarball, githubTarball },
  };
}

function unpackTarball(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", destination]);
}

async function walkFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(full, base));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files;
}

async function contentMap(packageDir) {
  const files = (await walkFiles(packageDir)).sort();
  const entries = {};
  for (const file of files) {
    entries[file] = {
      sha256: sha(path.join(packageDir, file), "sha256"),
      sizeBytes: statSync(path.join(packageDir, file)).size,
    };
  }
  return entries;
}

function compareContent(npmFiles, githubFiles) {
  const npmList = Object.keys(npmFiles).sort();
  const githubList = Object.keys(githubFiles).sort();
  const missingFromGithub = npmList.filter((file) => !(file in githubFiles));
  const extraInGithub = githubList.filter((file) => !(file in npmFiles));
  const changed = npmList.filter((file) => file in githubFiles && npmFiles[file].sha256 !== githubFiles[file].sha256);
  return {
    match: missingFromGithub.length === 0 && extraInGithub.length === 0 && changed.length === 0,
    fileCount: npmList.length,
    missingFromGithub,
    extraInGithub,
    changed,
  };
}

function describeTarball(file) {
  return {
    filename: path.basename(file),
    sizeBytes: statSync(file).size,
    sha1: sha(file, "sha1"),
    sha256: sha(file, "sha256"),
  };
}

async function buildResult(options) {
  const tmp = mkdtempSync(path.join(tmpdir(), "agent-runtime-post-alpha-"));
  try {
    const inputs = await resolveInputs(options, tmp);
    const npmUnpack = path.join(tmp, "npm-unpack");
    const githubUnpack = path.join(tmp, "github-unpack");
    unpackTarball(inputs.files.npmTarball, npmUnpack);
    unpackTarball(inputs.files.githubTarball, githubUnpack);
    const npmPackageDir = path.join(npmUnpack, "package");
    const githubPackageDir = path.join(githubUnpack, "package");
    if (!existsSync(npmPackageDir) || !existsSync(githubPackageDir)) {
      throw new Error("tarball did not unpack to package/ directory");
    }

    const npmTarball = describeTarball(inputs.files.npmTarball);
    const githubTarball = describeTarball(inputs.files.githubTarball);
    const npmContent = await contentMap(npmPackageDir);
    const githubContent = await contentMap(githubPackageDir);
    const unpackedPackage = compareContent(npmContent, githubContent);
    const gzipHashesMatch = npmTarball.sha256 === githubTarball.sha256 && npmTarball.sha1 === githubTarball.sha1;
    const expectedDifferentGzipPackaging = !gzipHashesMatch && unpackedPackage.match;
    const registryShasumMatches = typeof inputs.npmView.dist?.shasum === "string" ? inputs.npmView.dist.shasum === npmTarball.sha1 : null;
    const registryIntegrityPresent = typeof inputs.npmView.dist?.integrity === "string";
    const releaseAssetDigestMatches =
      typeof inputs.releaseAsset?.digest === "string" && inputs.releaseAsset.digest.startsWith("sha256:")
        ? inputs.releaseAsset.digest === `sha256:${githubTarball.sha256}`
        : null;
    const diagnostics = [];
    if (registryShasumMatches === false) diagnostics.push({ code: "npm_shasum_mismatch", message: "Downloaded npm registry tarball SHA1 does not match npm dist.shasum." });
    if (releaseAssetDigestMatches === false) diagnostics.push({ code: "github_asset_digest_mismatch", message: "Downloaded GitHub release tarball SHA256 does not match release asset digest." });
    if (!unpackedPackage.match) diagnostics.push({ code: "unpacked_package_content_mismatch", message: "npm registry and GitHub release tarballs unpack to different package content." });

    return {
      schemaVersion: SCHEMA_VERSION,
      ok: diagnostics.length === 0,
      packageName: inputs.packageName,
      version: inputs.version,
      npm: {
        distTags: inputs.distTags,
        dist: {
          shasum: inputs.npmView.dist?.shasum ?? null,
          integrity: inputs.npmView.dist?.integrity ?? null,
          fileCount: inputs.npmView.dist?.fileCount ?? null,
          unpackedSize: inputs.npmView.dist?.unpackedSize ?? null,
          tarballFilename: basenameFromUrl(inputs.npmView.dist?.tarball ?? npmTarball.filename),
        },
        downloadedTarball: npmTarball,
        registryShasumMatches,
        registryIntegrityPresent,
      },
      githubRelease: {
        tagName: inputs.release.tagName,
        targetCommitish: inputs.release.targetCommitish,
        isPrerelease: inputs.release.isPrerelease,
        isDraft: inputs.release.isDraft,
        tarballAsset: {
          name: inputs.releaseAsset?.name ?? githubTarball.filename,
          sizeBytes: inputs.releaseAsset?.size ?? null,
          digest: inputs.releaseAsset?.digest ?? null,
          digestMatchesDownloadedSha256: releaseAssetDigestMatches,
        },
        downloadedTarball: githubTarball,
      },
      comparison: {
        gzipHashesMatch,
        expectedDifferentGzipPackaging,
        acceptable: unpackedPackage.match && (registryShasumMatches !== false) && (releaseAssetDigestMatches !== false),
        rule: "Raw npm registry and GitHub Release gzip tarball hashes may differ because packaging artifacts differ; unpacked package file list and content must match.",
        contentBoundary: "npm registry shasum/integrity plus unpacked package file parity plus release:verify",
        unpackedPackage,
      },
      diagnostics,
    };
  } finally {
    if (!options.keepTemp) rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const result = await buildResult(options);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) writeFileSync(options.output, json, "utf8");
    process.stdout.write(json);
    if (!result.ok) process.exit(1);
  } catch (error) {
    const result = {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      diagnostics: [{ code: "post_alpha_verification_error", message: stableErrorMessage(error) }],
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }
}

main();
