# Changelog

## 0.1.0-alpha.0 — pre-alpha developer preview (release-candidate hardening)

- Release hygiene and package boundary finalization for P1-8.
- Added `CHANGELOG.md`, `SECURITY.md`, and `CONTRIBUTING.md`.
- Clarified API and install contract: package root intentionally exposes only `createAgentRuntime` as the value export and public facade types; adapter/parser/internal helpers stay internal.
- Added npm install smoke verification path (pack → install → ESM import → CLI execution) into contract tests.
- Documented pre-alpha / developer preview API stability and scope:
  - no stable API guarantee,
  - no daemon,
  - no WAL,
  - no remote runtime mode.
- Confirmed package packaging boundary excludes `.reference/`, `tests/`, and fixture directories; redaction and secrets hygiene remains enforced in diagnostics and package artifacts.

