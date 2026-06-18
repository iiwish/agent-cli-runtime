import { describe, expect, it } from "vitest";
import path from "node:path";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { constants, accessSync } from "node:fs";
import { parseCodexDebugModels } from "../src/adapters/codex.js";
import { parseLineSeparatedModels } from "../src/adapters/opencode.js";
import { detectAgents } from "../src/detection/detect.js";
import { resolveExecutable } from "../src/detection/executable-resolution.js";
import { fakeAdapter, tempDir, writeExecutable } from "./helpers.js";

describe("detection", () => {
  it("resolves executables in env override, primary bin, then fallback order", async () => {
    const dir = await tempDir();
    const fallback = await writeExecutable(dir, "fallback-agent", "console.log('fallback');");
    const primary = await writeExecutable(dir, "primary-agent", "console.log('primary');");
    const override = await writeExecutable(dir, "override-agent", "console.log('override');");
    accessSync(fallback, constants.X_OK);
    const adapter = fakeAdapter({
      bin: "primary-agent",
      fallbackBins: ["fallback-agent"],
      binEnvVar: "FAKE_BIN",
    });
    expect(resolveExecutable(adapter, { env: { PATH: dir } }).selectedPath).toBe(primary);
    expect(resolveExecutable(adapter, { env: { PATH: dir, FAKE_BIN: override } }).selectedPath).toBe(override);
  });

  it("isolates a failed adapter from other adapter detection", async () => {
    const dir = await tempDir();
    const goodAgent = await writeExecutable(dir, "good-agent", "if (process.argv[2] === '--version') console.log('good 1.0.0');");
    const good = fakeAdapter({ id: "good", bin: "good-agent", binEnvVar: "GOOD_AGENT_BIN" });
    const bad = fakeAdapter({ id: "bad", bin: "missing-agent", binEnvVar: undefined });
    const agents = await detectAgents(
      { adapters: [bad, good], env: { PATH: "", GOOD_AGENT_BIN: goodAgent }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    const badAgent = agents.find((agent) => agent.id === "bad");
    expect(badAgent?.available).toBe(false);
    expect(badAgent?.diagnostics[0]?.code).toBe("not_installed");
    expect(badAgent?.diagnostics[0]?.searchedLocations).toEqual(expect.arrayContaining([path.join(dir, "missing-agent")]));
    expect(agents.find((agent) => agent.id === "good")).toMatchObject({ available: true, path: goodAgent });
  });

  it("classifies existing non-executable detection candidates", async () => {
    if (process.platform === "win32") return;
    const dir = await tempDir();
    const notExecutable = path.join(dir, "not-executable-agent");
    await writeFile(notExecutable, "#!/usr/bin/env node\n", "utf8");
    await chmod(notExecutable, 0o644);
    const adapter = fakeAdapter({ id: "not-exec", bin: "not-executable-agent", binEnvVar: undefined });
    const agents = await detectAgents(
      { adapters: [adapter], env: { PATH: "" }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: false });
    expect(agents[0]?.diagnostics[0]?.code).toBe("not_executable");
    expect(agents[0]?.diagnostics[0]?.searchedLocations).toEqual(expect.arrayContaining([notExecutable]));
  });

  it("runs metadata probes in a neutral temp cwd", async () => {
    const dir = await tempDir();
    const project = await tempDir("agent-runtime-project-");
    const marker = "probe-marker.txt";
    const probeAgent = await writeExecutable(dir, "probe-agent", `
if (process.argv[2] === "--version") { require("fs").writeFileSync("${marker}", process.cwd()); console.log("probe 1.0.0"); process.exit(0); }
`);
    const adapter = fakeAdapter({ id: "probe", bin: "probe-agent" });
    const agents = await detectAgents(
      { adapters: [adapter], env: { PATH: "", FAKE_BIN: probeAgent }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: true, path: probeAgent });
    await expect(readFile(path.join(project, marker), "utf8")).rejects.toThrow();
  });

  it("records unsupported flag and redacted probe diagnostics without making the adapter unavailable", async () => {
    const dir = await tempDir();
    const modelAgent = await writeExecutable(dir, "model-agent", `
if (process.argv[2] === "--version") { console.log("model 1.0.0"); process.exit(0); }
if (process.argv[2] === "models") { console.error("unknown option --models token sk" + "A".repeat(20)); process.exit(2); }
`);
    const adapter = fakeAdapter({
      id: "model",
      bin: "model-agent",
      listModels: {
        args: ["models"],
        parse(stdout) {
          return parseLineSeparatedModels(stdout);
        },
      },
    });
    const agents = await detectAgents(
      { adapters: [adapter], env: { PATH: "", FAKE_BIN: modelAgent }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: true, modelsSource: "fallback", path: modelAgent });
    expect(agents[0]?.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported_flag",
        probe: "models",
        stderrTail: expect.stringContaining("[REDACTED]"),
      }),
    ]);
    expect(JSON.stringify(agents[0]?.diagnostics)).not.toContain("sk");
  });

  it("records unsupported capability flags from help output", async () => {
    const dir = await tempDir();
    const capAgent = await writeExecutable(dir, "cap-agent", `
if (process.argv[2] === "--version") { console.log("cap 1.0.0"); process.exit(0); }
if (process.argv[2] === "help") { console.log("Usage: cap-agent --verified-flag"); process.exit(0); }
`);
    const adapter = fakeAdapter({
      id: "cap",
      bin: "cap-agent",
      helpArgs: ["help"],
      capabilityFlags: {
        "--verified-flag": "verified",
        "--missing-flag": "missing",
      },
    });
    const agents = await detectAgents(
      { adapters: [adapter], env: { PATH: "", FAKE_BIN: capAgent }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: true, path: capAgent });
    expect(agents[0]?.diagnostics).toEqual([
      expect.objectContaining({ code: "unsupported_flag", probe: "capabilities", message: expect.stringContaining("--missing-flag") }),
    ]);
  });

  it("classifies model probe network failures", async () => {
    const dir = await tempDir();
    const networkAgent = await writeExecutable(dir, "network-agent", `
if (process.argv[2] === "--version") { console.log("network 1.0.0"); process.exit(0); }
if (process.argv[2] === "models") { console.error("network error: ECONNRESET"); process.exit(1); }
`);
    const adapter = fakeAdapter({
      id: "network",
      bin: "network-agent",
      listModels: { args: ["models"], parse: parseLineSeparatedModels },
    });
    const agents = await detectAgents(
      { adapters: [adapter], env: { PATH: "", FAKE_BIN: networkAgent }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: true, path: networkAgent });
    expect(agents[0]?.diagnostics[0]?.code).toBe("network_error");
  });

  it("filters noisy model probe output", () => {
    expect(parseLineSeparatedModels(["", "WARN cache miss", "INFO loading", "anthropic/claude-sonnet-4-5", "not a model", "openai/gpt-5"].join("\n"))).toEqual([
      { id: "default", label: "Default" },
      { id: "anthropic/claude-sonnet-4-5", label: "anthropic/claude-sonnet-4-5" },
      { id: "openai/gpt-5", label: "openai/gpt-5" },
    ]);
    expect(parseCodexDebugModels(['Warning: noisy startup', '{"models":[{"slug":"gpt-5-codex","display_name":"GPT-5 Codex"},{"slug":"hidden","visibility":"hidden"}]}'].join("\n"))).toEqual([
      { id: "default", label: "Default" },
      { id: "gpt-5-codex", label: "GPT-5 Codex" },
    ]);
  });
});
