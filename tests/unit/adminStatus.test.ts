import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  buildAdminStatusReport,
  createAdminStatusReporter,
  DailyAdminStatusReporter,
  type AdminStatusNotifier
} from "../../src/adminStatus/adminStatus.service.js";
import {
  TelegramAdminStatusDeliveryError,
  TelegramAdminStatusNotifier
} from "../../src/adminStatus/telegramAdminStatus.service.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import {
  MemoryFetchRunRepository,
  type FetchRun
} from "../../src/storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import {
  MemorySourceActivityRepository,
  type SourceActivityRecord
} from "../../src/storage/sourceActivity.repository.js";
import type { ProposalRepository } from "../../src/storage/proposal.repository.js";
import {
  createFakeProtocolAdapter,
  createRawGovernanceItem,
  createSilentLogger,
  testEnv
} from "../helpers/builders.js";

class RecordingAdminStatusNotifier implements AdminStatusNotifier {
  readonly name = "recording-admin-status";
  readonly enabled = true;
  readonly messages: string[] = [];

  async send(message: string): Promise<void> {
    this.messages.push(message);
  }
}

function createNotificationLookupFailureRepository(
  message = "Firestore index missing"
): ProposalRepository {
  return {
    upsert: jest.fn(),
    upsertMany: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    findBySourceIdentity: jest.fn(),
    findByNotificationStatus: jest.fn(async () => {
      throw new Error(message);
    }),
    updateNotificationStatus: jest.fn()
  } as unknown as ProposalRepository;
}

function createRun(overrides: Partial<FetchRun> = {}): FetchRun {
  return {
    id: `fetchRun_${overrides.protocol ?? "lido"}_test`,
    protocol: "lido",
    startedAt: "2026-07-01T08:59:00.000Z",
    finishedAt: "2026-07-01T09:00:00.000Z",
    status: "success",
    fetchedCount: 10,
    allowlistedCount: 2,
    storedNewCount: 1,
    updatedExistingCount: 0,
    unchangedExistingCount: 1,
    skippedCount: 8,
    notificationSentCount: 1,
    notificationFailedCount: 0,
    errors: [],
    ...overrides
  };
}

function createSourceActivity(
  overrides: Partial<SourceActivityRecord> = {}
): SourceActivityRecord {
  return {
    protocol: "lido",
    sourceType: "forum",
    latestRawSourceId: "1001",
    latestRawPublishedAt: "2026-07-01T00:00:00.000Z",
    lastFetchedAt: "2026-07-01T09:00:00.000Z",
    lastFetchedCount: 10,
    consecutiveStaleRuns: 0,
    status: "healthy",
    warningThresholdDays: 14,
    criticalThresholdDays: 30,
    minFetchedCount: 1,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    ...overrides
  };
}

function createRegistry() {
  return {
    list: jest.fn(() => [
      createFakeProtocolAdapter({ protocol: "lido" }),
      createFakeProtocolAdapter({ protocol: "aave" }),
      createFakeProtocolAdapter({ protocol: "uniswap" })
    ])
  };
}

describe("admin status reports", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds a healthy daily status report from recent successful fetch runs", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "aave" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "aave" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "uniswap" }));

    const result = await buildAdminStatusReport({
      env: testEnv({
        ENABLE_SCHEDULER: "true",
        STORAGE_MODE: "firestore",
        DEMO_MODE: "false"
      }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(result.healthy).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.message).toContain("<b>GOVERNANCE MONITOR DAILY STATUS</b>");
    expect(result.message).toContain("Status: OK");
    expect(result.message).toContain("Storage: firestore");
    expect(result.message).toContain("Scheduler: enabled");
    expect(result.message).toContain("Enabled protocols: lido, aave, uniswap");
    expect(result.message).toContain("- lido: success");
    expect(result.message).toContain("Source activity:");
    expect(result.message).toContain("- lido: healthy");
    expect(result.message).toContain("Problems:\n- None detected.");
  });

  it("reports missing fetches, failed fetches, and failed notification state", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const failedProposal = normalizeLidoForumItem(
      createRawGovernanceItem({ sourceId: "failed-notification" })
    );

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(
      createRun({
        id: "fetchRun_aave_failed",
        protocol: "aave",
        status: "failed",
        errors: ["Aave forum unavailable"],
        notificationFailedCount: 2
      })
    );
    await proposalRepository.upsert(failedProposal, {
      notificationStatusForNew: "pending"
    });
    await proposalRepository.updateNotificationStatus(
      failedProposal.id,
      "failed",
      "Telegram unavailable"
    );
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));
    await sourceActivityRepository.upsert(
      createSourceActivity({
        protocol: "aave",
        status: "critical",
        statusReason: "Newest raw source item is 35 day(s) old."
      })
    );

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "aave latest fetch is failed: Aave forum unavailable",
        "No fetch run has been recorded for uniswap.",
        "aave fetch failed at 2026-07-01T09:00:00.000Z: Aave forum unavailable",
        "aave had 2 notification failure(s) in fetch run fetchRun_aave_failed.",
        "1 proposal notification(s) are marked failed.",
        "aave source activity is critical: Newest raw source item is 35 day(s) old.",
        "No source activity record has been recorded for uniswap."
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain("Failed notifications: 1");
    expect(result.message).toContain("Aave forum unavailable");
  });

  it("reports unhealthy when no protocol adapters are enabled", async () => {
    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: {
        list: jest.fn(() => [
          createFakeProtocolAdapter({ protocol: "lido", enabled: false }),
          createFakeProtocolAdapter({ protocol: "aave", enabled: false })
        ])
      } as never,
      fetchRunRepository: new MemoryFetchRunRepository(),
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository()
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toContain("No protocol adapters are enabled.");
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain("Enabled protocols: none");
  });

  it("does not fail the daily report on missing source-activity records when alerts are disabled", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "aave" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));

    const result = await buildAdminStatusReport({
      env: testEnv({
        ENABLE_SOURCE_ACTIVITY_ALERTS: "false",
        ENABLE_SCHEDULER: "true"
      }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository()
    });

    expect(result.healthy).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.message).toContain("Source activity:");
    expect(result.message).toContain("- lido: no source activity recorded");
  });

  it("still builds and marks unhealthy when notification queue reads fail", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "aave" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "aave" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "uniswap" }));

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository: createNotificationLookupFailureRepository(),
      sourceActivityRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "Unable to read pending notification queue: Firestore index missing",
        "Unable to read failed notification queue: Firestore index missing"
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain("Pending notifications: unknown");
    expect(result.message).toContain("Failed notifications: unknown");
    expect(result.message).toContain("- lido: success");
  });

  it("sends a fallback attention report if status report construction throws unexpectedly", async () => {
    const notifier = new RecordingAdminStatusNotifier();
    const reporter = new DailyAdminStatusReporter({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: {
        list: jest.fn(() => {
          throw new Error("registry unavailable");
        })
      } as never,
      fetchRunRepository: new MemoryFetchRunRepository(),
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository(),
      notifier,
      logger: createSilentLogger()
    });

    const result = await reporter.sendDailyStatusReport();

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual([
      "Unable to build admin status report: registry unavailable"
    ]);
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toContain("Status: ATTENTION REQUIRED");
    expect(notifier.messages[0]).toContain(
      "Unable to build admin status report: registry unavailable"
    );
  });

  it("propagates admin notifier failures so the scheduler can log them", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const notifier = {
      name: "failing-admin-status",
      enabled: true,
      send: jest.fn(async () => {
        throw new Error("Telegram admin send failed");
      })
    };
    const reporter = new DailyAdminStatusReporter({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository,
      notifier,
      logger: createSilentLogger()
    });

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "aave" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "aave" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "uniswap" }));

    await expect(reporter.sendDailyStatusReport()).rejects.toThrow(
      "Telegram admin send failed"
    );
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it("escapes source values in Telegram HTML status messages", async () => {
    const protocol = "aave&<bad>";
    const fetchRunRepository = new MemoryFetchRunRepository();

    await fetchRunRepository.upsert(
      createRun({
        id: "fetchRun_html_escape",
        protocol,
        status: "failed",
        errors: ["<script>alert('&')</script>"]
      })
    );

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: {
        list: jest.fn(() => [createFakeProtocolAdapter({ protocol })])
      } as never,
      fetchRunRepository,
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository()
    });

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("aave&amp;&lt;bad&gt;");
    expect(result.message).toContain("&lt;script&gt;alert('&amp;')&lt;/script&gt;");
    expect(result.message).not.toContain("aave&<bad>");
    expect(result.message).not.toContain("<script>alert('&')</script>");
  });

  it("sends the built report through the configured admin notifier", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const notifier = new RecordingAdminStatusNotifier();
    const reporter = new DailyAdminStatusReporter({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository,
      notifier,
      logger: createSilentLogger()
    });

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "aave" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "aave" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "uniswap" }));

    const result = await reporter.sendDailyStatusReport();

    expect(result.healthy).toBe(true);
    expect(notifier.messages).toEqual([result.message]);
  });

  it("creates a noop admin status reporter unless explicitly enabled", () => {
    const reporter = createAdminStatusReporter({
      env: testEnv({ ENABLE_ADMIN_STATUS_REPORTS: "false" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository: new MemoryFetchRunRepository(),
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository(),
      logger: createSilentLogger()
    });

    expect(reporter.enabled).toBe(false);
  });

  it("fails clearly when admin reports are enabled without Telegram credentials", () => {
    expect(() =>
      createAdminStatusReporter({
        env: testEnv({
          ENABLE_ADMIN_STATUS_REPORTS: "true",
          TELEGRAM_BOT_TOKEN: ""
        }),
        protocolRegistry: createRegistry() as never,
        fetchRunRepository: new MemoryFetchRunRepository(),
        proposalRepository: new MemoryProposalRepository(),
        sourceActivityRepository: new MemorySourceActivityRepository(),
        logger: createSilentLogger()
      })
    ).toThrow(
      "Admin status reports are enabled but TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_USER_ID must be set."
    );
  });

  it("sends Telegram admin reports only to the configured admin user", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const notifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl,
      logger: createSilentLogger()
    });

    await notifier.send("<b>GOVERNANCE MONITOR DAILY STATUS</b>\nStatus: OK");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/botadmin-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    ) as Record<string, unknown>;

    expect(body).toMatchObject({
      chat_id: "1549323073",
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal
    );
    expect(String(body.text)).toContain("GOVERNANCE MONITOR DAILY STATUS");
  });

  it("times out stuck Telegram admin status requests", async () => {
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
    const notifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl,
      logger: createSilentLogger(),
      requestTimeoutMs: 25
    });

    const send = notifier.send("status");

    await Promise.resolve();
    jest.advanceTimersByTime(25);

    await expect(send).rejects.toThrow(
      "Telegram admin status message failed: Telegram admin status request timed out after 25ms"
    );
    await expect(send).rejects.not.toThrow(/admin-token|1549323073/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid Telegram admin notifier configuration before sending", () => {
    expect(
      () =>
        new TelegramAdminStatusNotifier({
          botToken: " ",
          adminUserId: "1549323073",
          fetchImpl: jest.fn<typeof fetch>()
        })
    ).toThrow("TelegramAdminStatusNotifier requires a bot token.");

    expect(
      () =>
        new TelegramAdminStatusNotifier({
          botToken: "admin-token",
          adminUserId: "0",
          fetchImpl: jest.fn<typeof fetch>()
        })
    ).toThrow(
      "TelegramAdminStatusNotifier admin user id must be a positive numeric Telegram user ID."
    );
  });

  it("redacts Telegram admin secrets when delivery fails", async () => {
    const logger = createSilentLogger();
    const fetchImpl = jest.fn<typeof fetch>(
      async () =>
        new Response("admin-token failed for 1549323073", {
          status: 500
        })
    );
    const notifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl,
      logger
    });

    await expect(notifier.send("status")).rejects.toBeInstanceOf(
      TelegramAdminStatusDeliveryError
    );

    const serializedLogs = JSON.stringify((logger.error as jest.Mock).mock.calls);

    expect(serializedLogs).not.toContain("admin-token");
    expect(serializedLogs).not.toContain("1549323073");
    expect(serializedLogs).toContain("[redacted]");
  });
});
