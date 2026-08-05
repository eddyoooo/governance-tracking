import { afterEach, describe, expect, it, jest } from "@jest/globals";
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
  afterEach(() => {
    jest.useRealTimers();
  });

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

  it("rejects cyclic external category hierarchies instead of looping forever", () => {
    const payload = discourseSiteResponseSchema.parse({
      categories: [
        {
          id: 1,
          name: "One",
          slug: "one",
          parent_category_id: 2
        },
        {
          id: 2,
          name: "Two",
          slug: "two",
          parent_category_id: 1
        }
      ]
    });

    expect(() => mapDiscourseCategories(payload)).toThrow(
      "Invalid Discourse category hierarchy: cycle detected at category 1."
    );
  });

  it("maps topics using original-poster metadata and never mistakes the last commenter for the publisher", () => {
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
      publisherName: "unknown"
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
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("times out stuck forum requests with protocol-labelled errors", async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        })
    );

    const request = fetchDiscourseJson({
      apiBaseUrl: "https://forum.example",
      pathname: "/latest.json?page=0",
      forumLabel: "Example forum",
      fetchImpl,
      timeoutMs: 25,
      maxAttempts: 1
    });

    await Promise.resolve();
    jest.advanceTimersByTime(25);

    await expect(request).rejects.toThrow(
      "Example forum request timed out after 25ms: https://forum.example/latest.json?page=0"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("retries a timed-out request and returns the next successful response", async () => {
    jest.useFakeTimers();
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () => {
              reject(new Error("request aborted"));
            });
          })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ recovered: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const sleep = jest.fn(async () => undefined);

    const request = fetchDiscourseJson({
      apiBaseUrl: "https://forum.example",
      pathname: "/latest.json?page=0",
      forumLabel: "Example forum",
      fetchImpl,
      timeoutMs: 25,
      maxAttempts: 2,
      retryBaseDelayMs: 10,
      sleep
    });

    await jest.advanceTimersByTimeAsync(25);

    await expect(request).resolves.toEqual({ recovered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
    jest.useRealTimers();
  });

  it("throws protocol-labelled errors for non-success responses", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () => new Response("not found", { status: 404 })
    );

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json?page=0",
        forumLabel: "Example forum",
        fetchImpl
      })
    ).rejects.toThrow(
      "Example forum request failed with 404: https://forum.example/latest.json?page=0"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries HTTP 429 responses using Retry-After before returning valid JSON", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const sleep = jest.fn(async () => undefined);

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json?page=0",
        forumLabel: "Example forum",
        fetchImpl,
        sleep
      })
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("honors an HTTP-date Retry-After value without exceeding the delay cap", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-26T10:00:00.000Z"));
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("temporarily unavailable", {
          status: 503,
          headers: {
            "retry-after": "Sun, 26 Jul 2026 10:01:00 GMT"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const sleep = jest.fn(async () => undefined);

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json",
        forumLabel: "Example forum",
        fetchImpl,
        maxRetryDelayMs: 30_000,
        sleep
      })
    ).resolves.toEqual({ ok: true });

    expect(sleep).toHaveBeenCalledWith(30_000);
    jest.useRealTimers();
  });

  it("uses bounded exponential delays for transient server failures", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ recovered: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const sleep = jest.fn(async () => undefined);

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json",
        forumLabel: "Example forum",
        fetchImpl,
        retryBaseDelayMs: 750,
        maxRetryDelayMs: 1_000,
        sleep
      })
    ).resolves.toEqual({ recovered: true });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[750], [1_000]]);
  });

  it("fails after the bounded number of transient-response attempts", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () => new Response("still limited", { status: 429 })
    );
    const sleep = jest.fn(async () => undefined);

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json",
        forumLabel: "Example forum",
        fetchImpl,
        maxAttempts: 3,
        retryBaseDelayMs: 10,
        sleep
      })
    ).rejects.toThrow(
      "Example forum request failed with 429: https://forum.example/latest.json"
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it("clamps non-positive max attempts to one request", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () => new Response("unavailable", { status: 503 })
    );
    const sleep = jest.fn(async () => undefined);

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json",
        forumLabel: "Example forum",
        fetchImpl,
        maxAttempts: 0,
        sleep
      })
    ).rejects.toThrow("Example forum request failed with 503");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("recovers from a transient network failure", async () => {
    const networkError = new TypeError("socket disconnected");
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ recovered: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const sleep = jest.fn(async () => undefined);

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json",
        forumLabel: "Example forum",
        fetchImpl,
        retryBaseDelayMs: 10,
        sleep
      })
    ).resolves.toEqual({ recovered: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("propagates a persistent network failure after bounded retries", async () => {
    const networkError = new TypeError("socket disconnected");
    const fetchImpl = jest.fn<typeof fetch>(async () => {
      throw networkError;
    });
    const sleep = jest.fn(async () => undefined);

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json",
        forumLabel: "Example forum",
        fetchImpl,
        maxAttempts: 3,
        retryBaseDelayMs: 10,
        sleep
      })
    ).rejects.toBe(networkError);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it("throws protocol-labelled errors and logs parse failures for invalid JSON", async () => {
    const logger = {
      debug: jest.fn(),
      error: jest.fn()
    };
    const fetchImpl = jest.fn<typeof fetch>(
      async () =>
        new Response("<html>down</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
    );

    await expect(
      fetchDiscourseJson({
        apiBaseUrl: "https://forum.example",
        pathname: "/latest.json?page=0",
        forumLabel: "Example forum",
        fetchImpl,
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
