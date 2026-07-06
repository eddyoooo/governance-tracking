import { describe, expect, it, jest } from "@jest/globals";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/index.js";
import {
  createAdminOnlyTelegramTestNotificationService,
  DEFAULT_TELEGRAM_TEST_SEND_DELAY_MS,
  parseTelegramTestSendDelayMs,
  sendTelegramTestNotifications
} from "../../src/telegramTestSend.runner.js";

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(message);
  }
}

function message(title: string): NotificationMessage {
  return {
    protocol: "lido",
    sourceType: "forum",
    publisherName: "Lido | Finance Team",
    title,
    sourceUrl: "https://research.lido.fi/t/test/1"
  };
}

describe("Telegram test-send runner", () => {
  it("parses the default 3 second delay", () => {
    expect(parseTelegramTestSendDelayMs(undefined)).toBe(
      DEFAULT_TELEGRAM_TEST_SEND_DELAY_MS
    );
    expect(parseTelegramTestSendDelayMs("")).toBe(DEFAULT_TELEGRAM_TEST_SEND_DELAY_MS);
    expect(parseTelegramTestSendDelayMs("3000")).toBe(3000);
    expect(parseTelegramTestSendDelayMs("0")).toBe(0);
  });

  it("rejects invalid delay values", () => {
    expect(() => parseTelegramTestSendDelayMs("-1")).toThrow(
      "TELEGRAM_TEST_SEND_DELAY_MS must be a non-negative number."
    );
    expect(() => parseTelegramTestSendDelayMs("abc")).toThrow(
      "TELEGRAM_TEST_SEND_DELAY_MS must be a non-negative number."
    );
  });

  it("waits between proposal test messages but not after the last one", async () => {
    const notificationService = new RecordingNotificationService();
    const sleep = jest.fn<() => Promise<void>>(async () => undefined);

    await sendTelegramTestNotifications({
      notificationService,
      notifications: [message("one"), message("two"), message("three")],
      delayMs: 3000,
      sleep
    });

    expect(notificationService.messages.map((item) => item.title)).toEqual([
      "one",
      "two",
      "three"
    ]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 3000);
    expect(sleep).toHaveBeenNthCalledWith(2, 3000);
  });

  it("does not sleep when delay is disabled or there are no messages", async () => {
    const notificationService = new RecordingNotificationService();
    const sleep = jest.fn<() => Promise<void>>(async () => undefined);

    await sendTelegramTestNotifications({
      notificationService,
      notifications: [message("one"), message("two")],
      delayMs: 0,
      sleep
    });
    await sendTelegramTestNotifications({
      notificationService,
      notifications: [],
      delayMs: 3000,
      sleep
    });

    expect(notificationService.messages.map((item) => item.title)).toEqual([
      "one",
      "two"
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("creates an admin-only Telegram service for live test sends", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () => new Response("{}", { status: 200 })
    );
    const service = createAdminOnlyTelegramTestNotificationService({
      botToken: "test-token",
      adminUserId: "1549323073",
      fetchImpl
    });

    await service.send(message("admin only"));

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    ) as Record<string, unknown>;

    expect(body.chat_id).toBe("1549323073");
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("987654321");
  });

  it("fails clearly when admin-only Telegram test-send credentials are missing", () => {
    expect(() =>
      createAdminOnlyTelegramTestNotificationService({
        botToken: "",
        adminUserId: "1549323073"
      })
    ).toThrow(
      "Telegram test send requires TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_USER_ID."
    );

    expect(() =>
      createAdminOnlyTelegramTestNotificationService({
        botToken: "test-token",
        adminUserId: " "
      })
    ).toThrow(
      "Telegram test send requires TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_USER_ID."
    );
  });
});
