import { describe, expect, it } from "@jest/globals";
import {
  createGovernanceDecisionId,
  createGovernanceLifecycleEventId
} from "../../src/onchain/governanceDecision.js";
import { MemoryGovernanceRepository } from "../../src/storage/governance.repository.js";
import {
  createGovernanceObservation,
  createGovernanceScanRun,
  createGovernanceSourceState,
  TEST_GOVERNOR_ADDRESS,
  TEST_SOURCE_KEY
} from "../helpers/onchainBuilders.js";

describe("MemoryGovernanceRepository", () => {
  it("atomically inserts a decision and its deterministic creation event", async () => {
    const repository = new MemoryGovernanceRepository();
    const result = await repository.upsertDecision(
      createGovernanceObservation(),
      {
        notificationStatusForNewEvents: "pending",
        now: "2026-09-01T00:00:00.000Z"
      }
    );

    expect(result).toMatchObject({ created: true, updated: true });
    expect(result.lifecycleEventsCreated).toHaveLength(1);
    expect(result.lifecycleEventsCreated[0]).toMatchObject({
      decisionId: result.decision.id,
      transition: "created",
      notificationStatus: "pending",
      transactionHash: `0x${"11".repeat(32)}`
    });
    await expect(repository.findDecisionById(result.decision.id)).resolves.toEqual(
      result.decision
    );
    await expect(repository.countByNotificationStatus("pending")).resolves.toBe(1);
  });

  it("does not rewrite or recreate events for an identical observation", async () => {
    const repository = new MemoryGovernanceRepository();
    const observation = createGovernanceObservation();

    await repository.upsertDecision(observation, {
      notificationStatusForNewEvents: "skipped",
      now: "2026-09-01T00:00:00.000Z"
    });
    const repeated = await repository.upsertDecision(
      { ...observation, lastObservedBlockNumber: 999 },
      {
        notificationStatusForNewEvents: "pending",
        now: "2026-09-02T00:00:00.000Z"
      }
    );

    expect(repeated).toMatchObject({ created: false, updated: false });
    expect(repeated.lifecycleEventsCreated).toEqual([]);
    expect(repeated.decision.updatedAt).toBe("2026-09-01T00:00:00.000Z");
    await expect(repository.countByNotificationStatus("skipped")).resolves.toBe(1);
    await expect(repository.countByNotificationStatus("pending")).resolves.toBe(0);
  });

  it("stores each implied transition exactly once when polling skips states", async () => {
    const repository = new MemoryGovernanceRepository();
    const pending = createGovernanceObservation({ status: "pending" });

    await repository.upsertDecision(pending, {
      notificationStatusForNewEvents: "pending"
    });
    const executed = await repository.upsertDecision(
      createGovernanceObservation({
        status: "executed",
        eta: "1789000000",
        forVotes: "50000000000000000000000000",
        executedBlockNumber: 190,
        executedTransactionHash: `0x${"44".repeat(32)}`,
        lastObservedBlockNumber: 200,
        rawHash: "executed-hash"
      }),
      { notificationStatusForNewEvents: "pending" }
    );
    const repeated = await repository.upsertDecision(executed.decision, {
      notificationStatusForNewEvents: "pending"
    });

    expect(executed.lifecycleEventsCreated.map((event) => event.transition)).toEqual([
      "succeeded",
      "queued",
      "executed"
    ]);
    expect(executed.lifecycleEventsCreated[0]).toMatchObject({
      transition: "succeeded",
      blockNumber: 111,
      decisionStatus: "succeeded"
    });
    expect(repeated.lifecycleEventsCreated).toEqual([]);
    await expect(repository.countByNotificationStatus("pending")).resolves.toBe(4);
  });

  it("records a defeated vote result at the first post-voting block", async () => {
    const repository = new MemoryGovernanceRepository();
    const result = await repository.upsertDecision(
      createGovernanceObservation({
        status: "defeated",
        endBlock: 110,
        againstVotes: "50000000000000000000000000",
        rawHash: "defeated-hash"
      }),
      { notificationStatusForNewEvents: "pending" }
    );

    expect(result.lifecycleEventsCreated).toEqual([
      expect.objectContaining({ transition: "created" }),
      expect.objectContaining({
        transition: "defeated",
        decisionStatus: "defeated",
        blockNumber: 111
      })
    ]);
  });

  it("records a canceled proposal against its canonical event block and transaction", async () => {
    const repository = new MemoryGovernanceRepository();
    const canceledTransactionHash = `0x${"22".repeat(32)}`;
    const result = await repository.upsertDecision(
      createGovernanceObservation({
        status: "canceled",
        canceledBlockNumber: 109,
        canceledTransactionHash,
        rawHash: "canceled-hash"
      }),
      { notificationStatusForNewEvents: "pending" }
    );

    expect(result.lifecycleEventsCreated).toEqual([
      expect.objectContaining({ transition: "created" }),
      expect.objectContaining({
        transition: "canceled",
        decisionStatus: "canceled",
        blockNumber: 109,
        transactionHash: canceledTransactionHash
      })
    ]);
  });

  it("stores an intermediate canonical queue when cancellation occurs between polls", async () => {
    const repository = new MemoryGovernanceRepository();
    const queuedTransactionHash = `0x${"33".repeat(32)}`;

    await repository.upsertDecision(
      createGovernanceObservation({ status: "active" }),
      { notificationStatusForNewEvents: "pending" }
    );
    const result = await repository.upsertDecision(
      createGovernanceObservation({
        status: "canceled",
        queuedBlockNumber: 180,
        queuedTransactionHash,
        canceledBlockNumber: 190,
        canceledTransactionHash: `0x${"44".repeat(32)}`,
        lastObservedBlockNumber: 200,
        rawHash: "queued-then-canceled"
      }),
      { notificationStatusForNewEvents: "pending" }
    );

    expect(result.lifecycleEventsCreated.map((event) => event.transition)).toEqual([
      "succeeded",
      "queued",
      "canceled"
    ]);
    expect(result.lifecycleEventsCreated[1]).toMatchObject({
      transition: "queued",
      blockNumber: 180,
      transactionHash: queuedTransactionHash
    });
  });

  it("creates each queued-then-canceled lifecycle event once when only the ETA proves queuing", async () => {
    const repository = new MemoryGovernanceRepository();
    const observation = createGovernanceObservation({
      status: "canceled",
      eta: "1789000000",
      canceledBlockNumber: 190,
      canceledTransactionHash: `0x${"44".repeat(32)}`,
      lastObservedBlockNumber: 200,
      rawHash: "eta-proves-queued-then-canceled"
    });

    const inserted = await repository.upsertDecision(observation, {
      notificationStatusForNewEvents: "pending",
      now: "2026-09-01T00:00:00.000Z"
    });
    const repeated = await repository.upsertDecision(observation, {
      notificationStatusForNewEvents: "pending",
      now: "2026-09-02T00:00:00.000Z"
    });

    expect(inserted.decision).toMatchObject({
      voteOutcome: "succeeded",
      executionOutcome: "canceled"
    });
    expect(inserted.lifecycleEventsCreated.map((event) => event.transition)).toEqual([
      "created",
      "succeeded",
      "queued",
      "canceled"
    ]);
    expect(inserted.lifecycleEventsCreated[2]).toMatchObject({
      transition: "queued",
      blockNumber: 200,
      transactionHash: null,
      notificationStatus: "pending"
    });
    expect(repeated).toMatchObject({
      created: false,
      updated: false,
      lifecycleEventsCreated: []
    });
    await expect(repository.countByNotificationStatus("pending")).resolves.toBe(4);
  });

  it.each(["succeeded", "defeated"] as const)(
    "persists an inferred %s result exactly once for a post-vote cancellation",
    async (voteOutcome) => {
      const repository = new MemoryGovernanceRepository();
      const observation = createGovernanceObservation({
        status: "canceled",
        voteOutcome,
        canceledBlockNumber: 190,
        canceledTransactionHash: `0x${"44".repeat(32)}`,
        lastObservedBlockNumber: 200,
        rawHash: `post-vote-canceled-${voteOutcome}`
      });

      const inserted = await repository.upsertDecision(observation, {
        notificationStatusForNewEvents: "pending"
      });
      const repeated = await repository.upsertDecision(observation, {
        notificationStatusForNewEvents: "pending"
      });

      expect(inserted.lifecycleEventsCreated.map((event) => event.transition)).toEqual([
        "created",
        voteOutcome,
        "canceled"
      ]);
      expect(repeated.lifecycleEventsCreated).toEqual([]);
      await expect(repository.countByNotificationStatus("pending")).resolves.toBe(3);
    }
  );

  it("enriches historical lifecycle events without recreating or renotifying them", async () => {
    const repository = new MemoryGovernanceRepository();
    const initial = await repository.upsertDecision(
      createGovernanceObservation({
        status: "executed",
        eta: "1789000000",
        forVotes: "50000000000000000000000000",
        rawHash: "executed-before-event-logs",
        lastObservedBlockNumber: 200
      }),
      {
        notificationStatusForNewEvents: "skipped",
        now: "2026-09-01T00:00:00.000Z"
      }
    );
    const queuedEventId = createGovernanceLifecycleEventId(
      initial.decision.id,
      "queued"
    );
    const queuedBefore = await repository.findById(queuedEventId);
    expect(queuedBefore).toMatchObject({
      blockNumber: 200,
      transactionHash: null,
      notificationStatus: "skipped"
    });
    await repository.updateNotificationState(queuedEventId, () => ({
      notificationStatus: "sent",
      notificationDeliveries: {
        recipient: {
          recipientKey: "recipient",
          recipientMaskedId: "*****3073",
          status: "sent",
          attemptCount: 1,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z"
        }
      }
    }));

    const queuedTransactionHash = `0x${"33".repeat(32)}`;
    const enriched = await repository.upsertDecision(
      createGovernanceObservation({
        status: "executed",
        eta: "1789000000",
        forVotes: "50000000000000000000000000",
        queuedBlockNumber: 180,
        queuedTransactionHash,
        rawHash: "executed-before-event-logs",
        lastObservedBlockNumber: 220
      }),
      {
        notificationStatusForNewEvents: "pending",
        now: "2026-09-02T00:00:00.000Z"
      }
    );

    expect(enriched).toMatchObject({
      created: false,
      updated: true,
      lifecycleEventsCreated: []
    });
    await expect(repository.findById(queuedEventId)).resolves.toMatchObject({
      blockNumber: 180,
      transactionHash: queuedTransactionHash,
      notificationStatus: "sent",
      notificationDeliveries: {
        recipient: expect.objectContaining({ status: "sent" })
      },
      firstSeenAt: queuedBefore?.firstSeenAt,
      createdAt: queuedBefore?.createdAt,
      updatedAt: "2026-09-02T00:00:00.000Z"
    });
  });

  it("rejects conflicting lifecycle transaction hashes atomically", async () => {
    const repository = new MemoryGovernanceRepository();
    const originalHash = `0x${"33".repeat(32)}`;
    const original = await repository.upsertDecision(
      createGovernanceObservation({
        status: "queued",
        queuedBlockNumber: 180,
        queuedTransactionHash: originalHash,
        lastObservedBlockNumber: 200,
        rawHash: "queued-original"
      }),
      { notificationStatusForNewEvents: "skipped" }
    );
    const queuedEventId = createGovernanceLifecycleEventId(
      original.decision.id,
      "queued"
    );
    const eventBefore = await repository.findById(queuedEventId);

    await expect(
      repository.upsertDecision(
        createGovernanceObservation({
          status: "queued",
          title: "This update must not partially persist",
          queuedBlockNumber: 181,
          queuedTransactionHash: `0x${"44".repeat(32)}`,
          lastObservedBlockNumber: 200,
          rawHash: "queued-conflict"
        }),
        { notificationStatusForNewEvents: "pending" }
      )
    ).rejects.toThrow("transaction hash cannot change");

    await expect(repository.findDecisionById(original.decision.id)).resolves.toEqual(
      original.decision
    );
    await expect(repository.findById(queuedEventId)).resolves.toEqual(eventBefore);
  });

  it("rejects moving a finalized lifecycle transaction to another block", async () => {
    const repository = new MemoryGovernanceRepository();
    const transactionHash = `0x${"33".repeat(32)}`;
    const original = await repository.upsertDecision(
      createGovernanceObservation({
        status: "queued",
        queuedBlockNumber: 180,
        queuedTransactionHash: transactionHash,
        lastObservedBlockNumber: 200,
        rawHash: "queued-original-block"
      }),
      { notificationStatusForNewEvents: "skipped" }
    );
    const queuedEventId = createGovernanceLifecycleEventId(
      original.decision.id,
      "queued"
    );
    const eventBefore = await repository.findById(queuedEventId);

    await expect(
      repository.upsertDecision(
        createGovernanceObservation({
          status: "queued",
          queuedBlockNumber: 181,
          queuedTransactionHash: transactionHash,
          lastObservedBlockNumber: 200,
          rawHash: "queued-moved-block"
        }),
        { notificationStatusForNewEvents: "pending" }
      )
    ).rejects.toThrow("block number cannot change once its transaction is known");

    await expect(repository.findDecisionById(original.decision.id)).resolves.toEqual(
      original.decision
    );
    await expect(repository.findById(queuedEventId)).resolves.toEqual(eventBefore);
  });

  it("updates per-recipient notification state without mutating decision data", async () => {
    const repository = new MemoryGovernanceRepository();
    const inserted = await repository.upsertDecision(
      createGovernanceObservation(),
      { notificationStatusForNewEvents: "pending" }
    );
    const event = inserted.lifecycleEventsCreated[0];
    const recipientKey = "opaque-recipient";

    const updated = await repository.updateNotificationState(event.id, () => ({
      notificationStatus: "failed",
      notificationError: "Telegram unavailable",
      notificationDeliveries: {
        [recipientKey]: {
          recipientKey,
          recipientMaskedId: "*****3073",
          status: "failed",
          attemptCount: 1,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          nextRetryAt: "2026-09-01T00:15:00.000Z"
        }
      }
    }));

    expect(updated).toMatchObject({
      id: event.id,
      notificationStatus: "failed",
      notificationError: "Telegram unavailable"
    });
    expect(updated?.notificationDeliveries?.[recipientKey]).toMatchObject({
      recipientMaskedId: "*****3073",
      status: "failed"
    });
    await expect(repository.findDecisionById(inserted.decision.id)).resolves.toEqual(
      inserted.decision
    );
    await expect(repository.updateNotificationState("missing", () => ({
      notificationStatus: "sent"
    }))).resolves.toBeNull();
  });

  it("initializes source state once and protects immutable source identity", async () => {
    const repository = new MemoryGovernanceRepository();
    const initial = createGovernanceSourceState();
    const competing = createGovernanceSourceState({ cursorBlockNumber: 999 });

    await expect(repository.initializeSourceState(initial)).resolves.toEqual(initial);
    await expect(repository.initializeSourceState(competing)).resolves.toEqual(initial);
    await expect(
      repository.updateSourceState(TEST_SOURCE_KEY, (state) => ({
        ...state,
        chainId: 10
      }))
    ).rejects.toThrow("Governance source identity cannot change.");
    await expect(
      repository.updateSourceState(TEST_SOURCE_KEY, (state) => ({
        ...state,
        initialProposalId: "8"
      }))
    ).rejects.toThrow("Governance source identity cannot change.");
    await expect(
      repository.updateSourceState(TEST_SOURCE_KEY, (state) => ({
        ...state,
        sourceType: "forum" as never
      }))
    ).rejects.toThrow("Governance source identity cannot change.");
    await expect(
      repository.updateSourceState(TEST_SOURCE_KEY, (state) => ({
        ...state,
        baselineProposalCount: "2"
      }))
    ).resolves.toMatchObject({ baselineProposalCount: "2" });
    await expect(
      repository.updateSourceState("missing", (state) => state)
    ).resolves.toBeNull();
  });

  it("sorts arbitrarily large proposal ids without losing integer precision", async () => {
    const repository = new MemoryGovernanceRepository();
    const ids = [
      "9007199254740993",
      "9007199254740992",
      "100000000000000000000"
    ];

    for (const proposalId of ids) {
      await repository.upsertDecision(
        createGovernanceObservation({
          id: createGovernanceDecisionId({
            protocol: "uniswap",
            chainId: 1,
            governorAddress: TEST_GOVERNOR_ADDRESS,
            proposalId
          }),
          proposalId
        }),
        { notificationStatusForNewEvents: "skipped" }
      );
    }

    await expect(repository.findDecisionsBySource(TEST_SOURCE_KEY)).resolves.toEqual(
      expect.arrayContaining(ids.map((proposalId) => expect.objectContaining({ proposalId })))
    );
    expect(
      (await repository.findDecisionsBySource(TEST_SOURCE_KEY)).map(
        (decision) => decision.proposalId
      )
    ).toEqual(["100000000000000000000", "9007199254740993", "9007199254740992"]);
  });

  it("stores scan runs in newest-first order and looks up the latest source run", async () => {
    const repository = new MemoryGovernanceRepository();
    const older = createGovernanceScanRun({
      id: "older",
      startedAt: "2026-09-01T00:00:00.000Z"
    });
    const newer = createGovernanceScanRun({
      id: "newer",
      startedAt: "2026-09-02T00:00:00.000Z"
    });

    await repository.upsertScanRun(older);
    await repository.upsertScanRun(newer);

    await expect(repository.findScanRuns(1)).resolves.toEqual([newer]);
    await expect(repository.findLatestScanRunBySource(TEST_SOURCE_KEY)).resolves.toEqual(
      newer
    );

    repository.clear();
    await expect(repository.findScanRuns()).resolves.toEqual([]);
    await expect(repository.findAllSourceStates()).resolves.toEqual([]);
  });
});
