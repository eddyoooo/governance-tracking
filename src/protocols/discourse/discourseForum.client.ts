import type { Logger } from "pino";
import { z } from "zod";

const discourseUserSchema = z
  .object({
    id: z.number(),
    username: z.string(),
    name: z.string().nullable().optional()
  })
  .passthrough();

const discoursePosterSchema = z
  .object({
    user_id: z.number().optional(),
    description: z.string().nullable().optional(),
    extras: z.string().nullable().optional()
  })
  .passthrough();

export const discourseTopicSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    slug: z.string(),
    created_at: z.string().datetime({ offset: true }),
    last_posted_at: z.string().nullable().optional(),
    posts_count: z.number().optional(),
    reply_count: z.number().optional(),
    views: z.number().optional(),
    like_count: z.number().optional(),
    category_id: z.number().optional(),
    last_poster_username: z.string().optional(),
    posters: z.array(discoursePosterSchema).optional()
  })
  .passthrough();

export const discourseRecentTopicsResponseSchema = z
  .object({
    users: z.array(discourseUserSchema).optional().default([]),
    topic_list: z
      .object({
        topics: z.array(discourseTopicSchema).default([]),
        more_topics_url: z.string().nullable().optional(),
        per_page: z.number().optional()
      })
      .passthrough()
  })
  .passthrough();

export type DiscourseRecentTopicsResponse = z.infer<
  typeof discourseRecentTopicsResponseSchema
>;

const discourseSiteCategorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
    parent_category_id: z.number().nullable().optional(),
    read_restricted: z.boolean().optional().default(false)
  })
  .passthrough();

export const discourseSiteResponseSchema = z
  .object({
    categories: z.array(discourseSiteCategorySchema).default([])
  })
  .passthrough();

export type DiscourseSiteResponse = z.infer<typeof discourseSiteResponseSchema>;

export interface DiscourseForumCategory {
  id: number;
  name: string;
  slug: string;
  parentCategoryId?: number;
  path: string;
}

export interface DiscourseForumTopic {
  sourceId: string;
  title: string;
  slug: string;
  publisherName: string;
  sourceUrl: string;
  publishedAt: string;
  raw: unknown;
}

export interface DiscourseForumTopicPage {
  page: number;
  topics: DiscourseForumTopic[];
  hasMore: boolean;
  moreTopicsUrl?: string;
}

export interface FetchDiscourseJsonOptions {
  apiBaseUrl: string;
  pathname: string;
  forumLabel: string;
  fetchImpl: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export const DEFAULT_DISCOURSE_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_DISCOURSE_MAX_ATTEMPTS = 3;
export const DEFAULT_DISCOURSE_RETRY_BASE_DELAY_MS = 1_000;
export const DEFAULT_DISCOURSE_MAX_RETRY_DELAY_MS = 30_000;

function isRetryableDiscourseStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(
  response: Response,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const retryAfter = response.headers.get("retry-after")?.trim();

  if (retryAfter) {
    const seconds = Number(retryAfter);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, maxDelayMs);
    }

    const retryAt = Date.parse(retryAfter);

    if (Number.isFinite(retryAt)) {
      return Math.min(Math.max(0, retryAt - Date.now()), maxDelayMs);
    }
  }

  return exponentialRetryDelayMs(attempt, baseDelayMs, maxDelayMs);
}

function exponentialRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), maxDelayMs);
}

export async function fetchDiscourseJson(
  options: FetchDiscourseJsonOptions
): Promise<unknown> {
  const url = new URL(options.pathname, options.apiBaseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOURSE_FETCH_TIMEOUT_MS;
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_DISCOURSE_MAX_ATTEMPTS
  );
  const baseDelayMs =
    options.retryBaseDelayMs ?? DEFAULT_DISCOURSE_RETRY_BASE_DELAY_MS;
  const maxDelayMs =
    options.maxRetryDelayMs ?? DEFAULT_DISCOURSE_MAX_RETRY_DELAY_MS;
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));

  options.logger?.debug({ url: url.toString() }, `Fetching ${options.forumLabel} JSON`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let responseReceived = false;

    try {
      const response = await options.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "governance-tracking/0.1"
        },
        signal: controller.signal
      });
      responseReceived = true;

      if (!response.ok) {
        if (
          attempt < maxAttempts &&
          isRetryableDiscourseStatus(response.status)
        ) {
          const delayMs = retryDelayMs(
            response,
            attempt,
            baseDelayMs,
            maxDelayMs
          );

          options.logger?.debug(
            {
              url: url.toString(),
              status: response.status,
              attempt,
              maxAttempts,
              retryDelayMs: delayMs
            },
            `Retrying ${options.forumLabel} request after transient response`
          );
          await sleep(delayMs);
          continue;
        }

        throw new Error(
          `${options.forumLabel} request failed with ${response.status}: ${url}`
        );
      }

      try {
        return await response.json();
      } catch (error) {
        options.logger?.error(
          { url: url.toString(), error },
          `Failed to parse ${options.forumLabel} JSON response`
        );
        throw new Error(`Invalid JSON response from ${options.forumLabel}: ${url}`);
      }
    } catch (error) {
      const timedOut = controller.signal.aborted;

      if ((timedOut || !responseReceived) && attempt < maxAttempts) {
        const delayMs = exponentialRetryDelayMs(
          attempt,
          baseDelayMs,
          maxDelayMs
        );

        options.logger?.debug(
          {
            url: url.toString(),
            attempt,
            maxAttempts,
            retryDelayMs: delayMs,
            timedOut,
            error
          },
          `Retrying ${options.forumLabel} request after transient network failure`
        );
        await sleep(delayMs);
        continue;
      }

      if (timedOut) {
        throw new Error(
          `${options.forumLabel} request timed out after ${timeoutMs}ms: ${url}`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${options.forumLabel} request failed: ${url}`);
}

export function mapDiscourseRecentTopics(
  payload: DiscourseRecentTopicsResponse,
  baseUrl: string
): DiscourseForumTopic[] {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const usersById = new Map(payload.users.map((user) => [user.id, user]));

  return payload.topic_list.topics.map((topic) => {
    const originalPoster =
      topic.posters?.find((poster) =>
        poster.description?.toLowerCase().includes("original poster")
      ) ?? topic.posters?.[0];
    const user = originalPoster?.user_id
      ? usersById.get(originalPoster.user_id)
      : undefined;
    const publisherName =
      user?.name?.trim() ||
      user?.username.trim() ||
      "unknown";

    return {
      sourceId: String(topic.id),
      title: topic.title,
      slug: topic.slug,
      publisherName,
      sourceUrl: `${normalizedBaseUrl}/t/${topic.slug}/${topic.id}`,
      publishedAt: topic.created_at,
      raw: {
        topic,
        publisher: user
      }
    };
  });
}

export function toDiscourseTopicPage(
  page: number,
  payload: DiscourseRecentTopicsResponse,
  baseUrl: string
): DiscourseForumTopicPage {
  return {
    page,
    topics: mapDiscourseRecentTopics(payload, baseUrl),
    hasMore: Boolean(payload.topic_list.more_topics_url),
    moreTopicsUrl: payload.topic_list.more_topics_url ?? undefined
  };
}

export function mapDiscourseCategories(
  payload: DiscourseSiteResponse
): DiscourseForumCategory[] {
  const categoriesById = new Map(
    payload.categories.map((category) => [category.id, category])
  );

  return payload.categories
    .filter((category) => !category.read_restricted)
    .map((category) => {
      const pathParts: string[] = [];
      const visitedCategoryIds = new Set<number>();
      let current: DiscourseSiteResponse["categories"][number] | undefined = category;

      while (current) {
        if (visitedCategoryIds.has(current.id)) {
          throw new Error(
            `Invalid Discourse category hierarchy: cycle detected at category ${current.id}.`
          );
        }

        visitedCategoryIds.add(current.id);
        pathParts.unshift(current.slug);
        const parentId: number | undefined = current.parent_category_id ?? undefined;
        current = parentId ? categoriesById.get(parentId) : undefined;
      }

      return {
        id: category.id,
        name: category.name,
        slug: category.slug,
        parentCategoryId: category.parent_category_id ?? undefined,
        path: `/c/${pathParts.join("/")}/${category.id}/l/latest.json`
      };
    });
}
