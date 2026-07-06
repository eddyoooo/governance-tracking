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
        TELEGRAM_ALLOWED_USER_IDS: ["987654321"],
        telegramAdminUserId: "1549323073",
        TELEGRAM_ADMIN_USER_ID: "246813579",
        adminUserId: "1549323073",
        firebaseClientEmail: "service-account@example.com",
        FIREBASE_CLIENT_EMAIL: "service-account-uppercase@example.com",
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
    expect(serialized).not.toContain("987654321");
    expect(serialized).not.toContain("1549323073");
    expect(serialized).not.toContain("246813579");
    expect(serialized).not.toContain("service-account@example.com");
    expect(serialized).not.toContain("service-account-uppercase@example.com");
    expect(serialized).not.toContain("super-secret-firebase-value");
    expect(serialized).toContain("safe");
    expect(entry).toMatchObject({
      apiAuthToken: "[redacted]",
      telegramBotToken: "[redacted]",
      telegramAllowedUserIds: "[redacted]",
      TELEGRAM_ALLOWED_USER_IDS: "[redacted]",
      telegramAdminUserId: "[redacted]",
      TELEGRAM_ADMIN_USER_ID: "[redacted]",
      adminUserId: "[redacted]",
      firebaseClientEmail: "[redacted]",
      FIREBASE_CLIENT_EMAIL: "[redacted]",
      firebasePrivateKey: "[redacted]"
    });
  });
});
