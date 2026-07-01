import { describe, expect, it, jest } from "@jest/globals";
import {
  discourseRecentTopicsResponseSchema,
  discourseSiteResponseSchema,
  fetchDiscourseJson,
  mapDiscourseCategories,
  mapDiscourseRecentTopics,
  toDiscourseTopicPage
} from "../../src/protocols/discourse/discourseForum.client.js";

function recentTopicsPayload() {
  return {
    users: [
      { id: 1, username: "recent", name: "Recent Poster" },
      { id: 2, username: "original", name: "Original Publisher" }
    ],
    topic_list: {
      topics: [
        {
          id: 123,
          title: "Discourse proposal",
          slug: "discourse-proposal",
          created_at: "2026-06-20T12:00:00.000Z",
          posters: [
            { user_id: 1, description: "Most Recent Poster" },
            { user_id: 2, description: "Original Poster" }
          ],
          future_discourse_field: {
            stillPreserved: true
          }
        },
        {
          id: 124,
          title: "Fallback proposal",
          slug: "fallback-proposal",
          created_at: "2026-06-21T12:00:00.000Z",
          last_poster_username: "last-poster"
        }
      ],
      more_topics_url: "/latest?page=1",
      per_page: 30
    }
  };
}

describe("shared Discourse forum helpers", () => {
  it("validates recent topics and defaults optional users/topics arrays", () => {
    const parsed = discourseRecentTopicsResponseSchema.parse({
      topic_list: {}
    });

    expect(parsed).toMatchObject({
      users: [],
      topic_list: {
        topics: []
      }
    });
  });

  it("validates site categories and defaults missing category arrays", () => {
    const parsed = discourseSiteResponseSchema.parse({});

    expect(parsed.categories).toEqual([]);
  });

  it("maps public categories and subcategories to Discourse latest paths", () => {
    const payload = discourseSiteResponseSchema.parse({
      categories: [
        {
          id: 1,
          name: "Governance",
          slug: "governance",
          read_restricted: false
        },
        {
          id: 2,
          name: "Requests for Comment",
          slug: "proposal-discussion",
          parent_category_id: 1,
          read_restricted: false
        },
        {
          id: 3,
          name: "Private Staff",
          slug: "private-staff",
          read_restricted: true
        }
      ]
    });

    expect(mapDiscourseCategories(payload)).toEqual([
      {
        id: 1,
        name: "Governance",
        slug: "governance",
        parentCategoryId: undefined,
        path: "/c/governance/1/l/latest.json"
      },
      {
        id: 2,
        name: "Requests for Comment",
        slug: "proposal-discussion",
        parentCategoryId: 1,
        path: "/c/governance/proposal-discussion/2/l/latest.json"
      }
    ]);
  });

  it("maps topics using original-poster metadata and preserves raw future fields", () => {
    const payload = discourseRecentTopicsResponseSchema.parse(recentTopicsPayload());

    const topics = mapDiscourseRecentTopics(payload, "https://forum.example/");

    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({
      sourceId: "123",
      title: "Discourse proposal",
      publisherName: "Original Publisher",
      sourceUrl: "https://forum.example/t/discourse-proposal/123",
      publishedAt: "2026-06-20T12:00:00.000Z",
      raw: {
        topic: {
          future_discourse_field: {
            stillPreserved: true
          }
        },
        publisher: {
          id: 2,
          username: "original"
        }
      }
    });
    expect(topics[1]).toMatchObject({
      sourceId: "124",
      publisherName: "last-poster"
    });
  });

  it("creates topic pages with Discourse pagination metadata", () => {
    const payload = discourseRecentTopicsResponseSchema.parse(recentTopicsPayload());

    expect(toDiscourseTopicPage(2, payload, "https://forum.example")).toMatchObject({
      page: 2,
      hasMore: true,
      moreTopicsUrl: "/latest?page=1",
      topics: [
        {
          sourceId: "123"
        },
        {
          sourceId: "124"
        }
      ]
    });
  });

  it("fetches JSON with stable headers and URL construction", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await fetchDiscourseJson({
      apiBaseUrl: "https://forum.example/",
      pathname: "/latest.json?page=3",
      forumLabel: "Example forum",
      fetchImpl
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://forum.example/latest.json?page=3");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    });
  });

  it("throws protocol-labelled errors for non-success responses", async () => {
    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json?page=0",
        forumLabel: "Example forum",
        fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch
      })
    ).rejects.toThrow(
      "Example forum request failed with 404: https://forum.example/latest.json?page=0"
    );
  });

  it("throws protocol-labelled errors and logs parse failures for invalid JSON", async () => {
    const logger = {
      debug: jest.fn(),
      error: jest.fn()
    };

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json?page=0",
        forumLabel: "Example forum",
        fetchImpl: (async () =>
          new Response("<html>down</html>", {
            status: 200,
            headers: { "content-type": "text/html" }
          })) as typeof fetch,
        logger
      })
    ).rejects.toThrow(
      "Invalid JSON response from Example forum: https://forum.example/latest.json?page=0"
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://forum.example/latest.json?page=0",
        error: expect.objectContaining({
          name: "SyntaxError"
        })
      }),
      "Failed to parse Example forum JSON response"
    );
  });
});
