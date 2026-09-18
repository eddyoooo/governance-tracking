import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import { telegramTestNotificationFixtures } from "../../src/demoFixtures/telegramNotification.fixture.js";
import {
  createTelegramRecipientKey,
  ProposalNotificationDispatcher,
  TelegramNotificationService
} from "../../src/notifications/index.js";
import { createGovernanceDecisionId } from "../../src/onchain/governanceDecision.js";
import { governanceEventMessage } from "../../src/onchain/governanceNotifications.js";
import type { GovernanceDecisionObservation } from "../../src/onchain/types.js";
import { normalizeAaveForumItem } from "../../src/protocols/aave/aave.normalizer.js";
import { normalizeCowForumItem } from "../../src/protocols/cow/cow.normalizer.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import type { RawGovernanceItem } from "../../src/protocols/types.js";
import { normalizeUniswapForumItem } from "../../src/protocols/uniswap/uniswap.normalizer.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemoryGovernanceRepository } from "../../src/storage/governance.repository.js";
import {
  createRawGovernanceItem,
  createSilentLogger
} from "../helpers/builders.js";

const telegramE2EEnv = loadEnv({
  ...process.env,
  NODE_ENV: "test",
  STORAGE_MODE: "memory",
  DEMO_MODE: "true",
  ENABLE_SCHEDULER: "false",
  LOG_LEVEL: "silent"
});
const describeTelegramE2E =
  telegramE2EEnv.telegramE2EEnabled && process.env.RUN_TELEGRAM_E2E === "true"
  ? describe
  : describe.skip;

describeTelegramE2E("Telegram direct-message E2E", () => {
  it(
    "sends real governance notifications from different publishers to the configured admin only",
    async () => {
      const env = loadEnv({
        ...process.env,
        NODE_ENV: "test",
        STORAGE_MODE: "memory",
        DEMO_MODE: "true",
        ENABLE_SCHEDULER: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "true",
        LOG_LEVEL: "silent"
      });
      const repository = new MemoryProposalRepository();
      const notificationService = new TelegramNotificationService({
        botToken: env.telegramBotToken,
        allowedUserIds: [env.telegramAdminUserId],
        logger: createSilentLogger()
      });
      const dispatcher = new ProposalNotificationDispatcher(
        repository,
        notificationService,
        createSilentLogger()
      );
      const uniquePublisherCount = new Set(
        telegramTestNotificationFixtures.map((fixture) => fixture.publisherName)
      ).size;

      expect(env.telegramAdminUserId).toBe("1549323073");
      expect(notificationService.getRecipients()).toEqual([
        {
          key: createTelegramRecipientKey("1549323073"),
          maskedId: "******3073"
        }
      ]);
      expect(uniquePublisherCount).toBeGreaterThan(1);

      const proposals = telegramTestNotificationFixtures.map((fixture) => {
        const rawItem = createRawGovernanceItem({
          sourceId: `telegram-e2e-${fixture.sourceId}-${Date.now()}`,
          protocol: fixture.protocol,
          sourceType: fixture.sourceType as "forum",
          publisherName: fixture.publisherName,
          title: fixture.title,
          sourceUrl: fixture.sourceUrl,
          publishedAt: fixture.publishedAt,
          raw: {
            kind: "telegram-e2e",
            sourceId: fixture.sourceId,
            publisherName: fixture.publisherName,
            title: fixture.title,
            sourceUrl: fixture.sourceUrl,
            publishedAt: fixture.publishedAt
          }
        }) as RawGovernanceItem;

        if (fixture.protocol === "aave") {
          return normalizeAaveForumItem(rawItem);
        }

        if (fixture.protocol === "uniswap") {
          return normalizeUniswapForumItem(rawItem);
        }

        if (fixture.protocol === "cow") {
          return normalizeCowForumItem(rawItem);
        }

        return normalizeLidoForumItem(rawItem);
      });

      for (const [index, proposal] of proposals.entries()) {
        const stored = await repository.upsert(proposal, {
          notificationStatusForNew: "pending"
        });

        await expect(
          dispatcher.notifyNewProposal(stored.proposal)
        ).resolves.toEqual({
          status: "sent"
        });

        if (index < proposals.length - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, env.telegramTestSendDelayMs)
          );
        }
      }

      for (const proposal of proposals) {
        await expect(repository.findById(proposal.id)).resolves.toMatchObject({
          notificationStatus: "sent"
        });
      }
    },
    telegramTestNotificationFixtures.length *
        telegramE2EEnv.telegramTestSendDelayMs +
      30_000
  );

  it(
    "sends a real Uniswap vote-result notification to the configured admin only",
    async () => {
      const env = loadEnv({
        ...process.env,
        NODE_ENV: "test",
        STORAGE_MODE: "memory",
        DEMO_MODE: "true",
        ENABLE_SCHEDULER: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "true",
        LOG_LEVEL: "silent"
      });
      const fixture = JSON.parse(
        await readFile(
          new URL("../fixtures/uniswap/onchain-proposal-100.json", import.meta.url),
          "utf8"
        )
      ) as {
        observedAtBlock: number;
        governorAddress: string;
        proposal: {
          id: string;
          proposer: string;
          title: string;
          startBlock: number;
          endBlock: number;
          votingEndedAt: string;
          forVotes: string;
          againstVotes: string;
          abstainVotes: string;
          firstAction: {
            target: string;
            value: string;
            signature: string;
            calldata: string;
          };
          sourceUrl: string;
        };
        events: Array<{
          blockNumber: number;
          transactionHash: string;
        }>;
      };
      const proposal = fixture.proposal;
      const decisionId = createGovernanceDecisionId({
        protocol: "uniswap",
        chainId: 1,
        governorAddress: fixture.governorAddress,
        proposalId: proposal.id
      });
      const base: Omit<
        GovernanceDecisionObservation,
        "status" | "voteOutcome" | "executionOutcome" | "forVotes" | "againstVotes" | "abstainVotes" | "lastObservedBlockNumber" | "rawHash"
      > = {
        id: decisionId,
        sourceKey: `uniswap:onchain:1:${fixture.governorAddress.toLowerCase()}`,
        protocol: "uniswap",
        sourceType: "onchain",
        chainId: 1,
        governorAddress: fixture.governorAddress,
        proposalId: proposal.id,
        proposer: proposal.proposer,
        title: proposal.title,
        description: `# ${proposal.title}`,
        sourceUrl: proposal.sourceUrl,
        startBlock: proposal.startBlock,
        endBlock: proposal.endBlock,
        eta: null,
        actions: [{ index: 0, ...proposal.firstAction }],
        createdBlockNumber: fixture.events[0].blockNumber,
        createdTransactionHash: fixture.events[0].transactionHash
      };
      const repository = new MemoryGovernanceRepository();
      const notificationService = new TelegramNotificationService({
        botToken: env.telegramBotToken,
        allowedUserIds: [env.telegramAdminUserId],
        logger: createSilentLogger()
      });
      const dispatcher = new ProposalNotificationDispatcher(
        repository,
        notificationService,
        createSilentLogger(),
        governanceEventMessage
      );

      expect(env.telegramAdminUserId).toBe("1549323073");
      expect(notificationService.getRecipients()).toEqual([
        {
          key: createTelegramRecipientKey("1549323073"),
          maskedId: "******3073"
        }
      ]);

      await repository.upsertDecision(
        {
          ...base,
          status: "active",
          voteOutcome: "pending",
          executionOutcome: "not_started",
          forVotes: "0",
          againstVotes: "0",
          abstainVotes: "0",
          lastObservedBlockNumber: proposal.startBlock + 1,
          rawHash: "telegram-e2e-active"
        },
        { notificationStatusForNewEvents: "skipped" }
      );
      const result = await repository.upsertDecision(
        {
          ...base,
          status: "succeeded",
          voteOutcome: "succeeded",
          executionOutcome: "awaiting_queue",
          votingEndedAt: proposal.votingEndedAt,
          forVotes: proposal.forVotes,
          againstVotes: proposal.againstVotes,
          abstainVotes: proposal.abstainVotes,
          lastObservedBlockNumber: proposal.endBlock + 1,
          rawHash: "telegram-e2e-succeeded"
        },
        { notificationStatusForNewEvents: "pending" }
      );
      const voteResult = result.lifecycleEventsCreated[0];

      expect(result.lifecycleEventsCreated).toHaveLength(1);
      expect(voteResult).toMatchObject({
        transition: "succeeded",
        notificationStatus: "pending",
        message: {
          heading: "ON-CHAIN GOVERNANCE VOTE RESULT",
          title: "Activate v4 Protocol Fees (Part 1/2)",
          fields: expect.arrayContaining([
            { label: "Voting ended", value: "2026-07-25 07:29 UTC" }
          ])
        }
      });
      await new Promise((resolve) =>
        setTimeout(resolve, env.telegramTestSendDelayMs)
      );
      await expect(dispatcher.notifyNewProposal(voteResult)).resolves.toEqual({
        status: "sent"
      });
      await expect(repository.findById(voteResult.id)).resolves.toMatchObject({
        notificationStatus: "sent",
        notificationDeliveries: {
          [createTelegramRecipientKey("1549323073")]: {
            status: "sent",
            recipientMaskedId: "******3073"
          }
        }
      });
    },
    telegramE2EEnv.telegramTestSendDelayMs + 30_000
  );
});
