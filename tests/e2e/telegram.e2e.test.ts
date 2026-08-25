import { describe, expect, it } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import { telegramTestNotificationFixtures } from "../../src/demoFixtures/telegramNotification.fixture.js";
import {
  createTelegramRecipientKey,
  ProposalNotificationDispatcher,
  TelegramNotificationService
} from "../../src/notifications/index.js";
import { normalizeAaveForumItem } from "../../src/protocols/aave/aave.normalizer.js";
import { normalizeCowForumItem } from "../../src/protocols/cow/cow.normalizer.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import type { RawGovernanceItem } from "../../src/protocols/types.js";
import { normalizeUniswapForumItem } from "../../src/protocols/uniswap/uniswap.normalizer.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
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
});
