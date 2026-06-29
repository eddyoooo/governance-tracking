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
}

export async function fetchDiscourseJson(
  options: FetchDiscourseJsonOptions
): Promise<unknown> {
  const url = new URL(options.pathname, options.apiBaseUrl);

  options.logger?.debug({ url: url.toString() }, `Fetching ${options.forumLabel} JSON`);

  const response = await options.fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "governance-tracking/0.1"
    }
  });

  if (!response.ok) {
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
      topic.last_poster_username?.trim() ||
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
