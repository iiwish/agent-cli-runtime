# Stable Readiness Surface Audit

Status: P9-1 stable-readiness audit for the current pre-alpha runtime.

This is a repository-only audit document. It is not listed in `package.json` `files`, so it does not enter the npm package unless the package boundary is intentionally changed later. If this document becomes package-visible, the release target needs a fresh package-content check before it can be treated as release evidence.

The project remains pre-alpha / developer preview. The labels below describe readiness candidates for a later beta or stable decision; they are not a stable release statement.

## Classification Vocabulary

- `stable-candidate`: suitable to carry a later source-compatible or schema-compatible promise after beta/stable acceptance.
- `beta-candidate`: suitable for daemon or product-shell use, but still needs real consumer dogfood before a broad compatibility promise.
- `experimental`: usable in pre-alpha, but callers must expect shape or behavior changes.
- `internal`: implementation or repository workflow detail; consumers must not depend on it as public API.

## Surface Inventory

| Surface | Classification | Current contract |
| --- | --- | --- |
| Package root value exports | `stable-candidate` | The only package-root runtime value export is `createAgentRuntime`. Adding another root value is outside this audit. |
| Package root type exports for runtime facade, run/goal records, events, diagnostics, replay, store health, and store repair | `stable-candidate` | These are the supported source-compatible import boundary for embedders. |
| `AgentRuntime.detect`, `detectStream`, `run`, `createGoal`, `cancelRun`, `cancelGoal`, `shutdown`, run/goal status, replay, store inspection, and diagnostics facade methods | `stable-candidate` | These methods form the local execution-kernel facade. The historical `getRunEvents` / `getGoalEvents` aliases remain pre-alpha compatibility aliases; README-facing contract uses `replay*`. |
| `AgentRuntime.getAdapter` and `RuntimeOptions.adapters` | `experimental` | These are adapter experimentation points and are not stable-candidate until adapter-authoring compatibility is proven by external consumers. |
| CLI command set for `agents`, `doctor`, `run`, `goal`, run/goal replay/status, store health/lock/repair, diagnostics, conformance, and smoke | `beta-candidate` | CLI JSON output is versioned where intended for machines. Human command text and help copy remain pre-alpha. |
| CLI JSON schemas listed in the inventory below | `stable-candidate` | Same-version additions may add optional fields. Removing, renaming, changing types, or changing classification vocabulary requires docs, tests, and a version bump. |
| Terminal reason vocabulary | `stable-candidate` | `success`, `failed`, `timeout`, `canceled`, `interrupted`, `validation_failed`, `execution_failed`, `unavailable`, `auth_missing`, `task_graph_invalid`. |
| Real smoke and conformance classification vocabulary | `stable-candidate` | `success`, `real_run_skipped`, `auth_missing`, `unavailable_executable`, `unsupported_flag`, `needs_verification`, `unexpected_output`, `cwd_mutated`, `timeout`, `failed`. Skip states are not success. |
| Built-in Codex, Claude Code, and OpenCode compatibility profiles | `beta-candidate` | Fake-CLI and safe-preflight evidence support daemon use, while CLI drift can still require profile updates. |
| Adapter authoring extension types: `AgentAdapterDef`, `BuildArgsInput`, `PromptTransport`, `StreamParser`, `AdapterCompatibilityProfile` | `experimental` | These remain extension types for pre-alpha adapter experiments. They are not stable-candidate in P9-1. |
| Internal `dist/**` subpaths | `internal` | The tarball may contain internal files for declarations and CLI execution. Subpath imports under `dist/**` are unsupported. |
| Built-in adapter values, parser helpers, executable resolution, stores, schedulers, task-graph helpers, and storage modules | `internal` | These are implementation details and must not be documented as public API. |
| Daemon embedding gate and runtime safety gate | `beta-candidate` | `daemon:verify` and `runtime:safety` prove installed-tarball local-kernel behavior with fake CLIs. They do not create a hosted daemon contract. |
| Release verification, published verification, package-content, packaged-docs, and compatibility evidence schemas | `beta-candidate` | These are repository/release gate contracts. They are not runtime public API for package consumers. |
| Repo-only scripts for release evidence, real compatibility evidence, published verification, package-content equivalence, artifact normalization, and package checks | `internal` | Script outputs can be versioned, but the scripts themselves are repository workflow surfaces, not package-root public contract. |
| `.release-evidence/`, downloaded verification material, raw workflow logs, and local machine observations | `internal` | These are evidence inputs or summaries outside the npm package boundary. |

## Schema Inventory

This list is synchronized with `src/core/schema-contract.ts`.

| Schema | Classification |
| --- | --- |
| `agent-runtime.event.v1` | `stable-candidate` |
| `agent-runtime.diagnostics.v1` | `stable-candidate` |
| `agent-runtime.conformance.v1` | `stable-candidate` |
| `agent-runtime.daemonVerification.v1` | `beta-candidate` |
| `agent-runtime.runtimeSafety.v1` | `beta-candidate` |
| `agent-runtime.publishedDaemonConsumer.v1` | `beta-candidate` |
| `agent-runtime.publishedAdapters.v1` | `beta-candidate` |
| `agent-cli-runtime.publishedSmoke.v1` | `beta-candidate` |
| `agent-cli-runtime.publishedVerification.v1` | `beta-candidate` |
| `agent-cli-runtime.packagedDocsVerification.v1` | `beta-candidate` |
| `agent-cli-runtime.postAlphaEvidence.v1` | `beta-candidate` |
| `agent-cli-runtime.realCompatibilityMatrix.v1` | `beta-candidate` |
| `agent-cli-runtime.realCompatibilityEvidenceVerification.v1` | `beta-candidate` |
| `agent-runtime.realSmoke.v1` | `stable-candidate` |
| `agent-runtime.storeHealth.v1` | `stable-candidate` |
| `agent-runtime.storeRepair.v1` | `stable-candidate` |
| `agent-runtime.cliError.v1` | `stable-candidate` |
| `agent-cli-runtime.releaseVerification.v1` | `beta-candidate` |
| `agent-cli-runtime.releaseGateEvidence.v1` | `beta-candidate` |
| `agent-cli-runtime.releaseArtifactNormalization.v1` | `beta-candidate` |
| `agent-cli-runtime.packageContentEquivalence.v1` | `beta-candidate` |

## Stable Gaps

- `getAdapter` and `RuntimeOptions.adapters` remain `experimental`; adapter authoring needs real external consumer dogfood before any stable promise.
- Internal `dist/**` subpath imports remain unsupported, even when those files appear in the tarball.
- CLI JSON schemas have a versioning policy, but command removal or flag semantic changes still need an explicit pre-alpha breaking-change note.
- Release evidence schemas are repository and release-gate contracts; they do not become runtime public API for package consumers.
- Codex `session` and `authProbe` remain in `needsVerification`.
- Claude Code `session.id` and `reasoning` remain in `needsVerification`.
- OpenCode `extraAllowedDirs`, `session`, and `permissionPolicy.read-only` remain in `needsVerification`.
- The project must keep stable-readiness wording separate from a stable release claim until a later beta/stable acceptance pass closes these gaps.

## Package Boundary Decision

`docs/stable-readiness.md` is repository documentation in P9-1. It is intentionally absent from `package.json` `files`; package-visible docs remain `README.md`, `README.zh-CN.md`, and the existing packaged docs listed there.
