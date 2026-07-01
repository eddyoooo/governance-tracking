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
}, z.coerce.number().int().nonnegative().optional()).transform((value) => value ?? 3000);

function stringListFromEnv(variableName: string) {
  return z.preprocess(
    (value) => {
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
          throw new Error(`Invalid JSON array in ${variableName}.`);
        }
      }

      if (trimmed.startsWith("{")) {
        throw new Error(`Invalid JSON array in ${variableName}.`);
      }

      return trimmed.split(",");
    },
    z
      .array(z.string())
      .transform((items) => items.map((item) => item.trim()).filter(Boolean))
  );
}

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
    PORT: z.coerce.number().int().positive().max(65_535).default(3000),
    STORAGE_MODE: z.enum(["firestore", "memory"]).default("firestore"),
    DEMO_MODE: booleanFromEnv.default(false),
    FIREBASE_PROJECT_ID: z.string().default(""),
    FIREBASE_CLIENT_EMAIL: z.string().default(""),
    FIREBASE_PRIVATE_KEY: z.string().default(""),
    ENABLE_SCHEDULER: booleanFromEnv.optional(),
    FETCH_INTERVAL_CRON: z.string().default("0 */6 * * *"),
    LIDO_FORUM_BASE_URL: z.string().url().default("https://research.lido.fi"),
    LIDO_FORUM_API_BASE_URL: z.string().url().default("https://research.lido.fi"),
    LIDO_ENABLED: booleanFromEnv.default(true),
    LIDO_ALLOWED_PUBLISHERS: stringListFromEnv("LIDO_ALLOWED_PUBLISHERS").default([]),
    LIDO_FETCH_MAX_PAGES: z.coerce.number().int().positive().max(20).default(5),
    AAVE_FORUM_BASE_URL: z.string().url().default("https://governance.aave.com"),
    AAVE_FORUM_API_BASE_URL: z
      .string()
      .url()
      .default("https://governance.aave.com"),
    AAVE_ENABLED: booleanFromEnv.default(true),
    AAVE_ALLOWED_PUBLISHERS: stringListFromEnv("AAVE_ALLOWED_PUBLISHERS").default([]),
    AAVE_FETCH_MAX_PAGES: z.coerce.number().int().positive().max(20).default(10),
    AAVE_CATEGORY_FETCH_MAX_PAGES: z.coerce
      .number()
      .int()
      .positive()
      .max(5)
      .default(2),
    UNISWAP_FORUM_BASE_URL: z.string().url().default("https://gov.uniswap.org"),
    UNISWAP_FORUM_API_BASE_URL: z
      .string()
      .url()
      .default("https://gov.uniswap.org"),
    UNISWAP_ENABLED: booleanFromEnv.default(true),
    UNISWAP_ALLOWED_PUBLISHERS: stringListFromEnv(
      "UNISWAP_ALLOWED_PUBLISHERS"
    ).default([]),
    UNISWAP_FETCH_MAX_PAGES: z.coerce.number().int().positive().max(20).default(10),
    UNISWAP_CATEGORY_FETCH_MAX_PAGES: z.coerce
      .number()
      .int()
      .positive()
      .max(5)
      .default(2),
    ENABLE_TELEGRAM_NOTIFICATIONS: booleanFromEnv.default(false),
    TELEGRAM_BOT_TOKEN: z.string().default(""),
    TELEGRAM_ALLOWED_USER_IDS: telegramUserIdListFromEnv.default([]),
    TELEGRAM_E2E_ENABLED: booleanFromEnv.default(false),
    TELEGRAM_TEST_SEND_DELAY_MS: delayMsFromEnv,
    API_AUTH_ENABLED: booleanFromEnv.default(false),
    API_AUTH_TOKEN: z.string().default(""),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info")
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
    lidoForumBaseUrl: value.LIDO_FORUM_BASE_URL,
    lidoForumApiBaseUrl: value.LIDO_FORUM_API_BASE_URL,
    lidoEnabled: value.LIDO_ENABLED,
    lidoAllowedPublishers: value.LIDO_ALLOWED_PUBLISHERS,
    lidoFetchMaxPages: value.LIDO_FETCH_MAX_PAGES,
    aaveForumBaseUrl: value.AAVE_FORUM_BASE_URL,
    aaveForumApiBaseUrl: value.AAVE_FORUM_API_BASE_URL,
    aaveEnabled: value.AAVE_ENABLED,
    aaveAllowedPublishers: value.AAVE_ALLOWED_PUBLISHERS,
    aaveFetchMaxPages: value.AAVE_FETCH_MAX_PAGES,
    aaveCategoryFetchMaxPages: value.AAVE_CATEGORY_FETCH_MAX_PAGES,
    uniswapForumBaseUrl: value.UNISWAP_FORUM_BASE_URL,
    uniswapForumApiBaseUrl: value.UNISWAP_FORUM_API_BASE_URL,
    uniswapEnabled: value.UNISWAP_ENABLED,
    uniswapAllowedPublishers: value.UNISWAP_ALLOWED_PUBLISHERS,
    uniswapFetchMaxPages: value.UNISWAP_FETCH_MAX_PAGES,
    uniswapCategoryFetchMaxPages: value.UNISWAP_CATEGORY_FETCH_MAX_PAGES,
    enableTelegramNotifications: value.ENABLE_TELEGRAM_NOTIFICATIONS,
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    telegramAllowedUserIds: value.TELEGRAM_ALLOWED_USER_IDS,
    telegramE2EEnabled: value.TELEGRAM_E2E_ENABLED,
    telegramTestSendDelayMs: value.TELEGRAM_TEST_SEND_DELAY_MS,
    apiAuthEnabled: value.API_AUTH_ENABLED,
    apiAuthToken: value.API_AUTH_TOKEN,
    logLevel: value.LOG_LEVEL
  }));

export type Env = z.infer<typeof rawEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return rawEnvSchema.parse(source);
}

export function isMemoryMode(env: Env): boolean {
  return env.storageMode === "memory" || env.demoMode;
}

export const env = loadEnv();
