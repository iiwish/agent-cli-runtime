import { describe, expect, it } from "vitest";
import { redactEnv, redactText } from "../src/core/redaction.js";

describe("redaction", () => {
  it("does not leak token or env secrets", () => {
    expect(redactEnv({ OPENAI_API_KEY: "sk-secret-value-1234567890", NORMAL: "visible" })).toEqual({
      OPENAI_API_KEY: "[REDACTED]",
      NORMAL: "visible",
    });
    expect(redactText("Bearer abcdefghijklmnopqrstuvwxyz")).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
