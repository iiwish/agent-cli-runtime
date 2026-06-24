# Release Evidence

This directory is the repository-local landing zone for volatile release-candidate and published-verification evidence such as GitHub Actions run ids, artifact ids, artifact digests, tarball shasums, downloaded artifact paths, registry summaries, and command transcripts.

Evidence files here are intentionally outside the npm package boundary. The published package may include stable release process docs, but it must not include current-head volatile evidence that changes whenever a fresh release-candidate workflow runs.

For a fresh alpha release-candidate review:

1. Confirm `git rev-parse HEAD`, `git rev-parse origin/main`, and the remote `origin/main` SHA all match.
2. Trigger `.github/workflows/release-candidate.yml` for that commit.
3. Download all five artifacts and normalize them into one local review directory. The `agent-cli-runtime-gate-evidence` artifact must include `daemon:verify`, `runtime:safety`, and `compat:real:evidence:verify`.
4. Run `npm run release:verify -- --dir <normalized-artifact-dir>`.
5. Record the run URL, head SHA, artifact list, verification result, local gate results, and go/no-go decision in a local evidence file under this directory.

For a fresh published package verification review, trigger `.github/workflows/published-package-verification.yml`, confirm the run `headSha`, download `agent-cli-runtime-published-verification`, run `npm run published:verify:evidence -- --dir <normalized-downloaded-artifact-dir>`, and record only redacted summary metadata here.

For a real CLI compatibility refresh, run `npm run compat:real:evidence` for safe preflight only. Add authenticated smoke evidence only with explicit `--allow-real-run --agent <id> --expect-text <text>` pairs. The evidence file should keep summarized classifications, versions, auth/model sources, `needsVerification` decisions, cwd-mutation result fields, and explicit `gitDirty` / dirty summary fields only; do not store raw CLI stdout/stderr or full prompts.

After writing real compatibility evidence, run `npm run compat:real:evidence:verify`. The P6-2 verifier is offline: it reads `.release-evidence/p6-1-real-cli-compatibility.json` by default, supports `--file <path>` for alternate evidence, and does not start authenticated real agent runs. It rejects unsafe content, missing dirty-state evidence, skipped/auth-missing states claimed as success, incomplete authenticated success evidence, missing required `needsVerification` audit items, and invalid repo-only package-boundary claims. Use `npm run compat:real:evidence:verify -- --self-test` to exercise the verifier's local rejection fixtures.

P6-3 integrates that offline verifier into `prepublish:check` and `release:candidate`. This integration re-verifies existing repo-only compatibility evidence; it does not run `npm run compat:real:evidence`, does not pass `--allow-real-run`, and does not refresh authenticated real CLI evidence. Release-candidate `gate-evidence.json` stores only the compatibility verifier command, ok flag, verifier schema, verified evidence schema, and diagnostic count/codes. Do not copy the raw `.release-evidence/p6-1-real-cli-compatibility.json` file, raw stdout/stderr, diagnostic messages, full prompts, private paths, tokens, Bearer values, or auth env values into release artifacts.

Do not put `.reference/`, temporary download directories, private user paths, CI tokens, npm tokens, or real provider tokens in this directory.
