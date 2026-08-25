import { readFile } from "node:fs/promises";
import { describe, expect, it, jest } from "@jest/globals";
import {
  CowForumClient,
  cowRecentTopicsResponseSchema,
  cowSiteResponseSchema
} from "../../src/protocols/cow/cowForum.client.js";

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/cow/${name}`, import.meta.url), "utf8")
  ) as unknown;
}

function jsonFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
}

describe("CowForumClient", () => {
  it("validates live-derived recent-topic and site fixtures with Zod", async () => {
    expect(
      cowRecentTopicsResponseSchema.safeParse(
        await loadFixture("recent-topics.json")
      ).success
    ).toBe(true);
    expect(
      cowSiteResponseSchema.safeParse(await loadFixture("site.json")).success
    ).toBe(true);
  });

  it("maps original posters and preserves display-name and username fallbacks", async () => {
    const client = new CowForumClient({
      baseUrl: "https://forum.cow.fi",
      apiBaseUrl: "https://forum.cow.fi",
      fetchImpl: jsonFetch(await loadFixture("recent-topics.json"))
    });

    const topics = await client.fetchRecentTopics();

    expect(topics).toHaveLength(4);
    expect(topics.map((topic) => topic.publisherName)).toEqual([
      "Chen",
      "MooKeeper",
      "felixhenneke",
      "KPK"
    ]);
    expect(topics[1]).toMatchObject({
      sourceId: "3527",
      title: "CoW DAO Monthly Recap: July 2026",
      publisherName: "MooKeeper",
      sourceUrl:
        "https://forum.cow.fi/t/cow-dao-monthly-recap-july-2026/3527",
      publishedAt: "2026-08-04T12:47:10.847Z",
      raw: {
        publisher: {
          username: "moo_keeper"
        }
      }
    });
  });

  it("requests the global latest endpoint with explicit pagination", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify(await loadFixture("empty-response.json")), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const client = new CowForumClient({
      baseUrl: "https://forum.cow.fi/",
      apiBaseUrl: "https://forum.cow.fi/",
      fetchImpl
    });

    await client.fetchRecentTopics({ page: 3 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://forum.cow.fi/latest.json?page=3");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    });
  });

  it("discovers every public CoW category and builds nested Discourse paths", async () => {
    const client = new CowForumClient({
      baseUrl: "https://forum.cow.fi",
      apiBaseUrl: "https://forum.cow.fi",
      fetchImpl: jsonFetch(await loadFixture("site.json"))
    });

    const categories = await client.fetchCategories();

    expect(categories).toHaveLength(16);
    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 6,
          name: "Governance",
          path: "/c/cow-improvement-proposals-cip/6/l/latest.json"
        }),
        expect.objectContaining({
          id: 13,
          name: "Closed Proposals",
          path:
            "/c/cow-improvement-proposals-cip/closed-proposals/13/l/latest.json"
        }),
        expect.objectContaining({
          id: 24,
          name: "Core-Contributor-Grant",
          path:
            "/c/cow-grants-program/core-contributor-grant/24/l/latest.json"
        }),
        expect.objectContaining({
          id: 9,
          name: "CoW Ecosystem",
          path: "/c/general/cow-ecosystem/9/l/latest.json"
        })
      ])
    );
    expect(categories.map((category) => category.id)).not.toContain(999);
  });

  it("requests nested category pages through their generated path", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify(await loadFixture("recent-topics.json")), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const client = new CowForumClient({
      baseUrl: "https://forum.cow.fi/",
      apiBaseUrl: "https://forum.cow.fi/",
      fetchImpl
    });

    const page = await client.fetchCategoryTopicPage(
      {
        id: 13,
        name: "Closed Proposals",
        slug: "closed-proposals",
        parentCategoryId: 6,
        path:
          "/c/cow-improvement-proposals-cip/closed-proposals/13/l/latest.json"
      },
      { page: 1 }
    );

    expect(page.topics).toHaveLength(4);
    const [url] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://forum.cow.fi/c/cow-improvement-proposals-cip/closed-proposals/13/l/latest.json?page=1"
    );
  });

  it("rejects malformed recent, site, and category responses with context", async () => {
    const recentClient = new CowForumClient({
      baseUrl: "https://forum.cow.fi",
      apiBaseUrl: "https://forum.cow.fi",
      fetchImpl: jsonFetch(await loadFixture("malformed-response.json"))
    });
    const siteClient = new CowForumClient({
      baseUrl: "https://forum.cow.fi",
      apiBaseUrl: "https://forum.cow.fi",
      fetchImpl: jsonFetch({
        categories: [{ id: "broken", name: "Broken", slug: "broken" }]
      })
    });
    const logger = { debug: jest.fn(), error: jest.fn() };
    const categoryClient = new CowForumClient({
      baseUrl: "https://forum.cow.fi",
      apiBaseUrl: "https://forum.cow.fi",
      fetchImpl: jsonFetch({ topic_list: { topics: "broken" } }),
      logger
    });
    const category = {
      id: 6,
      name: "Governance",
      slug: "cow-improvement-proposals-cip",
      path: "/c/cow-improvement-proposals-cip/6/l/latest.json"
    };

    await expect(recentClient.fetchRecentTopics()).rejects.toThrow(
      "Invalid CoW recent topics response."
    );
    await expect(siteClient.fetchCategories()).rejects.toThrow(
      "Invalid CoW site response."
    );
    await expect(categoryClient.fetchCategoryTopicPage(category)).rejects.toThrow(
      "Invalid CoW category topics response."
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ category, issues: expect.any(Array) }),
      "Failed to validate CoW category topics response"
    );
  });

  it("labels definitive HTTP and invalid JSON failures as CoW errors", async () => {
    const missingClient = new CowForumClient({
      baseUrl: "https://forum.cow.fi",
      apiBaseUrl: "https://forum.cow.fi",
      fetchImpl: (async () =>
        new Response("Not found", { status: 404 })) as typeof fetch
    });
    const logger = { debug: jest.fn(), error: jest.fn() };
    const htmlClient = new CowForumClient({
      baseUrl: "https://forum.cow.fi",
      apiBaseUrl: "https://forum.cow.fi",
      fetchImpl: (async () =>
        new Response("<html>temporarily unavailable</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })) as typeof fetch,
      logger
    });

    await expect(missingClient.fetchRecentTopics()).rejects.toThrow(
      "CoW forum request failed with 404: https://forum.cow.fi/latest.json?page=0"
    );
    await expect(htmlClient.fetchRecentTopics()).rejects.toThrow(
      "Invalid JSON response from CoW forum: https://forum.cow.fi/latest.json?page=0"
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://forum.cow.fi/latest.json?page=0",
        error: expect.objectContaining({ name: "SyntaxError" })
      }),
      "Failed to parse CoW forum JSON response"
    );
  });
});
