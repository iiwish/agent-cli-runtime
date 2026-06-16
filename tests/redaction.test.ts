import { describe, expect, it } from "vitest";
import { redactEnv, redactText } from "../src/core/redaction.js";

describe("redaction", () => {
  it("does not leak token or env secrets", () => {
    const key = ["OPENAI", "API", "KEY"].join("_");
    const value = "s" + "k" + "A".repeat(20);
    expect(redactEnv({ [key]: value, NORMAL: "visible" })).toEqual({
      [key]: "[REDACTED]",
      NORMAL: "visible",
    });
    expect(redactText("Bearer abcdefghijklmnopqrstuvwxyz")).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
