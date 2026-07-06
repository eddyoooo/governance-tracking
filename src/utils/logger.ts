import pino, { type DestinationStream, type Logger } from "pino";
import type { Env } from "../config/env.js";

const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.Authorization",
  'req.headers["x-api-token"]',
  'req.headers["X-API-Token"]',
  "headers.authorization",
  "headers.Authorization",
  'headers["x-api-token"]',
  'headers["X-API-Token"]',
  "apiAuthToken",
  "API_AUTH_TOKEN",
  "telegramBotToken",
  "TELEGRAM_BOT_TOKEN",
  "telegramAllowedUserIds",
  "TELEGRAM_ALLOWED_USER_IDS",
  "telegramAdminUserId",
  "TELEGRAM_ADMIN_USER_ID",
  "adminUserId",
  "allowedUserIds",
  "firebaseClientEmail",
  "FIREBASE_CLIENT_EMAIL",
  "firebasePrivateKey",
  "FIREBASE_PRIVATE_KEY",
  "privateKey",
  "botToken"
];

export function createLogger(
  env: Pick<Env, "logLevel" | "nodeEnv">,
  destination?: DestinationStream
): Logger {
  const options = {
    level: env.logLevel,
    redact: {
      paths: REDACTED_LOG_PATHS,
      censor: "[redacted]"
    }
  };

  return destination ? pino(options, destination) : pino(options);
}
