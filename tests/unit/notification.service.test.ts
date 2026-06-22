import { describe, expect, it, jest } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import { telegramTestNotificationFixtures } from "../../src/demoFixtures/telegramNotification.fixture.js";
import {
  createNotificationService,
  formatTelegramGovernanceMessage,
  NoopNotificationService,
  notifyPendingProposals,
  TelegramNotificationService
} from "../../src/notifications/index.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import {
  createRawGovernanceItem,
  createSilentLogger
} from "../helpers/builders.js";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/index.js";

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];

  constructor(private readonly fail = false) {}

  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(message);

    if (this.fail) {
      throw new Error("Telegram unavailable");
    }
  }
}

describe("notification services", () => {
  it("keeps Telegram test fixtures realistic and publisher-diverse", () => {
    const publisherNames = telegramTestNotificationFixtures.map(
      (fixture) => fixture.publisherName
    );

    expect(telegramTestNotificationFixtures.length).toBeGreaterThanOrEqual(2);
    expect(new Set(publisherNames).size).toBe(telegramTestNotificationFixtures.length);
    expect(new Set(telegramTestNotificationFixtures.map((fixture) => fixture.protocol))).toEqual(
      new Set(["lido", "aave"])
    );
    expect(publisherNames).toEqual(
      expect.arrayContaining([
        "Lido Labs Foundation - Operations Team",
        "Lido | Finance Team",
        "AaveLabs",
        "LlamaRisk",
        "TokenLogic"
      ])
    );

    for (const fixture of telegramTestNotificationFixtures) {
      expect(fixture.sourceType).toBe("forum");
      expect(fixture.sourceId).toMatch(/^\d+$/);
      expect(fixture.publisherName).not.toBe("Governance Tracker Test");
      if (fixture.protocol === "lido") {
        expect(fixture.sourceUrl).toMatch(
          new RegExp(`^https://research\\.lido\\.fi/t/.+/${fixture.sourceId}$`)
        );
      } else {
        expect(fixture.protocol).toBe("aave");
        expect(fixture.sourceUrl).toMatch(
          new RegExp(`^https://governance\\.aave\\.com/t/.+/${fixture.sourceId}$`)
        );
      }
      expect(new Date(fixture.publishedAt).toISOString()).toBe(fixture.publishedAt);
    }
  });

  it("formats Telegram messages with only Simple MVP fields", () => {
    expect(
      formatTelegramGovernanceMessage({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Lido Ops",
        title: "Vote on boring but important thing",
        sourceUrl: "https://research.lido.fi/t/test/1"
      })
    ).toBe(
      [
        "<b>NEW GOVERNANCE ITEM TRACKED</b>",
        "Protocol: Lido",
        "Source: Forum",
        "Publisher: Lido Ops",
        "Title: Vote on boring but important thing",
        "Link: https://research.lido.fi/t/test/1"
      ].join("\n")
    );
  });

  it("escapes Telegram HTML fields while preserving the bold all-caps header", () => {
    expect(
      formatTelegramGovernanceMessage({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Lido <Ops> & Finance",
        title: "stETH < LDO & wstETH > ETH",
        sourceUrl: "https://research.lido.fi/t/test?a=1&b=<bad>"
      })
    ).toBe(
      [
        "<b>NEW GOVERNANCE ITEM TRACKED</b>",
        "Protocol: Lido",
        "Source: Forum",
        "Publisher: Lido &lt;Ops&gt; &amp; Finance",
        "Title: stETH &lt; LDO &amp; wstETH &gt; ETH",
        "Link: https://research.lido.fi/t/test?a=1&amp;b=&lt;bad&gt;"
      ].join("\n")
    );
  });

  it("uses noop notifications when Telegram is disabled", () => {
    const service = createNotificationService(
      loadEnv({
        ENABLE_TELEGRAM_NOTIFICATIONS: "false"
      } as NodeJS.ProcessEnv),
      createSilentLogger()
    );

    expect(service).toBeInstanceOf(NoopNotificationService);
    expect(service.enabled).toBe(false);
  });

  it("fails clearly when Telegram is enabled without credentials", () => {
    expect(() =>
      createNotificationService(
        loadEnv({
          ENABLE_TELEGRAM_NOTIFICATIONS: "true",
          TELEGRAM_BOT_TOKEN: "",
          TELEGRAM_ALLOWED_USER_IDS: "[]"
        } as NodeJS.ProcessEnv),
        createSilentLogger()
      )
    ).toThrow(
      "Telegram notifications are enabled but TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS must be set."
    );
  });

  it("creates a Telegram notification service only when a bot token and allowed users are configured", () => {
    const service = createNotificationService(
      loadEnv({
        ENABLE_TELEGRAM_NOTIFICATIONS: "true",
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_ALLOWED_USER_IDS: JSON.stringify(["111111111"])
      } as NodeJS.ProcessEnv),
      createSilentLogger()
    );

    expect(service).toBeInstanceOf(TelegramNotificationService);
    expect(service.enabled).toBe(true);
  });

  it("sends Telegram messages only to configured allowed user ids", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const service = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111", "222222222", "111111111"],
      fetchImpl,
      logger: createSilentLogger()
    });

    await service.send({
      protocol: "lido",
      sourceType: "forum",
      publisherName: "Allowed Publisher",
      title: "Proposal",
      sourceUrl: "https://example.com"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: expect.stringContaining('"chat_id":"111111111"')
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"chat_id":"222222222"')
      })
    );
    const firstBody = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    ) as Record<string, unknown>;

    expect(firstBody).toMatchObject({
      parse_mode: "HTML",
      disable_web_page_preview: false
    });
    expect(String(firstBody.text)).toContain("<b>NEW GOVERNANCE ITEM TRACKED</b>");
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("333333333");
  });

  it("does not log Telegram bot tokens or allowed user ids while sending succeeds", async () => {
    const logger = createSilentLogger();
    const fetchImpl = jest.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const service = new TelegramNotificationService({
      botToken: "sensitive-token",
      allowedUserIds: ["999999999"],
      fetchImpl,
      logger
    });

    await service.send({
      protocol: "lido",
      sourceType: "forum",
      publisherName: "Allowed Publisher",
      title: "Proposal",
      sourceUrl: "https://example.com"
    });

    const serializedLogs = JSON.stringify((logger.debug as jest.Mock).mock.calls);

    expect(serializedLogs).not.toContain("sensitive-token");
    expect(serializedLogs).not.toContain("999999999");
    expect(serializedLogs).toContain("allowedRecipientCount");
  });

  it("marks pending notifications skipped when using NoopNotificationService", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });

    const result = await notifyPendingProposals(
      repository,
      new NoopNotificationService(),
      createSilentLogger()
    );

    expect(result).toEqual({
      pendingCount: 1,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 1,
      errors: []
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "skipped"
    });
  });

  it("notifies only pending proposals and leaves failed proposals untouched", async () => {
    const repository = new MemoryProposalRepository();
    const pending = normalizeLidoForumItem(
      createRawGovernanceItem({ sourceId: "1001", title: "Pending proposal" })
    );
    const failed = normalizeLidoForumItem(
      createRawGovernanceItem({ sourceId: "1002", title: "Failed proposal" })
    );
    const service = new RecordingNotificationService();

    await repository.upsert(pending, {
      notificationStatusForNew: "pending"
    });
    await repository.upsert(failed, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(failed.id, "failed", "old failure");

    const result = await notifyPendingProposals(
      repository,
      service,
      createSilentLogger()
    );

    expect(result).toEqual({
      pendingCount: 1,
      sentCount: 1,
      failedCount: 0,
      skippedCount: 0,
      errors: []
    });
    expect(service.messages).toHaveLength(1);
    expect(service.messages[0].title).toBe("Pending proposal");
    await expect(repository.findById(pending.id)).resolves.toMatchObject({
      notificationStatus: "sent"
    });
    await expect(repository.findById(failed.id)).resolves.toMatchObject({
      notificationStatus: "failed",
      notificationError: "old failure"
    });
  });

  it("marks pending proposals failed when retry notification sending fails", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const service = new RecordingNotificationService(true);

    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });

    const result = await notifyPendingProposals(
      repository,
      service,
      createSilentLogger()
    );

    expect(result).toEqual({
      pendingCount: 1,
      sentCount: 0,
      failedCount: 1,
      skippedCount: 0,
      errors: ["Telegram unavailable"]
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "failed",
      notificationError: "Telegram unavailable"
    });
  });

  it("throws after attempting every allowed recipient when Telegram delivery fails", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockRejectedValueOnce(new Error("network down"));
    const service = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111", "222222222"],
      fetchImpl,
      logger: createSilentLogger()
    });

    const send = service.send({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Allowed Publisher",
        title: "Proposal",
        sourceUrl: "https://example.com"
      });

    await expect(send).rejects.toThrow(
      "Telegram notification failed for 2 of 2 allowed recipients: recipient 1 failed with 429: rate limited; recipient 2 failed: network down"
    );
    await expect(send).rejects.not.toThrow(/111111111|222222222/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws aggregated errors after partial Telegram delivery failures", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }));
    const service = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111", "222222222"],
      fetchImpl,
      logger: createSilentLogger()
    });

    await expect(
      service.send({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Allowed Publisher",
        title: "Proposal",
        sourceUrl: "https://example.com"
      })
    ).rejects.toMatchObject({
      name: "TelegramNotificationDeliveryError",
      failures: [
        {
          recipientIndex: 2,
          status: 403,
          responseBody: "blocked"
        }
      ],
      attemptedRecipientCount: 2
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("redacts tokens and user ids from Telegram failure details", async () => {
    const logger = createSilentLogger();
    const fetchImpl = jest.fn<typeof fetch>(
      async () => new Response("token sensitive-token chat 111111111", { status: 400 })
    );
    const service = new TelegramNotificationService({
      botToken: "sensitive-token",
      allowedUserIds: ["111111111"],
      fetchImpl,
      logger
    });

    await expect(
      service.send({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Allowed Publisher",
        title: "Proposal",
        sourceUrl: "https://example.com"
      })
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("sensitive-token"),
      failures: [
        expect.objectContaining({
          responseBody: "token [redacted] chat [redacted]"
        })
      ]
    });

    const serializedLogs = JSON.stringify((logger.error as jest.Mock).mock.calls);

    expect(serializedLogs).not.toContain("sensitive-token");
    expect(serializedLogs).not.toContain("111111111");
  });

  it("requires at least one allowed user id", () => {
    expect(
      () =>
        new TelegramNotificationService({
          botToken: "token",
          allowedUserIds: [],
          fetchImpl: jest.fn<typeof fetch>(),
          logger: createSilentLogger()
        })
    ).toThrow("TelegramNotificationService requires at least one allowed user id.");
  });

  it("requires a non-empty Telegram bot token even when constructed directly", () => {
    expect(
      () =>
        new TelegramNotificationService({
          botToken: "   ",
          allowedUserIds: ["111111111"],
          fetchImpl: jest.fn<typeof fetch>(),
          logger: createSilentLogger()
        })
    ).toThrow("TelegramNotificationService requires a bot token.");
  });

  it("rejects non-numeric Telegram user ids even when constructed directly", () => {
    expect(
      () =>
        new TelegramNotificationService({
          botToken: "token",
          allowedUserIds: ["111111111", "@teammate"],
          fetchImpl: jest.fn<typeof fetch>(),
          logger: createSilentLogger()
        })
    ).toThrow(
      "TelegramNotificationService allowed user ids must be positive numeric Telegram user IDs."
    );
  });
});
