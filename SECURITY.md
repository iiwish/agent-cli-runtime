# Security Policy

Thank you for helping keep `agent-cli-runtime` safe.

## Reporting a security issue

- Open an issue in this repository with a clear reproduction path and sample log snippets (redacted).
- If you believe the issue could cause immediate impact, report it as a private advisory through the repository's security/contact channel and include:
  - impact scenario,
  - affected version,
  - proof steps,
  - suggested timeline.
- Do not paste raw tokens, session identifiers, or absolute private paths in issue text.

## Secrets and redaction policy

- This project redacts secret-looking values at diagnostic and event boundaries.
- `redactText` and `redactUnknown` are required for:
  - tokens / Bearer-like values,
  - auth-token assignments (for example `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, etc.),
  - private absolute paths and similar local environment evidence.
- Storage diagnostics and redacted exports must not include raw values from secrets or absolute private paths.

## Repository content rules

- Do not commit real tokens, real CLI outputs, or raw private paths in docs, fixtures, or test artifacts.
- `docs/fixtures`, when present in future, must not include `sk-*`, `Bearer`, or real auth/session values.
- The `.reference/` tree is source-of-inspiration only and must not be published via package files.

## Runtime boundaries

- The runtime must not bypass the user CLI permission model.
- `cwd`, `extraAllowedDirs`, and permission policy selection are explicit and visible in request inputs.
- If a runtime behavior request requires stronger privilege than currently expressed in `RunRequest`, the feature must be explicitly surfaced as a non-default request path before implementation.

