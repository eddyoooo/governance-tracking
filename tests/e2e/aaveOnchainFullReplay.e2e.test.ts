import { describe, expect, it, jest } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import { NoopNotificationService } from "../../src/notifications/noopNotification.service.js";
import { ProposalNotificationDispatcher } from "../../src/notifications/proposalNotifications.js";
import { AaveOnchainClient } from "../../src/onchain/aave/aaveOnchain.client.js";
import { AaveOnchainGovernanceAdapter } from "../../src/onchain/aave/aaveOnchain.adapter.js";
import { createGovernanceLifecycleEventId } from "../../src/onchain/governanceDecision.js";
import { governanceEventMessage } from "../../src/onchain/governanceNotifications.js";
import { OnchainGovernanceScanJob } from "../../src/onchain/onchainGovernance.job.js";
import { EvmGovernanceRegistry } from "../../src/onchain/registry.js";
import type { GovernanceLifecycleEvent } from "../../src/onchain/types.js";
import { MemoryGovernanceRepository } from "../../src/storage/governance.repository.js";
import { errorMessage } from "../../src/utils/errors.js";
import { createLogger } from "../../src/utils/logger.js";

const describeLive = process.env.RUN_AAVE_ONCHAIN_FULL_E2E === "true"
  ? describe
  : describe.skip;

describeLive("Aave full historical mainnet replay", () => {
  it("silently indexes every native ID and repeats the fixed finalized head without changes", async () => {
    try {
      const env = loadEnv({
        ...process.env,
        STORAGE_MODE: "memory",
        ENABLE_SCHEDULER: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "false",
        ENABLE_ADMIN_STATUS_REPORTS: "false",
        AAVE_ONCHAIN_ENABLED: "true",
        AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
        UNISWAP_ONCHAIN_ENABLED: "false",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
        LOG_LEVEL: "info"
      });
      const logger = createLogger(env);
      const client = new AaveOnchainClient({
        rpcUrl: env.ethereumRpcUrl,
        metadataEnabled: false
      });
      const adapter = new AaveOnchainGovernanceAdapter(env, client);
      const finalized = await adapter.validateSource();
      // Hold the observed head still so new mainnet activity cannot invalidate
      // the repeat-scan assertions. All logs and state reads still use the RPC.
      jest.spyOn(adapter, "validateSource").mockResolvedValue(finalized);
      const repository = new MemoryGovernanceRepository();
      const notifications = new NoopNotificationService();
      const dispatcher = new ProposalNotificationDispatcher<GovernanceLifecycleEvent>(
        repository, notifications, logger, governanceEventMessage
      );
      const job = new OnchainGovernanceScanJob(
        new EvmGovernanceRegistry([adapter]), repository, notifications, dispatcher, logger
      );

      const baseline = await job.run("aave");
      const count = Number(finalized.proposalCount);
      const decisions = await repository.findDecisionsBySource(adapter.sourceKey);
      expect(count).toBeGreaterThan(0);
      expect(decisions.map((decision) => decision.proposalId)).toEqual(
        Array.from({ length: count }, (_, index) => String(count - 1 - index))
      );
      expect(baseline).toMatchObject({
        status: "success", baselineSeeding: true, decisionsCreated: count,
        notificationSentCount: 0, notificationFailedCount: 0, errors: []
      });
      await expect(repository.findSourceState(adapter.sourceKey)).resolves.toMatchObject({
        baselineStatus: "complete", healthStatus: "healthy",
        cursorBlockNumber: finalized.latestFinalizedBlock.number,
        cursorBlockHash: finalized.latestFinalizedBlock.hash
      });

      for (const decision of decisions) {
        expect(decision.createdTransactionHash).toMatch(/^0x[0-9a-f]{64}$/i);
        expect(decision.aave?.executionScope).toBe("governance-core");
        expect(decision.votingEndedAt).toBeNull();
        if (decision.voteOutcome === "succeeded" || decision.voteOutcome === "defeated") {
          expect(decision.aave?.resultReceivedAt).toEqual(expect.any(String));
          const eventId = createGovernanceLifecycleEventId(decision.id, decision.voteOutcome);
          await expect(repository.findById(eventId)).resolves.toMatchObject({
            notificationReady: true, notificationStatus: "skipped",
            transactionHash: decision.aave?.resultTransactionHash
          });
        }
      }

      const repeated = await job.run("aave");
      expect(repeated).toMatchObject({
        status: "success", baselineSeeding: false, decisionsCreated: 0, decisionsUpdated: 0,
        lifecycleEventsCreated: 0, notificationSentCount: 0, notificationFailedCount: 0, errors: []
      });
      await expect(repository.findDecisionsBySource(adapter.sourceKey)).resolves.toEqual(decisions);
      await expect(repository.countByNotificationStatus("skipped")).resolves.toBe(baseline.lifecycleEventsCreated);
      for (const status of ["pending", "sent", "failed"] as const) {
        await expect(repository.countByNotificationStatus(status)).resolves.toBe(0);
      }
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  }, 30 * 60 * 1_000);
});
