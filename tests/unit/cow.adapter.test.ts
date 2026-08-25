import { describe, expect, it, jest } from "@jest/globals";
import { CowAdapter } from "../../src/protocols/cow/cow.adapter.js";
import { createSilentLogger } from "../helpers/builders.js";

const cowAllowedPublishers = [
  "moo_keeper",
  "felixhenneke",
  "middleway.eth"
];

function createCowTopic(sourceId: string, title = `CoW topic ${sourceId}`) {
  return {
    sourceId,
    title,
    slug: `cow-topic-${sourceId}`,
    publisherName: "MooKeeper",
    sourceUrl: `https://forum.cow.fi/t/cow-topic-${sourceId}/${sourceId}`,
    publishedAt: "2026-08-04T12:47:10.847Z",
    raw: {
      topic: { id: Number(sourceId) },
      publisher: { username: "moo_keeper", name: "MooKeeper" }
    }
  };
}

function createAdapterOptions(
  overrides: Partial<ConstructorParameters<typeof CowAdapter>[0]> = {}
) {
  return {
    enabled: true,
    forumBaseUrl: "https://forum.cow.fi",
    forumApiBaseUrl: "https://forum.cow.fi",
    allowedPublishers: cowAllowedPublishers,
    maxPages: 10,
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

describe("CowAdapter", () => {
  it("exposes the CoW protocol metadata and configured allowlist", () => {
    const adapter = new CowAdapter(createAdapterOptions());

    expect(adapter).toMatchObject({
      protocol: "cow",
      enabled: true,
      publisherAllowlist: cowAllowedPublishers,
      source: {
        protocol: "cow",
        type: "forum",
        name: "CoW DAO Forum",
        baseUrl: "https://forum.cow.fi"
      }
    });
  });

  it("does not make source requests when disabled", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(),
      fetchCategories: jest.fn(),
      fetchCategoryTopicPage: jest.fn()
    };
    const adapter = new CowAdapter(
      createAdapterOptions({ enabled: false, client: client as never })
    );

    await expect(adapter.fetchRecent()).resolves.toEqual([]);
    expect(client.fetchRecentTopicPage).not.toHaveBeenCalled();
    expect(client.fetchCategories).not.toHaveBeenCalled();
    expect(client.fetchCategoryTopicPage).not.toHaveBeenCalled();
  });

  it("collects global and every discovered category while deduplicating overlaps", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [createCowTopic("3527")],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 6,
          name: "Governance",
          slug: "cow-improvement-proposals-cip",
          path: "/c/cow-improvement-proposals-cip/6/l/latest.json"
        },
        {
          id: 27,
          name: "Announcements",
          slug: "announcements",
          path: "/c/announcements/27/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(async (category: { id: number }) => ({
        page: 0,
        topics:
          category.id === 6
            ? [createCowTopic("3520"), createCowTopic("3527", "Duplicate")]
            : [createCowTopic("3510")],
        hasMore: false
      }))
    };
    const adapter = new CowAdapter(
      createAdapterOptions({ client: client as never })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchCategories).toHaveBeenCalledTimes(1);
    expect(client.fetchCategoryTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual([
      "3527",
      "3520",
      "3510"
    ]);
    expect(items[0]).toMatchObject({
      protocol: "cow",
      sourceType: "forum",
      title: "CoW topic 3527",
      publisherName: "MooKeeper"
    });
    expect(new Date(items[0].fetchedAt).toISOString()).toBe(items[0].fetchedAt);
  });

  it("honors global and category page ceilings and reports both limits", async () => {
    const logger = createSilentLogger();
    const client = {
      fetchRecentTopicPage: jest.fn(async ({ page }: { page: number }) => ({
        page,
        topics: [createCowTopic(String(3500 + page))],
        hasMore: true
      })),
      fetchCategories: jest.fn(async () => [
        {
          id: 6,
          name: "Governance",
          slug: "cow-improvement-proposals-cip",
          path: "/c/cow-improvement-proposals-cip/6/l/latest.json"
        }
      ]),
      fetchCategoryTopicPage: jest.fn(
        async (_category: unknown, { page }: { page: number }) => ({
          page,
          topics: [createCowTopic(String(3600 + page))],
          hasMore: true
        })
      )
    };
    const adapter = new CowAdapter(
      createAdapterOptions({
        maxPages: 2,
        categoryMaxPages: 1,
        client: client as never,
        logger
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledTimes(2);
    expect(client.fetchCategoryTopicPage).toHaveBeenCalledTimes(1);
    expect(items.map((item) => item.sourceId)).toEqual([
      "3500",
      "3501",
      "3600"
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "cow", maxPages: 2 }),
      "Reached CoW global latest pagination limit before exhausting pages"
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "cow", maxPages: 1, categoryId: 6 }),
      "Reached CoW category pagination limit before exhausting pages"
    );
  });

  it("preserves usable global data when category discovery fails", async () => {
    const logger = createSilentLogger();
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [createCowTopic("3527")],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => {
        throw new Error("site.json unavailable");
      }),
      fetchCategoryTopicPage: jest.fn()
    };
    const adapter = new CowAdapter(
      createAdapterOptions({ client: client as never, logger })
    );

    await expect(adapter.fetchRecent()).resolves.toEqual([
      expect.objectContaining({ sourceId: "3527" })
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "cow",
        failedFeedCount: 1,
        successfulFeedCount: 1
      }),
      "CoW forum fetch completed with partial feed failures"
    );
  });

  it("continues through one failed category and retains successful feeds", async () => {
    const logger = createSilentLogger();
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [createCowTopic("3527")],
        hasMore: false
      })),
      fetchCategories: jest.fn(async () => [
        { id: 6, name: "Governance", slug: "governance", path: "/six" },
        { id: 27, name: "Announcements", slug: "announcements", path: "/twenty-seven" }
      ]),
      fetchCategoryTopicPage: jest.fn(async (category: { id: number }) => {
        if (category.id === 6) {
          throw new Error("category unavailable");
        }

        return {
          page: 0,
          topics: [createCowTopic("3526")],
          hasMore: false
        };
      })
    };
    const adapter = new CowAdapter(
      createAdapterOptions({ client: client as never, logger })
    );

    await expect(adapter.fetchRecent()).resolves.toEqual([
      expect.objectContaining({ sourceId: "3527" }),
      expect.objectContaining({ sourceId: "3526" })
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "cow",
        failedFeedCount: 1,
        successfulFeedCount: 2
      }),
      "CoW forum fetch completed with partial feed failures"
    );
  });

  it("uses category data when global latest is unavailable", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => {
        throw new Error("global unavailable");
      }),
      fetchCategories: jest.fn(async () => [
        { id: 6, name: "Governance", slug: "governance", path: "/six" }
      ]),
      fetchCategoryTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [createCowTopic("3520")],
        hasMore: false
      }))
    };
    const adapter = new CowAdapter(
      createAdapterOptions({ client: client as never })
    );

    await expect(adapter.fetchRecent()).resolves.toEqual([
      expect.objectContaining({ sourceId: "3520" })
    ]);
  });

  it("fails clearly when no global or category feed can be read", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => {
        throw new Error("global unavailable");
      }),
      fetchCategories: jest.fn(async () => {
        throw "category discovery unavailable";
      }),
      fetchCategoryTopicPage: jest.fn()
    };
    const adapter = new CowAdapter(
      createAdapterOptions({ client: client as never })
    );

    await expect(adapter.fetchRecent()).rejects.toThrow(
      "CoW forum fetch failed because no governance feed could be read: global latest: global unavailable; category discovery: category discovery unavailable"
    );
    expect(client.fetchCategoryTopicPage).not.toHaveBeenCalled();
  });

  it("normalizes CoW items with stable identity and meaningful content hashes", () => {
    const adapter = new CowAdapter(createAdapterOptions());
    const item = {
      protocol: "cow",
      sourceType: "forum" as const,
      sourceId: "3520",
      title: "CIP-Draft: Penalty Cap Redesign",
      publisherName: "felixhenneke",
      sourceUrl: "https://forum.cow.fi/t/cip-draft-penalty-cap-redesign/3520",
      publishedAt: "2026-07-30T22:00:49.071Z",
      fetchedAt: "2026-08-05T08:00:00.000Z",
      raw: { topic: { id: 3520 } }
    };
    const normalized = adapter.normalize(item);
    const changed = adapter.normalize({ ...item, title: `${item.title} updated` });

    expect(normalized).toMatchObject({
      id: expect.stringMatching(/^cow_forum_3520_/),
      protocol: "cow",
      sourceType: "forum",
      sourceId: "3520"
    });
    expect(normalized.rawHash).not.toBe(changed.rawHash);
  });
});
