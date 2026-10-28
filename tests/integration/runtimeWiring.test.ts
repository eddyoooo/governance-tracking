import { describe, expect, it } from "@jest/globals";
import { createTelegramRecipientKey } from "../../src/notifications/index.js";
import { createApp } from "../../src/server.js";
import { testEnv } from "../helpers/builders.js";

describe("production feature wiring", () => {
  it("enables every supported forum adapter by default, including CoW", () => {
    const { context } = createApp({ env: testEnv() });

    expect(
      context.protocolRegistry
        .list()
        .filter((adapter) => adapter.enabled)
        .map((adapter) => adapter.protocol)
    ).toEqual(["lido", "aave", "uniswap", "cow"]);
  });

  it("keeps admin status reporting independent from normal governance recipients", () => {
    const { context } = createApp({
      env: testEnv({
        ENABLE_TELEGRAM_NOTIFICATIONS: "false",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_ALLOWED_USER_IDS: "",
        ENABLE_ADMIN_STATUS_REPORTS: "true",
        TELEGRAM_ADMIN_USER_ID: "1549323073"
      })
    });

    expect(context.notificationService.enabled).toBe(false);
    expect(context.notificationService.getRecipients()).toEqual([]);
    expect(context.adminStatusReporter.enabled).toBe(true);
  });

  it("wires normal governance alerts to every allowed user without adding the admin implicitly", () => {
    const { context } = createApp({
      env: testEnv({
        ENABLE_TELEGRAM_NOTIFICATIONS: "true",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_ALLOWED_USER_IDS: '["111111111","222222222"]',
        ENABLE_ADMIN_STATUS_REPORTS: "true",
        TELEGRAM_ADMIN_USER_ID: "1549323073"
      })
    });

    expect(context.notificationService.enabled).toBe(true);
    expect(context.notificationService.getRecipients()).toEqual([
      {
        key: createTelegramRecipientKey("111111111"),
        maskedId: "*****1111"
      },
      {
        key: createTelegramRecipientKey("222222222"),
        maskedId: "*****2222"
      }
    ]);
    expect(context.notificationService.getRecipients()).not.toContainEqual({
      key: createTelegramRecipientKey("1549323073"),
      maskedId: "******3073"
    });
    expect(context.adminStatusReporter.enabled).toBe(true);
  });

  it("registers Uniswap on-chain tracking only when its RPC-backed source is enabled", () => {
    const disabled = createApp({ env: testEnv() });
    const enabled = createApp({
      env: testEnv({
        ETHEREUM_RPC_URL: "https://rpc.example.test/secret",
        UNISWAP_ONCHAIN_ENABLED: "true",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false"
      })
    });

    expect(disabled.context.evmGovernanceRegistry.list()).toEqual([]);
    expect(
      enabled.context.evmGovernanceRegistry.list().map((adapter) => ({
        protocol: adapter.protocol,
        enabled: adapter.enabled,
        notificationsEnabled: adapter.notificationsEnabled
      }))
    ).toEqual([
      {
        protocol: "uniswap",
        enabled: true,
        notificationsEnabled: false
      }
    ]);
  });
});
