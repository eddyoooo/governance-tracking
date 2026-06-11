import { describe, expect, it } from "@jest/globals";
import { isMemoryMode, loadEnv, toSafeConfig } from "../../src/config/env.js";

describe("env parsing", () => {
  it("parses defaults and comma-separated allowlists for backwards compatibility", () => {
    const env = loadEnv({
      LIDO_ALLOWED_PUBLISHERS: " Allowed Publisher,DAO Ops ",
      FIREBASE_PRIVATE_KEY: "line1\\nline2"
    } as NodeJS.ProcessEnv);

    expect(env.port).toBe(3000);
    expect(env.storageMode).toBe("firestore");
    expect(env.enableScheduler).toBe(true);
    expect(env.fetchIntervalCron).toBe("*/15 * * * *");
    expect(env.lidoAllowedPublishers).toEqual(["Allowed Publisher", "DAO Ops"]);
    expect(env.lidoFetchMaxPages).toBe(5);
    expect(env.firebasePrivateKey).toBe("line1\nline2");
    expect(env.enableTelegramNotifications).toBe(false);
    expect(env.notifyOnNewProposal).toBe(true);
  });

  it("parses JSON array allowlists", () => {
    const env = loadEnv({
      LIDO_ALLOWED_PUBLISHERS: JSON.stringify([
        "Lido Labs Foundation - Operations Team",
        "Lido | Finance Team",
        "Lido Ecosystem Foundation - Operations Team"
      ])
    } as NodeJS.ProcessEnv);

    expect(env.lidoAllowedPublishers).toEqual([
      "Lido Labs Foundation - Operations Team",
      "Lido | Finance Team",
      "Lido Ecosystem Foundation - Operations Team"
    ]);
  });

  it("parses multiline JSON array allowlists", () => {
    const env = loadEnv({
      LIDO_ALLOWED_PUBLISHERS: `[
        "Allowed Publisher",
        "DAO Ops"
      ]`
    } as NodeJS.ProcessEnv);

    expect(env.lidoAllowedPublishers).toEqual(["Allowed Publisher", "DAO Ops"]);
  });

  it("rejects malformed JSON allowlists", () => {
    expect(() =>
      loadEnv({
        LIDO_ALLOWED_PUBLISHERS: "[not-json"
      } as NodeJS.ProcessEnv)
    ).toThrow("Invalid JSON array in LIDO_ALLOWED_PUBLISHERS.");
  });

  it("rejects JSON allowlists that are not arrays of strings", () => {
    expect(() =>
      loadEnv({
        LIDO_ALLOWED_PUBLISHERS: JSON.stringify({ publisher: "Allowed Publisher" })
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher", 123])
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("parses boolean values consistently", () => {
    const env = loadEnv({
      DEMO_MODE: "TRUE",
      ENABLE_SCHEDULER: "false",
      ENABLE_DEBUG_ENDPOINTS: " true ",
      LIDO_ENABLED: "FALSE",
      ENABLE_TELEGRAM_NOTIFICATIONS: "true",
      NOTIFY_ON_NEW_PROPOSAL: "false",
      API_AUTH_ENABLED: "true"
    } as NodeJS.ProcessEnv);

    expect(env.demoMode).toBe(true);
    expect(env.enableScheduler).toBe(false);
    expect(env.enableDebugEndpoints).toBe(true);
    expect(env.lidoEnabled).toBe(false);
    expect(env.enableTelegramNotifications).toBe(true);
    expect(env.notifyOnNewProposal).toBe(false);
    expect(env.apiAuthEnabled).toBe(true);
  });

  it("rejects invalid boolean strings instead of silently treating them as false", () => {
    expect(() =>
      loadEnv({
        ENABLE_SCHEDULER: "yes"
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("treats blank allowlist entries as absent", () => {
    const env = loadEnv({
      LIDO_ALLOWED_PUBLISHERS: JSON.stringify([" Allowed Publisher ", " ", "DAO Ops"])
    } as NodeJS.ProcessEnv);

    expect(env.lidoAllowedPublishers).toEqual(["Allowed Publisher", "DAO Ops"]);
  });

  it("uses memory mode when demo mode is enabled", () => {
    const env = loadEnv({
      STORAGE_MODE: "firestore",
      DEMO_MODE: "true"
    } as NodeJS.ProcessEnv);

    expect(isMemoryMode(env)).toBe(true);
    expect(env.enableScheduler).toBe(false);
  });

  it("uses memory mode when storage mode is memory", () => {
    const env = loadEnv({
      STORAGE_MODE: "memory",
      DEMO_MODE: "false"
    } as NodeJS.ProcessEnv);

    expect(isMemoryMode(env)).toBe(true);
    expect(env.enableScheduler).toBe(false);
  });

  it("allows scheduler to be explicitly enabled in demo mode", () => {
    const env = loadEnv({
      STORAGE_MODE: "memory",
      DEMO_MODE: "true",
      ENABLE_SCHEDULER: "true"
    } as NodeJS.ProcessEnv);

    expect(env.enableScheduler).toBe(true);
  });

  it("rejects invalid storage mode", () => {
    expect(() =>
      loadEnv({
        STORAGE_MODE: "sqlite"
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("parses and validates Lido pagination controls", () => {
    const env = loadEnv({
      LIDO_FETCH_MAX_PAGES: "7"
    } as NodeJS.ProcessEnv);

    expect(env.lidoFetchMaxPages).toBe(7);

    expect(() =>
      loadEnv({
        LIDO_FETCH_MAX_PAGES: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        LIDO_FETCH_MAX_PAGES: "21"
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("rejects invalid runtime and port values", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "staging"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        PORT: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("does not expose secrets in safe config", () => {
    const env = loadEnv({
      FIREBASE_PROJECT_ID: "project",
      FIREBASE_CLIENT_EMAIL: "service@example.com",
      FIREBASE_PRIVATE_KEY: "private-key",
      API_AUTH_ENABLED: "true",
      API_AUTH_TOKEN: "secret-token",
      ENABLE_TELEGRAM_NOTIFICATIONS: "true",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_CHAT_ID: "chat-id"
    } as NodeJS.ProcessEnv);
    const safeConfig = toSafeConfig(env);

    expect(JSON.stringify(safeConfig)).not.toContain("private-key");
    expect(JSON.stringify(safeConfig)).not.toContain("secret-token");
    expect(JSON.stringify(safeConfig)).not.toContain("telegram-token");
    expect(JSON.stringify(safeConfig)).not.toContain("chat-id");
    expect(safeConfig.fetchIntervalCron).toBe("*/15 * * * *");
    expect(safeConfig.firebase.hasPrivateKey).toBe(true);
    expect(safeConfig.apiAuth.hasToken).toBe(true);
    expect(safeConfig.lido.fetchMaxPages).toBe(5);
    expect(safeConfig.notifications.hasTelegramBotToken).toBe(true);
    expect(safeConfig.notifications.hasTelegramChatId).toBe(true);
  });
});
