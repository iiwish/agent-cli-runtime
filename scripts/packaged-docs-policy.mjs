import { readFileSync } from "node:fs";
import path from "node:path";

export const PACKAGED_DOCS_SCHEMA_VERSION = "agent-cli-runtime.packagedDocsVerification.v1";

export const PACKAGED_DOCS = [
  "CHANGELOG.md",
  "README.md",
  "README.zh-CN.md",
  "docs/ssot.md",
  "docs/compatibility.md",
  "docs/production-readiness.md",
  "docs/release-report.md",
  "docs/release-checklist.md",
  "docs/release-publish-runbook.md",
];

const commonStalePatterns = [
  {
    code: "dry_run_stop_point",
    message: "package docs must not contain self-expiring dry-run stop point wording.",
    pattern: /dry-run stop point|stop point.*dry-run|停在\s*dry-run/iu,
  },
  {
    code: "publish_ready_candidate",
    message: "package docs must not contain publish-ready release candidate wording.",
    pattern: /publish-ready release candidate|publish ready release candidate/iu,
  },
  {
    code: "old_current_alpha_dist_tag_claim",
    message: "package docs must not claim alpha still points at alpha.2 as current registry state.",
    pattern:
      /(?:current npm dist-tags|current registry state|当前 npm dist-tags|当前 registry)[^\n]*(?:alpha\s*(?:->|:|为)\s*`?0\.1\.0-alpha\.2`?)/iu,
  },
  {
    code: "alpha2_recommended_claim",
    message: "package docs must not recommend alpha.2 after the stale package-docs incident.",
    pattern: /(?:recommend|recommended|prefer|upgrade to|推荐使用|升级到)[^\n]*0\.1\.0-alpha\.2/iu,
  },
];

const alpha3StalePatterns = [
  {
    code: "alpha3_unpublished_claim",
    message: "alpha.3 package docs must not describe alpha.3 as unpublished.",
    pattern:
      /(?:0\.1\.0-alpha\.3|alpha\.3)[^\n]*(?:not published|unpublished|has not occurred|not yet published|未发布|尚未发布|尚未发生)/iu,
  },
  {
    code: "alpha3_candidate_claim",
    message: "alpha.3 package docs must describe the corrective release state, not a release candidate state.",
    pattern: /(?:0\.1\.0-alpha\.3|alpha\.3)[^\n]*(?:release candidate|publish-ready release candidate|candidate\s*\/\s*prep|候选发布)/iu,
  },
];

const alpha4StalePatterns = [
  {
    code: "alpha4_published_claim",
    message: "alpha.4 release-prep docs must not describe alpha.4 as already published.",
    pattern:
      /(?:0\.1\.0-alpha\.4|alpha\.4)[^\n]{0,120}(?:is already published|is published on npm|published on npm|has GitHub pre-release|已发布到 npm|已经发布到 npm)/iu,
  },
  {
    code: "stale_alpha3_current_claim",
    message: "alpha.4 release-prep docs must not keep alpha.3 as the current corrective package line.",
    pattern:
      /(?:Status:[^\n]*0\.1\.0-alpha\.3[^\n]*corrective pre-alpha release|Corrective package line:\s*`?agent-cli-runtime@0\.1\.0-alpha\.3`?|Version\s+`?0\.1\.0-alpha\.3`?\s+is the corrective pre-alpha release for package consumers|`?0\.1\.0-alpha\.3`?\s+是面向 package consumer 的 corrective pre-alpha release|`?0\.1\.0-alpha\.3`?\s+是 corrective pre-alpha release)/iu,
  },
];

const commonRequiredPatterns = [
  {
    code: "missing_alpha2_stale_incident",
    message: "packaged docs must record the alpha.2 stale package-docs incident.",
    pattern: /0\.1\.0-alpha\.2[^\n]*(?:stale|pre-publish|过期|发布前)/iu,
  },
  {
    code: "missing_registry_source_of_truth",
    message: "packaged docs must keep registry and GitHub state as the source of truth.",
    pattern: /(?:npm registry|GitHub)[^\n]*(?:source of truth|authoritative|为准|权威)/iu,
  },
];

const alpha3RequiredPatterns = [
  {
    code: "missing_alpha3",
    message: "packaged docs must mention the corrective alpha.3 release.",
    pattern: /0\.1\.0-alpha\.3/u,
  },
];

const alpha4RequiredPatterns = [
  {
    code: "missing_alpha4",
    message: "packaged docs must mention the alpha.4 release-prep candidate.",
    pattern: /0\.1\.0-alpha\.4/u,
  },
  {
    code: "missing_alpha4_release_prep",
    message: "packaged docs must describe alpha.4 as release prep or a pre-release candidate.",
    pattern: /(?:release-prep|pre-release candidate|package candidate|candidate version|发布准备|候选)/iu,
  },
  {
    code: "missing_alpha3_history",
    message: "packaged docs must keep alpha.3 as historical corrective release context.",
    pattern: /0\.1\.0-alpha\.3/u,
  },
];

export function redact(value) {
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

function addDiagnostic(diagnostics, code, message, details = {}) {
  diagnostics.push({
    code,
    message,
    ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, typeof value === "string" ? redact(value) : value])),
  });
}

export function inspectPackagedDocs(packageDir, { packageSource, packageSpec = null } = {}) {
  const diagnostics = [];
  const docs = [];
  let packageName = null;
  let version = null;

  try {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
    packageName = typeof manifest.name === "string" ? manifest.name : null;
    version = typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    addDiagnostic(diagnostics, "missing_package_manifest", "unpacked package is missing package.json");
  }

  const requiredPatterns = [
    ...commonRequiredPatterns,
    ...(version === "0.1.0-alpha.4" ? alpha4RequiredPatterns : alpha3RequiredPatterns),
  ];
  const stalePatterns = [
    ...commonStalePatterns,
    ...(version === "0.1.0-alpha.4" ? alpha4StalePatterns : alpha3StalePatterns),
  ];

  for (const doc of PACKAGED_DOCS) {
    const fullPath = path.join(packageDir, doc);
    let text = "";
    try {
      text = readFileSync(fullPath, "utf8");
    } catch {
      addDiagnostic(diagnostics, "missing_packaged_doc", "expected packaged doc is missing", { doc });
      docs.push({ path: doc, ok: false });
      continue;
    }

    const docDiagnostics = [];
    for (const rule of requiredPatterns) {
      if (!rule.pattern.test(text)) {
        docDiagnostics.push({ code: rule.code, message: rule.message });
      }
    }
    for (const rule of stalePatterns) {
      if (rule.pattern.test(text)) {
        docDiagnostics.push({ code: rule.code, message: rule.message });
      }
    }
    if (/\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|Bearer\s+(?!values?\b|value\b)[A-Za-z0-9+/_=.:-]{10,}|sk-[A-Za-z0-9_-]{20,}|\b[A-Z_]*(?:TOKEN|API_KEY)[A-Z_]*\s*=\s*(?!<|\$|\$\{|\[REDACTED\]|redacted\b)[^\s#'"]{4,}/u.test(text)) {
      docDiagnostics.push({ code: "unsafe_content", message: "packaged doc contains unsafe local path or secret-looking content" });
    }
    if (/\b(?:sizeBytes|sizeInBytes)\s*[:=]\s*\d|tarball size\s*[:：]?\s*`?\d|\b(?:shasum|integrity)\s*[:=]\s*[A-Za-z0-9+/=_-]{16,}/iu.test(text)) {
      docDiagnostics.push({ code: "volatile_tarball_metadata", message: "packaged doc contains tarball size, shasum, or integrity wording" });
    }

    for (const diagnostic of docDiagnostics) {
      addDiagnostic(diagnostics, diagnostic.code, diagnostic.message, { doc });
    }
    docs.push({ path: doc, ok: docDiagnostics.length === 0, diagnostics: docDiagnostics.map((diagnostic) => diagnostic.code) });
  }

  return {
    schemaVersion: PACKAGED_DOCS_SCHEMA_VERSION,
    ok: diagnostics.length === 0,
    packageName,
    version,
    packageSource,
    packageSpec,
    docs,
    diagnostics,
    noAlpha3UnpublishedClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha3_unpublished_claim"),
    noAlpha4PublishedClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha4_published_claim"),
    noStaleAlpha3CurrentClaim: !diagnostics.some((diagnostic) => diagnostic.code === "stale_alpha3_current_claim"),
    noDryRunStopPoint: !diagnostics.some((diagnostic) => diagnostic.code === "dry_run_stop_point"),
    noPublishReadyCandidate: !diagnostics.some((diagnostic) => diagnostic.code === "publish_ready_candidate"),
    noOldDistTagClaim: !diagnostics.some((diagnostic) => diagnostic.code === "old_current_alpha_dist_tag_claim"),
  };
}
