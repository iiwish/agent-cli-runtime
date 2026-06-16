import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { detectAgents } from "../src/detection/detect.js";
import { fakeAdapter, tempDir, writeExecutable } from "./helpers.js";

describe("auth probes", () => {
  it("can parse auth status from a non-zero probe stdout", async () => {
    const dir = await tempDir();
    await writeExecutable(dir, "auth-agent", `
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
      { adapters: [adapter], env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` } },
      { includeUnavailable: true },
    );
    expect(agents[0]).toMatchObject({ available: true, authStatus: "missing" });
  });
});
