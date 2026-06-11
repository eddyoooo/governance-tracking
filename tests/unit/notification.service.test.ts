import { describe, expect, it, jest } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
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

describe("notification services", () => {
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
        "New governance item tracked",
        "Protocol: Lido",
        "Source: Forum",
        "Publisher: Lido Ops",
        "Title: Vote on boring but important thing",
        "Link: https://research.lido.fi/t/test/1"
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
          TELEGRAM_CHAT_ID: ""
        } as NodeJS.ProcessEnv),
        createSilentLogger()
      )
    ).toThrow(
      "Telegram notifications are enabled but TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set."
    );
  });

  it("sends Telegram messages through the Bot API", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const service = new TelegramNotificationService({
      botToken: "token",
      chatId: "chat-id",
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

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("New governance item tracked")
      })
    );
  });

  it("does not log Telegram chat ids while sending", async () => {
    const logger = createSilentLogger();
    const fetchImpl = jest.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const service = new TelegramNotificationService({
      botToken: "token",
      chatId: "sensitive-chat-id",
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

    expect(JSON.stringify((logger.debug as jest.Mock).mock.calls)).not.toContain(
      "sensitive-chat-id"
    );
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

  it("throws on Telegram HTTP failures", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () => new Response("rate limited", { status: 429 })
    );
    const service = new TelegramNotificationService({
      botToken: "token",
      chatId: "chat-id",
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
    ).rejects.toThrow("Telegram notification failed with 429: rate limited");
  });
});
