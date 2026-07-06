import { describe, expect, it, jest } from "@jest/globals";
import { LidoAdapter } from "../../src/protocols/lido/lido.adapter.js";
import { createRawGovernanceItem, createSilentLogger } from "../helpers/builders.js";

function createAdapterOptions(overrides: Partial<ConstructorParameters<typeof LidoAdapter>[0]> = {}) {
  return {
    enabled: true,
    forumBaseUrl: "https://research.lido.fi",
    forumApiBaseUrl: "https://research.lido.fi",
    allowedPublishers: ["Allowed Publisher"],
    maxPages: 5,
    logger: createSilentLogger(),
    client: {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [],
        hasMore: false
      }))
    } as never,
    ...overrides
  };
}

describe("LidoAdapter", () => {
  it("returns no items and does not fetch when disabled", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => {
        throw new Error("should not fetch");
      })
    };
    const adapter = new LidoAdapter(
      createAdapterOptions({
        enabled: false,
        client: client as never
      })
    );

    await expect(adapter.fetchRecent()).resolves.toEqual([]);
    expect(client.fetchRecentTopicPage).not.toHaveBeenCalled();
  });

  it("maps Lido forum topics into raw governance items", async () => {
    const client = {
      fetchRecentTopicPage: jest.fn(async () => ({
        page: 0,
        topics: [
          {
            sourceId: "1001",
            title: "Allowed Lido Proposal",
            slug: "allowed-lido-proposal",
            publisherName: "Allowed Publisher",
            sourceUrl: "https://research.lido.fi/t/allowed-lido-proposal/1001",
            publishedAt: "2026-05-01T10:00:00.000Z",
            raw: { id: 1001 }
          }
        ],
        hasMore: false
      }))
    };
    const adapter = new LidoAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledWith({ page: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      protocol: "lido",
      sourceType: "forum",
      sourceId: "1001",
      title: "Allowed Lido Proposal",
      publisherName: "Allowed Publisher",
      sourceUrl: "https://research.lido.fi/t/allowed-lido-proposal/1001",
      publishedAt: "2026-05-01T10:00:00.000Z",
      raw: { id: 1001 }
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
              sourceId: "1001",
              title: "Page zero",
              slug: "page-zero",
              publisherName: "Allowed Publisher",
              sourceUrl: "https://research.lido.fi/t/page-zero/1001",
              publishedAt: "2026-05-01T10:00:00.000Z",
              raw: { id: 1001 }
            }
          ],
          hasMore: true
        })
        .mockResolvedValueOnce({
          page: 1,
          topics: [
            {
              sourceId: "1002",
              title: "Page one",
              slug: "page-one",
              publisherName: "Allowed Publisher",
              sourceUrl: "https://research.lido.fi/t/page-one/1002",
              publishedAt: "2026-05-02T10:00:00.000Z",
              raw: { id: 1002 }
            }
          ],
          hasMore: false
        })
    };
    const adapter = new LidoAdapter(
      createAdapterOptions({
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual(["1001", "1002"]);
  });

  it("stops at the configured max page count and logs an info message", async () => {
    const logger = createSilentLogger();
    const client = {
      fetchRecentTopicPage: jest.fn(async (options: { page: number }) => ({
        page: options.page,
        topics: [
          {
            sourceId: String(1000 + options.page),
            title: `Page ${options.page}`,
            slug: `page-${options.page}`,
            publisherName: "Allowed Publisher",
            sourceUrl: `https://research.lido.fi/t/page-${options.page}/${1000 + options.page}`,
            publishedAt: "2026-05-01T10:00:00.000Z",
            raw: { id: 1000 + options.page }
          }
        ],
        hasMore: true
      }))
    };
    const adapter = new LidoAdapter(
      createAdapterOptions({
        maxPages: 2,
        logger,
        client: client as never
      })
    );

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopicPage).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.sourceId)).toEqual(["1000", "1001"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "lido",
        maxPages: 2,
        fetchedCount: 2
      }),
      "Reached Lido proposal pagination limit before exhausting pages"
    );
  });

  it("normalizes raw items through the Lido normalizer", () => {
    const adapter = new LidoAdapter(createAdapterOptions());

    const normalized = adapter.normalize({
      protocol: "lido",
      sourceType: "forum",
      sourceId: "1001",
      title: "Allowed Lido Proposal",
      publisherName: "Allowed Publisher",
      sourceUrl: "https://research.lido.fi/t/allowed-lido-proposal/1001",
      publishedAt: "2026-05-01T10:00:00.000Z",
      fetchedAt: "2026-05-03T10:00:00.000Z",
      raw: { id: 1001 }
    });

    expect(normalized).toMatchObject({
      id: expect.stringMatching(/^lido_forum_1001_/),
      protocol: "lido",
      sourceType: "forum",
      sourceId: "1001"
    });
  });
});
