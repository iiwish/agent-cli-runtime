import { describe, expect, it } from "vitest";
import { detectAgents } from "../src/detection/detect.js";
import { fakeAdapter, tempDir, writeExecutable } from "./helpers.js";

describe("auth probes", () => {
  it("can parse auth status from a non-zero probe stdout", async () => {
    const dir = await tempDir();
    const authAgent = await writeExecutable(dir, "auth-agent", `
if (process.argv[2] === "--version") { console.log("auth 1.0.0"); process.exit(0); }
if (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: false })); process.exit(1); }
`);
    const adapter = fakeAdapter({
      id: "auth",
      bin: "auth-agent",
      authProbe: {
        args: ["auth", "status"],
        parse(stdout) {
          const parsed = JSON.parse(stdout) as { loggedIn: boolean };
          return parsed.loggedIn ? "ok" : "missing";
        },
      },
    });
    const agents = await detectAgents(
      { adapters: [adapter], env: { PATH: "", FAKE_BIN: authAgent }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: true, authStatus: "missing" });
    expect(agents[0]?.diagnostics).toEqual([expect.objectContaining({ code: "auth_missing", probe: "auth" })]);
  });

  it("classifies auth probe failures without leaking secrets", async () => {
    const dir = await tempDir();
    const authFailAgent = await writeExecutable(dir, "auth-fail-agent", `
if (process.argv[2] === "--version") { console.log("auth 1.0.0"); process.exit(0); }
if (process.argv[2] === "auth") { console.error("Authentication required. Bearer " + "C".repeat(20)); process.exit(1); }
`);
    const adapter = fakeAdapter({
      id: "auth-fail",
      bin: "auth-fail-agent",
      authProbe: {
        args: ["auth", "status"],
        parse() {
          return "unknown";
        },
      },
    });
    const agents = await detectAgents(
      { adapters: [adapter], env: { PATH: "", FAKE_BIN: authFailAgent }, searchPath: [dir] },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: true, authStatus: "missing" });
    expect(agents[0]?.diagnostics).toEqual([
      expect.objectContaining({ code: "auth_missing", probe: "auth", stderrTail: expect.stringContaining("[REDACTED]") }),
    ]);
    expect(JSON.stringify(agents[0]?.diagnostics)).not.toContain("Bearer C");
  });
});
