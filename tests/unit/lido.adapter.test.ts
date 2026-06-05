import { describe, expect, it, jest } from "@jest/globals";
import { LidoAdapter } from "../../src/protocols/lido/lido.adapter.js";
import { createSilentLogger } from "../helpers/builders.js";

describe("LidoAdapter", () => {
  it("returns no items and does not fetch when disabled", async () => {
    const client = {
      fetchRecentTopics: jest.fn(async () => {
        throw new Error("should not fetch");
      })
    };
    const adapter = new LidoAdapter({
      enabled: false,
      forumBaseUrl: "https://research.lido.fi",
      forumApiBaseUrl: "https://research.lido.fi",
      allowedPublishers: ["Allowed Publisher"],
      logger: createSilentLogger(),
      client: client as never
    });

    await expect(adapter.fetchRecent()).resolves.toEqual([]);
    expect(client.fetchRecentTopics).not.toHaveBeenCalled();
  });

  it("maps Lido forum topics into raw governance items", async () => {
    const client = {
      fetchRecentTopics: jest.fn(async () => [
        {
          sourceId: "1001",
          title: "Allowed Lido Proposal",
          slug: "allowed-lido-proposal",
          publisherName: "Allowed Publisher",
          sourceUrl: "https://research.lido.fi/t/allowed-lido-proposal/1001",
          publishedAt: "2026-05-01T10:00:00.000Z",
          raw: { id: 1001 }
        }
      ])
    };
    const adapter = new LidoAdapter({
      enabled: true,
      forumBaseUrl: "https://research.lido.fi",
      forumApiBaseUrl: "https://research.lido.fi",
      allowedPublishers: ["Allowed Publisher"],
      logger: createSilentLogger(),
      client: client as never
    });

    const items = await adapter.fetchRecent();

    expect(client.fetchRecentTopics).toHaveBeenCalledTimes(1);
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

  it("normalizes raw items through the Lido normalizer", () => {
    const adapter = new LidoAdapter({
      enabled: true,
      forumBaseUrl: "https://research.lido.fi",
      forumApiBaseUrl: "https://research.lido.fi",
      allowedPublishers: ["Allowed Publisher"],
      logger: createSilentLogger(),
      client: { fetchRecentTopics: jest.fn() } as never
    });

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
      sourceId: "1001",
      status: "new"
    });
  });
});
