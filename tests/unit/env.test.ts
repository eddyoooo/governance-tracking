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
const uniswapAllowedPublishers = [
  "haydenadams",
  "eek637",
  "devinwalsh",
  "kenneth",
  "nataliara",
  "GFXlabs",
  "UniswapFoundation"
];
const cowAllowedPublishers = [
  "notsoformal",
  "Kowrigan",
  "harisang",
  "felixhenneke",
  "KPK"
];

describe("env parsing", () => {
  it("parses defaults and comma-separated allowlists for backwards compatibility", () => {
    const env = loadEnv({
      LIDO_ALLOWED_PUBLISHERS: " Allowed Publisher,DAO Ops ",
      AAVE_ALLOWED_PUBLISHERS:
        " LlamaRisk, TokenLogic, Certora, kpk, karpatkey_TokenLogic, AaveLabs, stani ",
      UNISWAP_ALLOWED_PUBLISHERS:
        " haydenadams, eek637, devinwalsh, kenneth, nataliara, GFXlabs, UniswapFoundation ",
      COW_ALLOWED_PUBLISHERS:
        " notsoformal, Kowrigan, harisang, felixhenneke, KPK ",
      FIREBASE_PRIVATE_KEY: "line1\\nline2"
    } as NodeJS.ProcessEnv);

    expect(env.port).toBe(3000);
    expect(env.storageMode).toBe("firestore");
    expect(env.enableScheduler).toBe(true);
    expect(env.fetchIntervalCron).toBe("0 8 * * *");
    expect(env.fetchRunMaxAgeHours).toBe(48);
    expect(env.enableSourceActivityAlerts).toBe(true);
    expect(env.sourceActivityWarningDays).toBe(14);
    expect(env.sourceActivityCriticalDays).toBe(30);
    expect(env.sourceActivityMinFetchedCount).toBe(1);
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
    expect(env.uniswapAllowedPublishers).toEqual(uniswapAllowedPublishers);
    expect(env.uniswapFetchMaxPages).toBe(10);
    expect(env.uniswapCategoryFetchMaxPages).toBe(2);
    expect(env.cowForumBaseUrl).toBe("https://forum.cow.fi");
    expect(env.cowForumApiBaseUrl).toBe("https://forum.cow.fi");
    expect(env.cowEnabled).toBe(true);
    expect(env.cowAllowedPublishers).toEqual(cowAllowedPublishers);
    expect(env.cowFetchMaxPages).toBe(10);
    expect(env.cowCategoryFetchMaxPages).toBe(2);
    expect(env.ethereumRpcUrl).toBe("");
    expect(env.uniswapOnchainEnabled).toBe(false);
    expect(env.uniswapOnchainNotificationsEnabled).toBe(false);
    expect(env.onchainFetchIntervalCron).toBe("0 */6 * * *");
    expect(env.uniswapGovernorAddress).toBe(
      "0x408ED6354d4973f66138C91495F2f2FCbd8724C3"
    );
    expect(env.uniswapTimelockAddress).toBe(
      "0x1a9C8182C09F50C8318d769245beA52c32BE35BC"
    );
    expect(env.uniswapUniTokenAddress).toBe(
      "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    );
    expect(env.firebasePrivateKey).toBe("line1\nline2");
    expect(env.enableTelegramNotifications).toBe(false);
    expect(env.telegramAllowedUserIds).toEqual([]);
    expect(env.notificationRetryCron).toBe("*/15 * * * *");
    expect(env.enableAdminStatusReports).toBe(false);
    expect(env.telegramAdminUserId).toBe("1549323073");
    expect(env.adminStatusCron).toBe("0 9 * * *");
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
      UNISWAP_ALLOWED_PUBLISHERS: JSON.stringify(uniswapAllowedPublishers),
      COW_ALLOWED_PUBLISHERS: JSON.stringify(cowAllowedPublishers)
    } as NodeJS.ProcessEnv);

    expect(env.lidoAllowedPublishers).toEqual([
      "Lido Labs Foundation - Operations Team",
      "Lido | Finance Team",
      "Lido Ecosystem Foundation - Operations Team"
    ]);
    expect(env.aaveAllowedPublishers).toEqual(aaveAllowedPublishers);
    expect(env.uniswapAllowedPublishers).toEqual(uniswapAllowedPublishers);
    expect(env.cowAllowedPublishers).toEqual(cowAllowedPublishers);
  });

  it("validates the maximum age for a successful forum fetch", () => {
    expect(loadEnv({ FETCH_RUN_MAX_AGE_HOURS: "72" }).fetchRunMaxAgeHours).toBe(72);
    expect(() => loadEnv({ FETCH_RUN_MAX_AGE_HOURS: "0" })).toThrow();
    expect(() => loadEnv({ FETCH_RUN_MAX_AGE_HOURS: "1.5" })).toThrow();
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

    expect(() =>
      loadEnv({
        COW_ALLOWED_PUBLISHERS: "[not-json"
      } as NodeJS.ProcessEnv)
    ).toThrow("Invalid JSON array in COW_ALLOWED_PUBLISHERS.");
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
      COW_ENABLED: "TRUE",
      ENABLE_TELEGRAM_NOTIFICATIONS: "true",
      ENABLE_ADMIN_STATUS_REPORTS: "true",
      ENABLE_SOURCE_ACTIVITY_ALERTS: "false",
      TELEGRAM_E2E_ENABLED: "true",
      API_AUTH_ENABLED: "true",
      API_AUTH_TOKEN: "test-token"
    } as NodeJS.ProcessEnv);

    expect(env.demoMode).toBe(true);
    expect(env.enableScheduler).toBe(false);
    expect(env.lidoEnabled).toBe(false);
    expect(env.aaveEnabled).toBe(false);
    expect(env.uniswapEnabled).toBe(false);
    expect(env.cowEnabled).toBe(true);
    expect(env.enableTelegramNotifications).toBe(true);
    expect(env.enableAdminStatusReports).toBe(true);
    expect(env.enableSourceActivityAlerts).toBe(false);
    expect(env.telegramE2EEnabled).toBe(true);
    expect(env.apiAuthEnabled).toBe(true);
    expect(env.apiAuthToken).toBe("test-token");
  });

  it("allows CoW tracking to be explicitly disabled despite being enabled by default", () => {
    expect(loadEnv({ COW_ENABLED: "false" }).cowEnabled).toBe(false);
  });

  it("accepts already-parsed values from programmatic configuration sources", () => {
    const env = loadEnv({
      ENABLE_SCHEDULER: true,
      ENABLE_TELEGRAM_NOTIFICATIONS: false,
      LIDO_ALLOWED_PUBLISHERS: ["Lido Ops", "  ", "Lido Finance"],
      TELEGRAM_ALLOWED_USER_IDS: [1549323073, "7615564785", "1549323073"]
    } as unknown as NodeJS.ProcessEnv);

    expect(env.enableScheduler).toBe(true);
    expect(env.enableTelegramNotifications).toBe(false);
    expect(env.lidoAllowedPublishers).toEqual(["Lido Ops", "Lido Finance"]);
    expect(env.telegramAllowedUserIds).toEqual([
      "1549323073",
      "7615564785"
    ]);
  });

  it("parses and validates source activity watchdog thresholds", () => {
    const env = loadEnv({
      ENABLE_SOURCE_ACTIVITY_ALERTS: "true",
      SOURCE_ACTIVITY_WARNING_DAYS: "7",
      SOURCE_ACTIVITY_CRITICAL_DAYS: "21",
      SOURCE_ACTIVITY_MIN_FETCHED_COUNT: "0"
    } as NodeJS.ProcessEnv);

    expect(env.enableSourceActivityAlerts).toBe(true);
    expect(env.sourceActivityWarningDays).toBe(7);
    expect(env.sourceActivityCriticalDays).toBe(21);
    expect(env.sourceActivityMinFetchedCount).toBe(0);

    expect(() =>
      loadEnv({
        SOURCE_ACTIVITY_WARNING_DAYS: "14",
        SOURCE_ACTIVITY_CRITICAL_DAYS: "7"
      } as NodeJS.ProcessEnv)
    ).toThrow(
      "SOURCE_ACTIVITY_CRITICAL_DAYS must be greater than or equal to SOURCE_ACTIVITY_WARNING_DAYS."
    );

    expect(() =>
      loadEnv({
        SOURCE_ACTIVITY_MIN_FETCHED_COUNT: "-1"
      } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("parses and deduplicates Telegram allowed user ids", () => {
    const jsonEnv = loadEnv({
      TELEGRAM_ALLOWED_USER_IDS: JSON.stringify([123456789, "987654321", "123456789"])
    } as NodeJS.ProcessEnv);
    const commaEnv = loadEnv({
      TELEGRAM_ALLOWED_USER_IDS: " 123456789,987654321,123456789 ",
      NOTIFICATION_RETRY_CRON: "*/30 * * * *"
    } as NodeJS.ProcessEnv);

    expect(jsonEnv.telegramAllowedUserIds).toEqual(["123456789", "987654321"]);
    expect(commaEnv.telegramAllowedUserIds).toEqual(["123456789", "987654321"]);
    expect(commaEnv.notificationRetryCron).toBe("*/30 * * * *");
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

  it("parses and validates admin status Telegram configuration", () => {
    const env = loadEnv({
      ENABLE_ADMIN_STATUS_REPORTS: "true",
      TELEGRAM_ADMIN_USER_ID: " 1549323073 ",
      ADMIN_STATUS_CRON: "30 8 * * *"
    } as NodeJS.ProcessEnv);

    expect(env.enableAdminStatusReports).toBe(true);
    expect(env.telegramAdminUserId).toBe("1549323073");
    expect(env.adminStatusCron).toBe("30 8 * * *");

    expect(() =>
      loadEnv({
        TELEGRAM_ADMIN_USER_ID: "@admin"
      } as NodeJS.ProcessEnv)
    ).toThrow("TELEGRAM_ADMIN_USER_ID must be a positive numeric Telegram user ID.");

    expect(() =>
      loadEnv({
        TELEGRAM_ADMIN_USER_ID: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow("TELEGRAM_ADMIN_USER_ID must be a positive numeric Telegram user ID.");
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

  it("requires a usable API token when global API auth is enabled", () => {
    expect(() =>
      loadEnv({
        API_AUTH_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toThrow("API_AUTH_TOKEN must be set when API_AUTH_ENABLED=true.");

    expect(() =>
      loadEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "   "
      } as NodeJS.ProcessEnv)
    ).toThrow("API_AUTH_TOKEN must be set when API_AUTH_ENABLED=true.");
  });

  it("trims surrounding API token whitespace so Docker input remains usable", () => {
    const env = loadEnv({
      API_AUTH_ENABLED: "true",
      API_AUTH_TOKEN: "  test-token  "
    } as NodeJS.ProcessEnv);

    expect(env.apiAuthToken).toBe("test-token");
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
      UNISWAP_CATEGORY_FETCH_MAX_PAGES: "4",
      COW_FETCH_MAX_PAGES: "9",
      COW_CATEGORY_FETCH_MAX_PAGES: "3"
    } as NodeJS.ProcessEnv);

    expect(env.lidoFetchMaxPages).toBe(7);
    expect(env.aaveFetchMaxPages).toBe(6);
    expect(env.aaveCategoryFetchMaxPages).toBe(3);
    expect(env.uniswapFetchMaxPages).toBe(8);
    expect(env.uniswapCategoryFetchMaxPages).toBe(4);
    expect(env.cowFetchMaxPages).toBe(9);
    expect(env.cowCategoryFetchMaxPages).toBe(3);

    expect(() =>
      loadEnv({
        LIDO_FETCH_MAX_PAGES: "0"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        COW_FETCH_MAX_PAGES: "21"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        COW_CATEGORY_FETCH_MAX_PAGES: "0"
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

  it("parses explicit Uniswap on-chain governance configuration", () => {
    const env = loadEnv({
      ETHEREUM_RPC_URL: " https://example.quiknode.pro/secret/ ",
      UNISWAP_ONCHAIN_ENABLED: "true",
      UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "true",
      ONCHAIN_FETCH_INTERVAL_CRON: "15 */6 * * *",
      ENABLE_TELEGRAM_NOTIFICATIONS: "true",
      UNISWAP_GOVERNOR_ADDRESS:
        "0x408ED6354d4973f66138C91495F2f2FCbd8724C3",
      UNISWAP_TIMELOCK_ADDRESS:
        "0x1a9C8182C09F50C8318d769245beA52c32BE35BC",
      UNISWAP_UNI_TOKEN_ADDRESS:
        "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    } as NodeJS.ProcessEnv);

    expect(env.ethereumRpcUrl).toBe("https://example.quiknode.pro/secret/");
    expect(env.uniswapOnchainEnabled).toBe(true);
    expect(env.uniswapOnchainNotificationsEnabled).toBe(true);
    expect(env.onchainFetchIntervalCron).toBe("15 */6 * * *");
  });

  it("requires RPC configuration only when on-chain governance is enabled", () => {
    expect(() =>
      loadEnv({
        ETHEREUM_RPC_URL: "",
        UNISWAP_ONCHAIN_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toThrow("ETHEREUM_RPC_URL must be set when UNISWAP_ONCHAIN_ENABLED=true.");

    expect(() =>
      loadEnv({
        ETHEREUM_RPC_URL: "not-a-url",
        UNISWAP_ONCHAIN_ENABLED: "false"
      } as NodeJS.ProcessEnv)
    ).toThrow();

    expect(() =>
      loadEnv({
        ETHEREUM_RPC_URL: "",
        UNISWAP_ONCHAIN_ENABLED: "false"
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it("requires both the source and Telegram before lifecycle notifications can be enabled", () => {
    expect(() =>
      loadEnv({
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "true",
        UNISWAP_ONCHAIN_ENABLED: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "true"
      } as NodeJS.ProcessEnv)
    ).toThrow(
      "UNISWAP_ONCHAIN_ENABLED must be true when UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=true."
    );

    expect(() =>
      loadEnv({
        ETHEREUM_RPC_URL: "https://example.com/rpc",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "true",
        UNISWAP_ONCHAIN_ENABLED: "true",
        ENABLE_TELEGRAM_NOTIFICATIONS: "false"
      } as NodeJS.ProcessEnv)
    ).toThrow(
      "ENABLE_TELEGRAM_NOTIFICATIONS must be true when UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED=true."
    );
  });

  it.each([
    "0x1234",
    "408ED6354d4973f66138C91495F2f2FCbd8724C3",
    "0xZZ8ED6354d4973f66138C91495F2f2FCbd8724C3"
  ])("rejects malformed EVM address %s", (address) => {
    expect(() =>
      loadEnv({ UNISWAP_GOVERNOR_ADDRESS: address } as NodeJS.ProcessEnv)
    ).toThrow("Must be a valid Ethereum address.");
  });

});
