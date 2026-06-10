import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }

  return false;
}, z.boolean());

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

  return trimmed.split(",");
}, z.array(z.string()).transform((items) =>
  items.map((item) => item.trim()).filter(Boolean)
));

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    STORAGE_MODE: z.enum(["firestore", "memory"]).default("firestore"),
    DEMO_MODE: booleanFromEnv.default(false),
    FIREBASE_PROJECT_ID: z.string().default(""),
    FIREBASE_CLIENT_EMAIL: z.string().default(""),
    FIREBASE_PRIVATE_KEY: z.string().default(""),
    ENABLE_SCHEDULER: booleanFromEnv.default(true),
    FETCH_INTERVAL_CRON: z.string().default("0 */6 * * *"),
    ENABLE_DEBUG_ENDPOINTS: booleanFromEnv.default(false),
    LIDO_FORUM_BASE_URL: z.string().url().default("https://research.lido.fi"),
    LIDO_FORUM_API_BASE_URL: z.string().url().default("https://research.lido.fi"),
    LIDO_ENABLED: booleanFromEnv.default(true),
    LIDO_ALLOWED_PUBLISHERS: stringListFromEnv.default([]),
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
    enableScheduler: value.ENABLE_SCHEDULER,
    fetchIntervalCron: value.FETCH_INTERVAL_CRON,
    enableDebugEndpoints: value.ENABLE_DEBUG_ENDPOINTS,
    lidoForumBaseUrl: value.LIDO_FORUM_BASE_URL,
    lidoForumApiBaseUrl: value.LIDO_FORUM_API_BASE_URL,
    lidoEnabled: value.LIDO_ENABLED,
    lidoAllowedPublishers: value.LIDO_ALLOWED_PUBLISHERS,
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
      allowedPublisherCount: env.lidoAllowedPublishers.length
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
