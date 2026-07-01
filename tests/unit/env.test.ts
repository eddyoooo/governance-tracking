import { describe, expect, it } from "@jest/globals";
import { isMemoryMode, loadEnv } from "../../src/config/env.js";

const aaveAllowedPublishers = [
  "LlamaRisk",
  "TokenLogic",
  "Certora",
  "kpk",
  "karpatkey_TokenLogic",
  "AaveLabs",
  "stani"
];

describe("env parsing", () => {
  it("parses defaults and comma-separated allowlists for backwards compatibility", () => {
    const env = loadEnv({
      LIDO_ALLOWED_PUBLISHERS: " Allowed Publisher,DAO Ops ",
      AAVE_ALLOWED_PUBLISHERS:
        " LlamaRisk, TokenLogic, Certora, kpk, karpatkey_TokenLogic, AaveLabs, stani ",
      UNISWAP_ALLOWED_PUBLISHERS: " eek637, Squidward Jalapeno, Rika_Axia Network ",
      FIREBASE_PRIVATE_KEY: "line1\\nline2"
    } as NodeJS.ProcessEnv);

    expect(env.port).toBe(3000);
    expect(env.storageMode).toBe("firestore");
    expect(env.enableScheduler).toBe(true);
    expect(env.fetchIntervalCron).toBe("0 */6 * * *");
    expect(env.lidoAllowedPublishers).toEqual(["Allowed Publisher", "DAO Ops"]);
    expect(env.lidoFetchMaxPages).toBe(5);
    expect(env.aaveForumBaseUrl).toBe("https://governance.aave.com");
    expect(env.aaveForumApiBaseUrl).toBe("https://governance.aave.com");
    expect(env.aaveEnabled).toBe(true);
    expect(env.aaveAllowedPublishers).toEqual(aaveAllowedPublishers);
    expect(env.aaveFetchMaxPages).toBe(10);
    expect(env.aaveCategoryFetchMaxPages).toBe(2);
    expect(env.uniswapForumBaseUrl).toBe("https://gov.uniswap.org");
    expect(env.uniswapForumApiBaseUrl).toBe("https://gov.uniswap.org");
    expect(env.uniswapEnabled).toBe(true);
    expect(env.uniswapAllowedPublishers).toEqual([
      "eek637",
      "Squidward Jalapeno",
      "Rika_Axia Network"
    ]);
    expect(env.uniswapFetchMaxPages).toBe(10);
    expect(env.uniswapCategoryFetchMaxPages).toBe(2);
    expect(env.firebasePrivateKey).toBe("line1\nline2");
    expect(env.enableTelegramNotifications).toBe(false);
    expect(env.telegramAllowedUserIds).toEqual([]);
    expect(env.telegramE2EEnabled).toBe(false);
    expect(env.telegramTestSendDelayMs).toBe(3000);
  });

  it("parses JSON array allowlists", () => {
    const env = loadEnv({
      LIDO_ALLOWED_PUBLISHERS: JSON.stringify([
        "Lido Labs Foundation - Operations Team",
        "Lido | Finance Team",
        "Lido Ecosystem Foundation - Operations Team"
      ]),
      AAVE_ALLOWED_PUBLISHERS: JSON.stringify(aaveAllowedPublishers),
      UNISWAP_ALLOWED_PUBLISHERS: JSON.stringify([
        "eek637",
        "Squidward Jalapeno",
        "Rika_Axia Network"
      ])
    } as NodeJS.ProcessEnv);

    expect(env.lidoAllowedPublishers).toEqual([
      "Lido Labs Foundation - Operations Team",
      "Lido | Finance Team",
      "Lido Ecosystem Foundation - Operations Team"
    ]);
    expect(env.aaveAllowedPublishers).toEqual(aaveAllowedPublishers);
    expect(env.uniswapAllowedPublishers).toEqual([
      "eek637",
      "Squidward Jalapeno",
      "Rika_Axia Network"
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

    expect(() =>
      loadEnv({
        AAVE_ALLOWED_PUBLISHERS: "[not-json"
      } as NodeJS.ProcessEnv)
    ).toThrow("Invalid JSON array in AAVE_ALLOWED_PUBLISHERS.");

    expect(() =>
      loadEnv({
        UNISWAP_ALLOWED_PUBLISHERS: "[not-json"
      } as NodeJS.ProcessEnv)
    ).toThrow("Invalid JSON array in UNISWAP_ALLOWED_PUBLISHERS.");
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
      LIDO_ENABLED: "FALSE",
      AAVE_ENABLED: "FALSE",
      UNISWAP_ENABLED: "FALSE",
      ENABLE_TELEGRAM_NOTIFICATIONS: "true",
      TELEGRAM_E2E_ENABLED: "true",
      API_AUTH_ENABLED: "true"
    } as NodeJS.ProcessEnv);

    expect(env.demoMode).toBe(true);
    expect(env.enableScheduler).toBe(false);
    expect(env.lidoEnabled).toBe(false);
    expect(env.aaveEnabled).toBe(false);
    expect(env.uniswapEnabled).toBe(false);
    expect(env.enableTelegramNotifications).toBe(true);
    expect(env.telegramE2EEnabled).toBe(true);
    expect(env.apiAuthEnabled).toBe(true);
  });

  it("parses and deduplicates Telegram allowed user ids", () => {
    const jsonEnv = loadEnv({
      TELEGRAM_ALLOWED_USER_IDS: JSON.stringify([123456789, "987654321", "123456789"])
    } as NodeJS.ProcessEnv);
    const commaEnv = loadEnv({
      TELEGRAM_ALLOWED_USER_IDS: " 123456789,987654321,123456789 "
    } as NodeJS.ProcessEnv);

    expect(jsonEnv.telegramAllowedUserIds).toEqual(["123456789", "987654321"]);
    expect(commaEnv.telegramAllowedUserIds).toEqual(["123456789", "987654321"]);
  });

  it("parses and validates Telegram test-send delays", () => {
    expect(
      loadEnv({
        TELEGRAM_TEST_SEND_DELAY_MS: "0"
      } as NodeJS.ProcessEnv).telegramTestSendDelayMs
    ).toBe(0);
    expect(
      loadEnv({
        TELEGRAM_TEST_SEND_DELAY_MS: "4500"
      } as NodeJS.ProcessEnv).telegramTestSendDelayMs
    ).toBe(4500);
    expect(
      loadEnv({
        TELEGRAM_TEST_SEND_DELAY_MS: ""
      } as NodeJS.ProcessEnv).telegramTestSendDelayMs
    ).toBe(3000);

    expect(() =>
      loadEnv({
        TELEGRAM_TEST_SEND_DELAY_MS: "-1"
      } as NodeJS.ProcessEnv)
    ).toThrow();
    expect(() =>
      loadEnv({
        TELEGRAM_TEST_SEND_DELAY_MS: "abc"
      } as NodeJS.ProcessEnv)
    ).toThrow();
    expect(() =>
      loadEnv({
        TELEGRAM_TEST_SEND_DELAY_MS: "1.5"
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("rejects invalid Telegram allowed user ids", () => {
    expect(() =>
      loadEnv({
        TELEGRAM_ALLOWED_USER_IDS: "[not-json"
      } as NodeJS.ProcessEnv)
    ).toThrow("Invalid JSON array in TELEGRAM_ALLOWED_USER_IDS.");

    expect(() =>
      loadEnv({
        TELEGRAM_ALLOWED_USER_IDS: JSON.stringify({ userId: 123456789 })
      } as NodeJS.ProcessEnv)
    ).toThrow("Invalid JSON array in TELEGRAM_ALLOWED_USER_IDS.");

    expect(() =>
      loadEnv({
        TELEGRAM_ALLOWED_USER_IDS: JSON.stringify([123456789, -1])
      } as NodeJS.ProcessEnv)
    ).toThrow(
      "TELEGRAM_ALLOWED_USER_IDS must contain positive numeric Telegram user IDs."
    );

    expect(() =>
      loadEnv({
        TELEGRAM_ALLOWED_USER_IDS: "@username"
      } as NodeJS.ProcessEnv)
    ).toThrow(
      "TELEGRAM_ALLOWED_USER_IDS must contain positive numeric Telegram user IDs."
    );
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
      LIDO_FETCH_MAX_PAGES: "7",
      AAVE_FETCH_MAX_PAGES: "6",
      AAVE_CATEGORY_FETCH_MAX_PAGES: "3",
      UNISWAP_FETCH_MAX_PAGES: "8",
      UNISWAP_CATEGORY_FETCH_MAX_PAGES: "4"
    } as NodeJS.ProcessEnv);

    expect(env.lidoFetchMaxPages).toBe(7);
    expect(env.aaveFetchMaxPages).toBe(6);
    expect(env.aaveCategoryFetchMaxPages).toBe(3);
    expect(env.uniswapFetchMaxPages).toBe(8);
    expect(env.uniswapCategoryFetchMaxPages).toBe(4);

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

    expect(() =>
      loadEnv({
        AAVE_FETCH_MAX_PAGES: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        AAVE_FETCH_MAX_PAGES: "21"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        AAVE_CATEGORY_FETCH_MAX_PAGES: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        AAVE_CATEGORY_FETCH_MAX_PAGES: "6"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        UNISWAP_FETCH_MAX_PAGES: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        UNISWAP_FETCH_MAX_PAGES: "21"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        UNISWAP_CATEGORY_FETCH_MAX_PAGES: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        UNISWAP_CATEGORY_FETCH_MAX_PAGES: "6"
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

    expect(() =>
      loadEnv({
        PORT: "70000"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        LOG_LEVEL: "verbose"
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

});
