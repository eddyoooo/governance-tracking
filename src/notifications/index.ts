import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { NoopNotificationService } from "./noopNotification.service.js";
import type { NotificationService } from "./notification.service.js";
import { TelegramNotificationService } from "./telegramNotification.service.js";

export function createNotificationService(
  env: Env,
  logger: Logger
): NotificationService {
  if (!env.enableTelegramNotifications) {
    logger.info("Using noop notification service");
    return new NoopNotificationService();
  }

  if (!env.telegramBotToken || !env.telegramChatId) {
    throw new Error(
      "Telegram notifications are enabled but TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set."
    );
  }

  logger.info("Using Telegram notification service");

  return new TelegramNotificationService({
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId,
    logger
  });
}

export type {
  NotificationMessage,
  NotificationService
} from "./notification.service.js";
export { NoopNotificationService } from "./noopNotification.service.js";
export {
  formatTelegramGovernanceMessage,
  TelegramNotificationService
} from "./telegramNotification.service.js";
export {
  buildProposalNotificationMessage,
  notifyPendingProposals,
  notifyProposal
} from "./proposalNotifications.js";
