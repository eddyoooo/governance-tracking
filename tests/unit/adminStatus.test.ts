import { describe, expect, it, jest } from "@jest/globals";
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
  it("builds a healthy daily status report from recent successful fetch runs", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "aave" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));

    const result = await buildAdminStatusReport({
      env: testEnv({
        ENABLE_SCHEDULER: "true",
        STORAGE_MODE: "firestore",
        DEMO_MODE: "false"
      }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository
    });

    expect(result.healthy).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.message).toContain("<b>GOVERNANCE MONITOR DAILY STATUS</b>");
    expect(result.message).toContain("Status: OK");
    expect(result.message).toContain("Storage: firestore");
    expect(result.message).toContain("Scheduler: enabled");
    expect(result.message).toContain("Enabled protocols: lido, aave, uniswap");
    expect(result.message).toContain("- lido: success");
    expect(result.message).toContain("Problems:\n- None detected.");
  });

  it("reports missing fetches, failed fetches, and failed notification state", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
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

    const result = await buildAdminStatusReport({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "aave latest fetch is failed: Aave forum unavailable",
        "No fetch run has been recorded for uniswap.",
        "aave fetch failed at 2026-07-01T09:00:00.000Z: Aave forum unavailable",
        "aave had 2 notification failure(s) in fetch run fetchRun_aave_failed.",
        "1 proposal notification(s) are marked failed."
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain("Failed notifications: 1");
    expect(result.message).toContain("Aave forum unavailable");
  });

  it("sends the built report through the configured admin notifier", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    const proposalRepository = new MemoryProposalRepository();
    const notifier = new RecordingAdminStatusNotifier();
    const reporter = new DailyAdminStatusReporter({
      env: testEnv({ ENABLE_SCHEDULER: "true" }),
      protocolRegistry: createRegistry() as never,
      fetchRunRepository,
      proposalRepository,
      notifier,
      logger: createSilentLogger()
    });

    await fetchRunRepository.upsert(createRun({ protocol: "lido" }));
    await fetchRunRepository.upsert(createRun({ protocol: "aave" }));
    await fetchRunRepository.upsert(createRun({ protocol: "uniswap" }));

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
    expect(String(body.text)).toContain("GOVERNANCE MONITOR DAILY STATUS");
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
