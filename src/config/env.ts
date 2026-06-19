import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }

    if (!normalized) {
      return undefined;
    }
  }

  return value;
}, z.boolean());

const delayMsFromEnv = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.coerce.number().nonnegative().optional()).transform((value) => value ?? 3000);

const stringListFromEnv = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error("Invalid JSON array in LIDO_ALLOWED_PUBLISHERS.");
    }
  }

  if (trimmed.startsWith("{")) {
    throw new Error("Invalid JSON array in LIDO_ALLOWED_PUBLISHERS.");
  }

  return trimmed.split(",");
}, z.array(z.string()).transform((items) =>
  items.map((item) => item.trim()).filter(Boolean)
));

const telegramUserIdListFromEnv = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error("Invalid JSON array in TELEGRAM_ALLOWED_USER_IDS.");
    }
  }

  if (trimmed.startsWith("{")) {
    throw new Error("Invalid JSON array in TELEGRAM_ALLOWED_USER_IDS.");
  }

  return trimmed.split(",");
}, z.array(z.union([z.string(), z.number()])).transform((items, context) => {
  const userIds = new Set<string>();

  for (const item of items) {
    const userId = String(item).trim();

    if (!userId) {
      continue;
    }

    if (!/^[1-9]\d*$/.test(userId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "TELEGRAM_ALLOWED_USER_IDS must contain positive numeric Telegram user IDs."
      });
      continue;
    }

    userIds.add(userId);
  }

  return [...userIds];
}));

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    STORAGE_MODE: z.enum(["firestore", "memory"]).default("firestore"),
    DEMO_MODE: booleanFromEnv.default(false),
    FIREBASE_PROJECT_ID: z.string().default(""),
    FIREBASE_CLIENT_EMAIL: z.string().default(""),
    FIREBASE_PRIVATE_KEY: z.string().default(""),
    ENABLE_SCHEDULER: booleanFromEnv.optional(),
    FETCH_INTERVAL_CRON: z.string().default("*/15 * * * *"),
    ENABLE_DEBUG_ENDPOINTS: booleanFromEnv.default(false),
    LIDO_FORUM_BASE_URL: z.string().url().default("https://research.lido.fi"),
    LIDO_FORUM_API_BASE_URL: z.string().url().default("https://research.lido.fi"),
    LIDO_ENABLED: booleanFromEnv.default(true),
    LIDO_ALLOWED_PUBLISHERS: stringListFromEnv.default([]),
    LIDO_FETCH_MAX_PAGES: z.coerce.number().int().positive().max(20).default(5),
    ENABLE_TELEGRAM_NOTIFICATIONS: booleanFromEnv.default(false),
    TELEGRAM_BOT_TOKEN: z.string().default(""),
    TELEGRAM_ALLOWED_USER_IDS: telegramUserIdListFromEnv.default([]),
    TELEGRAM_E2E_ENABLED: booleanFromEnv.default(false),
    TELEGRAM_TEST_SEND_DELAY_MS: delayMsFromEnv,
    NOTIFY_ON_NEW_PROPOSAL: booleanFromEnv.default(true),
    API_AUTH_ENABLED: booleanFromEnv.default(false),
    API_AUTH_TOKEN: z.string().default(""),
    LOG_LEVEL: z.string().default("info"),
    CORS_ORIGIN: z.string().default("http://localhost:4200")
  })
  .transform((value) => ({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    storageMode: value.STORAGE_MODE,
    demoMode: value.DEMO_MODE,
    firebaseProjectId: value.FIREBASE_PROJECT_ID,
    firebaseClientEmail: value.FIREBASE_CLIENT_EMAIL,
    firebasePrivateKey: value.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    enableScheduler:
      value.ENABLE_SCHEDULER ??
      !(value.DEMO_MODE || value.STORAGE_MODE === "memory"),
    fetchIntervalCron: value.FETCH_INTERVAL_CRON,
    enableDebugEndpoints: value.ENABLE_DEBUG_ENDPOINTS,
    lidoForumBaseUrl: value.LIDO_FORUM_BASE_URL,
    lidoForumApiBaseUrl: value.LIDO_FORUM_API_BASE_URL,
    lidoEnabled: value.LIDO_ENABLED,
    lidoAllowedPublishers: value.LIDO_ALLOWED_PUBLISHERS,
    lidoFetchMaxPages: value.LIDO_FETCH_MAX_PAGES,
    enableTelegramNotifications: value.ENABLE_TELEGRAM_NOTIFICATIONS,
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    telegramAllowedUserIds: value.TELEGRAM_ALLOWED_USER_IDS,
    telegramE2EEnabled: value.TELEGRAM_E2E_ENABLED,
    telegramTestSendDelayMs: value.TELEGRAM_TEST_SEND_DELAY_MS,
    notifyOnNewProposal: value.NOTIFY_ON_NEW_PROPOSAL,
    apiAuthEnabled: value.API_AUTH_ENABLED,
    apiAuthToken: value.API_AUTH_TOKEN,
    logLevel: value.LOG_LEVEL,
    corsOrigin: value.CORS_ORIGIN
  }));

export type Env = z.infer<typeof rawEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return rawEnvSchema.parse(source);
}

export function isMemoryMode(env: Env): boolean {
  return env.storageMode === "memory" || env.demoMode;
}

export function toSafeConfig(env: Env) {
  return {
    nodeEnv: env.nodeEnv,
    port: env.port,
    storageMode: env.storageMode,
    demoMode: env.demoMode,
    enableScheduler: env.enableScheduler,
    fetchIntervalCron: env.fetchIntervalCron,
    enableDebugEndpoints: env.enableDebugEndpoints,
    corsOrigin: env.corsOrigin,
    firebase: {
      hasProjectId: Boolean(env.firebaseProjectId),
      hasClientEmail: Boolean(env.firebaseClientEmail),
      hasPrivateKey: Boolean(env.firebasePrivateKey)
    },
    lido: {
      enabled: env.lidoEnabled,
      forumBaseUrl: env.lidoForumBaseUrl,
      forumApiBaseUrl: env.lidoForumApiBaseUrl,
      allowedPublisherCount: env.lidoAllowedPublishers.length,
      fetchMaxPages: env.lidoFetchMaxPages
    },
    notifications: {
      telegramEnabled: env.enableTelegramNotifications,
      notifyOnNewProposal: env.notifyOnNewProposal,
      hasTelegramBotToken: Boolean(env.telegramBotToken),
      telegramAllowedUserCount: env.telegramAllowedUserIds.length,
      telegramE2EEnabled: env.telegramE2EEnabled,
      telegramTestSendDelayMs: env.telegramTestSendDelayMs
    },
    apiAuth: {
      enabled: env.apiAuthEnabled,
      hasToken: Boolean(env.apiAuthToken)
    },
    logging: {
      level: env.logLevel
    }
  };
}

export const env = loadEnv();
