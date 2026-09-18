import { describe, expect, it } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import { AaveForumClient } from "../../src/protocols/aave/aaveForum.client.js";
import { CowForumClient } from "../../src/protocols/cow/cowForum.client.js";
import type {
  DiscourseForumCategory,
  DiscourseForumTopicPage
} from "../../src/protocols/discourse/discourseForum.client.js";
import { LidoForumClient } from "../../src/protocols/lido/lidoForum.client.js";
import { UniswapForumClient } from "../../src/protocols/uniswap/uniswapForum.client.js";
import { errorMessage } from "../../src/utils/errors.js";

interface LiveForumProbe {
  protocol: string;
  baseUrl: string;
  fetchRecentPage(): Promise<DiscourseForumTopicPage>;
  fetchCategories?: () => Promise<DiscourseForumCategory[]>;
}

const describeLive = process.env.RUN_FORUM_E2E === "true" ? describe : describe.skip;

describeLive("live Discourse forum sources", () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "test",
    STORAGE_MODE: "memory",
    DEMO_MODE: "false",
    ENABLE_SCHEDULER: "false",
    ENABLE_TELEGRAM_NOTIFICATIONS: "false",
    ENABLE_ADMIN_STATUS_REPORTS: "false",
    UNISWAP_ONCHAIN_ENABLED: "false",
    UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
    LOG_LEVEL: "silent"
  });
  const lido = new LidoForumClient({
    baseUrl: env.lidoForumBaseUrl,
    apiBaseUrl: env.lidoForumApiBaseUrl
  });
  const aave = new AaveForumClient({
    baseUrl: env.aaveForumBaseUrl,
    apiBaseUrl: env.aaveForumApiBaseUrl
  });
  const uniswap = new UniswapForumClient({
    baseUrl: env.uniswapForumBaseUrl,
    apiBaseUrl: env.uniswapForumApiBaseUrl
  });
  const cow = new CowForumClient({
    baseUrl: env.cowForumBaseUrl,
    apiBaseUrl: env.cowForumApiBaseUrl
  });
  const probes: LiveForumProbe[] = [
    {
      protocol: "lido",
      baseUrl: env.lidoForumBaseUrl,
      fetchRecentPage: () => lido.fetchRecentTopicPage({ page: 0 })
    },
    {
      protocol: "aave",
      baseUrl: env.aaveForumBaseUrl,
      fetchRecentPage: () => aave.fetchRecentTopicPage({ page: 0 }),
      fetchCategories: () => aave.fetchCategories()
    },
    {
      protocol: "uniswap",
      baseUrl: env.uniswapForumBaseUrl,
      fetchRecentPage: () => uniswap.fetchRecentTopicPage({ page: 0 }),
      fetchCategories: () => uniswap.fetchCategories()
    },
    {
      protocol: "cow",
      baseUrl: env.cowForumBaseUrl,
      fetchRecentPage: () => cow.fetchRecentTopicPage({ page: 0 }),
      fetchCategories: () => cow.fetchCategories()
    }
  ];

  it.each(probes)(
    "$protocol returns a valid recent-topic page and public category metadata",
    async (probe) => {
      try {
        const page = await probe.fetchRecentPage();

        expect(page.page).toBe(0);
        expect(page.topics.length).toBeGreaterThan(0);
        expect(typeof page.hasMore).toBe("boolean");
        expect(new Set(page.topics.map((topic) => topic.sourceId)).size).toBe(
          page.topics.length
        );

        for (const topic of page.topics) {
          expect(topic.sourceId).toMatch(/^[1-9]\d*$/);
          expect(topic.title.trim()).not.toBe("");
          expect(topic.publisherName.trim()).not.toBe("");
          expect(topic.sourceUrl.startsWith(`${probe.baseUrl.replace(/\/$/, "")}/t/`)).toBe(
            true
          );
          expect(Number.isFinite(Date.parse(topic.publishedAt))).toBe(true);
        }

        if (probe.fetchCategories) {
          const categories = await probe.fetchCategories();

          expect(categories.length).toBeGreaterThan(0);
          expect(new Set(categories.map((category) => category.id)).size).toBe(
            categories.length
          );
          for (const category of categories) {
            expect(category.path).toMatch(
              new RegExp(`/c/.+/${category.id}/l/latest\\.json$`)
            );
          }
        }
      } catch (error) {
        throw new Error(`${probe.protocol} live forum validation failed: ${errorMessage(error)}`);
      }
    },
    120_000
  );
});
