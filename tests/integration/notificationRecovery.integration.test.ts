import { describe, expect, it, jest } from "@jest/globals";
import { buildAdminStatusReport } from "../../src/adminStatus/adminStatus.service.js";
import { FetchProtocolGovernanceJob } from "../../src/jobs/fetchProtocolGovernance.job.js";
import {
  ProposalNotificationDispatcher,
  TelegramNotificationService
} from "../../src/notifications/index.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import { ProtocolRegistry } from "../../src/protocols/registry.js";
import { MemoryFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemoryProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import {
  createFakeProtocolAdapter,
  createRawGovernanceItem,
  createSilentLogger,
  testEnv
} from "../helpers/builders.js";

describe("notification recovery integration", () => {
  it("retries only the failed recipient and clears current admin health automatically", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response("temporarily unavailable", { status: 503 })
      );
    const notificationService = new TelegramNotificationService({
      botToken: "integration-token",
      allowedUserIds: ["111111111", "222222222"],
      fetchImpl,
      logger: createSilentLogger()
    });
    const proposalRepository = new MemoryProposalRepository();
    const fetchRunRepository = new MemoryFetchRunRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const protocolStateRepository = new MemoryProtocolStateRepository();
    const registry = new ProtocolRegistry();
    registry.register(createFakeProtocolAdapter());
    await protocolStateRepository.initializeBaseline("lido", true);
    const job = new FetchProtocolGovernanceJob(
      registry,
      proposalRepository,
      fetchRunRepository,
      sourceActivityRepository,
      createSilentLogger(),
      {
        notificationService,
        protocolStateRepository,
        sourceActivityConfig: {
          warningDays: 365,
          criticalDays: 730,
          minFetchedCount: 1
        }
      }
    );

    const initialRun = await job.run("lido");
    const failedProposal = (await proposalRepository.findAll())[0];

    expect(initialRun).toMatchObject({
      notificationSentCount: 0,
      notificationFailedCount: 1
    });
    expect(initialRun.run.status).toBe("success");
    expect(failedProposal).toMatchObject({
      notificationStatus: "failed",
      notificationDeliveries: {
        [notificationService.getRecipients()[0].key]: {
          status: "sent",
          attemptCount: 1
        },
        [notificationService.getRecipients()[1].key]: {
          status: "failed",
          attemptCount: 1,
          nextRetryAt: expect.any(String)
        }
      }
    });

    const retryAt =
      failedProposal.notificationDeliveries?.[
        notificationService.getRecipients()[1].key
      ].nextRetryAt as string;
    fetchImpl.mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(
      job.notificationDispatcher.recoverOutstanding(retryAt)
    ).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 1,
      attemptedRecipientCount: 1,
      recoveredCount: 1,
      stillFailedCount: 0,
      errors: []
    });

    const requestBodies = fetchImpl.mock.calls.map(
      (call) =>
        JSON.parse((call[1] as RequestInit).body as string) as {
          chat_id: string;
        }
    );

    expect(requestBodies.map((body) => body.chat_id)).toEqual([
      "111111111",
      "222222222",
      "222222222"
    ]);
    await expect(
      proposalRepository.countByNotificationStatus("failed")
    ).resolves.toBe(0);
    await expect(proposalRepository.findById(failedProposal.id)).resolves.toMatchObject({
      notificationStatus: "sent",
      notificationDeliveries: {
        [notificationService.getRecipients()[0].key]: {
          status: "sent",
          attemptCount: 1
        },
        [notificationService.getRecipients()[1].key]: {
          status: "sent",
          attemptCount: 2
        }
      }
    });

    const statusReport = await buildAdminStatusReport({
      env: testEnv({
        ENABLE_SCHEDULER: "true",
        ENABLE_SOURCE_ACTIVITY_ALERTS: "true"
      }),
      protocolRegistry: registry,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    });

    expect(statusReport.healthy).toBe(true);
    expect(statusReport.problems).toEqual([]);
    expect(statusReport.message).toContain("Failed notifications: 0");
    expect(statusReport.message).toContain("initial notification failures 1");
  });

  it("clears ambiguous legacy health failures without contacting any recipient", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    const notificationService = new TelegramNotificationService({
      botToken: "integration-token",
      allowedUserIds: ["111111111", "222222222"],
      fetchImpl,
      logger: createSilentLogger()
    });
    const proposalRepository = new MemoryProposalRepository();
    const fetchRunRepository = new MemoryFetchRunRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const registry = new ProtocolRegistry();
    registry.register(createFakeProtocolAdapter());
    await fetchRunRepository.upsert({
      id: "fetchRun_lido_legacy_recovery",
      protocol: "lido",
      startedAt: "2026-07-24T08:00:00.000Z",
      finishedAt: "2026-07-24T08:00:01.000Z",
      status: "success",
      fetchedCount: 1,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 0,
      notificationSentCount: 0,
      notificationFailedCount: 1,
      errors: []
    });
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    await proposalRepository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await proposalRepository.updateNotificationStatus(
      proposal.id,
      "failed",
      "Telegram notification failed for 1 of 2 allowed recipients: recipient 2 failed: chat not found"
    );
    const reportOptions = {
      env: testEnv({
        ENABLE_SCHEDULER: "false",
        ENABLE_SOURCE_ACTIVITY_ALERTS: "false"
      }),
      protocolRegistry: registry,
      fetchRunRepository,
      proposalRepository,
      sourceActivityRepository
    };

    const beforeRecovery = await buildAdminStatusReport(reportOptions);

    expect(beforeRecovery.healthy).toBe(false);
    expect(beforeRecovery.message).toContain("Failed notifications: 1");

    const dispatcher = new ProposalNotificationDispatcher(
      proposalRepository,
      notificationService,
      createSilentLogger()
    );

    await expect(
      dispatcher.recoverOutstanding("2026-07-24T12:00:00.000Z")
    ).resolves.toMatchObject({
      candidateCount: 1,
      attemptedProposalCount: 0,
      attemptedRecipientCount: 0,
      stillFailedCount: 0,
      skippedCount: 1,
      errors: []
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(proposalRepository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "skipped",
      notificationError: expect.stringContaining(
        "automatically closed without resend"
      )
    });
    const afterRecovery = await buildAdminStatusReport(reportOptions);

    expect(afterRecovery.healthy).toBe(true);
    expect(afterRecovery.problems).toEqual([]);
    expect(afterRecovery.message).toContain("Failed notifications: 0");
  });
});
