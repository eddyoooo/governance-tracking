import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  buildAdminStatusReport,
  createAdminStatusReporter,
  DailyAdminStatusReporter,
  formatAdminStatusMessage,
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
  createTelegramApiSuccessResponse,
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
    existsForProtocol: jest.fn(),
    findBySourceIdentity: jest.fn(),
    findByNotificationStatus: jest.fn(async () => {
      throw new Error(message);
    }),
    countByNotificationStatus: jest.fn(async () => {
      throw new Error(message);
    }),
    updateNotificationState: jest.fn(),
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
    expect(result.message).toContain("silently seeded 0");
    expect(result.message).toContain("Source activity:");
    expect(result.message).toContain("- lido: healthy");
    expect(result.message).toContain("Problems:\n- None detected.");
  });

  it("includes an enabled healthy CoW adapter in the daily operator report", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();

    await fetchRunRepository.upsert(createRun({ protocol: "cow" }));
    await sourceActivityRepository.upsert(
      createSourceActivity({ protocol: "cow", latestRawSourceId: "3527" })
    );

    const result = await buildAdminStatusReport({
      env: testEnv({
        ENABLE_SCHEDULER: "true",
        STORAGE_MODE: "firestore",
        DEMO_MODE: "false",
        COW_ENABLED: "true",
        COW_ALLOWED_PUBLISHERS: JSON.stringify([
          "notsoformal",
          "Kowrigan",
          "harisang",
          "felixhenneke",
          "KPK"
        ])
      }),
      protocolRegistry: {
        list: jest.fn(() => [
          createFakeProtocolAdapter({
            protocol: "cow",
            publisherAllowlist: [
              "notsoformal",
              "Kowrigan",
              "harisang",
              "felixhenneke",
              "KPK"
            ]
          })
        ])
      } as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(result.healthy).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.message).toContain("Enabled protocols: cow");
    expect(result.message).toContain("- cow: success");
    expect(result.message).toContain("- cow: healthy; latest raw 3527");
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
      'Telegram notification failed for 1 of 2 allowed recipients: recipient 2 failed with 400: {"ok":false,"description":"Bad Request: chat not found"}'
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
      env: testEnv({
        ENABLE_SCHEDULER: "true",
        TELEGRAM_ALLOWED_USER_IDS: JSON.stringify(["111111111", "222222222"])
      }),
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
        "1 proposal notification(s) have unresolved recipient deliveries.",
        "aave source activity is critical: Newest raw source item is 35 day(s) old.",
        "No source activity record has been recorded for uniswap."
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain("Failed notifications: 1");
    expect(result.message).toContain("Failed notification details:");
    expect(result.message).toContain("lido/forum/failed-notification");
    expect(result.message).toContain("recipient 2 (*****2222)");
    expect(result.message).toContain("Bad Request: chat not found");
    expect(result.message).toContain("Aave forum unavailable");
    expect(result.message).not.toContain("222222222");
  });

  it("does not keep reporting historical fetch notification failures after current state recovers", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();

    await fetchRunRepository.upsert(
      createRun({
        id: "fetchRun_aave_old_failure",
        protocol: "aave",
        startedAt: "2026-06-30T08:59:00.000Z",
        finishedAt: "2026-06-30T09:00:00.000Z",
        status: "failed",
        notificationFailedCount: 2,
        errors: ["Historical Telegram failure"]
      })
    );
    await fetchRunRepository.upsert(
      createRun({
        id: "fetchRun_aave_current",
        protocol: "aave",
        notificationFailedCount: 0,
        errors: []
      })
    );
    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "aave" }));
    await sourceActivityRepository.upsert(
      createSourceActivity({ protocol: "uniswap" })
    );

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(result.healthy).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.message).toContain("Failed notifications: 0");
    expect(result.message).not.toContain("Historical Telegram failure");
    expect(result.message).not.toContain("had 2 notification failure");
  });

  it("recovers a protocol's latest run when many manual runs push it outside the shared audit window", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const findLatestByProtocol = jest.spyOn(
      fetchRunRepository,
      "findLatestByProtocol"
    );

    await fetchRunRepository.upsert(
      createRun({
        id: "aave-outside-window",
        protocol: "aave",
        startedAt: "2026-07-01T08:00:00.000Z"
      })
    );
    await fetchRunRepository.upsert(
      createRun({
        id: "uniswap-outside-window",
        protocol: "uniswap",
        startedAt: "2026-07-01T08:00:00.000Z"
      })
    );

    for (let index = 0; index < 60; index += 1) {
      await fetchRunRepository.upsert(
        createRun({
          id: `lido-manual-${index}`,
          protocol: "lido",
          startedAt: `2026-07-02T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`
        })
      );
    }

    for (const protocol of ["lido", "aave", "uniswap"]) {
      await sourceActivityRepository.upsert(createSourceActivity({ protocol }));
    }

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(result.healthy).toBe(true);
    expect(result.message).toContain("- aave: success");
    expect(result.message).toContain("- uniswap: success");
    expect(findLatestByProtocol).toHaveBeenCalledWith("aave");
    expect(findLatestByProtocol).toHaveBeenCalledWith("uniswap");
  });

  it("describes unresolved recipients with masked ids, attempts, and retry timing", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const proposal = normalizeLidoForumItem(
      createRawGovernanceItem({
        sourceId: "recipient-detail",
        title: "Recipient-specific recovery"
      })
    );

    for (const protocol of ["lido", "aave", "uniswap"]) {
      await fetchRunRepository.upsert(createRun({ protocol }));
      await sourceActivityRepository.upsert(createSourceActivity({ protocol }));
    }
    await proposalRepository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await proposalRepository.updateNotificationState(proposal.id, () => ({
      notificationStatus: "failed",
      notificationError: "One recipient remains unresolved.",
      notificationDeliveries: {
        opaqueRecipientKey: {
          recipientKey: "opaqueRecipientKey",
          recipientMaskedId: "******3073",
          status: "failed",
          attemptCount: 3,
          createdAt: "2026-07-01T08:00:00.000Z",
          updatedAt: "2026-07-01T08:45:00.000Z",
          lastAttemptAt: "2026-07-01T08:45:00.000Z",
          nextRetryAt: "2026-07-01T14:45:00.000Z",
          lastError: "Telegram returned 403: bot was blocked"
        }
      }
    }));

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("recipient ******3073");
    expect(result.message).toContain("attempts 3");
    expect(result.message).toContain(
      "next retry 2026-07-01T14:45:00.000Z"
    );
    expect(result.message).toContain("Telegram returned 403: bot was blocked");
    expect(result.message).not.toMatch(/\b1549323073\b/);
  });

  it("keeps Telegram admin reports below the safe message limit", () => {
    const message = formatAdminStatusMessage({
      env: testEnv(),
      enabledProtocols: ["lido", "aave", "uniswap"],
      latestByProtocol: new Map(),
      sourceActivityByProtocol: new Map(),
      pendingNotificationCount: 100,
      failedNotificationCount: 100,
      failedNotifications: [],
      healthy: false,
      problems: Array.from(
        { length: 100 },
        (_, index) =>
          `Problem ${index}: ${"detailed operational failure ".repeat(8)}`
      ),
      checkedAt: "2026-07-24T09:00:00.000Z"
    });

    expect(message.length).toBeLessThanOrEqual(3900);
    expect(message).toContain("<b>GOVERNANCE MONITOR DAILY STATUS</b>");
    expect(
      message.endsWith(
        "Report truncated. Inspect Firestore and application logs for full details."
      )
    ).toBe(true);
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

  it("reports an enabled protocol with an empty publisher allowlist", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: {
        list: jest.fn(() => [
          createFakeProtocolAdapter({
            protocol: "lido",
            publisherAllowlist: []
          })
        ])
      } as never,
      fetchRunRepository,
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toContain(
      "lido is enabled but its publisher allowlist is empty."
    );
    expect(result.message).toContain(
      "lido is enabled but its publisher allowlist is empty."
    );
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
        "Unable to read pending notification count: Firestore index missing",
        "Unable to read failed notification count: Firestore index missing",
        "Unable to read failed notification details: Firestore index missing"
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain("Pending notifications: unknown");
    expect(result.message).toContain("Failed notifications: unknown");
    expect(result.message).toContain("- lido: success");
  });

  it("marks pending notification work as attention required", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await sourceActivityRepository.upsert(createSourceActivity({ protocol: "lido" }));
    await proposalRepository.upsert(
      normalizeLidoForumItem(createRawGovernanceItem()),
      { notificationStatusForNew: "pending" }
    );

    const result = await buildAdminStatusReport({
      env: testEnv({
        ENABLE_SCHEDULER: "true",
        ENABLE_SOURCE_ACTIVITY_ALERTS: "true"
      }),
      protocolRegistry: {
        list: jest.fn(() => [createFakeProtocolAdapter({ protocol: "lido" })])
      } as never,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toContain(
      "1 proposal notification(s) are pending automatic delivery."
    );
    expect(result.message).toContain("Pending notifications: 1");
  });

  it("reports a failed per-protocol latest-run fallback without hiding it", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    jest.spyOn(fetchRunRepository, "findAll").mockResolvedValue([]);
    jest
      .spyOn(fetchRunRepository, "findLatestByProtocol")
      .mockRejectedValue(new Error("Firestore read unavailable"));

    const result = await buildAdminStatusReport({
      env: testEnv({
        ENABLE_SCHEDULER: "true",
        ENABLE_SOURCE_ACTIVITY_ALERTS: "false"
      }),
      protocolRegistry: {
        list: jest.fn(() => [createFakeProtocolAdapter({ protocol: "lido" })])
      } as never,
      fetchRunRepository,
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository()
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "Unable to read latest lido fetch run: Firestore read unavailable",
        "No fetch run has been recorded for lido."
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
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

  it("returns a healthy empty result from the noop reporter", async () => {
    const reporter = createAdminStatusReporter({
      env: testEnv({ ENABLE_ADMIN_STATUS_REPORTS: "false" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository: new MemoryFetchRunRepository(),
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository(),
      logger: createSilentLogger()
    });

    await expect(reporter.sendDailyStatusReport()).resolves.toEqual({
      healthy: true,
      message: "",
      problems: []
    });
  });

  it("creates an enabled admin reporter when its dedicated credentials exist", () => {
    const reporter = createAdminStatusReporter({
      env: testEnv({
        ENABLE_ADMIN_STATUS_REPORTS: "true",
        TELEGRAM_BOT_TOKEN: "admin-token",
        TELEGRAM_ADMIN_USER_ID: "1549323073"
      }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository: new MemoryFetchRunRepository(),
      proposalRepository: new MemoryProposalRepository(),
      sourceActivityRepository: new MemorySourceActivityRepository(),
      logger: createSilentLogger()
    });

    expect(reporter.enabled).toBe(true);
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
    const fetchImpl = jest.fn<typeof fetch>(async () =>
      createTelegramApiSuccessResponse()
    );
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

  it("treats Telegram JSON ok=false as an admin delivery failure even with HTTP 200", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ ok: false, description: "bot was blocked" }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );
    const notifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl,
      logger: createSilentLogger()
    });

    await expect(notifier.send("status")).rejects.toMatchObject({
      name: "TelegramAdminStatusDeliveryError",
      status: 200,
      responseBody: JSON.stringify({
        ok: false,
        description: "bot was blocked"
      })
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    ) as { chat_id: string };
    expect(body.chat_id).toBe("1549323073");
  });

  it("accepts valid Telegram admin JSON success and rejects malformed JSON success bodies", async () => {
    const successNotifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl: jest.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
            status: 200,
            headers: { "content-type": "application/json" }
          })
      )
    });
    const malformedNotifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl: jest.fn<typeof fetch>(
        async () =>
          new Response("<html>proxy error</html>", {
            status: 200,
            headers: { "content-type": "application/json" }
          })
      )
    });

    await expect(successNotifier.send("status")).resolves.toBeUndefined();
    await expect(malformedNotifier.send("status")).rejects.toMatchObject({
      status: 200,
      responseBody: "<html>proxy error</html>"
    });
  });

  it("rejects an HTTP 200 non-JSON proxy response for the daily admin report", async () => {
    const notifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl: jest.fn<typeof fetch>(
        async () =>
          new Response("<html>upstream unavailable</html>", {
            status: 200,
            headers: { "content-type": "text/html" }
          })
      ),
      logger: createSilentLogger()
    });

    await expect(notifier.send("status")).rejects.toMatchObject({
      name: "TelegramAdminStatusDeliveryError",
      status: 200,
      responseBody: "<html>upstream unavailable</html>"
    });
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

  it("bounds oversized Telegram admin failure responses before logging or throwing", async () => {
    const logger = createSilentLogger();
    const notifier = new TelegramAdminStatusNotifier({
      botToken: "admin-token",
      adminUserId: "1549323073",
      fetchImpl: jest.fn<typeof fetch>(
        async () => new Response("x".repeat(5_000), { status: 500 })
      ),
      logger
    });

    const error = await notifier
      .send("status")
      .catch((caught) => caught as TelegramAdminStatusDeliveryError);

    expect(error).toBeInstanceOf(TelegramAdminStatusDeliveryError);
    expect(error.responseBody?.length).toBeLessThanOrEqual(1_000);
    expect(error.responseBody?.endsWith("...")).toBe(true);
    expect(JSON.stringify((logger.error as jest.Mock).mock.calls).length).toBeLessThan(
      1_500
    );
  });
});
