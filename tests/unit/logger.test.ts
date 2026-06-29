import { describe, expect, it } from "@jest/globals";
import type { DestinationStream } from "pino";
import { createLogger } from "../../src/utils/logger.js";

function createLogCapture(): {
  stream: DestinationStream;
  lines: string[];
} {
  const lines: string[] = [];

  return {
    lines,
    stream: {
      write(line: string) {
        lines.push(line);
      }
    }
  };
}

describe("logger", () => {
  it("redacts API auth, Telegram, and Firebase secrets from structured logs", () => {
    const capture = createLogCapture();
    const logger = createLogger(
      {
        logLevel: "info",
        nodeEnv: "test"
      },
      capture.stream
    );

    logger.info(
      {
        req: {
          headers: {
            authorization: "Bearer super-secret-api-value",
            "x-api-token": "super-secret-api-value"
          }
        },
        apiAuthToken: "super-secret-api-value",
        telegramBotToken: "super-secret-telegram-value",
        telegramAllowedUserIds: ["123456789"],
        firebasePrivateKey: "super-secret-firebase-value",
        nested: {
          visible: "safe"
        }
      },
      "redaction test"
    );

    const serialized = capture.lines.join("");
    const entry = JSON.parse(serialized) as Record<string, unknown>;

    expect(serialized).not.toContain("super-secret-api-value");
    expect(serialized).not.toContain("super-secret-telegram-value");
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("super-secret-firebase-value");
    expect(serialized).toContain("safe");
    expect(entry).toMatchObject({
      apiAuthToken: "[redacted]",
      telegramBotToken: "[redacted]",
      telegramAllowedUserIds: "[redacted]",
      firebasePrivateKey: "[redacted]"
    });
  });
});
