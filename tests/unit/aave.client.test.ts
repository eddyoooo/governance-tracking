import { readFile } from "node:fs/promises";
import { describe, expect, it, jest } from "@jest/globals";
import {
  AaveForumClient,
  aaveRecentTopicsResponseSchema,
  aaveSiteResponseSchema
} from "../../src/protocols/aave/aaveForum.client.js";

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/aave/${name}`, import.meta.url), "utf8")
  ) as unknown;
}

function jsonFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
}

describe("AaveForumClient", () => {
  it("validates recent topic fixture payloads with Zod", async () => {
    const payload = await loadFixture("recent-topics.json");

    expect(aaveRecentTopicsResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("validates Aave site category fixture payloads with Zod", async () => {
    const payload = await loadFixture("site.json");

    expect(aaveSiteResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("maps recent topics to forum topic records", async () => {
    const payload = await loadFixture("recent-topics.json");
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch(payload)
    });

    const topics = await client.fetchRecentTopics();

    expect(topics).toHaveLength(4);
    expect(topics[0]).toMatchObject({
      sourceId: "25170",
      title: "[ARFC] Deploy Aave V4 on Arc",
      publisherName: "AaveLabs",
      sourceUrl:
        "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170"
    });
    expect(topics.map((topic) => topic.publisherName)).toEqual([
      "AaveLabs",
      "LlamaRisk",
      "TokenLogic",
      "Gepetto"
    ]);
  });

  it("requests the Aave latest JSON endpoint with pagination", async () => {
    const payload = await loadFixture("empty-response.json");
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com/",
      apiBaseUrl: "https://governance.aave.com/",
      fetchImpl
    });

    await client.fetchRecentTopics({ page: 2 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://governance.aave.com/latest.json?page=2");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    });
  });

  it("maps all public top-level categories and subcategories to Discourse latest paths", async () => {
    const payload = await loadFixture("site.json");
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch(payload)
    });

    const categories = await client.fetchCategories();

    expect(categories).toHaveLength(18);
    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 4,
          name: "Governance",
          path: "/c/governance/4/l/latest.json"
        }),
        expect.objectContaining({
          id: 10,
          name: "New Market",
          parentCategoryId: 4,
          path: "/c/governance/new-market/10/l/latest.json"
        }),
        expect.objectContaining({
          id: 17,
          name: "Oracles",
          parentCategoryId: 7,
          path: "/c/risk/oracles/17/l/latest.json"
        }),
        expect.objectContaining({
          id: 26,
          name: "Development",
          path: "/c/development/26/l/latest.json"
        }),
        expect.objectContaining({
          id: 30,
          name: "Finance",
          path: "/c/finance/30/l/latest.json"
        })
      ])
    );
    expect(categories.map((category) => category.id)).not.toContain(999);
  });

  it("requests category latest pages using generated category paths", async () => {
    const payload = await loadFixture("recent-topics.json");
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com/",
      apiBaseUrl: "https://governance.aave.com/",
      fetchImpl
    });

    const page = await client.fetchCategoryTopicPage(
      {
        id: 10,
        name: "New Market",
        slug: "new-market",
        parentCategoryId: 4,
        path: "/c/governance/new-market/10/l/latest.json"
      },
      { page: 2 }
    );

    expect(page.topics).toHaveLength(4);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://governance.aave.com/c/governance/new-market/10/l/latest.json?page=2"
    );
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    });
  });

  it("reports whether a recent topics page has more pages", async () => {
    const payload = await loadFixture("recent-topics.json");
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch({
        ...(payload as Record<string, unknown>),
        topic_list: {
          ...((payload as { topic_list: Record<string, unknown> }).topic_list),
          more_topics_url: "/latest?no_definitions=true&page=1",
          per_page: 30
        }
      })
    });

    const page = await client.fetchRecentTopicPage();

    expect(page).toMatchObject({
      page: 0,
      hasMore: true,
      moreTopicsUrl: "/latest?no_definitions=true&page=1"
    });
    expect(page.topics).toHaveLength(4);
  });

  it("trims blank display names and falls back to username or last poster", async () => {
    const payload = {
      users: [{ id: 1, username: "aave-username", name: "   " }],
      topic_list: {
        topics: [
          {
            id: 1,
            title: "Username fallback",
            slug: "username-fallback",
            created_at: "2026-06-19T12:00:28.625Z",
            posters: [{ user_id: 1, description: "Original Poster" }]
          },
          {
            id: 2,
            title: "Last poster fallback",
            slug: "last-poster-fallback",
            created_at: "2026-06-19T13:00:28.625Z",
            last_poster_username: "last-poster"
          }
        ]
      }
    };
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch(payload)
    });

    const topics = await client.fetchRecentTopics();

    expect(topics.map((topic) => topic.publisherName)).toEqual([
      "aave-username",
      "last-poster"
    ]);
  });

  it("rejects malformed recent topic responses", async () => {
    const payload = await loadFixture("malformed-response.json");
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch(payload)
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Invalid Aave recent topics response."
    );
  });

  it("logs validation issues for malformed responses", async () => {
    const payload = await loadFixture("malformed-response.json");
    const logger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch(payload),
      logger
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Invalid Aave recent topics response."
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: expect.any(Array)
      }),
      "Failed to validate Aave recent topics response"
    );
  });

  it("rejects malformed site responses", async () => {
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch({
        categories: [
          {
            id: "not-a-number",
            name: "Broken",
            slug: "broken"
          }
        ]
      })
    });

    await expect(client.fetchCategories()).rejects.toThrow(
      "Invalid Aave site response."
    );
  });

  it("throws when the Aave endpoint returns a non-success response", async () => {
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: (async () => new Response("Not found", { status: 404 })) as typeof fetch
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Aave forum request failed with 404: https://governance.aave.com/latest.json?page=0"
    );
  });

  it("throws a clear error when the Aave endpoint returns invalid JSON", async () => {
    const logger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: (async () =>
        new Response("<html>temporarily unavailable</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })) as typeof fetch,
      logger
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Invalid JSON response from Aave forum: https://governance.aave.com/latest.json?page=0"
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://governance.aave.com/latest.json?page=0",
        error: expect.objectContaining({
          name: "SyntaxError"
        })
      }),
      "Failed to parse Aave forum JSON response"
    );
  });

  it("handles empty recent topic responses", async () => {
    const payload = await loadFixture("empty-response.json");
    const client = new AaveForumClient({
      baseUrl: "https://governance.aave.com",
      apiBaseUrl: "https://governance.aave.com",
      fetchImpl: jsonFetch(payload)
    });

    await expect(client.fetchRecentTopics()).resolves.toEqual([]);
  });
});
