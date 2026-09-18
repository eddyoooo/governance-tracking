import { describe, expect, it } from "@jest/globals";
import {
  errorMessage,
  safeErrorDetails,
  sanitizeSensitiveText
} from "../../src/utils/errors.js";

describe("safe error formatting", () => {
  it("preserves useful ordinary error details", () => {
    expect(safeErrorDetails(new TypeError("RPC request failed"))).toEqual({
      name: "TypeError",
      message: "RPC request failed"
    });
    expect(errorMessage("plain failure")).toBe("plain failure");
  });

  it("removes authenticated URLs, bearer values, bot tokens, and private keys", () => {
    const text = sanitizeSensitiveText(
      [
        "URL: https://example.quiknode.pro/project/secret-token",
        "Authorization: Bearer bearer-secret-value",
        "Bot: 123456789:abcdefghijklmnopqrstuvwxyz_ABC",
        "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----"
      ].join("\n")
    );

    expect(text).toContain("URL: [redacted-url]");
    expect(text).toContain("Authorization: Bearer [redacted]");
    expect(text).toContain("Bot: [redacted-token]");
    expect(text).toContain("[redacted-private-key]");
    expect(text).not.toMatch(/secret-token|bearer-secret-value|private-material/);
  });

  it("sanitizes non-Error values before returning structured details", () => {
    expect(
      safeErrorDetails("request failed at https://rpc.example/credential")
    ).toEqual({
      name: "UnknownError",
      message: "request failed at [redacted-url]"
    });
  });
});
