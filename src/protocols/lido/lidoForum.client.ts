import { z } from "zod";
import type { Logger } from "pino";

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

const discourseTopicSchema = z
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

export const lidoRecentTopicsResponseSchema = z
  .object({
    users: z.array(discourseUserSchema).optional().default([]),
    topic_list: z
      .object({
        topics: z.array(discourseTopicSchema).default([])
      })
      .passthrough()
  })
  .passthrough();

export type LidoRecentTopicsResponse = z.infer<typeof lidoRecentTopicsResponseSchema>;

export interface LidoForumTopic {
  sourceId: string;
  title: string;
  slug: string;
  publisherName: string;
  sourceUrl: string;
  publishedAt: string;
  raw: unknown;
}

export interface LidoForumClientOptions {
  baseUrl: string;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
}

export class LidoForumClient {
  private readonly baseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;

  constructor(options: LidoForumClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  async fetchRecentTopics(options: { page?: number } = {}): Promise<LidoForumTopic[]> {
    const page = options.page ?? 0;
    const payload = await this.fetchJson(`/c/proposals/9/l/latest.json?page=${page}`);
    const parsed = lidoRecentTopicsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { issues: parsed.error.issues },
        "Failed to validate Lido recent topics response"
      );
      throw new Error("Invalid Lido recent topics response.");
    }

    return this.mapRecentTopics(parsed.data);
  }

  private async fetchJson(pathname: string): Promise<unknown> {
    const url = new URL(pathname, this.apiBaseUrl);
    this.logger?.debug({ url: url.toString() }, "Fetching Lido forum JSON");

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "governance-tracking/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Lido forum request failed with ${response.status}: ${url}`);
    }

    return response.json();
  }

  private mapRecentTopics(payload: LidoRecentTopicsResponse): LidoForumTopic[] {
    const usersById = new Map(payload.users.map((user) => [user.id, user]));

    return payload.topic_list.topics.map((topic) => {
      const originalPoster =
        topic.posters?.find((poster) =>
          poster.description?.toLowerCase().includes("original poster")
        ) ?? topic.posters?.[0];
      const user = originalPoster?.user_id
        ? usersById.get(originalPoster.user_id)
        : undefined;
      const publisherName = user?.name || user?.username || topic.last_poster_username || "unknown";

      return {
        sourceId: String(topic.id),
        title: topic.title,
        slug: topic.slug,
        publisherName,
        sourceUrl: `${this.baseUrl}/t/${topic.slug}/${topic.id}`,
        publishedAt: topic.created_at,
        raw: {
          topic,
          publisher: user
        }
      };
    });
  }
}
