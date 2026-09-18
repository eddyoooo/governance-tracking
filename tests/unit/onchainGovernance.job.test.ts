import { describe, expect, it, jest } from "@jest/globals";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/notification.service.js";
import { ProposalNotificationDispatcher } from "../../src/notifications/proposalNotifications.js";
import { governanceEventMessage } from "../../src/onchain/governanceNotifications.js";
import {
  blockRanges,
  findMissingLifecycleReferences,
  findMissingProposalIds,
  groupEventsByProposal,
  OnchainGovernanceScanJob,
  OnchainScanAlreadyRunningError,
  UnknownOnchainGovernanceSourceError
} from "../../src/onchain/onchainGovernance.job.js";
import { EvmGovernanceRegistry } from "../../src/onchain/registry.js";
import type { GovernanceLifecycleEvent } from "../../src/onchain/types.js";
import { MemoryGovernanceRepository } from "../../src/storage/governance.repository.js";
import { createSilentLogger } from "../helpers/builders.js";
import {
  createFakeEvmGovernanceAdapter,
  createGovernanceContractEvent,
  createGovernanceObservation,
  createGovernanceSourceState,
  testBlockHash,
  TEST_SOURCE_KEY
} from "../helpers/onchainBuilders.js";

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled: boolean;
  readonly messages: NotificationMessage[] = [];
  failWith: Error | null = null;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  getRecipients() {
    return [{ key: "admin", maskedId: "*****3073" }];
  }

  async send(message: NotificationMessage): Promise<void> {
    if (this.failWith) {
      throw this.failWith;
    }

    this.messages.push(message);
  }
}

function createJob(options: {
  repository?: MemoryGovernanceRepository;
  notificationService?: RecordingNotificationService;
  adapterControl?: ReturnType<typeof createFakeEvmGovernanceAdapter>;
} = {}) {
  const repository = options.repository ?? new MemoryGovernanceRepository();
  const notificationService =
    options.notificationService ?? new RecordingNotificationService();
  const control =
    options.adapterControl ?? createFakeEvmGovernanceAdapter();
  const registry = new EvmGovernanceRegistry([control.adapter]);
  const logger = createSilentLogger();
  const dispatcher = new ProposalNotificationDispatcher<GovernanceLifecycleEvent>(
    repository,
    notificationService,
    logger,
    governanceEventMessage
  );
  const job = new OnchainGovernanceScanJob(
    registry,
    repository,
    notificationService,
    dispatcher,
    logger
  );

  return { job, repository, notificationService, control, logger, dispatcher };
}

describe("OnchainGovernanceScanJob", () => {
  it("silently seeds all historical decisions and persists a resumable source cursor", async () => {
    const { job, repository, notificationService, control } = createJob();

    const result = await job.run(" Uniswap ");

    expect(result).toMatchObject({
      protocol: "uniswap",
      status: "success",
      baselineSeeding: true,
      cursorBefore: 99,
      cursorAfter: 110,
      latestFinalizedBlock: 110,
      rangesScanned: 2,
      contractEventsRead: 1,
      decisionsCreated: 1,
      lifecycleEventsCreated: 1,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    });
    expect(control.getEvents).toHaveBeenNthCalledWith(1, 100, 109);
    expect(control.getEvents).toHaveBeenNthCalledWith(2, 110, 110);
    expect(control.getDecision).toHaveBeenCalledWith(
      "1",
      expect.any(Array),
      null,
      110
    );
    expect(notificationService.messages).toEqual([]);
    await expect(repository.findAllSourceStates()).resolves.toEqual([
      expect.objectContaining({
        sourceKey: TEST_SOURCE_KEY,
        baselineStatus: "complete",
        healthStatus: "healthy",
        cursorBlockNumber: 110,
        cursorBlockHash: testBlockHash(110)
      })
    ]);
    await expect(repository.countByNotificationStatus("skipped")).resolves.toBe(1);
  });

  it("indexes a multi-range proposal history contiguously and remains idempotent", async () => {
    const proposalCount = 50;
    const events = Array.from({ length: proposalCount }, (_, index) => {
      const proposalId = (index + 1).toString();
      const transactionHash = `0x${(index + 1)
        .toString(16)
        .padStart(64, "0")}`;

      return createGovernanceContractEvent({
        proposalId,
        blockNumber: 100 + index,
        transactionHash,
        id: `${transactionHash}:0`
      });
    });
    const statuses = Object.fromEntries(
      events.map((event) => [event.proposalId, "pending" as const])
    );
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 160,
      proposalCount: proposalCount.toString(),
      events,
      statuses,
      maxLogBlockRange: 7
    });
    const setup = createJob({ adapterControl: control });

    const baseline = await setup.job.run("uniswap");
    const decisions = await setup.repository.findDecisionsBySource(
      TEST_SOURCE_KEY
    );

    expect(baseline).toMatchObject({
      status: "success",
      baselineSeeding: true,
      rangesScanned: 9,
      contractEventsRead: proposalCount,
      decisionsCreated: proposalCount,
      lifecycleEventsCreated: proposalCount,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    expect(decisions).toHaveLength(proposalCount);
    expect(decisions.map((decision) => decision.proposalId)).toEqual(
      Array.from({ length: proposalCount }, (_, index) =>
        (proposalCount - index).toString()
      )
    );
    expect(new Set(decisions.map((decision) => decision.id)).size).toBe(
      proposalCount
    );
    await expect(
      setup.repository.countByNotificationStatus("skipped")
    ).resolves.toBe(proposalCount);

    const repeated = await setup.job.run("uniswap");

    expect(repeated).toMatchObject({
      status: "success",
      baselineSeeding: false,
      decisionsCreated: 0,
      decisionsUpdated: 0,
      decisionsUnchanged: proposalCount,
      lifecycleEventsCreated: 0,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toHaveLength(proposalCount);
    await expect(
      setup.repository.countByNotificationStatus("skipped")
    ).resolves.toBe(proposalCount);
  });

  it("ignores legacy Governor Alpha events at or below Bravo initialProposalId", async () => {
    const control = createFakeEvmGovernanceAdapter({
      initialProposalId: "8",
      proposalCount: "9",
      events: [
        createGovernanceContractEvent({ proposalId: "1", blockNumber: 101 }),
        createGovernanceContractEvent({ proposalId: "9", blockNumber: 102 })
      ],
      statuses: { "9": "pending" }
    });
    const setup = createJob({ adapterControl: control });

    const result = await setup.job.run("uniswap");

    expect(result).toMatchObject({
      status: "success",
      contractEventsRead: 1,
      decisionsCreated: 1,
      lifecycleEventsCreated: 1
    });
    expect(control.getDecision).toHaveBeenCalledTimes(1);
    expect(control.getDecision).toHaveBeenCalledWith(
      "9",
      [expect.objectContaining({ proposalId: "9" })],
      null,
      110
    );
    await expect(setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)).resolves.toEqual([
      expect.objectContaining({ proposalId: "9" })
    ]);
  });

  it("fails closed when a log proposal id exceeds the finalized proposal counter", async () => {
    const control = createFakeEvmGovernanceAdapter({
      initialProposalId: "8",
      proposalCount: "9",
      events: [
        createGovernanceContractEvent({ proposalId: "10", blockNumber: 101 })
      ],
      statuses: { "10": "pending" }
    });
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "emitted proposal id 10 above finalized proposalCount 9"
    );
    expect(control.getDecision).not.toHaveBeenCalled();
    await expect(setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)).resolves.toEqual([]);
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      cursorBlockNumber: 99,
      healthStatus: "failed"
    });
  });

  it("discovers and notifies a new finalized proposal after the baseline", async () => {
    const setup = createJob();
    await setup.job.run("uniswap");
    setup.control.validation.latestFinalizedBlock.number = 120;
    setup.control.validation.latestFinalizedBlock.hash = testBlockHash(120);
    setup.control.validation.proposalCount = "2";
    setup.control.events.push(
      createGovernanceContractEvent({ proposalId: "2", blockNumber: 115 })
    );
    setup.control.statuses.set("2", "pending");

    const result = await setup.job.run("uniswap");

    expect(result).toMatchObject({
      baselineSeeding: false,
      cursorBefore: 110,
      cursorAfter: 120,
      contractEventsRead: 1,
      decisionsCreated: 1,
      decisionsUnchanged: 1,
      lifecycleEventsCreated: 1,
      notificationSentCount: 1,
      notificationFailedCount: 0
    });
    expect(setup.control.getEvents).toHaveBeenNthCalledWith(3, 109, 118);
    expect(setup.control.getEvents).toHaveBeenNthCalledWith(4, 119, 120);
    expect(setup.notificationService.messages).toEqual([
      expect.objectContaining({
        kind: "lifecycle",
        heading: "NEW GOVERNANCE VOTE TRACKED",
        protocol: "uniswap",
        title: "Real Uniswap proposal #2"
      })
    ]);
    await expect(setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)).resolves.toHaveLength(2);
    await expect(setup.repository.countByNotificationStatus("sent")).resolves.toBe(1);
  });

  it("does not rewrite or renotify unchanged proposals on six-hour overlap scans", async () => {
    const setup = createJob();
    await setup.job.run("uniswap");

    const repeated = await setup.job.run("uniswap");

    expect(repeated).toMatchObject({
      baselineSeeding: false,
      cursorBefore: 110,
      cursorAfter: 110,
      decisionsCreated: 0,
      decisionsUpdated: 0,
      decisionsUnchanged: 1,
      lifecycleEventsCreated: 0,
      notificationSentCount: 0
    });
    expect(setup.notificationService.messages).toEqual([]);
    await expect(setup.repository.findScanRuns()).resolves.toHaveLength(2);
  });

  it("refreshes non-terminal proposals and emits a result without requiring a new log", async () => {
    const setup = createJob();
    await setup.job.run("uniswap");
    setup.control.statuses.set("1", "succeeded");

    const result = await setup.job.run("uniswap");

    expect(result).toMatchObject({
      decisionsUpdated: 1,
      lifecycleEventsCreated: 1,
      notificationSentCount: 1
    });
    expect(setup.notificationService.messages[0]).toMatchObject({
      kind: "lifecycle",
      heading: "ON-CHAIN GOVERNANCE VOTE RESULT"
    });
    await expect(
      setup.repository.findNonTerminalDecisions(TEST_SOURCE_KEY)
    ).resolves.toEqual([expect.objectContaining({ status: "succeeded" })]);
  });

  it("emits both the inferred vote result and cancellation when polling spans both", async () => {
    const control = createFakeEvmGovernanceAdapter({
      statuses: { "1": "active" }
    });
    const setup = createJob({ adapterControl: control });
    await setup.job.run("uniswap");
    control.validation.latestFinalizedBlock.number = 120;
    control.validation.latestFinalizedBlock.hash = testBlockHash(120);
    control.events.push(
      createGovernanceContractEvent({
        proposalId: "1",
        type: "canceled",
        blockNumber: 115
      })
    );
    control.getDecision.mockResolvedValueOnce(
      createGovernanceObservation({
        proposalId: "1",
        status: "canceled",
        voteOutcome: "defeated",
        againstVotes: "50000000000000000000000000",
        createdBlockNumber: undefined,
        createdTransactionHash: undefined,
        canceledBlockNumber: 115,
        canceledTransactionHash: control.events.at(-1)?.transactionHash,
        lastObservedBlockNumber: 120,
        rawHash: "post-vote-cancellation"
      })
    );

    const result = await setup.job.run("uniswap");

    expect(result).toMatchObject({
      status: "success",
      decisionsUpdated: 1,
      lifecycleEventsCreated: 2,
      notificationSentCount: 2,
      notificationFailedCount: 0
    });
    expect(setup.notificationService.messages).toEqual([
      expect.objectContaining({
        heading: "ON-CHAIN GOVERNANCE VOTE RESULT",
        fields: expect.arrayContaining([
          expect.objectContaining({ label: "Status", value: "Defeated" })
        ])
      }),
      expect.objectContaining({
        heading: "GOVERNANCE VOTE CANCELED"
      })
    ]);
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toEqual([
      expect.objectContaining({
        status: "canceled",
        voteOutcome: "defeated",
        executionOutcome: "canceled"
      })
    ]);
  });

  it("refreshes aggregate vote totals without creating lifecycle alerts or rewrite churn", async () => {
    const control = createFakeEvmGovernanceAdapter({
      statuses: { "1": "active" }
    });
    let forVotes = "10";
    control.getDecision.mockImplementation(
      async (
        proposalId: string,
        proposalEvents: ReturnType<typeof createGovernanceContractEvent>[],
        existing: Awaited<ReturnType<MemoryGovernanceRepository["findDecisionById"]>>,
        observedAtBlock: number
      ) => {
        const created = proposalEvents.find((event) => event.type === "created");

        return createGovernanceObservation({
          proposalId,
          status: "active",
          forVotes,
          title: created?.description?.replace(/^#\s*/, "") ?? existing?.title,
          description: created?.description ?? existing?.description,
          createdBlockNumber:
            created?.blockNumber ?? existing?.createdBlockNumber ?? undefined,
          createdTransactionHash:
            created?.transactionHash ??
            existing?.createdTransactionHash ??
            undefined,
          lastObservedBlockNumber: observedAtBlock,
          rawHash: `active-${forVotes}`
        });
      }
    );
    const setup = createJob({ adapterControl: control });
    await setup.job.run("uniswap");

    forVotes = "25";
    control.validation.latestFinalizedBlock = {
      number: 120,
      hash: testBlockHash(120),
      timestamp: "2026-09-01T01:00:00.000Z"
    };
    const changed = await setup.job.run("uniswap");

    expect(changed).toMatchObject({
      decisionsUpdated: 1,
      decisionsUnchanged: 0,
      lifecycleEventsCreated: 0,
      notificationSentCount: 0
    });
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toEqual([
      expect.objectContaining({
        status: "active",
        forVotes: "25",
        lastObservedBlockNumber: 120
      })
    ]);

    control.validation.latestFinalizedBlock = {
      number: 130,
      hash: testBlockHash(130),
      timestamp: "2026-09-01T02:00:00.000Z"
    };
    const unchanged = await setup.job.run("uniswap");

    expect(unchanged).toMatchObject({
      decisionsUpdated: 0,
      decisionsUnchanged: 1,
      lifecycleEventsCreated: 0,
      notificationSentCount: 0
    });
    expect(setup.notificationService.messages).toEqual([]);
  });

  it.each(["defeated", "expired"] as const)(
    "accepts an explicit cancellation log after a proposal was %s",
    async (previousStatus) => {
      const baselineFinalizedBlock = previousStatus === "expired" ? 120 : 110;
      const control = createFakeEvmGovernanceAdapter({
        finalizedBlock: baselineFinalizedBlock,
        statuses: { "1": previousStatus },
        events:
          previousStatus === "expired"
            ? [
                createGovernanceContractEvent({ blockNumber: 101 }),
                createGovernanceContractEvent({
                  proposalId: "1",
                  type: "queued",
                  blockNumber: 112,
                  eta: "1785000000"
                })
              ]
            : undefined
      });
      const setup = createJob({ adapterControl: control });
      await setup.job.run("uniswap");
      const cancellationHead = baselineFinalizedBlock + 10;
      control.validation.latestFinalizedBlock.number = cancellationHead;
      control.validation.latestFinalizedBlock.hash = testBlockHash(cancellationHead);
      control.statuses.set("1", "canceled");
      control.events.push(
        createGovernanceContractEvent({
          proposalId: "1",
          type: "canceled",
          blockNumber: baselineFinalizedBlock + 5
        })
      );

      const result = await setup.job.run("uniswap");

      expect(result).toMatchObject({
        status: "success",
        decisionsUpdated: 1,
        lifecycleEventsCreated: 1,
        notificationSentCount: 1
      });
      expect(setup.notificationService.messages).toEqual([
        expect.objectContaining({
          heading: "GOVERNANCE VOTE CANCELED"
        })
      ]);
      await expect(
        setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
      ).resolves.toEqual([
        expect.objectContaining({ status: "canceled" })
      ]);
    }
  );

  it.each(["defeated", "expired"] as const)(
    "refreshes %s proposals and fails closed when cancellation state lacks its canonical log",
    async (previousStatus) => {
      const events = [createGovernanceContractEvent({ blockNumber: 101 })];
      if (previousStatus === "expired") {
        events.push(
          createGovernanceContractEvent({
            type: "queued",
            blockNumber: 105,
            transactionHash: `0x${"22".repeat(32)}`,
            eta: "1785000000"
          })
        );
      }
      const control = createFakeEvmGovernanceAdapter({
        finalizedBlock: 120,
        events,
        statuses: { "1": previousStatus }
      });
      const setup = createJob({ adapterControl: control });
      await setup.job.run("uniswap");

      control.validation.latestFinalizedBlock = {
        number: 130,
        hash: testBlockHash(130),
        timestamp: "2026-09-01T02:00:00.000Z"
      };
      control.statuses.set("1", "canceled");
      control.getEvents.mockClear();
      control.getDecision.mockClear();

      await expect(setup.job.run("uniswap")).rejects.toThrow(
        "live lifecycle coverage gap detected; missing canonical reference(s): 1:canceled"
      );
      expect(control.getEvents).toHaveBeenCalled();
      expect(control.getDecision).toHaveBeenCalledWith(
        "1",
        [],
        expect.objectContaining({ status: previousStatus }),
        130
      );
      await expect(
        setup.repository.findSourceState(TEST_SOURCE_KEY)
      ).resolves.toMatchObject({
        baselineStatus: "complete",
        replayMode: "live",
        healthStatus: "failed"
      });
    }
  );

  it("persists failed lifecycle delivery for automatic recovery", async () => {
    const notificationService = new RecordingNotificationService();
    const setup = createJob({ notificationService });
    await setup.job.run("uniswap");
    setup.control.statuses.set("1", "defeated");
    notificationService.failWith = new Error("Telegram unavailable");

    const result = await setup.job.run("uniswap");

    expect(result.notificationFailedCount).toBe(1);
    expect(result.errors).toEqual([
      expect.stringContaining("Telegram unavailable")
    ]);
    await expect(setup.repository.countByNotificationStatus("failed")).resolves.toBe(1);
    const failed = await setup.repository.findByNotificationStatus("failed");
    expect(failed[0].notificationDeliveries?.admin).toMatchObject({
      status: "failed",
      attemptCount: 1,
      recipientMaskedId: "*****3073"
    });

    notificationService.failWith = null;
    const retryAt = failed[0].notificationDeliveries?.admin.nextRetryAt;
    const recovery = await setup.dispatcher.recoverOutstanding(retryAt);

    expect(recovery).toMatchObject({
      candidateCount: 1,
      recoveredCount: 1,
      stillFailedCount: 0
    });
    await expect(setup.repository.countByNotificationStatus("sent")).resolves.toBe(1);
  });

  it("keeps lifecycle events skipped when source notifications are disabled", async () => {
    const control = createFakeEvmGovernanceAdapter({
      notificationsEnabled: false
    });
    const setup = createJob({ adapterControl: control });
    await setup.job.run("uniswap");
    control.statuses.set("1", "succeeded");

    const result = await setup.job.run("uniswap");

    expect(result.lifecycleEventsCreated).toBe(1);
    expect(result.notificationSentCount).toBe(0);
    expect(setup.notificationService.messages).toEqual([]);
    await expect(setup.repository.countByNotificationStatus("skipped")).resolves.toBe(2);
  });

  it("resumes a failed baseline from its last fully persisted block range", async () => {
    const setup = createJob();
    setup.control.validation.latestFinalizedBlock.number = 120;
    setup.control.validation.latestFinalizedBlock.hash = testBlockHash(120);
    setup.control.getEvents.mockImplementationOnce(async () => setup.control.events);
    setup.control.getEvents.mockRejectedValueOnce(new Error("RPC range failed"));

    await expect(setup.job.run("uniswap")).rejects.toThrow("RPC range failed");
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "seeding",
      cursorBlockNumber: 109,
      healthStatus: "failed",
      consecutiveFailures: 1,
      lastSuccessfulScanAt: null,
      lastError: "RPC range failed"
    });

    setup.control.getEvents.mockImplementation(async (from: unknown, to: unknown) =>
      setup.control.events.filter(
        (event) =>
          event.blockNumber >= Number(from) && event.blockNumber <= Number(to)
      )
    );
    const resumed = await setup.job.run("uniswap");

    expect(resumed).toMatchObject({
      status: "success",
      baselineSeeding: true,
      cursorBefore: 109,
      cursorAfter: 120,
      decisionsCreated: 0,
      decisionsUnchanged: 1
    });
    expect(setup.control.getEvents).toHaveBeenCalledWith(110, 119);
    expect(setup.control.getEvents).toHaveBeenCalledWith(120, 120);
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "complete",
      healthStatus: "healthy",
      consecutiveFailures: 0,
      lastError: null
    });
  });

  it("notifies proposals finalized while a failed historical baseline is resuming", async () => {
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 120,
      proposalCount: "1",
      events: [createGovernanceContractEvent({ blockNumber: 101 })]
    });
    const setup = createJob({ adapterControl: control });
    control.getEvents
      .mockImplementationOnce(async () => [control.events[0]])
      .mockRejectedValueOnce(new Error("temporary RPC failure"));

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "temporary RPC failure"
    );
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "seeding",
      baselineTargetBlock: 120,
      baselineProposalCount: "1",
      cursorBlockNumber: 109
    });

    control.validation.latestFinalizedBlock.number = 130;
    control.validation.latestFinalizedBlock.hash = testBlockHash(130);
    control.validation.proposalCount = "2";
    control.events.push(
      createGovernanceContractEvent({ proposalId: "2", blockNumber: 125 })
    );
    control.statuses.set("2", "pending");
    control.getEvents.mockImplementation(async (from: unknown, to: unknown) =>
      control.events.filter(
        (event) =>
          event.blockNumber >= Number(from) && event.blockNumber <= Number(to)
      )
    );

    const result = await setup.job.run("uniswap");

    expect(result).toMatchObject({
      status: "success",
      baselineSeeding: true,
      cursorBefore: 109,
      cursorAfter: 130,
      decisionsCreated: 1,
      lifecycleEventsCreated: 1,
      notificationSentCount: 1
    });
    expect(control.getEvents).toHaveBeenCalledWith(121, 130);
    expect(control.getDecision).toHaveBeenLastCalledWith(
      "2",
      expect.any(Array),
      null,
      130
    );
    expect(setup.notificationService.messages).toEqual([
      expect.objectContaining({
        heading: "NEW GOVERNANCE VOTE TRACKED",
        title: "Real Uniswap proposal #2"
      })
    ]);
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "complete",
      baselineTargetBlock: 120,
      baselineProposalCount: "1",
      cursorBlockNumber: 130,
      healthStatus: "healthy"
    });
  });

  it("keeps a completed baseline and rewinds catch-up when a new proposal log is omitted", async () => {
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 120,
      proposalCount: "1",
      events: [createGovernanceContractEvent({ blockNumber: 101 })]
    });
    const setup = createJob({ adapterControl: control });
    control.getEvents
      .mockImplementationOnce(async () => [control.events[0]])
      .mockRejectedValueOnce(new Error("baseline interrupted"));
    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "baseline interrupted"
    );

    control.validation.latestFinalizedBlock.number = 130;
    control.validation.latestFinalizedBlock.hash = testBlockHash(130);
    control.validation.proposalCount = "2";
    control.getEvents.mockResolvedValue([]);

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "live coverage gap detected; missing proposal id(s): 2"
    );
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "complete",
      baselineTargetBlock: 120,
      baselineProposalCount: "1",
      cursorBlockNumber: 99,
      cursorBlockHash: null,
      healthStatus: "failed",
      consecutiveFailures: 1
    });
    expect(setup.notificationService.messages).toEqual([]);
  });

  it("detects incomplete log results and prepares a silent full replay", async () => {
    const control = createFakeEvmGovernanceAdapter({ proposalCount: "2" });
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "coverage gap detected; missing proposal id(s): 2"
    );
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "seeding",
      replayMode: "silent",
      cursorBlockNumber: 99,
      cursorBlockHash: null,
      healthStatus: "failed",
      consecutiveFailures: 1
    });
    const latestRun = await setup.repository.findLatestScanRunBySource(TEST_SOURCE_KEY);
    expect(latestRun).toMatchObject({ status: "failed" });
  });

  it("fails a historical baseline when canonical lifecycle logs are incomplete and recovers silently", async () => {
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 120,
      events: [createGovernanceContractEvent({ blockNumber: 101 })],
      statuses: { "1": "executed" }
    });
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "historical lifecycle coverage gap detected; missing canonical reference(s): 1:queued, 1:executed"
    );
    await expect(
      setup.repository.findSourceState(TEST_SOURCE_KEY)
    ).resolves.toMatchObject({
      baselineStatus: "seeding",
      cursorBlockNumber: 99,
      cursorBlockHash: null,
      healthStatus: "failed",
      lastError:
        "On-chain governance historical lifecycle coverage gap detected; missing canonical reference(s): 1:queued, 1:executed. The next scan will replay the baseline silently."
    });
    expect(setup.notificationService.messages).toEqual([]);

    control.events.push(
      createGovernanceContractEvent({
        proposalId: "1",
        type: "queued",
        blockNumber: 112,
        transactionHash: `0x${"22".repeat(32)}`,
        eta: "1785000000"
      }),
      createGovernanceContractEvent({
        proposalId: "1",
        type: "executed",
        blockNumber: 113,
        transactionHash: `0x${"33".repeat(32)}`
      })
    );

    const recovered = await setup.job.run("uniswap");

    expect(recovered).toMatchObject({
      status: "success",
      baselineSeeding: true,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toEqual([
      expect.objectContaining({
        status: "executed",
        queuedBlockNumber: 112,
        executedBlockNumber: 113
      })
    ]);
    await expect(
      setup.repository.countByNotificationStatus("skipped")
    ).resolves.toBe(4);
  });

  it("rewinds incomplete live lifecycle metadata without duplicating alerts on repair", async () => {
    const setup = createJob();
    await setup.job.run("uniswap");

    setup.control.validation.latestFinalizedBlock.number = 120;
    setup.control.validation.latestFinalizedBlock.hash = testBlockHash(120);
    setup.control.statuses.set("1", "executed");
    setup.control.events.push(
      createGovernanceContractEvent({
        proposalId: "1",
        type: "queued",
        blockNumber: 115,
        transactionHash: `0x${"22".repeat(32)}`,
        eta: "1785000000"
      })
    );

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "live lifecycle coverage gap detected; missing canonical reference(s): 1:executed"
    );
    expect(setup.notificationService.messages).toHaveLength(3);
    await expect(
      setup.repository.findSourceState(TEST_SOURCE_KEY)
    ).resolves.toMatchObject({
      baselineStatus: "complete",
      replayMode: "live",
      cursorBlockNumber: 99,
      cursorBlockHash: null,
      healthStatus: "failed"
    });

    setup.control.events.push(
      createGovernanceContractEvent({
        proposalId: "1",
        type: "executed",
        blockNumber: 116,
        transactionHash: `0x${"33".repeat(32)}`
      })
    );

    const recovered = await setup.job.run("uniswap");

    expect(recovered).toMatchObject({
      status: "success",
      baselineSeeding: false,
      lifecycleEventsCreated: 0,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    await expect(
      setup.repository.findSourceState(TEST_SOURCE_KEY)
    ).resolves.toMatchObject({ replayMode: null, healthStatus: "healthy" });
    expect(setup.notificationService.messages).toHaveLength(3);
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toEqual([
      expect.objectContaining({
        status: "executed",
        queuedBlockNumber: 115,
        executedBlockNumber: 116
      })
    ]);
    await expect(
      setup.repository.countByNotificationStatus("sent")
    ).resolves.toBe(3);
  });

  it("keeps new proposals notification-eligible while silently repairing old baseline history", async () => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(
      createGovernanceSourceState({
        baselineStatus: "complete",
        baselineTargetBlock: 110,
        baselineProposalCount: "1",
        cursorBlockNumber: 110,
        cursorBlockHash: testBlockHash(110)
      })
    );
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 120,
      proposalCount: "2",
      events: [
        createGovernanceContractEvent({ proposalId: "1", blockNumber: 101 }),
        createGovernanceContractEvent({ proposalId: "2", blockNumber: 115 })
      ],
      statuses: { "1": "pending", "2": "pending" }
    });
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "historical coverage gap detected; missing proposal id(s): 1"
    );
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "seeding",
      baselineTargetBlock: 110,
      baselineProposalCount: "1",
      cursorBlockNumber: 99
    });

    const recovered = await setup.job.run("uniswap");

    expect(recovered).toMatchObject({
      status: "success",
      baselineSeeding: true,
      decisionsCreated: 2,
      lifecycleEventsCreated: 2,
      notificationSentCount: 1
    });
    expect(setup.notificationService.messages).toEqual([
      expect.objectContaining({
        heading: "NEW GOVERNANCE VOTE TRACKED",
        title: "Real Uniswap proposal #2"
      })
    ]);
    await expect(repository.countByNotificationStatus("skipped")).resolves.toBe(1);
    await expect(repository.countByNotificationStatus("sent")).resolves.toBe(1);
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "complete",
      baselineTargetBlock: 110,
      baselineProposalCount: "1",
      cursorBlockNumber: 120
    });
  });

  it("bounds long coverage-gap diagnostics", async () => {
    const control = createFakeEvmGovernanceAdapter({ proposalCount: "25" });
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "missing proposal id(s): 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21 and 4 more"
    );
  });

  it("rewinds a live cursor without silently reseeding when a provider omits a proposal log", async () => {
    const setup = createJob();
    await setup.job.run("uniswap");
    setup.control.validation.latestFinalizedBlock.number = 120;
    setup.control.validation.latestFinalizedBlock.hash = testBlockHash(120);
    setup.control.validation.proposalCount = "2";

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "live coverage gap detected; missing proposal id(s): 2"
    );
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "complete",
      cursorBlockNumber: 99,
      cursorBlockHash: null,
      healthStatus: "failed",
      consecutiveFailures: 1
    });

    setup.control.events.push(
      createGovernanceContractEvent({ proposalId: "2", blockNumber: 115 })
    );
    setup.control.statuses.set("2", "pending");

    const recovered = await setup.job.run("uniswap");

    expect(recovered).toMatchObject({
      status: "success",
      baselineSeeding: false,
      cursorBefore: 99,
      cursorAfter: 120,
      decisionsCreated: 1,
      notificationSentCount: 1
    });
    expect(setup.notificationService.messages).toHaveLength(1);
    await expect(setup.repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      baselineStatus: "complete",
      cursorBlockNumber: 120,
      healthStatus: "healthy",
      consecutiveFailures: 0,
      lastError: null
    });
  });

  it("fails closed when immutable proposal sequence metadata changes or regresses", async () => {
    const initialIdRepository = new MemoryGovernanceRepository();
    await initialIdRepository.initializeSourceState(createGovernanceSourceState());
    const initialIdControl = createFakeEvmGovernanceAdapter({
      initialProposalId: "8",
      proposalCount: "100"
    });
    const initialIdSetup = createJob({
      repository: initialIdRepository,
      adapterControl: initialIdControl
    });

    await expect(initialIdSetup.job.run("uniswap")).rejects.toThrow(
      "initialProposalId changed from 0 to 8"
    );
    expect(initialIdControl.getEvents).not.toHaveBeenCalled();

    const countRepository = new MemoryGovernanceRepository();
    await countRepository.initializeSourceState(
      createGovernanceSourceState({ baselineProposalCount: "100" })
    );
    const countControl = createFakeEvmGovernanceAdapter({ proposalCount: "99" });
    const countSetup = createJob({
      repository: countRepository,
      adapterControl: countControl
    });

    await expect(countSetup.job.run("uniswap")).rejects.toThrow(
      "proposalCount regressed from baseline 100 to 99"
    );
    expect(countControl.getEvents).not.toHaveBeenCalled();
  });

  it("rejects proposal-count regression below a post-baseline decision", async () => {
    const setup = createJob();
    await setup.job.run("uniswap");

    setup.control.validation.latestFinalizedBlock.number = 120;
    setup.control.validation.latestFinalizedBlock.hash = testBlockHash(120);
    setup.control.validation.proposalCount = "2";
    setup.control.events.push(
      createGovernanceContractEvent({ proposalId: "2", blockNumber: 115 })
    );
    setup.control.statuses.set("2", "pending");
    await setup.job.run("uniswap");

    setup.control.validation.latestFinalizedBlock.number = 130;
    setup.control.validation.latestFinalizedBlock.hash = testBlockHash(130);
    setup.control.validation.proposalCount = "1";

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "proposalCount regressed below already stored proposal 2; received 1"
    );
    await expect(
      setup.repository.findSourceState(TEST_SOURCE_KEY)
    ).resolves.toMatchObject({
      cursorBlockNumber: 120,
      healthStatus: "failed",
      consecutiveFailures: 1
    });
  });

  it.each([
    [
      "chain id",
      { chainId: 10 },
      "validation chain id 10 does not match adapter chain id 1"
    ],
    [
      "finalized block hash",
      { latestFinalizedBlock: { number: 110, hash: "0xbad", timestamp: "2026-09-01T00:00:00.000Z" } },
      "finalized block hash must be a 32-byte hex value"
    ],
    [
      "finalized block timestamp",
      { latestFinalizedBlock: { number: 110, hash: testBlockHash(110), timestamp: "not-a-date" } },
      "finalized block timestamp is invalid"
    ],
    [
      "implementation address",
      { implementationAddress: "not-an-address" },
      "implementation address is invalid"
    ],
    [
      "voting delay",
      { votingDelay: "-1" },
      "Governor votingDelay is not a non-negative integer"
    ],
    [
      "voting period",
      { votingPeriod: "1.5" },
      "Governor votingPeriod is not a non-negative integer"
    ],
    [
      "proposal threshold",
      { proposalThreshold: "not-a-number" },
      "Governor proposalThreshold is not a non-negative integer"
    ],
    [
      "quorum votes",
      { quorumVotes: "" },
      "Governor quorumVotes is not a non-negative integer"
    ]
  ])("rejects malformed adapter %s validation", async (_field, override, message) => {
    const control = createFakeEvmGovernanceAdapter();
    Object.assign(control.validation, override);
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(message);
    expect(control.getEvents).not.toHaveBeenCalled();
  });

  it.each([
    [
      "baseline status",
      { baselineStatus: "unknown" },
      "baseline status is invalid"
    ],
    [
      "health status",
      { healthStatus: "unknown" },
      "health status is invalid"
    ],
    [
      "replay mode",
      { replayMode: "unknown" },
      "replay mode is invalid"
    ],
    [
      "silent replay mode with a completed baseline",
      { baselineStatus: "complete", replayMode: "silent" },
      "replay mode is inconsistent with baseline status"
    ],
    [
      "live replay mode with a seeding baseline",
      { baselineStatus: "seeding", replayMode: "live" },
      "replay mode is inconsistent with baseline status"
    ],
    [
      "baseline target",
      { baselineTargetBlock: 99 },
      "baseline target predates contract deployment"
    ],
    [
      "cursor",
      { cursorBlockNumber: 98, cursorBlockHash: null },
      "cursor predates contract deployment"
    ],
    [
      "missing cursor hash",
      { cursorBlockHash: null },
      "cursor hash is missing"
    ],
    [
      "finalized hash",
      { latestFinalizedBlockHash: "0xbad" },
      "stored finalized block hash must be a 32-byte hex value"
    ],
    [
      "failure count",
      { consecutiveFailures: -1 },
      "consecutive failure count is invalid"
    ]
  ])("rejects corrupt persisted %s state", async (_field, override, message) => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(
      createGovernanceSourceState(override as never)
    );
    const setup = createJob({ repository });

    await expect(setup.job.run("uniswap")).rejects.toThrow(message);
    expect(setup.control.getEvents).not.toHaveBeenCalled();
  });

  it("deduplicates exact adapter events before synchronizing a proposal", async () => {
    const event = createGovernanceContractEvent();
    const control = createFakeEvmGovernanceAdapter({ events: [event, event] });
    const setup = createJob({ adapterControl: control });

    const result = await setup.job.run("uniswap");

    expect(result.contractEventsRead).toBe(1);
    expect(result.decisionsCreated).toBe(1);
    expect(control.getDecision).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "out-of-range block",
      createGovernanceContractEvent({ blockNumber: 111 }),
      "outside requested block range"
    ],
    [
      "invalid proposal id",
      createGovernanceContractEvent({ proposalId: "0" }),
      "event proposal id is invalid"
    ],
    [
      "invalid block hash",
      createGovernanceContractEvent({ blockHash: "0xbad" }),
      "event block hash must be a 32-byte hex value"
    ],
    [
      "invalid transaction hash",
      createGovernanceContractEvent({ transactionHash: "0xbad" }),
      "event transaction hash must be a 32-byte hex value"
    ],
    [
      "invalid log index",
      createGovernanceContractEvent({ logIndex: -1 }),
      "event log index is invalid"
    ],
    [
      "inconsistent event id",
      createGovernanceContractEvent({ id: "wrong-id" }),
      "event id does not match"
    ]
  ] as const)("rejects adapter event with %s", async (_name, event, message) => {
    const control = createFakeEvmGovernanceAdapter({ events: [] });
    control.getEvents.mockResolvedValueOnce([event]);
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(message);
    expect(control.getDecision).not.toHaveBeenCalled();
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toEqual([]);
  });

  it("rejects conflicting duplicate adapter events atomically", async () => {
    const event = createGovernanceContractEvent();
    const conflicting = { ...event, description: "# Conflicting proposal" };
    const control = createFakeEvmGovernanceAdapter({
      events: [event, conflicting]
    });
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      `event ${event.id} is conflicting`
    );
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "wrong number",
      { number: 108, hash: testBlockHash(108), timestamp: "2026-09-01T00:00:00.000Z" },
      "returned block 108 for requested cursor block 109"
    ],
    [
      "invalid hash",
      { number: 109, hash: "0xbad", timestamp: "2026-09-01T00:00:00.000Z" },
      "cursor block hash must be a 32-byte hex value"
    ],
    [
      "invalid timestamp",
      { number: 109, hash: testBlockHash(109), timestamp: "not-a-date" },
      "cursor block timestamp is invalid"
    ]
  ] as const)("rejects adapter cursor block with %s", async (_name, block, message) => {
    const control = createFakeEvmGovernanceAdapter();
    control.getBlock.mockResolvedValueOnce(block);
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(message);
    const state = await setup.repository.findSourceState(TEST_SOURCE_KEY);
    expect(state?.cursorBlockNumber).toBe(99);
  });

  it.each([
    ["id", { id: "wrong-id" }, "does not match its requested source identity"],
    ["source", { sourceKey: "wrong-source" }, "does not match its requested source identity"],
    ["protocol", { protocol: "aave" }, "does not match its requested source identity"],
    ["chain", { chainId: 10 }, "does not match its requested source identity"],
    [
      "governor",
      { governorAddress: "0x0000000000000000000000000000000000000002" },
      "does not match its requested source identity"
    ],
    [
      "observation block",
      { lastObservedBlockNumber: 109 },
      "was observed at block 109, expected 110"
    ],
    [
      "outcomes",
      { voteOutcome: "defeated" },
      "outcomes do not match status pending"
    ]
  ] as const)("rejects adapter decision with invalid %s", async (_name, override, message) => {
    const control = createFakeEvmGovernanceAdapter();
    control.getDecision.mockResolvedValueOnce(
      createGovernanceObservation(override as never)
    );
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(message);
    await expect(
      setup.repository.findDecisionsBySource(TEST_SOURCE_KEY)
    ).resolves.toEqual([]);
  });

  it("upgrades a legacy completed source state without replaying its history", async () => {
    const repository = new MemoryGovernanceRepository();
    const legacyState = createGovernanceSourceState() as Partial<
      ReturnType<typeof createGovernanceSourceState>
    >;
    delete legacyState.initialProposalId;
    delete legacyState.baselineProposalCount;
    await repository.initializeSourceState(legacyState as never);
    const control = createFakeEvmGovernanceAdapter({
      proposalCount: "0",
      events: [],
      statuses: {}
    });
    const setup = createJob({ repository, adapterControl: control });

    const result = await setup.job.run("uniswap");

    expect(result).toMatchObject({
      status: "success",
      baselineSeeding: false,
      cursorBefore: 110,
      cursorAfter: 110
    });
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      initialProposalId: "0",
      baselineProposalCount: "0",
      baselineStatus: "complete"
    });
  });

  it("silently repairs missing baseline decisions in a legacy completed state", async () => {
    const repository = new MemoryGovernanceRepository();
    const legacyState = createGovernanceSourceState() as Partial<
      ReturnType<typeof createGovernanceSourceState>
    >;
    delete legacyState.initialProposalId;
    delete legacyState.baselineProposalCount;
    await repository.initializeSourceState(legacyState as never);
    const control = createFakeEvmGovernanceAdapter();
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "historical coverage gap detected; missing proposal id(s): 1"
    );
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      initialProposalId: "0",
      baselineProposalCount: "1",
      baselineStatus: "seeding",
      replayMode: "silent",
      cursorBlockNumber: 99,
      cursorBlockHash: null
    });
    expect(control.getEvents).not.toHaveBeenCalled();

    await expect(setup.job.run("uniswap")).resolves.toMatchObject({
      status: "success",
      baselineSeeding: true,
      decisionsCreated: 1,
      notificationSentCount: 0
    });
    expect(setup.notificationService.messages).toEqual([]);
  });

  it("repairs corrupt baseline lifecycle metadata silently after baseline completion", async () => {
    const setup = createJob();
    await setup.job.run("uniswap");
    const [storedDecision] = await setup.repository.findDecisionsBySource(
      TEST_SOURCE_KEY
    );
    expect(storedDecision).toBeDefined();

    jest
      .spyOn(setup.repository, "findDecisionsBySource")
      .mockResolvedValue([
        {
          ...storedDecision!,
          createdBlockNumber: null,
          createdTransactionHash: null
        }
      ]);
    setup.control.getEvents.mockClear();

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "historical lifecycle coverage gap detected; missing canonical reference(s): 1:created"
    );
    await expect(
      setup.repository.findSourceState(TEST_SOURCE_KEY)
    ).resolves.toMatchObject({
      baselineStatus: "seeding",
      cursorBlockNumber: 99,
      cursorBlockHash: null,
      healthStatus: "failed"
    });
    expect(setup.control.getEvents).not.toHaveBeenCalled();
    expect(setup.notificationService.messages).toEqual([]);
  });

  it("restarts a legacy in-progress baseline because its proposal boundary is unknown", async () => {
    const repository = new MemoryGovernanceRepository();
    const legacyState = createGovernanceSourceState({
      baselineStatus: "seeding",
      cursorBlockNumber: 105,
      cursorBlockHash: testBlockHash(105),
      healthStatus: "seeding"
    }) as Partial<ReturnType<typeof createGovernanceSourceState>>;
    delete legacyState.initialProposalId;
    delete legacyState.baselineProposalCount;
    await repository.initializeSourceState(legacyState as never);
    const control = createFakeEvmGovernanceAdapter({
      proposalCount: "0",
      events: [],
      statuses: {}
    });
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).resolves.toMatchObject({
      status: "success",
      baselineSeeding: true,
      cursorBefore: 105,
      cursorAfter: 110
    });
    expect(control.getEvents).toHaveBeenNthCalledWith(1, 100, 109);
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      initialProposalId: "0",
      baselineProposalCount: "0",
      baselineStatus: "complete",
      cursorBlockNumber: 110
    });
  });

  it("refuses to advance when a previously finalized cursor hash changes", async () => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(
      createGovernanceSourceState({ cursorBlockHash: testBlockHash(999) })
    );
    const setup = createJob({ repository });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "Previously finalized on-chain governance cursor block 110 changed hash"
    );
    expect(setup.control.getEvents).not.toHaveBeenCalled();
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      healthStatus: "failed",
      consecutiveFailures: 1
    });
  });

  it.each([
    [
      "cursor",
      createGovernanceSourceState({ cursorBlockNumber: 111 }),
      "cursor 111 is ahead of finalized block 110"
    ],
    [
      "baseline target",
      createGovernanceSourceState({
        baselineStatus: "seeding",
        baselineTargetBlock: 111,
        cursorBlockNumber: 99,
        cursorBlockHash: null,
        healthStatus: "seeding"
      }),
      "baseline target 111 is ahead of finalized block 110"
    ]
  ])("rejects a persisted %s ahead of finality", async (_name, state, message) => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(state);
    const setup = createJob({ repository });

    await expect(setup.job.run("uniswap")).rejects.toThrow(message);
    expect(setup.control.getEvents).not.toHaveBeenCalled();
  });

  it("rejects corrupt source identity and baseline counter state", async () => {
    const identityRepository = new MemoryGovernanceRepository();
    await identityRepository.initializeSourceState(
      createGovernanceSourceState({ chainId: 10 })
    );
    const identitySetup = createJob({ repository: identityRepository });
    await expect(identitySetup.job.run("uniswap")).rejects.toThrow(
      "Stored governance source state does not match adapter"
    );

    const counterRepository = new MemoryGovernanceRepository();
    await counterRepository.initializeSourceState(
      createGovernanceSourceState({
        initialProposalId: "8",
        baselineProposalCount: "7"
      })
    );
    const counterControl = createFakeEvmGovernanceAdapter({
      initialProposalId: "8",
      proposalCount: "8"
    });
    const counterSetup = createJob({
      repository: counterRepository,
      adapterControl: counterControl
    });
    await expect(counterSetup.job.run("uniswap")).rejects.toThrow(
      "baselineProposalCount 7 is below initialProposalId 8"
    );
  });

  it("never associates an older overlap block hash with a newer persisted cursor", async () => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(
      createGovernanceSourceState({
        initialProposalId: "0",
        baselineProposalCount: "0"
      })
    );
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 112,
      proposalCount: "0",
      events: [],
      statuses: {},
      maxLogBlockRange: 1,
      reorgOverlapBlocks: 5
    });
    control.getEvents
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("stop after older overlap range"));
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "stop after older overlap range"
    );

    expect(control.getEvents).toHaveBeenNthCalledWith(1, 106, 106);
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      cursorBlockNumber: 110,
      cursorBlockHash: testBlockHash(110)
    });
  });

  it("fails closed when the governor implementation changes", async () => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(createGovernanceSourceState());
    const control = createFakeEvmGovernanceAdapter({
      implementationAddress: "0x0000000000000000000000000000000000000002"
    });
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "Governor implementation changed"
    );
    expect(control.getEvents).not.toHaveBeenCalled();
  });

  it("releases the same-source lock after early repository failure", async () => {
    const repository = new MemoryGovernanceRepository();
    const lookup = jest
      .spyOn(repository, "findSourceState")
      .mockRejectedValueOnce(new Error("Firestore unavailable"));
    const setup = createJob({ repository });

    await expect(setup.job.run("uniswap")).rejects.toThrow("Firestore unavailable");
    lookup.mockRestore();
    await expect(setup.job.run("uniswap")).resolves.toMatchObject({
      status: "success"
    });
  });

  it("preserves the original scan failure when failure-state writes also fail", async () => {
    const repository = new MemoryGovernanceRepository();
    const stateWrite = jest
      .spyOn(repository, "updateSourceState")
      .mockRejectedValue(new Error("Firestore state write failed"));
    const runWrite = jest
      .spyOn(repository, "upsertScanRun")
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("Firestore run write failed"));
    const control = createFakeEvmGovernanceAdapter();
    control.validateSource.mockRejectedValueOnce("RPC rejected without Error");
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toBe(
      "RPC rejected without Error"
    );
    expect(stateWrite).toHaveBeenCalled();
    expect(runWrite).toHaveBeenCalledTimes(2);
    expect(setup.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: TEST_SOURCE_KEY }),
      "Failed to record on-chain source failure state"
    );
    expect(setup.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "uniswap" }),
      "Failed to persist failed on-chain governance scan run"
    );
  });

  it("preserves an early RPC failure when no source state exists to mark failed", async () => {
    const control = createFakeEvmGovernanceAdapter();
    const rpcError = new Error("RPC validation failed before initialization");
    control.validateSource.mockRejectedValueOnce(rpcError);
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toBe(rpcError);
    await expect(
      setup.repository.findSourceState(TEST_SOURCE_KEY)
    ).resolves.toBeNull();
    await expect(setup.repository.findScanRuns()).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        errors: ["RPC validation failed before initialization"]
      })
    ]);
    expect(setup.logger.error).toHaveBeenCalledWith(
      { sourceKey: TEST_SOURCE_KEY },
      "On-chain governance source state disappeared while recording failure"
    );
  });

  it("fails closed if durable source state disappears while advancing the cursor", async () => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(
      createGovernanceSourceState({
        initialProposalId: "0",
        baselineProposalCount: "0"
      })
    );
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 112,
      initialProposalId: "0",
      proposalCount: "0",
      events: [],
      statuses: {}
    });
    const stateWrite = jest
      .spyOn(repository, "updateSourceState")
      .mockResolvedValueOnce(null);
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "disappeared while advancing its finalized cursor"
    );
    expect(stateWrite).toHaveBeenCalled();
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      healthStatus: "failed",
      consecutiveFailures: 1,
      lastError: expect.stringContaining(
        "disappeared while advancing its finalized cursor"
      )
    });
    await expect(repository.findScanRuns()).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        cursorBefore: 110,
        cursorAfter: 110,
        errors: [
          expect.stringContaining(
            "disappeared while advancing its finalized cursor"
          )
        ]
      })
    ]);

    await expect(setup.job.run("uniswap")).resolves.toMatchObject({
      status: "success",
      cursorAfter: 112
    });
  });

  it("does not report success if the final durable health checkpoint disappears", async () => {
    const repository = new MemoryGovernanceRepository();
    await repository.initializeSourceState(
      createGovernanceSourceState({
        initialProposalId: "0",
        baselineProposalCount: "0"
      })
    );
    const control = createFakeEvmGovernanceAdapter({
      finalizedBlock: 112,
      initialProposalId: "0",
      proposalCount: "0",
      events: [],
      statuses: {}
    });
    const updateSourceState = repository.updateSourceState.bind(repository);
    let writeCount = 0;
    jest
      .spyOn(repository, "updateSourceState")
      .mockImplementation(async (sourceKey, updater) => {
        writeCount += 1;
        return writeCount === 2
          ? null
          : updateSourceState(sourceKey, updater);
      });
    const setup = createJob({ repository, adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toThrow(
      "disappeared while recording a successful scan"
    );
    await expect(repository.findSourceState(TEST_SOURCE_KEY)).resolves.toMatchObject({
      cursorBlockNumber: 112,
      healthStatus: "failed",
      consecutiveFailures: 1,
      lastSuccessfulScanAt: "2026-09-01T00:00:00.000Z",
      lastError: expect.stringContaining(
        "disappeared while recording a successful scan"
      )
    });
    await expect(repository.findScanRuns()).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        cursorAfter: 112
      })
    ]);

    await expect(setup.job.run("uniswap")).resolves.toMatchObject({
      status: "success",
      cursorBefore: 112,
      cursorAfter: 112
    });
  });

  it("does not include nested authenticated RPC metadata in scanner logs", async () => {
    const control = createFakeEvmGovernanceAdapter();
    const rpcError = Object.assign(new Error("Ethereum RPC request failed"), {
      cause: { url: "https://rpc.example/secret-token" }
    });
    control.validateSource.mockRejectedValueOnce(rpcError);
    const setup = createJob({ adapterControl: control });

    await expect(setup.job.run("uniswap")).rejects.toBe(rpcError);

    const serializedLogs = JSON.stringify(setup.logger.error.mock.calls);
    expect(serializedLogs).toContain("Ethereum RPC request failed");
    expect(serializedLogs).not.toContain("secret-token");
    expect(serializedLogs).not.toContain("rpc.example");
  });

  it("prevents overlapping runs for the same source", async () => {
    const setup = createJob();
    let releaseValidation: (() => void) | undefined;
    setup.control.validateSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseValidation = () => resolve(structuredClone(setup.control.validation));
        })
    );

    const first = setup.job.run("uniswap");
    await Promise.resolve();
    await expect(setup.job.run("uniswap")).rejects.toBeInstanceOf(
      OnchainScanAlreadyRunningError
    );
    releaseValidation?.();
    await expect(first).resolves.toMatchObject({ status: "success" });
  });

  it("rejects unknown or disabled protocol sources", async () => {
    const setup = createJob();

    await expect(setup.job.run("aave")).rejects.toBeInstanceOf(
      UnknownOnchainGovernanceSourceError
    );
    await expect(setup.job.run("aave")).rejects.toThrow(
      "On-chain governance source is not enabled for protocol: aave"
    );

    const disabledControl = createFakeEvmGovernanceAdapter({ enabled: false });
    const disabled = createJob({ adapterControl: disabledControl });
    await expect(disabled.job.run("uniswap")).rejects.toBeInstanceOf(
      UnknownOnchainGovernanceSourceError
    );
    expect(disabledControl.validateSource).not.toHaveBeenCalled();
  });
});

describe("on-chain scan helpers", () => {
  it("splits inclusive block ranges without gaps or overlap", () => {
    expect(blockRanges(100, 120, 10)).toEqual([
      { from: 100, to: 109 },
      { from: 110, to: 119 },
      { from: 120, to: 120 }
    ]);
    expect(blockRanges(121, 120, 10)).toEqual([]);
    expect(() => blockRanges(1, 2, 0)).toThrow("positive safe integer");
    expect(() => blockRanges(1, 2, 1.5)).toThrow("positive safe integer");
    expect(() => blockRanges(-1, 2, 1)).toThrow(
      "bounds must be non-negative safe integers"
    );
    expect(() => blockRanges(1, Number.NaN, 1)).toThrow(
      "bounds must be non-negative safe integers"
    );
  });

  it("groups mixed lifecycle logs by proposal without losing source order", () => {
    const first = createGovernanceContractEvent({ proposalId: "1" });
    const second = createGovernanceContractEvent({
      proposalId: "2",
      blockNumber: 102
    });
    const queued = createGovernanceContractEvent({
      proposalId: "1",
      type: "queued",
      blockNumber: 103
    });

    expect(groupEventsByProposal([first, second, queued])).toEqual(
      new Map([
        ["1", [first, queued]],
        ["2", [second]]
      ])
    );
  });

  it("finds proposal-sequence gaps using integer-safe ids", () => {
    expect(
      findMissingProposalIds(
        [{ proposalId: "9" }, { proposalId: "11" }],
        "8",
        "11"
      )
    ).toEqual(["10"]);
    expect(findMissingProposalIds([], "8", "8")).toEqual([]);
    expect(() => findMissingProposalIds([], "10", "9")).toThrow(
      "proposalCount 9 is below initialProposalId 10"
    );
    expect(() => findMissingProposalIds([], "bad", "10")).toThrow(
      "initialProposalId is not a non-negative integer"
    );
    expect(() => findMissingProposalIds([], "0", "10001")).toThrow(
      "refusing an unbounded coverage check"
    );
    expect(findMissingProposalIds([], "0", "25")).toHaveLength(25);
  });

  it("finds missing canonical references for every event-backed lifecycle stage", () => {
    expect(
      findMissingLifecycleReferences([
        createGovernanceObservation({
          proposalId: "1",
          status: "pending",
          createdBlockNumber: undefined,
          createdTransactionHash: undefined
        }) as never,
        createGovernanceObservation({
          proposalId: "2",
          status: "canceled",
          canceledBlockNumber: undefined,
          canceledTransactionHash: undefined
        }) as never,
        createGovernanceObservation({
          proposalId: "3",
          status: "canceled",
          eta: "1785000000",
          canceledBlockNumber: 115,
          canceledTransactionHash: `0x${"33".repeat(32)}`,
          queuedBlockNumber: undefined,
          queuedTransactionHash: undefined
        }) as never,
        createGovernanceObservation({
          proposalId: "4",
          status: "executed",
          eta: "1785000000",
          queuedBlockNumber: undefined,
          queuedTransactionHash: undefined,
          executedBlockNumber: undefined,
          executedTransactionHash: undefined
        }) as never,
        createGovernanceObservation({
          proposalId: "5",
          status: "pending",
          createdBlockNumber: undefined,
          createdTransactionHash: `0x${"55".repeat(32)}`
        }) as never,
        createGovernanceObservation({
          proposalId: "6",
          status: "pending",
          createdBlockNumber: 106,
          createdTransactionHash: undefined
        }) as never
      ])
    ).toEqual([
      "1:created",
      "2:canceled",
      "3:queued",
      "4:queued",
      "4:executed",
      "5:created",
      "6:created"
    ]);
  });
});
