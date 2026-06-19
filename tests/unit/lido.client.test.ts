import { readFile } from "node:fs/promises";
import { describe, expect, it, jest } from "@jest/globals";
import {
  LidoForumClient,
  lidoRecentTopicsResponseSchema
} from "../../src/protocols/lido/lidoForum.client.js";

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/lido/${name}`, import.meta.url), "utf8")
  ) as unknown;
}

function jsonFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
}

describe("LidoForumClient", () => {
  it("validates recent topic fixture payloads with Zod", async () => {
    const payload = await loadFixture("recent-topics.json");

    expect(lidoRecentTopicsResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("maps recent topics to forum topic records", async () => {
    const payload = await loadFixture("recent-topics.json");
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload)
    });

    const topics = await client.fetchRecentTopics();

    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({
      sourceId: "1001",
      title: "Allowed Lido Proposal",
      publisherName: "Allowed Publisher",
      sourceUrl: "https://research.lido.fi/t/allowed-lido-proposal/1001"
    });
    expect(topics[0].publishedAt).toBe("2026-05-01T10:00:00.000Z");
    expect(topics[0].raw).toMatchObject({
      topic: {
        id: 1001
      },
      publisher: {
        id: 1,
        name: "Allowed Publisher"
      }
    });
  });

  it("requests the configured recent topics page with JSON headers", async () => {
    const payload = await loadFixture("empty-response.json");
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi/",
      apiBaseUrl: "https://research.lido.fi/",
      fetchImpl
    });

    await client.fetchRecentTopics({ page: 3 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://research.lido.fi/c/proposals/9/l/latest.json?page=3");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    });
  });

  it("reports whether a recent topics page has more pages", async () => {
    const payload = await loadFixture("recent-topics.json");
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch({
        ...(payload as Record<string, unknown>),
        topic_list: {
          ...((payload as { topic_list: Record<string, unknown> }).topic_list),
          more_topics_url: "/c/proposals/9/l/latest?page=1",
          per_page: 30
        }
      })
    });

    const page = await client.fetchRecentTopicPage();

    expect(page).toMatchObject({
      page: 0,
      hasMore: true,
      moreTopicsUrl: "/c/proposals/9/l/latest?page=1"
    });
    expect(page.topics).toHaveLength(2);
  });

  it("prefers the original poster when multiple posters are present", async () => {
    const payload = {
      users: [
        { id: 1, username: "recent", name: "Recent Poster" },
        { id: 2, username: "original", name: "Original Publisher" }
      ],
      topic_list: {
        topics: [
          {
            id: 55,
            title: "Original poster topic",
            slug: "original-poster-topic",
            created_at: "2026-05-01T10:00:00.000Z",
            posters: [
              { user_id: 1, description: "Most Recent Poster" },
              { user_id: 2, description: "Original Poster" }
            ]
          }
        ]
      }
    };
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload)
    });

    const topics = await client.fetchRecentTopics();

    expect(topics[0].publisherName).toBe("Original Publisher");
  });

  it("falls back from display name to username, last poster, and unknown", async () => {
    const payload = {
      users: [{ id: 1, username: "username-only", name: null }],
      topic_list: {
        topics: [
          {
            id: 1,
            title: "Username fallback",
            slug: "username-fallback",
            created_at: "2026-05-01T10:00:00.000Z",
            posters: [{ user_id: 1, description: "Original Poster" }]
          },
          {
            id: 2,
            title: "Last poster fallback",
            slug: "last-poster-fallback",
            created_at: "2026-05-02T10:00:00.000Z",
            last_poster_username: "last-poster"
          },
          {
            id: 3,
            title: "Unknown fallback",
            slug: "unknown-fallback",
            created_at: "2026-05-03T10:00:00.000Z"
          }
        ]
      }
    };
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload)
    });

    const topics = await client.fetchRecentTopics();

    expect(topics.map((topic) => topic.publisherName)).toEqual([
      "username-only",
      "last-poster",
      "unknown"
    ]);
  });

  it("uses last_poster_username when poster metadata points to a missing user", async () => {
    const payload = {
      users: [],
      topic_list: {
        topics: [
          {
            id: 42,
            title: "Missing user topic",
            slug: "missing-user-topic",
            created_at: "2026-05-01T10:00:00.000Z",
            last_poster_username: "fallback-user",
            posters: [{ user_id: 999, description: "Original Poster" }]
          }
        ]
      }
    };
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload)
    });

    const topics = await client.fetchRecentTopics();

    expect(topics[0]).toMatchObject({
      sourceId: "42",
      publisherName: "fallback-user"
    });
    expect(topics[0].raw).toMatchObject({
      publisher: undefined
    });
  });

  it("keeps unknown future Discourse fields in the raw payload", async () => {
    const payload = {
      users: [{ id: 1, username: "allowed", name: "Allowed Publisher" }],
      topic_list: {
        topics: [
          {
            id: 77,
            title: "Future field topic",
            slug: "future-field-topic",
            created_at: "2026-05-01T10:00:00.000Z",
            unexpected_discourse_field: {
              nested: true
            },
            posters: [{ user_id: 1, description: "Original Poster" }]
          }
        ]
      }
    };
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload)
    });

    const [topic] = await client.fetchRecentTopics();

    expect(topic.raw).toMatchObject({
      topic: {
        unexpected_discourse_field: {
          nested: true
        }
      }
    });
  });

  it("rejects malformed recent topic responses", async () => {
    const payload = await loadFixture("malformed-response.json");
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload)
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Invalid Lido recent topics response."
    );
  });

  it("rejects topics with invalid published dates", async () => {
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch({
        users: [],
        topic_list: {
          topics: [
            {
              id: 1,
              title: "Invalid date topic",
              slug: "invalid-date-topic",
              created_at: "not-a-date"
            }
          ]
        }
      })
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Invalid Lido recent topics response."
    );
  });

  it("logs validation issues for malformed responses", async () => {
    const payload = await loadFixture("malformed-response.json");
    const logger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload),
      logger
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Invalid Lido recent topics response."
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: expect.any(Array)
      }),
      "Failed to validate Lido recent topics response"
    );
  });

  it("throws when the Lido endpoint returns a non-success response", async () => {
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: (async () => new Response("Not found", { status: 404 })) as typeof fetch
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Lido forum request failed with 404: https://research.lido.fi/c/proposals/9/l/latest.json?page=0"
    );
  });

  it("handles empty recent topic responses", async () => {
    const payload = await loadFixture("empty-response.json");
    const client = new LidoForumClient({
      baseUrl: "https://research.lido.fi",
      apiBaseUrl: "https://research.lido.fi",
      fetchImpl: jsonFetch(payload)
    });

    await expect(client.fetchRecentTopics()).resolves.toEqual([]);
  });
});
