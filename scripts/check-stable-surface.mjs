#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "agent-cli-runtime.stableSurfaceCheck.v1";
const EXPECTED_ROOT_VALUE_EXPORTS = ["createAgentRuntime"];
const EVENT_VOCABULARY_MARKER = "Event terminal reasons use the `EventTerminalReason` vocabulary:";
const SMOKE_VOCABULARY_MARKER = "Smoke and conformance classifications use:";

const DISALLOWED_PACKAGE_PATTERNS = [
  /^\.reference(?:\/|$)/u,
  /^\.release-evidence(?:\/|$)/u,
  /^published-verification(?:\/|$)/u,
  /^scripts\/(?!dogfood\.mjs$).+\.mjs$/u,
];

const UNSAFE_PATTERNS = [
  /\/Users\/[^"',\s]+/u,
  /\/private\/tmp\/[^"',\s]+/u,
  /\/var\/folders\/[^"',\s]+/u,
  /\/tmp\/[^"',\s]+/u,
  /[A-Z]:\\Users\\[^"',\s]+/u,
  /sk-[A-Za-z0-9_-]{20,}/u,
  /\bBearer\s+[A-Za-z0-9+/_=-]{10,}\b/u,
  /\b(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*[^\s"',]+/iu,
  /\braw\s+(?:stdout|stderr)\b/iu,
  /\bworkflow\s+logs?\b/iu,
];

function parseArgs(argv) {
  const options = { root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      options.root = path.resolve(argv[++i] ?? "");
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/check-stable-surface.mjs [--root <repo-root>]\n");
      process.exit(0);
    } else {
      throw new Error(`unknown_arg:${redact(arg)}`);
    }
  }
  return options;
}

function redact(value) {
  return String(value)
    .replaceAll(process.cwd(), "<repo>")
    .replaceAll(process.env.HOME ?? "__no_home__", "<home>")
    .replace(/\/Users\/[^"',\s]+(?:\/[^"',\s]+)*/gu, "<path>")
    .replace(/\/private\/tmp\/[^"',\s]+(?:\/[^"',\s]+)*/gu, "<path>")
    .replace(/\/var\/folders\/[^"',\s]+(?:\/[^"',\s]+)*/gu, "<path>")
    .replace(/\/tmp\/[^"',\s]+(?:\/[^"',\s]+)*/gu, "<path>")
    .replace(/[A-Z]:\\Users\\[^"',\s]+(?:\\[^"',\s]+)*/gu, "<path>")
    .replace(/sk-[A-Za-z0-9_-]{20,}/gu, "<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9+/_=-]{10,}\b/gu, "Bearer <redacted>")
    .replace(
      /\b(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENAI_AUTH_TOKEN|CLAUDE_AUTH_TOKEN|CODEX_AUTH_TOKEN|OPENCODE_AUTH_TOKEN)\s*=\s*[^\s"',]+/giu,
      "$1=<redacted>",
    )
    .slice(0, 180);
}

function diagnostic(code, message, field) {
  return {
    code,
    message: redact(message),
    ...(field ? { field } : {}),
  };
}

function boundary(overrides = {}) {
  return {
    repoOnlyGate: true,
    noNpmPublish: true,
    noGithubRelease: true,
    noAuthenticatedRealRun: true,
    distSubpathsAreNotPublicApi: true,
    stableSurfaceCheckIsRuntimePublicApi: false,
    experimentalAdapterSurfacePromoted: false,
    ...overrides,
  };
}

function readText(root, relativeFile, diagnostics) {
  try {
    return readFileSync(path.join(root, relativeFile), "utf8");
  } catch {
    diagnostics.push(diagnostic("missing_file", `missing ${relativeFile}`, relativeFile));
    return "";
  }
}

async function loadModule(root, relativeFile, diagnostics) {
  try {
    return await import(`${pathToFileURL(path.join(root, relativeFile)).href}?stableSurface=${Date.now()}`);
  } catch {
    diagnostics.push(diagnostic("module_load_failed", `cannot load ${relativeFile}; run npm run build first`, relativeFile));
    return null;
  }
}

function runNpmPack(root, diagnostics) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    diagnostics.push(diagnostic("pack_metadata_failed", "npm pack dry-run failed"));
    return [];
  }
  try {
    const parsed = JSON.parse(result.stdout ?? "[]");
    if (!Array.isArray(parsed)) throw new Error("metadata_not_array");
    return parsed.flatMap((entry) => Array.isArray(entry.files) ? entry.files.map((file) => String(file.path)) : []);
  } catch {
    diagnostics.push(diagnostic("pack_metadata_invalid", "npm pack dry-run JSON was not parseable"));
    return [];
  }
}

function sameArray(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function extractBulletsAfter(text, marker) {
  const start = text.indexOf(marker);
  if (start === -1) return [];
  const tail = text.slice(start + marker.length);
  const lines = tail.split(/\r?\n/u);
  const values = [];
  let sawBullet = false;
  for (const line of lines) {
    const bullet = line.match(/^- `([^`]+)`/u);
    if (bullet) {
      values.push(bullet[1]);
      sawBullet = true;
      continue;
    }
    if (sawBullet && line.trim() === "") break;
  }
  return values;
}

function extractStableReadinessRowValues(text, rowLabel) {
  const row = text.split(/\r?\n/u).find((line) => line.startsWith(`| ${rowLabel} |`));
  if (!row) return [];
  return Array.from(row.matchAll(/`([^`]+)`/gu), (match) => match[1]).slice(1);
}

function extractStableReadinessSchemas(text) {
  const start = text.indexOf("## Schema Inventory");
  const end = text.indexOf("## Stable Gaps");
  if (start === -1 || end === -1 || end <= start) return [];
  return Array.from(text.slice(start, end).matchAll(/\| `(agent-[^`]+\.v1)` \|/gu), (match) => match[1]);
}

function checkPackageRoot(exportsModule, diagnostics) {
  const valueExports = exportsModule ? Object.keys(exportsModule).sort() : [];
  const ok = sameArray(valueExports, EXPECTED_ROOT_VALUE_EXPORTS);
  if (!ok) {
    diagnostics.push(diagnostic("package_root_exports_changed", "package root value exports must remain createAgentRuntime only", "packageRoot.valueExports"));
  }
  return {
    ok,
    valueExports,
    expectedValueExports: EXPECTED_ROOT_VALUE_EXPORTS,
  };
}

function checkPublicTypes(root, diagnostics) {
  const declaration = readText(root, "dist/index.d.ts", diagnostics);
  const valueExportMatches = Array.from(declaration.matchAll(/^export\s+(?!type\b)(?:\{([^}]+)\}|(?:declare\s+)?(?:const|function|class|let|var)\s+([A-Za-z0-9_$]+))/gmu));
  const valueExports = valueExportMatches.flatMap((match) => {
    const names = match[1] ? match[1].split(",").map((part) => part.trim().split(/\s+as\s+/u).at(-1)?.trim() ?? "") : [match[2]];
    return names.filter(Boolean);
  }).sort();
  const exportSources = Array.from(declaration.matchAll(/from\s+"([^"]+)"/gu), (match) => match[1]);
  const forbiddenSources = exportSources.filter((source) =>
    /^\.\/(?:storage|parsers|adapters\/(?!adapter-types))/u.test(source) ||
    /(?:scheduler|task-graph)/iu.test(source),
  );
  const forbiddenValueSources = Array.from(declaration.matchAll(/^export\s+(?!type\b).*from\s+"([^"]+)"/gmu), (match) => match[1]).filter((source) =>
    /^\.\/(?:storage|parsers|adapters\/(?!adapter-types))/u.test(source) ||
    /(?:scheduler|task-graph)/iu.test(source),
  );
  const ok = sameArray(valueExports, EXPECTED_ROOT_VALUE_EXPORTS) && forbiddenSources.length === 0 && forbiddenValueSources.length === 0;
  if (!sameArray(valueExports, EXPECTED_ROOT_VALUE_EXPORTS)) {
    diagnostics.push(diagnostic("declaration_value_exports_changed", "package root declarations must expose createAgentRuntime as the only value export", "publicTypes.valueExports"));
  }
  for (const source of forbiddenSources) {
    diagnostics.push(diagnostic("forbidden_public_type_source", `forbidden declaration source ${source}`, "publicTypes.forbiddenSources"));
  }
  return {
    ok,
    valueExports,
    forbiddenSources,
    forbiddenValueSources,
  };
}

function checkSchemaInventory(schemaContract, docs, diagnostics) {
  const schemaVersions = Array.isArray(schemaContract?.CLI_SCHEMA_INVENTORY)
    ? schemaContract.CLI_SCHEMA_INVENTORY.map((contract) => String(contract.schemaVersion))
    : [];
  const stableReadinessSchemas = extractStableReadinessSchemas(docs.stableReadiness);
  const missingFromApi = schemaVersions.filter((schemaVersion) => !docs.apiContract.includes(schemaVersion));
  const missingFromStableReadiness = schemaVersions.filter((schemaVersion) => !docs.stableReadiness.includes(schemaVersion));
  const stableReadinessOrderMatches = sameArray(stableReadinessSchemas, schemaVersions);

  for (const schemaVersion of missingFromApi) {
    diagnostics.push(diagnostic("schema_missing_from_api_contract", `schema ${schemaVersion} missing from api contract`, "schemaInventory.apiContract"));
  }
  for (const schemaVersion of missingFromStableReadiness) {
    diagnostics.push(diagnostic("schema_missing_from_stable_readiness", `schema ${schemaVersion} missing from stable readiness`, "schemaInventory.stableReadiness"));
  }
  if (!stableReadinessOrderMatches) {
    diagnostics.push(diagnostic("stable_readiness_schema_inventory_mismatch", "stable readiness schema inventory must match CLI_SCHEMA_INVENTORY order", "schemaInventory.stableReadiness"));
  }
  return {
    ok: schemaVersions.length > 0 && missingFromApi.length === 0 && missingFromStableReadiness.length === 0 && stableReadinessOrderMatches,
    count: schemaVersions.length,
    schemaVersions,
    docs: {
      apiContract: { ok: missingFromApi.length === 0, missing: missingFromApi },
      stableReadiness: { ok: missingFromStableReadiness.length === 0 && stableReadinessOrderMatches, missing: missingFromStableReadiness },
    },
  };
}

function checkCliVocabularies(schemaContract, docs, diagnostics) {
  const terminalReasons = Array.isArray(schemaContract?.EVENT_TERMINAL_REASONS) ? schemaContract.EVENT_TERMINAL_REASONS.map(String) : [];
  const smokeClassifications = Array.isArray(schemaContract?.SMOKE_CONFORMANCE_CLASSIFICATIONS)
    ? schemaContract.SMOKE_CONFORMANCE_CLASSIFICATIONS.map(String)
    : [];
  const apiTerminalReasons = extractBulletsAfter(docs.apiContract, EVENT_VOCABULARY_MARKER);
  const apiSmokeClassifications = extractBulletsAfter(docs.apiContract, SMOKE_VOCABULARY_MARKER);
  const stableTerminalReasons = extractStableReadinessRowValues(docs.stableReadiness, "Terminal reason vocabulary");
  const stableSmokeClassifications = extractStableReadinessRowValues(docs.stableReadiness, "Real smoke and conformance classification vocabulary");

  const checks = [
    ["api_terminal_reasons_mismatch", "cliVocabularies.apiContract.terminalReasons", apiTerminalReasons, terminalReasons],
    ["api_smoke_classifications_mismatch", "cliVocabularies.apiContract.smokeConformanceClassifications", apiSmokeClassifications, smokeClassifications],
    ["stable_readiness_terminal_reasons_mismatch", "cliVocabularies.stableReadiness.terminalReasons", stableTerminalReasons, terminalReasons],
    [
      "stable_readiness_smoke_classifications_mismatch",
      "cliVocabularies.stableReadiness.smokeConformanceClassifications",
      stableSmokeClassifications,
      smokeClassifications,
    ],
  ];
  for (const [code, field, actual, expected] of checks) {
    if (!sameArray(actual, expected)) diagnostics.push(diagnostic(code, "documented vocabulary must match frozen runtime vocabulary", field));
  }

  const ok = checks.every(([, , actual, expected]) => sameArray(actual, expected));
  return {
    ok,
    terminalReasons,
    smokeConformanceClassifications: smokeClassifications,
  };
}

function checkStableReadiness(docs, diagnostics) {
  const rows = docs.stableReadiness.split(/\r?\n/u);
  const guardedRows = [
    { label: "`AgentRuntime.getAdapter` and `RuntimeOptions.adapters`", field: "stableReadiness.getAdapter" },
    {
      label: "Adapter authoring extension types: `AgentAdapterDef`, `BuildArgsInput`, `PromptTransport`, `StreamParser`, `AdapterCompatibilityProfile`",
      field: "stableReadiness.adapterAuthoringTypes",
    },
  ];
  let ok = true;
  for (const { label, field } of guardedRows) {
    const row = rows.find((line) => line.startsWith(`| ${label} |`));
    if (!row || !row.includes("| `experimental` |")) {
      ok = false;
      diagnostics.push(diagnostic("experimental_surface_promoted", "adapter extension surface must remain experimental", field));
    }
  }
  return {
    ok,
    experimentalSurfaces: {
      getAdapterAndRuntimeOptionsAdapters: rows.some((line) => line.startsWith("| `AgentRuntime.getAdapter` and `RuntimeOptions.adapters` | `experimental` |")),
      adapterAuthoringExtensionTypes: rows.some((line) =>
        line.startsWith(
          "| Adapter authoring extension types: `AgentAdapterDef`, `BuildArgsInput`, `PromptTransport`, `StreamParser`, `AdapterCompatibilityProfile` | `experimental` |",
        ),
      ),
    },
  };
}

function checkPackagedDocs(root, diagnostics) {
  const manifestText = readText(root, "package.json", diagnostics);
  let manifestFiles = [];
  try {
    manifestFiles = JSON.parse(manifestText).files ?? [];
  } catch {
    diagnostics.push(diagnostic("package_manifest_invalid", "package.json is not parseable", "packagedDocs.manifest"));
  }
  const packedFiles = runNpmPack(root, diagnostics).sort();
  const disallowedPackedFiles = packedFiles.filter((file) => DISALLOWED_PACKAGE_PATTERNS.some((pattern) => pattern.test(file)));
  for (const file of disallowedPackedFiles) {
    diagnostics.push(diagnostic("disallowed_package_file", `disallowed package file ${file}`, "packagedDocs.disallowedPackedFiles"));
  }
  const ok = disallowedPackedFiles.length === 0 && !manifestFiles.includes("docs/stable-readiness.md");
  if (manifestFiles.includes("docs/stable-readiness.md")) {
    diagnostics.push(diagnostic("stable_readiness_packaged", "stable readiness audit must remain repo-only", "packagedDocs.manifest"));
  }
  return {
    ok,
    packedFileCount: packedFiles.length,
    disallowedPackedFiles,
    repoOnlyExcluded: {
      reference: !packedFiles.some((file) => file.startsWith(".reference/")),
      releaseEvidence: !packedFiles.some((file) => file.startsWith(".release-evidence/")),
      repoOnlyScripts: !packedFiles.some((file) => /^scripts\/(?!dogfood\.mjs$).+\.mjs$/u.test(file)),
      stableReadiness: !packedFiles.includes("docs/stable-readiness.md"),
    },
  };
}

function sanitizeOutput(result) {
  const text = JSON.stringify(result);
  if (!UNSAFE_PATTERNS.some((pattern) => pattern.test(text))) return result;
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    packageRoot: { ok: false, valueExports: [], expectedValueExports: EXPECTED_ROOT_VALUE_EXPORTS },
    publicTypes: { ok: false, valueExports: [], forbiddenSources: [], forbiddenValueSources: [] },
    schemaInventory: { ok: false, count: 0, schemaVersions: [], docs: { apiContract: { ok: false, missing: [] }, stableReadiness: { ok: false, missing: [] } } },
    cliVocabularies: { ok: false, terminalReasons: [], smokeConformanceClassifications: [] },
    packagedDocs: { ok: false, packedFileCount: 0, disallowedPackedFiles: [], repoOnlyExcluded: {} },
    diagnostics: [diagnostic("unsafe_output_redacted", "stable surface check output was replaced by a redacted failure envelope")],
    boundary: boundary(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root;
  const diagnostics = [];
  const [rootModule, schemaContract] = await Promise.all([
    loadModule(root, "dist/index.js", diagnostics),
    loadModule(root, "dist/core/schema-contract.js", diagnostics),
  ]);
  const docs = {
    apiContract: readText(root, "docs/api-schema-contract.md", diagnostics),
    stableReadiness: readText(root, "docs/stable-readiness.md", diagnostics),
  };

  const packageRoot = checkPackageRoot(rootModule, diagnostics);
  const publicTypes = checkPublicTypes(root, diagnostics);
  const schemaInventory = checkSchemaInventory(schemaContract, docs, diagnostics);
  const cliVocabularies = checkCliVocabularies(schemaContract, docs, diagnostics);
  const stableReadiness = checkStableReadiness(docs, diagnostics);
  const packagedDocs = checkPackagedDocs(root, diagnostics);
  const resultBoundary = boundary({
    experimentalAdapterSurfacePromoted: !stableReadiness.ok,
  });

  const result = sanitizeOutput({
    schemaVersion: SCHEMA_VERSION,
    ok:
      diagnostics.length === 0 &&
      packageRoot.ok &&
      publicTypes.ok &&
      schemaInventory.ok &&
      cliVocabularies.ok &&
      stableReadiness.ok &&
      packagedDocs.ok,
    packageRoot,
    publicTypes,
    schemaInventory,
    cliVocabularies,
    packagedDocs,
    diagnostics,
    boundary: resultBoundary,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  const result = sanitizeOutput({
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    packageRoot: { ok: false, valueExports: [], expectedValueExports: EXPECTED_ROOT_VALUE_EXPORTS },
    publicTypes: { ok: false, valueExports: [], forbiddenSources: [], forbiddenValueSources: [] },
    schemaInventory: { ok: false, count: 0, schemaVersions: [], docs: { apiContract: { ok: false, missing: [] }, stableReadiness: { ok: false, missing: [] } } },
    cliVocabularies: { ok: false, terminalReasons: [], smokeConformanceClassifications: [] },
    packagedDocs: { ok: false, packedFileCount: 0, disallowedPackedFiles: [], repoOnlyExcluded: {} },
    diagnostics: [diagnostic("stable_surface_check_error", error instanceof Error ? error.message : String(error))],
    boundary: boundary(),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
});
