import { env } from "./config/env.js";
import { createTelegramTestNotifications } from "./demoFixtures/telegramNotification.fixture.js";
import { createNotificationService } from "./notifications/index.js";
import { sendTelegramTestNotifications } from "./telegramTestSend.runner.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  if (!env.enableTelegramNotifications) {
    throw new Error(
      "Telegram test send requires ENABLE_TELEGRAM_NOTIFICATIONS=true."
    );
  }

  const logger = createLogger(env);
  const notificationService = createNotificationService(env, logger);
  const notifications = createTelegramTestNotifications();
  const delayMs = env.telegramTestSendDelayMs;

  await sendTelegramTestNotifications({
    notificationService,
    notifications,
    delayMs
  });

  console.log(
    `Sent ${notifications.length} Telegram test message(s) to ${env.telegramAllowedUserIds.length} allowed user(s) with ${delayMs}ms between messages.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
