import { describe, expect, it } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import { NoopNotificationService } from "../../src/notifications/noopNotification.service.js";
import { ProposalNotificationDispatcher } from "../../src/notifications/proposalNotifications.js";
import { governanceEventMessage } from "../../src/onchain/governanceNotifications.js";
import { createGovernanceLifecycleEventId } from "../../src/onchain/governanceDecision.js";
import { OnchainGovernanceScanJob } from "../../src/onchain/onchainGovernance.job.js";
import { EvmGovernanceRegistry } from "../../src/onchain/registry.js";
import type { GovernanceLifecycleEvent } from "../../src/onchain/types.js";
import { UniswapOnchainGovernanceAdapter } from "../../src/onchain/uniswap/uniswapOnchain.adapter.js";
import { MemoryGovernanceRepository } from "../../src/storage/governance.repository.js";
import { createLogger } from "../../src/utils/logger.js";
import { errorMessage } from "../../src/utils/errors.js";

const describeLive =
  process.env.RUN_UNISWAP_ONCHAIN_FULL_E2E === "true"
    ? describe
    : describe.skip;

describeLive("Uniswap on-chain full historical replay E2E", () => {
  it(
    "indexes every Governor Bravo proposal without gaps, writes, or notifications",
    async () => {
      try {
      const env = loadEnv({
        ...process.env,
        NODE_ENV: "test",
        STORAGE_MODE: "memory",
        DEMO_MODE: "false",
        ENABLE_SCHEDULER: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "false",
        ENABLE_ADMIN_STATUS_REPORTS: "false",
        UNISWAP_ONCHAIN_ENABLED: "true",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
        LOG_LEVEL: "silent"
      });
      if (!env.ethereumRpcUrl) {
        throw new Error(
          "ETHEREUM_RPC_URL is required for the full Uniswap on-chain E2E replay."
        );
      }

      const logger = createLogger(env);
      const repository = new MemoryGovernanceRepository();
      const notificationService = new NoopNotificationService();
      const adapter = new UniswapOnchainGovernanceAdapter(env);
      const registry = new EvmGovernanceRegistry([adapter]);
      const dispatcher =
        new ProposalNotificationDispatcher<GovernanceLifecycleEvent>(
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
      const firstRun = await job.run("uniswap");
      const decisions = await repository.findDecisionsBySource(adapter.sourceKey);
      const sourceState = await repository.findSourceState(adapter.sourceKey);
      if (!sourceState) {
        throw new Error("Full replay did not persist an on-chain source state.");
      }
      const initialProposalId = BigInt(sourceState.initialProposalId);
      const baselineProposalCount = BigInt(sourceState.baselineProposalCount);
      const expectedDecisionCount = Number(
        baselineProposalCount - initialProposalId
      );
      const expectedIds = Array.from(
        { length: expectedDecisionCount },
        (_, index) => (baselineProposalCount - BigInt(index)).toString()
      );

      expect(expectedDecisionCount).toBeGreaterThan(0);
      expect(firstRun).toMatchObject({
        status: "success",
        baselineSeeding: true,
        notificationSentCount: 0,
        notificationFailedCount: 0,
        errors: []
      });
      expect(decisions).toHaveLength(expectedDecisionCount);
      expect(decisions.map((decision) => decision.proposalId)).toEqual(
        expectedIds
      );
      expect(new Set(decisions.map((decision) => decision.id)).size).toBe(
        expectedDecisionCount
      );
      expect(
        decisions.every(
          (decision) =>
            decision.chainId === 1 &&
            decision.sourceType === "onchain" &&
            decision.actions.length > 0 &&
            BigInt(decision.forVotes) >= 0n &&
            BigInt(decision.againstVotes) >= 0n &&
            BigInt(decision.abstainVotes) >= 0n
        )
      ).toBe(true);
      expect(
        decisions
          .filter(
            (decision) =>
              decision.voteOutcome === "succeeded" ||
              decision.voteOutcome === "defeated"
          )
          .every(
            (decision) =>
              decision.votingEndedAt !== null &&
              new Date(decision.votingEndedAt).toISOString() ===
                decision.votingEndedAt
          )
      ).toBe(true);
      expect(
        decisions.filter(
          (decision) =>
            decision.createdBlockNumber === null ||
            decision.createdTransactionHash === null ||
            (decision.status === "canceled" &&
              (decision.canceledBlockNumber === null ||
                decision.canceledTransactionHash === null)) ||
            ((["queued", "expired", "executed"].includes(decision.status) ||
              (decision.status === "canceled" && decision.eta !== null)) &&
              (decision.queuedBlockNumber === null ||
                decision.queuedTransactionHash === null)) ||
            (decision.status === "executed" &&
              (decision.executedBlockNumber === null ||
                decision.executedTransactionHash === null))
        )
      ).toEqual([]);
      await expect(repository.countByNotificationStatus("pending")).resolves.toBe(
        0
      );
      await expect(repository.countByNotificationStatus("sent")).resolves.toBe(0);
      await expect(repository.countByNotificationStatus("failed")).resolves.toBe(
        0
      );
      await expect(repository.countByNotificationStatus("skipped")).resolves.toBe(
        firstRun.lifecycleEventsCreated
      );
      expect(sourceState).toMatchObject({
        baselineStatus: "complete",
        replayMode: null,
        healthStatus: "healthy",
        cursorBlockNumber: firstRun.latestFinalizedBlock
      });

      for (const decision of decisions) {
        if (
          decision.status === "canceled" &&
          (decision.voteOutcome === "succeeded" ||
            decision.voteOutcome === "defeated")
        ) {
          await expect(
            repository.findById(
              createGovernanceLifecycleEventId(decision.id, decision.voteOutcome)
            )
          ).resolves.toMatchObject({
            decisionId: decision.id,
            transition: decision.voteOutcome,
            notificationStatus: "skipped"
          });
        }
      }

      const repeated = await job.run("uniswap");
      const decisionsAfterRepeat = await repository.findDecisionsBySource(
        adapter.sourceKey
      );

      expect(repeated).toMatchObject({
        status: "success",
        baselineSeeding: false,
        decisionsCreated: 0,
        notificationSentCount: 0,
        notificationFailedCount: 0,
        errors: []
      });
      const highestProposalId = BigInt(decisionsAfterRepeat[0].proposalId);
      const expectedAfterRepeatCount = Number(
        highestProposalId - initialProposalId
      );
      expect(decisionsAfterRepeat).toHaveLength(expectedAfterRepeatCount);
      expect(
        decisionsAfterRepeat.map((decision) => decision.proposalId)
      ).toEqual(
        Array.from(
          { length: expectedAfterRepeatCount },
          (_, index) => (highestProposalId - BigInt(index)).toString()
        )
      );
      expect(new Set(decisionsAfterRepeat.map((decision) => decision.id)).size).toBe(
        expectedAfterRepeatCount
      );
      } catch (error) {
        throw new Error(errorMessage(error));
      }
    },
    30 * 60 * 1_000
  );
});
