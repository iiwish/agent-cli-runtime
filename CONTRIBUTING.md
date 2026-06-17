# Contributing to Agent CLI Runtime

Thanks for contributing.

## Current status

`agent-cli-runtime` is a **pre-alpha / developer preview** project. APIs are intentionally small and may still change before a stable release.

## Development setup

```bash
npm ci
npm run build
npm test
```

Use these for local checks:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run ci`

## Adding adapter/parser fixtures

Current parser fixtures live in:

- `tests/fixtures/streams/` (parser replay fixtures),
- `src/smoke/parser-fixtures.ts` (fixture runner registration).

When adding fixtures:

1. Keep fixtures as minimal reproductions of real streams.
2. Add assertions in parser/contract tests that match the fixture contract.
3. Keep raw sensitive values redacted; do not commit real tokens.
4. Name fixtures by adapter and expected output contract (`<adapter>-*.jsonl`).

## `.reference/` and clean-room boundary

- `.reference/` is read-only design-reference material.
- Do not import `.reference/` code as production implementation.
- Keep public package files clean-room:
  - no `.reference/`,
  - no tests/fixtures,
  - no private local paths,
  - no raw output from real secret-bearing sessions.

## Apache-2.0 contribution boundary

- This project is under Apache-2.0.
- Contributions should remain within this license scope.
- If you add third-party snippets, preserve original license headers and attribution.

## What to include in a PR

- Short rationale and expected behavior change.
- Test proof (at least one relevant automated test).
- Security and redaction consideration (if behavior touches CLI output or diagnostics).

