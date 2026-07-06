import { describe, expect, it, jest } from "@jest/globals";
import { AaveAdapter } from "../../src/protocols/aave/aave.adapter.js";
import { createSilentLogger } from "../helpers/builders.js";

const aaveAllowedPublishers = [
  "LlamaRisk",
  "TokenLogic",
  "Certora",
  "kpk",
  "karpatkey_TokenLogic",
  "AaveLabs",
  "stani"
];

function createAdapterOptions(
  overrides: Partial<ConstructorParameters<typeof AaveAdapter>[0]> = {}
) {
  return {
    enabled: true,
    forumBaseUrl: "https://governance.aave.com",
    forumApiBaseUrl: "https://governance.aave.com",
    allowedPublishers: aaveAllowedPublishers,
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

describe("AaveAdapter", () => {
  it("keeps the real Aave publisher allowlist on the adapter", () => {
    const adapter = new AaveAdapter(createAdapterOptions());

    expect(adapter.publisherAllowlist).toEqual(aaveAllowedPublishers);
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
    const adapter = new AaveAdapter(
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

  it("maps Aave forum topics into raw governance items", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "25170",
            title: "[ARFC] Deploy Aave V4 on Arc",
            slug: "arfc-deploy-aave-v4-on-arc",
            publisherName: "AaveLabs",
            sourceUrl:
              "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
            publishedAt: "2026-06-19T12:00:28.625Z",
            raw: { id: 25170 }
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
    const adapter = new AaveAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledWith({ page: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      protocol: "aave",
      sourceType: "forum",
      sourceId: "25170",
      title: "[ARFC] Deploy Aave V4 on Arc",
      publisherName: "AaveLabs",
      sourceUrl: "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
      publishedAt: "2026-06-19T12:00:28.625Z",
      raw: { id: 25170 }
    });
    expect(new Date(items[0].fetchedAt).toISOString()).toBe(items[0].fetchedAt);
  });

  it("fetches multiple pages until Discourse has no more topics", async () => {
    const client = {
      fetchRecentTopicPage: jest
        .fn()
        .mockResolvedValueOnce({
          page: 0,
          topics: [
            {
              sourceId: "25170",
              title: "Page zero",
              slug: "page-zero",
              publisherName: "AaveLabs",
              sourceUrl: "https://governance.aave.com/t/page-zero/25170",
              publishedAt: "2026-06-19T12:00:28.625Z",
              raw: { id: 25170 }
            }
          ],
          hasMore: true
        })
        .mockResolvedValueOnce({
          page: 1,
          topics: [
            {
              sourceId: "25168",
              title: "Page one",
              slug: "page-one",
              publisherName: "LlamaRisk",
              sourceUrl: "https://governance.aave.com/t/page-one/25168",
              publishedAt: "2026-06-18T20:17:30.736Z",
              raw: { id: 25168 }
            }
          ],
          hasMore: false
        }),
      fetchCategories: jest.fn(async () => []),
      fetchCategoryTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      }))
    };
    const adapter = new AaveAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual(["25170", "25168"]);
  });

  it("stops at the configured max page count and logs an info message", async () => {
    const logger = createSilentLogger();
    const client = {
      fetchRecentTopicPage: jest.fn(async (options: { page: number }) => ({
        page: options.page,
        topics: [
          {
            sourceId: String(25170 + options.page),
            title: `Page ${options.page}`,
            slug: `page-${options.page}`,
            publisherName: "AaveLabs",
            sourceUrl: `https://governance.aave.com/t/page-${options.page}/${25170 + options.page}`,
            publishedAt: "2026-06-19T12:00:28.625Z",
            raw: { id: 25170 + options.page }
          }
        ],
        hasMore: true
      })),
      fetchCategories: jest.fn(async () => []),
      fetchCategoryTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      }))
    };
    const adapter = new AaveAdapter(
      createAdapterOptions({
        maxPages: 2,
        logger,
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual(["25170", "25171"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "aave",
        maxPages: 2,
        fetchedCount: 2
      }),
      "Reached Aave global latest pagination limit before exhausting pages"
    );
  });

  it("uses the configured category page limit for category feeds", async () => {
    const logger = createSilentLogger();
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 10,
          name: "New Market",
          slug: "new-market",
          parentCategoryId: 4,
          path: "/c/governance/new-market/10/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(async (_category: unknown, options: { page: number }) => ({
        page: options.page,
        topics: [
          {
            sourceId: String(25170 + options.page),
            title: `Category page ${options.page}`,
            slug: `category-page-${options.page}`,
            publisherName: "AaveLabs",
            sourceUrl: `https://governance.aave.com/t/category-page-${options.page}/${25170 + options.page}`,
            publishedAt: "2026-06-19T12:00:28.625Z",
            raw: { id: 25170 + options.page }
          }
        ],
        hasMore: true
      }))
    };
    const adapter = new AaveAdapter(
      createAdapterOptions({
        categoryMaxPages: 2,
        logger,
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchCategoryTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual(["25170", "25171"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "aave",
        maxPages: 2,
        categoryId: 10,
        categoryPath: "/c/governance/new-market/10/l/latest.json"
      }),
      "Reached Aave category pagination limit before exhausting pages"
    );
  });

  it("fetches every discovered public category and subcategory page", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 10,
          name: "New Market",
          slug: "new-market",
          parentCategoryId: 4,
          path: "/c/governance/new-market/10/l/latest.json"
        },
        {
          id: 30,
          name: "Finance",
          slug: "finance",
          path: "/c/finance/30/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(async (category: { id: number }) => ({
        page: 0,
        topics: [
          {
            sourceId: category.id === 10 ? "25170" : "25154",
            title: category.id === 10
              ? "[ARFC] Deploy Aave V4 on Arc"
              : "[ARFC] Umbrella Parameter Update",
            slug: category.id === 10
              ? "arfc-deploy-aave-v4-on-arc"
              : "arfc-umbrella-parameter-update",
            publisherName: category.id === 10 ? "AaveLabs" : "TokenLogic",
            sourceUrl: `https://governance.aave.com/t/category-topic/${category.id}`,
            publishedAt: "2026-06-19T12:00:28.625Z",
            raw: { id: category.id }
          }
        ],
        hasMore: false
      }))
    };
    const adapter = new AaveAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchCategories).toHaveBeenCalledTimes(1);
    expect(client.fetchCategoryTopicPage).toHaveBeenCalledTimes(2);
    expect(client.fetchCategoryTopicPage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 10,
        path: "/c/governance/new-market/10/l/latest.json"
      }),
      { page: 0 }
    );
    expect(client.fetchCategoryTopicPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 30,
        path: "/c/finance/30/l/latest.json"
      }),
      { page: 0 }
    );
    expect(items.map((item) => item.sourceId)).toEqual(["25170", "25154"]);
  });

  it("deduplicates topics that appear in both global latest and category feeds", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "25170",
            title: "[ARFC] Deploy Aave V4 on Arc",
            slug: "arfc-deploy-aave-v4-on-arc",
            publisherName: "AaveLabs",
            sourceUrl:
              "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
            publishedAt: "2026-06-19T12:00:28.625Z",
            raw: { feed: "global", id: 25170 }
          }
        ],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 10,
          name: "New Market",
          slug: "new-market",
          parentCategoryId: 4,
          path: "/c/governance/new-market/10/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "25170",
            title: "[ARFC] Deploy Aave V4 on Arc",
            slug: "arfc-deploy-aave-v4-on-arc",
            publisherName: "AaveLabs",
            sourceUrl:
              "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
            publishedAt: "2026-06-19T12:00:28.625Z",
            raw: { feed: "category", id: 25170 }
          }
        ],
        hasMore: false
      }))
    };
    const adapter = new AaveAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: "25170",
      raw: {
        feed: "global"
      }
    });
  });

  it("normalizes raw items through the Aave normalizer", () => {
    const adapter = new AaveAdapter(createAdapterOptions());

    const normalized = adapter.normalize({
      protocol: "aave",
      sourceType: "forum",
      sourceId: "25170",
      title: "[ARFC] Deploy Aave V4 on Arc",
      publisherName: "AaveLabs",
      sourceUrl: "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
      publishedAt: "2026-06-19T12:00:28.625Z",
      fetchedAt: "2026-06-19T13:00:00.000Z",
      raw: { id: 25170 }
    });
    const normalizedWithVolatileRaw = adapter.normalize({
      protocol: "aave",
      sourceType: "forum",
      sourceId: "25170",
      title: "[ARFC] Deploy Aave V4 on Arc",
      publisherName: "AaveLabs",
      sourceUrl: "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
      publishedAt: "2026-06-19T12:00:28.625Z",
      fetchedAt: "2026-06-19T14:00:00.000Z",
      raw: {
        id: 25170,
        views: 999,
        reply_count: 50,
        last_posted_at: "2026-06-20T00:00:00.000Z"
      }
    });
    const normalizedWithChangedTitle = adapter.normalize({
      protocol: "aave",
      sourceType: "forum",
      sourceId: "25170",
      title: "[ARFC] Deploy Aave V4 on Arc - updated",
      publisherName: "AaveLabs",
      sourceUrl: "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
      publishedAt: "2026-06-19T12:00:28.625Z",
      fetchedAt: "2026-06-19T14:00:00.000Z",
      raw: { id: 25170 }
    });

    expect(normalized).toMatchObject({
      id: expect.stringMatching(/^aave_forum_25170_/),
      protocol: "aave",
      sourceType: "forum",
      sourceId: "25170"
    });
    expect(normalized.rawHash).toBe(normalizedWithVolatileRaw.rawHash);
    expect(normalized.rawHash).not.toBe(normalizedWithChangedTitle.rawHash);
  });
});
