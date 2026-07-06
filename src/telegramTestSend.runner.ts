import type { Logger } from "pino";
import { TelegramNotificationService } from "./notifications/telegramNotification.service.js";
import type { NotificationService } from "./notifications/notification.service.js";
import type { NotificationMessage } from "./notifications/notification.service.js";

export const DEFAULT_TELEGRAM_TEST_SEND_DELAY_MS = 3000;

export interface SendTelegramTestNotificationsOptions {
  notificationService: NotificationService;
  notifications: NotificationMessage[];
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CreateAdminOnlyTelegramTestServiceOptions {
  botToken: string;
  adminUserId: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
}

export function parseTelegramTestSendDelayMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_TELEGRAM_TEST_SEND_DELAY_MS;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("TELEGRAM_TEST_SEND_DELAY_MS must be a non-negative number.");
  }

  return parsed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createAdminOnlyTelegramTestNotificationService(
  options: CreateAdminOnlyTelegramTestServiceOptions
): NotificationService {
  if (!options.botToken.trim() || !options.adminUserId.trim()) {
    throw new Error(
      "Telegram test send requires TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_USER_ID."
    );
  }

  return new TelegramNotificationService({
    botToken: options.botToken,
    allowedUserIds: [options.adminUserId],
    fetchImpl: options.fetchImpl,
    logger: options.logger
  });
}

export async function sendTelegramTestNotifications(
  options: SendTelegramTestNotificationsOptions
): Promise<void> {
  const delayMs = options.delayMs ?? DEFAULT_TELEGRAM_TEST_SEND_DELAY_MS;
  const sleepFn = options.sleep ?? sleep;

  for (let index = 0; index < options.notifications.length; index += 1) {
    await options.notificationService.send(options.notifications[index]);

    if (delayMs > 0 && index < options.notifications.length - 1) {
      await sleepFn(delayMs);
    }
  }
}
