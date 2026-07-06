import { describe, expect, it, jest } from "@jest/globals";
import { UniswapAdapter } from "../../src/protocols/uniswap/uniswap.adapter.js";
import { createSilentLogger } from "../helpers/builders.js";

const uniswapAllowedPublishers = [
  "haydenadams",
  "eek637",
  "devinwalsh",
  "kenneth",
  "nataliara",
  "GFXlabs",
  "UniswapFoundation"
];

function createAdapterOptions(
  overrides: Partial<ConstructorParameters<typeof UniswapAdapter>[0]> = {}
) {
  return {
    enabled: true,
    forumBaseUrl: "https://gov.uniswap.org",
    forumApiBaseUrl: "https://gov.uniswap.org",
    allowedPublishers: uniswapAllowedPublishers,
    maxPages: 5,
    categoryMaxPages: 2,
    logger: createSilentLogger(),
    client: {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => []),
      fetchCategoryTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      }))
    } as never,
    ...overrides
  };
}

describe("UniswapAdapter", () => {
  it("keeps the real Uniswap publisher allowlist on the adapter", () => {
    const adapter = new UniswapAdapter(createAdapterOptions());

    expect(adapter.publisherAllowlist).toEqual(uniswapAllowedPublishers);
  });

  it("returns no items and does not fetch when disabled", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => {
        throw new Error("should not fetch");
      }),
      fetchCategories: jest.fn(async () => {
        throw new Error("should not fetch");
      }),
      fetchCategoryTopicPage: jest.fn(async () => {
        throw new Error("should not fetch");
      })
    };
    const adapter = new UniswapAdapter(
      createAdapterOptions({
        enabled: false,
        client: client as never
      })
    );

    await expect(adapter.fetchRecent()).resolves.toEqual([]);
    expect(client.fetchRecentTopicPage).not.toHaveBeenCalled();
    expect(client.fetchCategories).not.toHaveBeenCalled();
    expect(client.fetchCategoryTopicPage).not.toHaveBeenCalled();
  });

  it("maps Uniswap forum topics into raw governance items", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "26127",
            title: "[RFC] - Update Crosschain Governance Parameters",
            slug: "rfc-update-crosschain-governance-parameters",
            publisherName: "eek637",
            sourceUrl:
              "https://gov.uniswap.org/t/rfc-update-crosschain-governance-parameters/26127",
            publishedAt: "2026-06-19T17:04:30.632Z",
            raw: { id: 26127 }
          }
        ],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => []),
      fetchCategoryTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      }))
    };
    const adapter = new UniswapAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledWith({ page: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      protocol: "uniswap",
      sourceType: "forum",
      sourceId: "26127",
      title: "[RFC] - Update Crosschain Governance Parameters",
      publisherName: "eek637",
      sourceUrl:
        "https://gov.uniswap.org/t/rfc-update-crosschain-governance-parameters/26127",
      publishedAt: "2026-06-19T17:04:30.632Z",
      raw: { id: 26127 }
    });
    expect(new Date(items[0].fetchedAt).toISOString()).toBe(items[0].fetchedAt);
  });

  it("fetches global latest plus every discovered public category", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "26127",
            title: "Global topic",
            slug: "global-topic",
            publisherName: "eek637",
            sourceUrl: "https://gov.uniswap.org/t/global-topic/26127",
            publishedAt: "2026-06-19T17:04:30.632Z",
            raw: { feed: "global", id: 26127 }
          }
        ],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 5,
          name: "Requests for Comment",
          slug: "proposal-discussion",
          path: "/c/proposal-discussion/5/l/latest.json"
        },
        {
          id: 8,
          name: "Governance-Meta",
          slug: "governance-meta",
          path: "/c/governance-meta/8/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(async (category: { id: number }) => ({
        page: 0,
        topics: [
          {
            sourceId: category.id === 5 ? "26123" : "26036",
            title: category.id === 5 ? "RFC topic" : "Delegate platform",
            slug: category.id === 5 ? "rfc-topic" : "delegate-platform",
            publisherName: category.id === 5 ? "Devin" : "GFX Labs",
            sourceUrl: `https://gov.uniswap.org/t/category-topic/${category.id}`,
            publishedAt: "2026-06-14T03:00:12.974Z",
            raw: { id: category.id }
          }
        ],
        hasMore: false
      }))
    };
    const adapter = new UniswapAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchCategories).toHaveBeenCalledTimes(1);
    expect(client.fetchCategoryTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual(["26127", "26123", "26036"]);
  });

  it("deduplicates topics that appear in both global latest and category feeds", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "26127",
            title: "Global topic",
            slug: "global-topic",
            publisherName: "eek637",
            sourceUrl: "https://gov.uniswap.org/t/global-topic/26127",
            publishedAt: "2026-06-19T17:04:30.632Z",
            raw: { feed: "global", id: 26127 }
          }
        ],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 5,
          name: "Requests for Comment",
          slug: "proposal-discussion",
          path: "/c/proposal-discussion/5/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "26127",
            title: "Category duplicate",
            slug: "category-duplicate",
            publisherName: "eek637",
            sourceUrl: "https://gov.uniswap.org/t/category-duplicate/26127",
            publishedAt: "2026-06-19T17:04:30.632Z",
            raw: { feed: "category", id: 26127 }
          }
        ],
        hasMore: false
      }))
    };
    const adapter = new UniswapAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: "26127",
      raw: {
        feed: "global"
      }
    });
  });

  it("uses configured page limits and logs info messages", async () => {
    const logger = createSilentLogger();
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 5,
          name: "Requests for Comment",
          slug: "proposal-discussion",
          path: "/c/proposal-discussion/5/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(async (_category: unknown, options: { page: number }) => ({
        page: options.page,
        topics: [
          {
            sourceId: String(26120 + options.page),
            title: `Category page ${options.page}`,
            slug: `category-page-${options.page}`,
            publisherName: "eek637",
            sourceUrl: `https://gov.uniswap.org/t/category-page-${options.page}/${26120 + options.page}`,
            publishedAt: "2026-06-19T17:04:30.632Z",
            raw: { id: 26120 + options.page }
          }
        ],
        hasMore: true
      }))
    };
    const adapter = new UniswapAdapter(
      createAdapterOptions({
        categoryMaxPages: 2,
        logger,
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchCategoryTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual(["26120", "26121"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "uniswap",
        maxPages: 2,
        categoryId: 5,
        categoryPath: "/c/proposal-discussion/5/l/latest.json"
      }),
      "Reached Uniswap category pagination limit before exhausting pages"
    );
  });

  it("normalizes raw items through the Uniswap normalizer", () => {
    const adapter = new UniswapAdapter(createAdapterOptions());

    const normalized = adapter.normalize({
      protocol: "uniswap",
      sourceType: "forum",
      sourceId: "26127",
      title: "[RFC] - Update Crosschain Governance Parameters",
      publisherName: "eek637",
      sourceUrl:
        "https://gov.uniswap.org/t/rfc-update-crosschain-governance-parameters/26127",
      publishedAt: "2026-06-19T17:04:30.632Z",
      fetchedAt: "2026-06-19T18:00:00.000Z",
      raw: { id: 26127 }
    });
    const normalizedWithChangedTitle = adapter.normalize({
      protocol: "uniswap",
      sourceType: "forum",
      sourceId: "26127",
      title: "[RFC] - Update Crosschain Governance Parameters - updated",
      publisherName: "eek637",
      sourceUrl:
        "https://gov.uniswap.org/t/rfc-update-crosschain-governance-parameters/26127",
      publishedAt: "2026-06-19T17:04:30.632Z",
      fetchedAt: "2026-06-19T19:00:00.000Z",
      raw: { id: 26127 }
    });

    expect(normalized).toMatchObject({
      id: expect.stringMatching(/^uniswap_forum_26127_/),
      protocol: "uniswap",
      sourceType: "forum",
      sourceId: "26127"
    });
    expect(normalized.rawHash).not.toBe(normalizedWithChangedTitle.rawHash);
  });
});
