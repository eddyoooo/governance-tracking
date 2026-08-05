import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import {
  createTelegramTestNotification,
  createTelegramTestNotifications,
  telegramTestNotificationFixtures
} from "../../src/demoFixtures/telegramNotification.fixture.js";
import {
  createNotificationService,
  createTelegramRecipientKey,
  formatTelegramGovernanceMessage,
  NoopNotificationService,
  notificationRetryAt,
  ProposalNotificationDispatcher,
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

class TargetedNotificationService implements NotificationService {
  readonly name = "targeted";
  readonly enabled = true;
  readonly calls: Array<{
    message: NotificationMessage;
    recipientKeys: readonly string[];
  }> = [];
  readonly failingRecipientKeys = new Set<string>();

  constructor(
    private readonly recipients: ReadonlyArray<{
      key: string;
      maskedId: string;
    }>
  ) {}

  getRecipients() {
    return this.recipients;
  }

  async send(
    message: NotificationMessage,
    recipientKeys?: readonly string[]
  ): Promise<void> {
    const targets =
      recipientKeys ?? this.recipients.map((recipient) => recipient.key);

    this.calls.push({ message, recipientKeys: [...targets] });

    const failedTarget = targets.find((key) =>
      this.failingRecipientKeys.has(key)
    );

    if (failedTarget) {
      throw new Error(`Delivery failed for ${failedTarget}`);
    }
  }
}

class BlockingNotificationService implements NotificationService {
  readonly name = "blocking";
  readonly enabled = true;
  readonly calls: NotificationMessage[] = [];
  private releaseSend: (() => void) | undefined;
  private readonly blocked = new Promise<void>((resolve) => {
    this.releaseSend = resolve;
  });

  getRecipients() {
    return [{ key: "recipient-1", maskedId: "*****1111" }];
  }

  async send(
    message: NotificationMessage,
    _recipientKeys?: readonly string[]
  ): Promise<void> {
    this.calls.push(message);
    await this.blocked;
  }

  release(): void {
    this.releaseSend?.();
  }
}

describe("notification services", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps Telegram test fixtures realistic and publisher-diverse", () => {
    const publisherNames = telegramTestNotificationFixtures.map(
      (fixture) => fixture.publisherName
    );

    expect(telegramTestNotificationFixtures.length).toBeGreaterThanOrEqual(2);
    expect(new Set(publisherNames).size).toBe(telegramTestNotificationFixtures.length);
    expect(new Set(telegramTestNotificationFixtures.map((fixture) => fixture.protocol))).toEqual(
      new Set(["lido", "aave", "uniswap"])
    );
    expect(publisherNames).toEqual(
      expect.arrayContaining([
        "Lido Labs Foundation - Operations Team",
        "Lido | Finance Team",
        "AaveLabs",
        "LlamaRisk",
        "TokenLogic",
        "Certora",
        "kpk",
        "Hayden Adams",
        "eek637",
        "Devin",
        "Ken Ng",
        "Natalia",
        "GFX Labs",
        "UniswapFoundation"
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
      } else if (fixture.protocol === "aave") {
        expect(fixture.protocol).toBe("aave");
        expect(fixture.sourceUrl).toMatch(
          new RegExp(`^https://governance\\.aave\\.com/t/.+/${fixture.sourceId}$`)
        );
      } else {
        expect(fixture.protocol).toBe("uniswap");
        expect(fixture.sourceUrl).toMatch(
          new RegExp(`^https://gov\\.uniswap\\.org/t/.+/${fixture.sourceId}$`)
        );
      }
      expect(new Date(fixture.publishedAt).toISOString()).toBe(fixture.publishedAt);
    }
  });

  it("builds isolated Telegram demo messages with safe overrides", () => {
    const single = createTelegramTestNotification({
      title: "Overridden title"
    });
    const all = createTelegramTestNotifications({
      sourceType: "forum"
    });

    expect(single).toMatchObject({
      protocol: "lido",
      title: "Overridden title"
    });
    expect(all).toHaveLength(telegramTestNotificationFixtures.length);
    expect(all.every((message) => message.sourceType === "forum")).toBe(true);
    expect(telegramTestNotificationFixtures[0].title).not.toBe(
      "Overridden title"
    );
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

  it.each([
    ["lido", "Lido"],
    ["aave", "Aave"],
    ["uniswap", "Uniswap"]
  ])(
    "preserves the established customer message contract for %s",
    (protocol, displayedProtocol) => {
      const lines = formatTelegramGovernanceMessage({
        protocol,
        sourceType: "forum",
        publisherName: "Tracked Publisher",
        title: "Tracked proposal title",
        sourceUrl: "https://forum.example/t/proposal/123"
      }).split("\n");

      expect(lines).toEqual([
        "<b>NEW GOVERNANCE ITEM TRACKED</b>",
        `Protocol: ${displayedProtocol}`,
        "Source: Forum",
        "Publisher: Tracked Publisher",
        "Title: Tracked proposal title",
        "Link: https://forum.example/t/proposal/123"
      ]);
    }
  );

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

  it("keeps the noop service inert when called directly", async () => {
    const service = new NoopNotificationService();

    expect(service.enabled).toBe(false);
    expect(service.getRecipients()).toEqual([]);
    await expect(
      service.send({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Allowed Publisher",
        title: "Proposal",
        sourceUrl: "https://example.com"
      })
    ).resolves.toBeUndefined();
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
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal
    );
    expect(String(firstBody.text)).toContain("<b>NEW GOVERNANCE ITEM TRACKED</b>");
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("333333333");
  });

  it("treats a Telegram JSON ok=false response as a delivery failure even with HTTP 200", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ ok: false, description: "chat not found" }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );
    const service = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111"],
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
      failures: [
        expect.objectContaining({
          status: 200,
          responseBody: JSON.stringify({
            ok: false,
            description: "chat not found"
          })
        })
      ]
    });
  });

  it("accepts only a valid Telegram JSON ok=true success response", async () => {
    const successService = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111"],
      fetchImpl: jest.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" }
          })
      ),
      logger: createSilentLogger()
    });
    const malformedService = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111"],
      fetchImpl: jest.fn<typeof fetch>(
        async () =>
          new Response("<html>proxy error</html>", {
            status: 200,
            headers: { "content-type": "application/json" }
          })
      ),
      logger: createSilentLogger()
    });
    const message = {
      protocol: "lido",
      sourceType: "forum",
      publisherName: "Allowed Publisher",
      title: "Proposal",
      sourceUrl: "https://example.com"
    };

    await expect(successService.send(message)).resolves.toBeUndefined();
    await expect(malformedService.send(message)).rejects.toMatchObject({
      failures: [
        expect.objectContaining({
          status: 200,
          responseBody: "<html>proxy error</html>"
        })
      ]
    });
  });

  it("does not lose an oversized Telegram ok=false failure while truncating its details", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ ok: false, description: "x".repeat(5_000) }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );
    const service = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111"],
      fetchImpl,
      logger: createSilentLogger()
    });

    const error = await service
      .send({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Allowed Publisher",
        title: "Proposal",
        sourceUrl: "https://example.com"
      })
      .catch(
        (caught) =>
          caught as { failures: Array<{ status: number; responseBody: string }> }
      );

    expect(error.failures[0].status).toBe(200);
    expect(error.failures[0].responseBody.length).toBeLessThanOrEqual(1_000);
    expect(error.failures[0].responseBody.endsWith("...")).toBe(true);
  });

  it("rejects unknown recipient keys before making any Telegram request", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    const service = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111"],
      fetchImpl,
      logger: createSilentLogger()
    });

    await expect(
      service.send(
        {
          protocol: "lido",
          sourceType: "forum",
          publisherName: "Allowed Publisher",
          title: "Proposal",
          sourceUrl: "https://example.com"
        },
        ["unknown-recipient-key"]
      )
    ).rejects.toThrow(
      "Telegram notification requested 1 unknown recipient key(s)."
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out stuck Telegram proposal notification requests per recipient", async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        })
    );
    const service = new TelegramNotificationService({
      botToken: "sensitive-token",
      allowedUserIds: ["111111111"],
      fetchImpl,
      logger: createSilentLogger(),
      requestTimeoutMs: 25
    });

    const send = service.send({
      protocol: "lido",
      sourceType: "forum",
      publisherName: "Allowed Publisher",
      title: "Proposal",
      sourceUrl: "https://example.com"
    });

    await Promise.resolve();
    jest.advanceTimersByTime(25);

    await expect(send).rejects.toThrow(
      "Telegram notification failed for 1 of 1 allowed recipients: recipient 1 (*****1111) failed: Telegram notification request timed out after 25ms"
    );
    await expect(send).rejects.not.toThrow(/sensitive-token|111111111/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  it("marks a new pending notification skipped when notifications are disabled", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      new NoopNotificationService(),
      createSilentLogger()
    );

    const result = await dispatcher.notifyNewProposal(stored.proposal);

    expect(result).toEqual({
      status: "skipped"
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "skipped"
    });
  });

  it.each(["sent", "skipped"] as const)(
    "does not send a proposal already in terminal notification state %s",
    async (notificationStatus) => {
      const repository = new MemoryProposalRepository();
      const proposal = normalizeLidoForumItem(createRawGovernanceItem());
      const stored = await repository.upsert(proposal, {
        notificationStatusForNew: notificationStatus
      });
      const service = new TargetedNotificationService([
        { key: "recipient-1", maskedId: "*****1111" }
      ]);
      const dispatcher = new ProposalNotificationDispatcher(
        repository,
        service,
        createSilentLogger()
      );

      await expect(
        dispatcher.notifyNewProposal(stored.proposal)
      ).resolves.toEqual({ status: notificationStatus });
      expect(service.calls).toEqual([]);
    }
  );

  it("does not retry a failed proposal through the new-proposal path", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(proposal.id, "failed");
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(dispatcher.notifyNewProposal(stored.proposal)).resolves.toEqual({
      status: "failed",
      error: "Proposal notification is awaiting automatic recovery."
    });
    expect(service.calls).toEqual([]);
  });

  it("fails safely when a proposal disappears before notification dispatch", async () => {
    const repository = new MemoryProposalRepository();
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );
    const missing = {
      ...normalizeLidoForumItem(createRawGovernanceItem()),
      notificationStatus: "pending" as const,
      firstSeenAt: "2026-07-24T00:00:00.000Z",
      lastSeenAt: "2026-07-24T00:00:00.000Z",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    };

    await expect(dispatcher.notifyNewProposal(missing)).resolves.toEqual({
      status: "failed",
      error: "Proposal disappeared before notification delivery."
    });
    expect(service.calls).toEqual([]);
  });

  it("fails safely when a proposal disappears while recipient state is initialized", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    jest
      .spyOn(repository, "updateNotificationState")
      .mockResolvedValueOnce(null);
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(dispatcher.notifyNewProposal(stored.proposal)).resolves.toEqual({
      status: "failed",
      error: "Proposal disappeared before notification delivery."
    });
    expect(service.calls).toEqual([]);
  });

  it("records a clear failure when an enabled notification service exposes no recipients", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const service = new TargetedNotificationService([]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(
      dispatcher.notifyNewProposal(stored.proposal)
    ).resolves.toEqual({
      status: "failed",
      error:
        "Notifications are enabled but no notification recipients are configured."
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "failed",
      notificationError:
        "Notifications are enabled but no notification recipients are configured."
    });
    expect(service.calls).toEqual([]);
  });

  it("records recipient-level delivery state when a new proposal is sent", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(
      createRawGovernanceItem({ sourceId: "1001", title: "New proposal" })
    );
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" },
      { key: "recipient-2", maskedId: "*****2222" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(dispatcher.notifyNewProposal(stored.proposal)).resolves.toEqual({
      status: "sent"
    });
    expect(service.calls.map((call) => call.recipientKeys)).toEqual([
      ["recipient-1"],
      ["recipient-2"]
    ]);

    const delivered = await repository.findById(proposal.id);

    expect(delivered).toMatchObject({
      notificationStatus: "sent",
      notificationDeliveries: {
        "recipient-1": {
          recipientMaskedId: "*****1111",
          status: "sent",
          attemptCount: 1
        },
        "recipient-2": {
          recipientMaskedId: "*****2222",
          status: "sent",
          attemptCount: 1
        }
      }
    });
    expect(delivered).not.toHaveProperty("notificationError");
  });

  it("does not send when a proposal disappears before a recipient attempt is prepared", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const updateNotificationState =
      repository.updateNotificationState.bind(repository);
    jest
      .spyOn(repository, "updateNotificationState")
      .mockImplementationOnce(updateNotificationState)
      .mockResolvedValueOnce(null);
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(dispatcher.notifyNewProposal(stored.proposal)).resolves.toEqual({
      status: "failed",
      error: "One or more notification deliveries failed."
    });
    expect(service.calls).toEqual([]);
  });

  it("reports a vanished proposal after delivery without a duplicate send", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const findById = repository.findById.bind(repository);
    jest
      .spyOn(repository, "findById")
      .mockImplementationOnce(findById)
      .mockImplementationOnce(findById)
      .mockImplementationOnce(findById)
      .mockImplementationOnce(findById)
      .mockResolvedValueOnce(null);
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(dispatcher.notifyNewProposal(stored.proposal)).resolves.toEqual({
      status: "failed",
      error: "Proposal disappeared during notification delivery."
    });
    expect(service.calls).toHaveLength(1);
    expect(service.calls[0].recipientKeys).toEqual(["recipient-1"]);
  });

  it("serializes concurrent new-proposal dispatches without duplicate sends", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const service = new BlockingNotificationService();
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    const first = dispatcher.notifyNewProposal(stored.proposal);
    const second = dispatcher.notifyNewProposal(stored.proposal);
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.calls).toHaveLength(1);
    service.release();

    await expect(first).resolves.toEqual({ status: "sent" });
    await expect(second).resolves.toEqual({ status: "sent" });
    expect(service.calls).toHaveLength(1);
  });

  it("prevents overlapping automatic recovery cycles", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const service = new BlockingNotificationService();
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    const first = dispatcher.recoverOutstanding(
      "2026-07-24T12:00:00.000Z"
    );
    await new Promise((resolve) => setImmediate(resolve));
    const overlapping = await dispatcher.recoverOutstanding(
      "2026-07-24T12:00:01.000Z"
    );

    expect(overlapping).toMatchObject({
      candidateCount: 0,
      attemptedProposalCount: 0,
      skippedBecauseRunning: true
    });

    service.release();
    await expect(first).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 1,
      recoveredCount: 1,
      skippedBecauseRunning: false
    });
    expect(service.calls).toHaveLength(1);
  });

  it("reports a recovery candidate that disappears before delivery", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    jest.spyOn(repository, "findById").mockResolvedValueOnce(null);
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 0,
      skippedCount: 1,
      errors: [
        expect.stringContaining(
          "Notification recovery proposal no longer exists"
        )
      ]
    });
    expect(service.calls).toEqual([]);
  });

  it("does not mutate recovery candidates when notifications are disabled", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      new NoopNotificationService(),
      createSilentLogger()
    );

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 0,
      stillPendingCount: 1,
      stillFailedCount: 0
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "pending"
    });
  });

  it("keeps recovery failed when an enabled service has no recipients", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const service = new TargetedNotificationService([]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 0,
      stillFailedCount: 1,
      errors: [
        "Notifications are enabled but no notification recipients are configured."
      ]
    });
    expect(service.calls).toEqual([]);
  });

  it("automatically retries only the failed recipient after backoff", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" },
      { key: "recipient-2", maskedId: "*****2222" }
    ]);
    service.failingRecipientKeys.add("recipient-2");
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(dispatcher.notifyNewProposal(stored.proposal)).resolves.toMatchObject({
      status: "failed"
    });
    const failed = await repository.findById(proposal.id);

    expect(failed).toMatchObject({
      notificationStatus: "failed",
      notificationDeliveries: {
        "recipient-1": {
          status: "sent",
          attemptCount: 1
        },
        "recipient-2": {
          status: "failed",
          attemptCount: 1,
          nextRetryAt: expect.any(String)
        }
      }
    });
    const retryAt =
      failed?.notificationDeliveries?.["recipient-2"].nextRetryAt as string;
    const beforeRetry = new Date(Date.parse(retryAt) - 1).toISOString();

    await expect(dispatcher.recoverOutstanding(beforeRetry)).resolves.toMatchObject({
      candidateCount: 0,
      attemptedRecipientCount: 0
    });
    expect(service.calls).toHaveLength(2);

    service.failingRecipientKeys.clear();

    await expect(dispatcher.recoverOutstanding(retryAt)).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 1,
      attemptedRecipientCount: 1,
      recoveredCount: 1,
      stillFailedCount: 0,
      errors: []
    });
    expect(service.calls.map((call) => call.recipientKeys)).toEqual([
      ["recipient-1"],
      ["recipient-2"],
      ["recipient-2"]
    ]);
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "sent",
      notificationDeliveries: {
        "recipient-1": {
          status: "sent",
          attemptCount: 1
        },
        "recipient-2": {
          status: "sent",
          attemptCount: 2
        }
      }
    });
  });

  it("closes ambiguous legacy failures without resending", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(
      proposal.id,
      "failed",
      "Telegram unavailable"
    );
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" },
      { key: "recipient-2", maskedId: "*****2222" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    const result = await dispatcher.recoverOutstanding(
      "2026-07-24T12:00:00.000Z"
    );

    expect(result).toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 0,
      attemptedRecipientCount: 0,
      stillFailedCount: 0,
      skippedCount: 1,
      errors: []
    });
    expect(service.calls).toEqual([]);
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "skipped",
      notificationError: expect.stringContaining(
        "automatically closed without resend"
      )
    });
    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:15:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 0,
      skippedCount: 0
    });
  });

  it("does not trust a legacy recipient index without a masked id", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(
      proposal.id,
      "failed",
      "Telegram notification failed for 1 of 2 allowed recipients: recipient 2 failed: chat not found"
    );
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" },
      { key: "recipient-2", maskedId: "*****2222" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      attemptedRecipientCount: 0,
      stillFailedCount: 0,
      skippedCount: 1
    });
    expect(service.calls).toEqual([]);
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "skipped",
      notificationError: expect.stringContaining(
        "recipient identity could not be verified safely"
      )
    });
  });

  it("reconstructs a known legacy partial failure and retries only its failed recipient", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(
      proposal.id,
      "failed",
      "Telegram notification failed for 1 of 2 allowed recipients: recipient 2 (*****2222) failed: chat not found"
    );
    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" },
      { key: "recipient-2", maskedId: "*****2222" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      attemptedRecipientCount: 1,
      recoveredCount: 1,
      stillFailedCount: 0
    });
    expect(service.calls.map((call) => call.recipientKeys)).toEqual([
      ["recipient-2"]
    ]);
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "sent",
      notificationDeliveries: {
        "recipient-1": {
          status: "sent",
          attemptCount: 1
        },
        "recipient-2": {
          status: "sent",
          attemptCount: 2
        }
      }
    });
  });

  it("automatically resolves a failed delivery when that recipient is removed", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const initialService = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" },
      { key: "recipient-2", maskedId: "*****2222" }
    ]);
    initialService.failingRecipientKeys.add("recipient-2");
    await new ProposalNotificationDispatcher(
      repository,
      initialService,
      createSilentLogger()
    ).notifyNewProposal(stored.proposal);

    const remainingService = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const recovery = new ProposalNotificationDispatcher(
      repository,
      remainingService,
      createSilentLogger()
    );

    await expect(
      recovery.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 1,
      attemptedRecipientCount: 0,
      recoveredCount: 0,
      stillFailedCount: 0
    });
    expect(remainingService.calls).toEqual([]);
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "sent",
      notificationDeliveries: {
        "recipient-1": {
          status: "sent"
        },
        "recipient-2": {
          status: "skipped",
          lastError: "Recipient is no longer configured."
        }
      }
    });
  });

  it("bounds automatic recovery work and drains the next batch later", async () => {
    const repository = new MemoryProposalRepository();

    for (let index = 0; index < 101; index += 1) {
      await repository.upsert(
        normalizeLidoForumItem(
          createRawGovernanceItem({
            sourceId: String(20_000 + index),
            title: `Proposal ${index}`
          })
        ),
        { notificationStatusForNew: "pending" }
      );
    }

    const service = new TargetedNotificationService([
      { key: "recipient-1", maskedId: "*****1111" }
    ]);
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 100,
      attemptedProposalCount: 100,
      attemptedRecipientCount: 100,
      recoveredCount: 100
    });
    expect(service.calls).toHaveLength(100);
    await expect(
      repository.countByNotificationStatus("pending")
    ).resolves.toBe(1);

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:15:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 1,
      recoveredCount: 1
    });
    expect(service.calls).toHaveLength(101);
    await expect(
      repository.countByNotificationStatus("pending")
    ).resolves.toBe(0);
  });

  it("persists non-Error delivery failures as useful retry state", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const stored = await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    const service: NotificationService = {
      name: "string-throwing",
      enabled: true,
      getRecipients: () => [
        { key: "recipient-1", maskedId: "*****1111" }
      ],
      send: async () => {
        throw "network offline";
      }
    };
    const dispatcher = new ProposalNotificationDispatcher(
      repository,
      service,
      createSilentLogger()
    );

    await expect(dispatcher.notifyNewProposal(stored.proposal)).resolves.toEqual({
      status: "failed",
      error:
        "Telegram delivery unresolved for 1 recipient(s); *****1111: network offline"
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "failed",
      notificationDeliveries: {
        "recipient-1": {
          status: "failed",
          lastError: "network offline",
          nextRetryAt: expect.any(String)
        }
      }
    });
  });

  it("uses bounded exponential retry delays", () => {
    const attemptedAt = "2026-07-24T12:00:00.000Z";

    expect(notificationRetryAt(1, attemptedAt)).toBe(
      "2026-07-24T12:15:00.000Z"
    );
    expect(notificationRetryAt(2, attemptedAt)).toBe(
      "2026-07-24T13:00:00.000Z"
    );
    expect(notificationRetryAt(3, attemptedAt)).toBe(
      "2026-07-24T18:00:00.000Z"
    );
    expect(notificationRetryAt(4, attemptedAt)).toBe(
      "2026-07-25T12:00:00.000Z"
    );
    expect(notificationRetryAt(99, attemptedAt)).toBe(
      "2026-07-25T12:00:00.000Z"
    );
  });

  it("creates stable opaque Telegram recipient keys without storing user ids", () => {
    const key = createTelegramRecipientKey("1549323073");

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).toBe(createTelegramRecipientKey("1549323073"));
    expect(key).not.toContain("1549323073");
    expect(key).not.toBe(createTelegramRecipientKey("1549323074"));
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
      "Telegram notification failed for 2 of 2 allowed recipients: recipient 1 (*****1111) failed with 429: rate limited; recipient 2 (*****2222) failed: network down"
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
          recipientMaskedId: "*****2222",
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

  it("bounds oversized Telegram failure bodies before persisting error state", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () => new Response("x".repeat(5_000), { status: 500 })
    );
    const service = new TelegramNotificationService({
      botToken: "token",
      allowedUserIds: ["111111111"],
      fetchImpl,
      logger: createSilentLogger()
    });

    const error = await service
      .send({
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Allowed Publisher",
        title: "Proposal",
        sourceUrl: "https://example.com"
      })
      .catch((caught) => caught as {
        message: string;
        failures: Array<{ responseBody: string }>;
      });

    expect(error.failures[0].responseBody.length).toBeLessThanOrEqual(1_000);
    expect(error.failures[0].responseBody.endsWith("...")).toBe(true);
    expect(error.message.length).toBeLessThan(1_200);
  });

  it("redacts tokens and user ids from Telegram request error logs", async () => {
    const logger = createSilentLogger();
    const fetchImpl = jest.fn<typeof fetch>(async () => {
      throw new Error("failed token sensitive-token user 111111111");
    });
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
    ).rejects.toThrow("failed token [redacted] user [redacted]");

    const serializedLogs = JSON.stringify((logger.error as jest.Mock).mock.calls);

    expect(serializedLogs).not.toContain("sensitive-token");
    expect(serializedLogs).not.toContain("111111111");
    expect(serializedLogs).toContain("failed token [redacted] user [redacted]");
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
