import { readFile } from "node:fs/promises";
import { describe, expect, it, jest } from "@jest/globals";
import {
  UniswapForumClient,
  uniswapRecentTopicsResponseSchema,
  uniswapSiteResponseSchema
} from "../../src/protocols/uniswap/uniswapForum.client.js";

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/uniswap/${name}`, import.meta.url), "utf8")
  ) as unknown;
}

function jsonFetch(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
}

describe("UniswapForumClient", () => {
  it("validates recent topic and site fixture payloads with Zod", async () => {
    expect(
      uniswapRecentTopicsResponseSchema.safeParse(
        await loadFixture("recent-topics.json")
      ).success
    ).toBe(true);
    expect(
      uniswapSiteResponseSchema.safeParse(await loadFixture("site.json")).success
    ).toBe(true);
  });

  it("maps recent topics to forum topic records", async () => {
    const client = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org",
      apiBaseUrl: "https://gov.uniswap.org",
      fetchImpl: jsonFetch(await loadFixture("recent-topics.json"))
    });

    const topics = await client.fetchRecentTopics();

    expect(topics).toHaveLength(4);
    expect(topics[0]).toMatchObject({
      sourceId: "26127",
      title:
        "[RFC] - Update Crosschain Governance Parameters for Avalanche, MegaETH, Soneium, and X Layer",
      publisherName: "eek637",
      sourceUrl:
        "https://gov.uniswap.org/t/rfc-update-crosschain-governance-parameters-for-avalanche-megaeth-soneium-and-x-layer/26127",
      publishedAt: "2026-06-19T17:04:30.632Z"
    });
    expect(topics.map((topic) => topic.publisherName)).toEqual([
      "eek637",
      "Squidward Jalapeno",
      "Rika_Axia Network",
      "Sergei"
    ]);
  });

  it("requests the Uniswap latest JSON endpoint with pagination", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify(await loadFixture("empty-response.json")), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const client = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org/",
      apiBaseUrl: "https://gov.uniswap.org/",
      fetchImpl
    });

    await client.fetchRecentTopics({ page: 2 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://gov.uniswap.org/latest.json?page=2");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    });
  });

  it("maps all public categories to Discourse latest paths", async () => {
    const client = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org",
      apiBaseUrl: "https://gov.uniswap.org",
      fetchImpl: jsonFetch(await loadFixture("site.json"))
    });

    const categories = await client.fetchCategories();

    expect(categories).toHaveLength(6);
    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 9,
          name: "Temperature Check",
          path: "/c/temperature-check/9/l/latest.json"
        }),
        expect.objectContaining({
          id: 5,
          name: "Requests for Comment",
          path: "/c/proposal-discussion/5/l/latest.json"
        }),
        expect.objectContaining({
          id: 10,
          name: "Consensus Check",
          path: "/c/consensus-check/10/l/latest.json"
        }),
        expect.objectContaining({
          id: 8,
          name: "Governance-Meta",
          path: "/c/governance-meta/8/l/latest.json"
        }),
        expect.objectContaining({
          id: 14,
          name: "Service Providers",
          path: "/c/service-providers/14/l/latest.json"
        })
      ])
    );
    expect(categories.map((category) => category.id)).not.toContain(999);
  });

  it("requests category latest pages using generated category paths", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify(await loadFixture("recent-topics.json")), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const client = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org/",
      apiBaseUrl: "https://gov.uniswap.org/",
      fetchImpl
    });

    const page = await client.fetchCategoryTopicPage(
      {
        id: 5,
        name: "Requests for Comment",
        slug: "proposal-discussion",
        path: "/c/proposal-discussion/5/l/latest.json"
      },
      { page: 2 }
    );

    expect(page.topics).toHaveLength(4);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://gov.uniswap.org/c/proposal-discussion/5/l/latest.json?page=2"
    );
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    });
  });

  it("rejects malformed recent topic and site responses", async () => {
    const recentClient = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org",
      apiBaseUrl: "https://gov.uniswap.org",
      fetchImpl: jsonFetch(await loadFixture("malformed-response.json"))
    });
    const siteClient = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org",
      apiBaseUrl: "https://gov.uniswap.org",
      fetchImpl: jsonFetch({
        categories: [{ id: "broken", name: "Broken", slug: "broken" }]
      })
    });

    await expect(recentClient.fetchRecentTopics()).rejects.toThrow(
      "Invalid Uniswap recent topics response."
    );
    await expect(siteClient.fetchCategories()).rejects.toThrow(
      "Invalid Uniswap site response."
    );
  });

  it("throws when the Uniswap endpoint returns a non-success response", async () => {
    const client = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org",
      apiBaseUrl: "https://gov.uniswap.org",
      fetchImpl: (async () => new Response("Not found", { status: 404 })) as typeof fetch
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Uniswap forum request failed with 404: https://gov.uniswap.org/latest.json?page=0"
    );
  });

  it("throws a clear error when the Uniswap endpoint returns invalid JSON", async () => {
    const logger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    const client = new UniswapForumClient({
      baseUrl: "https://gov.uniswap.org",
      apiBaseUrl: "https://gov.uniswap.org",
      fetchImpl: (async () =>
        new Response("<html>temporarily unavailable</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })) as typeof fetch,
      logger
    });

    await expect(client.fetchRecentTopics()).rejects.toThrow(
      "Invalid JSON response from Uniswap forum: https://gov.uniswap.org/latest.json?page=0"
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gov.uniswap.org/latest.json?page=0",
        error: expect.objectContaining({
          name: "SyntaxError"
        })
      }),
      "Failed to parse Uniswap forum JSON response"
    );
  });
});
