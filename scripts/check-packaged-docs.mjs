#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  PACKAGED_DOCS_SCHEMA_VERSION,
  inspectPackagedDocs,
  redact,
} from "./packaged-docs-policy.mjs";

function parseArgs(argv) {
  const options = { packageSpec: null, packageSource: "local-pack" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package-spec") {
      options.packageSpec = argv[++i];
      options.packageSource = "npm-registry";
    } else if (arg === "--source") {
      options.packageSource = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage: node scripts/check-packaged-docs.mjs [--package-spec <name@version>]

Packs the local checkout or downloads a published package from the npm registry,
unpacks it, and verifies the package docs do not contain stale pre-publish
release-state claims.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${redact(arg)}`);
    }
  }
  if (argv.includes("--package-spec") && !options.packageSpec) throw new Error("Missing value for --package-spec");
  return options;
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.map(redact).join(" ")} failed`);
  }
  return result.stdout ?? "";
}

function packPackage(options, tempDir) {
  const args = ["pack"];
  if (options.packageSpec) args.push(options.packageSpec);
  args.push("--json", "--ignore-scripts", "--pack-destination", tempDir);
  const payload = parseJson(run("npm", args, process.cwd()));
  if (!Array.isArray(payload) || !payload[0]?.filename) throw new Error("npm pack did not return package metadata");
  return path.join(tempDir, path.basename(payload[0].filename));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempDir = mkdtempSync(path.join(tmpdir(), "agent-runtime-packaged-docs-"));
  try {
    const tarball = packPackage(options, tempDir);
    run("tar", ["-xzf", tarball, "-C", tempDir], process.cwd());
    const result = inspectPackagedDocs(path.join(tempDir, "package"), {
      packageSource: options.packageSource,
      packageSpec: options.packageSpec,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: PACKAGED_DOCS_SCHEMA_VERSION,
    ok: false,
    packageSource: null,
    diagnostics: [{ code: "packaged_docs_check_error", message: redact(error instanceof Error ? error.message : String(error)) }],
    noAlpha3UnpublishedClaim: false,
    noAlpha4PublishedClaim: true,
    noAlpha4UnpublishedClaim: false,
    noAlpha4GithubReleaseMissingClaim: false,
    noAlpha5PublishedClaim: false,
    noAlpha5GithubReleaseCreatedClaim: false,
    noAlpha5UnpublishedClaim: false,
    noAlpha5GithubReleaseMissingClaim: false,
    noAlpha5OldLatestAlpha1Claim: false,
    noAlpha5OldAlpha4CurrentTagClaim: false,
    noAlpha5PublishedVerificationPassClaim: false,
    alpha5StaleDocsIncidentRecorded: false,
    alpha5PublishedVerificationFailureRecorded: false,
    noAlpha6UnpublishedClaim: false,
    noAlpha6FuturePublishClaim: false,
    alpha6PublishedStateRecorded: false,
    alpha6AlphaTagRecorded: false,
    alpha6LatestTagRecorded: false,
    alpha6GithubReleaseStateRecorded: false,
    alpha6GithubReleaseParityRecorded: false,
    alpha6FuturePromotionGateRecorded: false,
    noStaleAlpha3CurrentClaim: false,
    noDryRunStopPoint: false,
    noPublishReadyCandidate: false,
    noOldDistTagClaim: false,
  }, null, 2)}\n`);
  process.exit(1);
}
