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
    code: "alpha4_unpublished_claim",
    message: "alpha.4 package docs must not describe alpha.4 as unpublished or still waiting for the publish decision.",
    pattern:
      /(?:0\.1\.0-alpha\.4|alpha\.4)[^\n]{0,180}(?:not published|unpublished|not yet published|release-prep package candidate|next package candidate|before any human publish decision|requires fresh P9-6|requires fresh main release-candidate evidence|未发布|尚未发布|发布准备中的 package candidate|进入 human publish decision)/iu,
  },
  {
    code: "alpha4_github_release_missing_claim",
    message: "alpha.4 package docs must not describe GitHub Release v0.1.0-alpha.4 as missing after it is created.",
    pattern:
      /(?:GitHub Release|GitHub pre-release)[^\n]{0,160}(?:v0\.1\.0-alpha\.4)[^\n]{0,160}(?:not created|not yet created|missing|absent|blocked until[^\n]{0,120}(?:exist|exists)|未创建|尚未创建)|(?:v0\.1\.0-alpha\.4|alpha\.4)[^\n]{0,220}(?:blocked until|remains blocked until)[^\n]{0,160}(?:GitHub Release|GitHub pre-release)[^\n]{0,160}(?:v0\.1\.0-alpha\.4)[^\n]{0,160}(?:exist|exists|created|available)|(?:blocked until|remains blocked until)[^\n]{0,160}(?:GitHub Release|GitHub pre-release)[^\n]{0,160}(?:v0\.1\.0-alpha\.4)[^\n]{0,160}(?:exist|exists|created|available)|(?:v0\.1\.0-alpha\.4)[^\n]{0,160}(?:GitHub Release|GitHub pre-release)[^\n]{0,160}(?:not created|not yet created|missing|absent|blocked until[^\n]{0,120}(?:exist|exists)|未创建|尚未创建)/iu,
  },
  {
    code: "stale_alpha3_current_claim",
    message: "alpha.4 package docs must not keep alpha.3 as the current corrective package line.",
    pattern:
      /(?:Status:[^\n]*0\.1\.0-alpha\.3[^\n]*corrective pre-alpha release|Corrective package line:\s*`?agent-cli-runtime@0\.1\.0-alpha\.3`?|Version\s+`?0\.1\.0-alpha\.3`?\s+is the corrective pre-alpha release for package consumers|`?0\.1\.0-alpha\.3`?\s+是面向 package consumer 的 corrective pre-alpha release|`?0\.1\.0-alpha\.3`?\s+是 corrective pre-alpha release)/iu,
  },
];

const alpha5StalePatterns = [
  {
    code: "alpha5_unpublished_claim",
    message: "alpha.5 package docs must not describe alpha.5 as unpublished or still waiting for publish.",
    pattern:
      /(?:0\.1\.0-alpha\.5|alpha\.5)[^\n]{0,220}(?:not published|unpublished|not yet published|before any explicit maintainer authorization for real publish|before any human publish decision|requires fresh release-candidate evidence before[^\n]{0,80}publish|未发布|尚未发布|发布前必须先|人工授权前)/iu,
  },
  {
    code: "alpha5_github_release_missing_claim",
    message: "alpha.5 package docs must not describe GitHub Release v0.1.0-alpha.5 as missing after it is created.",
    pattern:
      /(?:GitHub Release|GitHub pre-release)[^\n]{0,160}(?:v0\.1\.0-alpha\.5)[^\n]{0,160}(?:not created|not yet created|missing|absent|blocked until[^\n]{0,120}(?:exist|exists)|未创建|尚未创建)|(?:v0\.1\.0-alpha\.5|alpha\.5)[^\n]{0,220}(?:blocked until|remains blocked until)[^\n]{0,160}(?:GitHub Release|GitHub pre-release)[^\n]{0,160}(?:exist|exists|created|available)/iu,
  },
  {
    code: "alpha5_old_latest_alpha1_claim",
    message: "alpha.5 package docs must not claim latest remains on alpha.1 after the alpha.5 retag.",
    pattern:
      /(?:latest|npm latest|latest dist-tag)[^\n]{0,120}(?:remains|still|points at|points to|仍指向|仍停在|保持在)\s*(?:on\s*)?`?0\.1\.0-alpha\.1`?/iu,
  },
  {
    code: "alpha5_old_alpha4_current_tag_claim",
    message: "alpha.5 package docs must not claim alpha.4 is the current alpha dist-tag target after the alpha.5 publish.",
    pattern:
      /(?:alpha\.4 remains the npm `?alpha`? version|alpha\.4 remains the npm|alpha\.4[^\n]{0,120}current npm `?alpha`?|alpha\.4[^\n]{0,120}alpha dist-tag points|alpha\s*(?:dist-tag|tag)[^\n]{0,120}(?:points at|points to|指向)\s*`?0\.1\.0-alpha\.4`?|alpha\.4 是当前 npm `?alpha`? 版本|alpha\.4[^\n]{0,120}`?alpha`? dist-tag 指向)/iu,
  },
  {
    code: "alpha5_published_verification_pass_claim",
    message: "package docs must not claim aggregate published verification passes for alpha.5 after the stale-docs incident.",
    pattern:
      /(?:published:verify|published:verify:evidence|published verification|published verifier|aggregate published verification|发布后验证)[^\n]{0,260}(?:pass|passes|passed|ok|通过)[^\n]{0,160}(?:0\.1\.0-alpha\.5|alpha\.5)|(?:0\.1\.0-alpha\.5|alpha\.5)[^\n]{0,260}(?:published:verify|published:verify:evidence|published verification|published verifier|aggregate published verification|发布后验证)[^\n]{0,260}(?:pass|passes|passed|ok|通过)/iu,
  },
];

const alpha6StalePatterns = [
  {
    code: "alpha6_published_claim",
    message: "alpha.6 package docs must not describe alpha.6 as already published.",
    pattern:
      /(?:0\.1\.0-alpha\.6|alpha\.6)[^\n]{0,120}(?:published on npm|published pre-alpha|published corrective alpha release|is published|already published|已发布到 npm|已经发布到 npm|已发布的 corrective alpha release)/iu,
  },
  {
    code: "alpha6_dist_tag_claim",
    message: "alpha.6 package docs must not claim npm dist-tags already point at alpha.6.",
    pattern:
      /(?:alpha|latest|dist-tags?)[^\n]{0,160}(?:points at|points to|指向|均指向)\s*`?0\.1\.0-alpha\.6`?|0\.1\.0-alpha\.6[^\n]{0,160}(?:alpha|latest|dist-tags?)[^\n]{0,160}(?:points at|points to|指向|均指向)\s*`?0\.1\.0-alpha\.6`?/iu,
  },
  {
    code: "alpha6_github_release_created_claim",
    message: "alpha.6 package docs must not describe GitHub Release v0.1.0-alpha.6 as already created.",
    pattern:
      /(?:GitHub Release|GitHub pre-release)[^\n]{0,180}v0\.1\.0-alpha\.6[^\n]{0,220}(?:created|exists|prerelease|pre-release|tarball asset|已创建|已有|已上传)|v0\.1\.0-alpha\.6[^\n]{0,180}(?:GitHub Release|GitHub pre-release)[^\n]{0,220}(?:created|exists|prerelease|pre-release|tarball asset|已创建|已有|已上传)/iu,
  },
  {
    code: "alpha6_published_verification_pass_claim",
    message: "alpha.6 package docs must not claim published verification passes before alpha.6 is published.",
    pattern:
      /(?:0\.1\.0-alpha\.6|alpha\.6)[^\n]{0,260}(?:published:verify|published:verify:evidence|published verification|published verifier|发布后验证)[^\n]{0,260}(?:pass|passes|passed|ok|通过)|(?:published:verify|published:verify:evidence|published verification|published verifier|发布后验证)[^\n]{0,260}(?:pass|passes|passed|ok|通过)[^\n]{0,160}(?:0\.1\.0-alpha\.6|alpha\.6)/iu,
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
    message: "packaged docs must mention the alpha.4 release.",
    pattern: /0\.1\.0-alpha\.4/u,
  },
  {
    code: "missing_alpha4_published_state",
    message: "packaged docs must describe alpha.4 as published on npm.",
    pattern: /(?:0\.1\.0-alpha\.4|alpha\.4)[^\n]{0,180}(?:published on npm|published pre-alpha|npm package is published|已发布到 npm|已经发布到 npm)/iu,
  },
  {
    code: "missing_alpha4_alpha_tag",
    message: "packaged docs must state that the alpha dist-tag points at alpha.4.",
    pattern: /(?:alpha\s*(?:dist-tag|tag)|dist-tags)[^\n]{0,120}0\.1\.0-alpha\.4|0\.1\.0-alpha\.4[^\n]{0,120}(?:alpha\s*(?:dist-tag|tag)|dist-tag)/iu,
  },
  {
    code: "missing_alpha4_github_release_state",
    message: "packaged docs must state that GitHub Release v0.1.0-alpha.4 exists with the npm registry tarball asset.",
    pattern: /(?:GitHub Release|GitHub pre-release)[^\n]{0,180}v0\.1\.0-alpha\.4[^\n]{0,220}(?:created|exists|prerelease|pre-release|tarball asset|已创建|已有|已上传)|v0\.1\.0-alpha\.4[^\n]{0,180}(?:GitHub Release|GitHub pre-release)[^\n]{0,220}(?:created|exists|prerelease|pre-release|tarball asset|已创建|已有|已上传)/iu,
  },
  {
    code: "missing_alpha4_github_release_parity",
    message: "packaged docs must state that alpha.4 GitHub Release tarball parity now passes.",
    pattern: /(?:release:post-alpha:verify|GitHub Release tarball parity|tarball parity|parity verification)[^\n]{0,180}(?:pass|passes|passed|closed|ok|通过|闭合)/iu,
  },
  {
    code: "missing_alpha4_stale_docs_incident",
    message: "packaged docs must record that the published alpha.4 npm tarball contains stale release-prep docs.",
    pattern: /(?:0\.1\.0-alpha\.4|alpha\.4)[^\n]{0,220}(?:stale|pre-publish|release-prep|过期|发布前)[^\n]{0,160}(?:package docs|packaged docs|tarball docs|docs)|(?:package docs|packaged docs|tarball docs|docs)[^\n]{0,160}(?:stale|pre-publish|release-prep|过期|发布前)[^\n]{0,220}(?:0\.1\.0-alpha\.4|alpha\.4)/iu,
  },
  {
    code: "missing_alpha3_history",
    message: "packaged docs must keep alpha.3 as historical corrective release context.",
    pattern: /0\.1\.0-alpha\.3/u,
  },
];

const alpha4HistoricalRequiredPatterns = alpha4RequiredPatterns.filter(
  (rule) => rule.code !== "missing_alpha4_alpha_tag",
);

const alpha5RequiredPatterns = [
  {
    code: "missing_alpha5",
    message: "packaged docs must mention the alpha.5 corrective release.",
    pattern: /0\.1\.0-alpha\.5/u,
  },
  {
    code: "missing_alpha5_corrective_context",
    message: "packaged docs must describe alpha.5 as the published alpha.5 corrective attempt after alpha.4 stale docs.",
    pattern:
      /(?:0\.1\.0-alpha\.5|alpha\.5)[^\n]{0,260}(?:corrective|replace stale alpha\.4 package docs|替换[^\n]{0,80}alpha\.4|纠偏[^\n]{0,80}alpha|stale alpha\.4 package docs)|(?:corrective|replace stale alpha\.4 package docs|替换[^\n]{0,80}alpha\.4|纠偏[^\n]{0,80}alpha|stale alpha\.4 package docs)[^\n]{0,260}(?:0\.1\.0-alpha\.5|alpha\.5)/iu,
  },
  {
    code: "missing_alpha5_published_state",
    message: "packaged docs must describe alpha.5 as published on npm.",
    pattern:
      /(?:0\.1\.0-alpha\.5|alpha\.5)[^\n]{0,180}(?:published on npm|published pre-alpha|published corrective alpha release|npm package is published|已发布到 npm|已经发布到 npm|已发布的 corrective alpha release)/iu,
  },
  {
    code: "missing_alpha5_alpha_tag",
    message: "packaged docs must state that the alpha dist-tag points at alpha.5.",
    pattern:
      /(?:(?:`?alpha`?)\s*(?:dist-tag|tag)|dist-tags)[^\n]{0,120}0\.1\.0-alpha\.5|0\.1\.0-alpha\.5[^\n]{0,120}(?:(?:`?alpha`?)\s*(?:dist-tag|tag)|dist-tag)/iu,
  },
  {
    code: "missing_alpha5_latest_tag",
    message: "packaged docs must state that the latest dist-tag points at alpha.5.",
    pattern:
      /(?:(?:`?latest`?)\s*(?:dist-tag|tag)|dist-tags)[^\n]{0,120}0\.1\.0-alpha\.5|0\.1\.0-alpha\.5[^\n]{0,120}(?:(?:`?latest`?)\s*(?:dist-tag|tag)|dist-tag)/iu,
  },
  {
    code: "missing_alpha5_github_release_state",
    message: "packaged docs must state that GitHub Release v0.1.0-alpha.5 exists with the npm registry tarball asset.",
    pattern:
      /(?:GitHub Release|GitHub pre-release)[^\n]{0,180}v0\.1\.0-alpha\.5[^\n]{0,220}(?:created|exists|prerelease|pre-release|tarball asset|已创建|已有|已上传)|v0\.1\.0-alpha\.5[^\n]{0,180}(?:GitHub Release|GitHub pre-release)[^\n]{0,220}(?:created|exists|prerelease|pre-release|tarball asset|已创建|已有|已上传)/iu,
  },
  {
    code: "missing_alpha5_github_release_parity",
    message: "packaged docs must state that alpha.5 GitHub Release tarball parity passes.",
    pattern: /(?:release:post-alpha:verify|GitHub Release tarball parity|tarball parity|parity verification)[^\n]{0,220}(?:pass|passes|passed|closed|ok|通过|闭合)/iu,
  },
  {
    code: "missing_alpha5_stale_docs_incident",
    message: "packaged docs must record that the published alpha.5 npm tarball contains stale package docs.",
    pattern:
      /(?:0\.1\.0-alpha\.5|alpha\.5)[^\n]{0,260}(?:stale|pre-publish|release-prep|过期|发布前)[^\n]{0,180}(?:package docs|packaged docs|tarball docs|docs)|(?:package docs|packaged docs|tarball docs|docs)[^\n]{0,180}(?:stale|pre-publish|release-prep|过期|发布前)[^\n]{0,260}(?:0\.1\.0-alpha\.5|alpha\.5)/iu,
  },
  {
    code: "missing_alpha5_published_verification_failure",
    message: "packaged docs must state that aggregate published verification fails for alpha.5 because registry packaged docs are stale.",
    pattern:
      /(?:published:verify|published:verify:evidence|published verification|published verifier|aggregate published verification|发布后验证)[^\n]{0,260}(?:fail|fails|failed|blocked|registry_packaged_docs_failed|失败|未通过)[^\n]{0,180}(?:0\.1\.0-alpha\.5|alpha\.5|stale|package docs|docs)|(?:0\.1\.0-alpha\.5|alpha\.5)[^\n]{0,260}(?:published:verify|published:verify:evidence|published verification|published verifier|aggregate published verification|发布后验证)[^\n]{0,260}(?:fail|fails|failed|blocked|registry_packaged_docs_failed|失败|未通过)/iu,
  },
  {
    code: "missing_future_fresh_evidence_gate",
    message: "packaged docs must require fresh evidence before alpha.6 publish and any future beta or stable promotion.",
    pattern:
      /(?:alpha\.6|0\.1\.0-alpha\.6|future beta|future stable|beta\/stable|beta or stable|后续 alpha\.6|后续 beta|后续 stable|未来 beta|未来 stable)[^\n]{0,260}(?:fresh release evidence|fresh evidence|fresh release-candidate|fresh published verification|fresh gate|新鲜[^\n]{0,80}证据|重新生成[^\n]{0,80}证据)|(?:fresh release evidence|fresh evidence|fresh release-candidate|fresh published verification|fresh gate|新鲜[^\n]{0,80}证据|重新生成[^\n]{0,80}证据)[^\n]{0,260}(?:alpha\.6|0\.1\.0-alpha\.6|future beta|future stable|beta\/stable|beta or stable|后续 alpha\.6|后续 beta|后续 stable|未来 beta|未来 stable)/iu,
  },
];

const alpha6RequiredPatterns = [
  {
    code: "missing_alpha6",
    message: "packaged docs must mention the alpha.6 corrective target.",
    pattern: /0\.1\.0-alpha\.6/u,
  },
  {
    code: "missing_alpha6_corrective_target",
    message: "packaged docs must describe alpha.6 as the next corrective alpha target.",
    pattern:
      /(?:0\.1\.0-alpha\.6|alpha\.6)[^\n]{0,260}(?:corrective alpha target|corrective target|next corrective|下一次 corrective|下一个 corrective|纠偏[^\n]{0,80}目标|候选目标)|(?:corrective alpha target|corrective target|next corrective|下一次 corrective|下一个 corrective|纠偏[^\n]{0,80}目标|候选目标)[^\n]{0,260}(?:0\.1\.0-alpha\.6|alpha\.6)/iu,
  },
  {
    code: "missing_alpha6_unpublished_state",
    message: "packaged docs must state that alpha.6 is not yet published.",
    pattern:
      /(?:0\.1\.0-alpha\.6|alpha\.6)[^\n]{0,220}(?:not published|not yet published|has not been published|unpublished|尚未发布|未发布)/iu,
  },
  {
    code: "missing_alpha6_authorization_gate",
    message: "packaged docs must state that alpha.6 real publish and registry or GitHub mutations require explicit authorization.",
    pattern:
      /(?:0\.1\.0-alpha\.6|alpha\.6)[^\n]{0,260}(?:explicit maintainer authorization|explicit authorization|human authorization|明确授权|人工授权)[^\n]{0,220}(?:publish|dist-tag|GitHub Release|registry|发布|标签|mutation|变更)|(?:0\.1\.0-alpha\.6|alpha\.6)[^\n]{0,260}(?:publish|dist-tag|GitHub Release|registry|发布|标签|mutation|变更)[^\n]{0,260}(?:explicit maintainer authorization|explicit authorization|human authorization|明确授权|人工授权)|(?:publish|dist-tag|GitHub Release|registry|发布|标签|mutation|变更)[^\n]{0,220}(?:0\.1\.0-alpha\.6|alpha\.6)[^\n]{0,260}(?:explicit maintainer authorization|explicit authorization|human authorization|明确授权|人工授权)/iu,
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

  let versionRequiredPatterns = alpha3RequiredPatterns;
  let versionStalePatterns = alpha3StalePatterns;
  if (version === "0.1.0-alpha.4") {
    versionRequiredPatterns = alpha4RequiredPatterns;
    versionStalePatterns = alpha4StalePatterns;
  } else if (version === "0.1.0-alpha.5") {
    versionRequiredPatterns = [
      ...alpha4HistoricalRequiredPatterns,
      ...alpha5RequiredPatterns,
    ];
    versionStalePatterns = [
      ...alpha4StalePatterns,
      ...alpha5StalePatterns,
    ];
  } else if (version === "0.1.0-alpha.6") {
    versionRequiredPatterns = [
      ...alpha4HistoricalRequiredPatterns,
      ...alpha5RequiredPatterns,
      ...alpha6RequiredPatterns,
    ];
    versionStalePatterns = [
      ...alpha4StalePatterns,
      ...alpha5StalePatterns,
      ...alpha6StalePatterns,
    ];
  }
  const requiredPatterns = [
    ...commonRequiredPatterns,
    ...versionRequiredPatterns,
  ];
  const stalePatterns = [
    ...commonStalePatterns,
    ...versionStalePatterns,
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
    noAlpha4PublishedClaim: true,
    noAlpha4UnpublishedClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha4_unpublished_claim"),
    noAlpha4GithubReleaseMissingClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha4_github_release_missing_claim"),
    noAlpha5PublishedClaim: true,
    noAlpha5GithubReleaseCreatedClaim: true,
    noAlpha5UnpublishedClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha5_unpublished_claim"),
    noAlpha5GithubReleaseMissingClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha5_github_release_missing_claim"),
    noAlpha5OldLatestAlpha1Claim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha5_old_latest_alpha1_claim"),
    noAlpha5OldAlpha4CurrentTagClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha5_old_alpha4_current_tag_claim"),
    noAlpha5PublishedVerificationPassClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha5_published_verification_pass_claim"),
    alpha5StaleDocsIncidentRecorded: !diagnostics.some((diagnostic) => diagnostic.code === "missing_alpha5_stale_docs_incident"),
    alpha5PublishedVerificationFailureRecorded: !diagnostics.some((diagnostic) => diagnostic.code === "missing_alpha5_published_verification_failure"),
    noAlpha6PublishedClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha6_published_claim"),
    noAlpha6DistTagClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha6_dist_tag_claim"),
    noAlpha6GithubReleaseCreatedClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha6_github_release_created_claim"),
    noAlpha6PublishedVerificationPassClaim: !diagnostics.some((diagnostic) => diagnostic.code === "alpha6_published_verification_pass_claim"),
    alpha6UnpublishedStateRecorded: !diagnostics.some((diagnostic) => diagnostic.code === "missing_alpha6_unpublished_state"),
    alpha6FuturePublishGateRecorded: !diagnostics.some((diagnostic) => diagnostic.code === "missing_alpha6_authorization_gate" || diagnostic.code === "missing_future_fresh_evidence_gate"),
    noStaleAlpha3CurrentClaim: !diagnostics.some((diagnostic) => diagnostic.code === "stale_alpha3_current_claim"),
    noDryRunStopPoint: !diagnostics.some((diagnostic) => diagnostic.code === "dry_run_stop_point"),
    noPublishReadyCandidate: !diagnostics.some((diagnostic) => diagnostic.code === "publish_ready_candidate"),
    noOldDistTagClaim: !diagnostics.some((diagnostic) => diagnostic.code === "old_current_alpha_dist_tag_claim"),
  };
}
