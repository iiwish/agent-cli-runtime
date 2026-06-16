import { describe, expect, it } from "vitest";
import path from "node:path";
import { delimiter } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants, accessSync } from "node:fs";
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
    expect(resolveExecutable(adapter, { env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` } }).selectedPath).toBe(primary);
    expect(resolveExecutable(adapter, { env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, FAKE_BIN: override } }).selectedPath).toBe(override);
  });

  it("isolates a failed adapter from other adapter detection", async () => {
    const dir = await tempDir();
    await writeExecutable(dir, "good-agent", "if (process.argv[2] === '--version') console.log('good 1.0.0');");
    const good = fakeAdapter({ id: "good", bin: "good-agent" });
    const bad = fakeAdapter({ id: "bad", bin: "missing-agent" });
    const agents = await detectAgents({ adapters: [bad, good], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` } }, { includeUnavailable: true });
    expect(agents.find((agent) => agent.id === "bad")?.available).toBe(false);
    expect(agents.find((agent) => agent.id === "good")?.available).toBe(true);
  });

  it("runs metadata probes in a neutral temp cwd", async () => {
    const dir = await tempDir();
    const project = await tempDir("agent-runtime-project-");
    const marker = "probe-marker.txt";
    await writeExecutable(dir, "probe-agent", `
if (process.argv[2] === "--version") { require("fs").writeFileSync("${marker}", process.cwd()); console.log("probe 1.0.0"); process.exit(0); }
`);
    const adapter = fakeAdapter({ id: "probe", bin: "probe-agent" });
    const agents = await detectAgents({ adapters: [adapter], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` }, searchPath: [dir] }, { includeUnavailable: true });
    expect(agents[0]?.available).toBe(true);
    await expect(readFile(path.join(project, marker), "utf8")).rejects.toThrow();
  });
});
