# CLI Dogfood

These commands are safe defaults for a local checkout. They do not launch an authenticated real agent run unless `--allow-real-run` is explicitly present.

## Local Checkout

```bash
npm ci
npm run build
npm run dogfood
```

`npm run dogfood` rebuilds the package, runs offline fixtures and fake conformance, performs real local detection/profile conformance without real runs, checks `agents` and `doctor`, performs an npm pack dry-run, installs the packed tarball into a temporary project, and verifies the installed package import plus CLI fixtures/fake paths.

## Fixtures And Fake Paths

```bash
node ./dist/cli/main.js conformance --mode fixtures --json
node ./dist/cli/main.js conformance --mode fake --json
node ./dist/cli/main.js smoke --mode fixtures --json
node ./dist/cli/main.js agents --json
node ./dist/cli/main.js doctor --json
```

Fixtures exercise parser contracts offline. Fake conformance creates temporary fake CLIs and runs the real adapter argv/stdin/parser path without real accounts, provider tokens, or network agent runs.

## Real Local Profile Conformance

```bash
node ./dist/cli/main.js conformance --mode real --agent all --json
```

This performs real executable/version/auth/model/profile certification. It does not launch a real agent run. Runnable adapters report `runClassification: "real_run_skipped"` and `skippedReason: "real_run_not_allowed"`.

## Optional Real Run

Run this only on a machine where the selected CLI is installed, authorized, and safe to use. Without `--cwd`, the command uses an isolated temporary cwd and asks for read-only behavior.

```bash
node ./dist/cli/main.js conformance \
  --mode real \
  --agent codex \
  --allow-real-run \
  --json \
  --timeout-ms 30000
```

Equivalent detailed smoke:

```bash
node ./dist/cli/main.js smoke \
  --mode real \
  --agent codex \
  --allow-real-run \
  --json \
  --diagnostics \
  --timeout-ms 30000
```

## Run And Goal

Use a disposable directory for manual mutation tests:

```bash
tmp="$(mktemp -d /tmp/agent-runtime-run-XXXXXX)"
node ./dist/cli/main.js run \
  --agent codex \
  --cwd "$tmp" \
  --permission workspace-write \
  --prompt "Create smoke.txt containing exactly: agent-runtime smoke ok" \
  --stream jsonl \
  --diagnostics
```

```bash
tmp="$(mktemp -d /tmp/agent-runtime-goal-XXXXXX)"
node ./dist/cli/main.js goal \
  --agent codex \
  --cwd "$tmp" \
  --permission workspace-write \
  --prompt "Create one file named goal-smoke.txt containing exactly: agent-runtime goal smoke ok" \
  --stream jsonl \
  --diagnostics
```

## Diagnostics And Store Health

```bash
store="$(mktemp -d /tmp/agent-runtime-store-XXXXXX)"
node ./dist/cli/main.js store-health --storage-dir "$store" --json
node ./dist/cli/main.js store-lock --storage-dir "$store" --json
node ./dist/cli/main.js store-repair --storage-dir "$store" --dry-run --json
```

After a stored run or goal exists:

```bash
node ./dist/cli/main.js runs --storage-dir "$store" --json
node ./dist/cli/main.js goals --storage-dir "$store" --json
node ./dist/cli/main.js replay-run run_123 --storage-dir "$store" --after 10 --jsonl
node ./dist/cli/main.js replay-goal goal_123 --storage-dir "$store" --after 10 --jsonl
node ./dist/cli/main.js diagnostics run run_123 --storage-dir "$store" --json
node ./dist/cli/main.js diagnostics goal goal_123 --storage-dir "$store" --json --out diagnostics-goal_123.json
```

## Package Boundary

```bash
npm pack --dry-run
npm pack --json --ignore-scripts --pack-destination "$(mktemp -d /tmp/agent-runtime-pack-XXXXXX)"
```

Before publishing, confirm the packed file list includes `dist/`, README files, `LICENSE`, `docs/`, and `examples/`, and excludes `.reference/`, `tests/`, fixture files, raw CLI output, real private paths, and secrets.
