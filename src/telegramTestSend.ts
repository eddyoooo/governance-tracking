import { env } from "./config/env.js";
import { createTelegramTestNotifications } from "./demoFixtures/telegramNotification.fixture.js";
import {
  createAdminOnlyTelegramTestNotificationService,
  sendTelegramTestNotifications
} from "./telegramTestSend.runner.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  if (!env.telegramE2EEnabled) {
    throw new Error(
      "Telegram test send requires TELEGRAM_E2E_ENABLED=true."
    );
  }

  if (!env.telegramBotToken || !env.telegramAdminUserId) {
    throw new Error(
      "Telegram test send requires TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_USER_ID."
    );
  }

  const logger = createLogger(env);
  const notificationService = createAdminOnlyTelegramTestNotificationService({
    botToken: env.telegramBotToken,
    adminUserId: env.telegramAdminUserId,
    logger
  });
  const notifications = createTelegramTestNotifications();
  const delayMs = env.telegramTestSendDelayMs;

  await sendTelegramTestNotifications({
    notificationService,
    notifications,
    delayMs
  });

  console.log(
    `Sent ${notifications.length} Telegram test message(s) to the configured admin user only with ${delayMs}ms between messages.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
