# Release Evidence

This directory is the repository-local landing zone for volatile release-candidate and published-verification evidence such as GitHub Actions run ids, artifact ids, artifact digests, tarball shasums, downloaded artifact paths, registry summaries, and command transcripts.

Evidence files here are intentionally outside the npm package boundary. The published package may include stable release process docs, but it must not include current-head volatile evidence that changes whenever a fresh release-candidate workflow runs.

For a fresh alpha release-candidate review:

1. Confirm `git rev-parse HEAD`, `git rev-parse origin/main`, and the remote `origin/main` SHA all match.
2. Trigger `.github/workflows/release-candidate.yml` for that commit.
3. Download all five artifacts and normalize them into one local review directory.
4. Run `npm run release:verify -- --dir <normalized-artifact-dir>`.
5. Record the run URL, head SHA, artifact list, verification result, local gate results, and go/no-go decision in a local evidence file under this directory.

For a fresh published package verification review, trigger `.github/workflows/published-package-verification.yml`, confirm the run `headSha`, download `agent-cli-runtime-published-verification`, run `npm run published:verify:evidence -- --dir <normalized-downloaded-artifact-dir>`, and record only redacted summary metadata here.

Do not put `.reference/`, temporary download directories, private user paths, CI tokens, npm tokens, or real provider tokens in this directory.
