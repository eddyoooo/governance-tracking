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

export const aaveRecentTopicsResponseSchema = z
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

export type AaveRecentTopicsResponse = z.infer<
  typeof aaveRecentTopicsResponseSchema
>;

const aaveSiteCategorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
    parent_category_id: z.number().nullable().optional(),
    read_restricted: z.boolean().optional().default(false)
  })
  .passthrough();

export const aaveSiteResponseSchema = z
  .object({
    categories: z.array(aaveSiteCategorySchema).default([])
  })
  .passthrough();

export type AaveSiteResponse = z.infer<typeof aaveSiteResponseSchema>;

export interface AaveForumCategory {
  id: number;
  name: string;
  slug: string;
  parentCategoryId?: number;
  path: string;
}

export interface AaveForumTopic {
  sourceId: string;
  title: string;
  slug: string;
  publisherName: string;
  sourceUrl: string;
  publishedAt: string;
  raw: unknown;
}

export interface AaveForumTopicPage {
  page: number;
  topics: AaveForumTopic[];
  hasMore: boolean;
  moreTopicsUrl?: string;
}

export interface AaveForumClientOptions {
  baseUrl: string;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
}

export class AaveForumClient {
  private readonly baseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;

  constructor(options: AaveForumClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  async fetchRecentTopics(options: { page?: number } = {}): Promise<AaveForumTopic[]> {
    const topicPage = await this.fetchRecentTopicPage(options);

    return topicPage.topics;
  }

  async fetchCategories(): Promise<AaveForumCategory[]> {
    const payload = await this.fetchJson("/site.json");
    const parsed = aaveSiteResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { issues: parsed.error.issues },
        "Failed to validate Aave site response"
      );
      throw new Error("Invalid Aave site response.");
    }

    return this.mapCategories(parsed.data);
  }

  async fetchRecentTopicPage(
    options: { page?: number } = {}
  ): Promise<AaveForumTopicPage> {
    const page = options.page ?? 0;
    const payload = await this.fetchJson(`/latest.json?page=${page}`);
    const parsed = aaveRecentTopicsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { issues: parsed.error.issues },
        "Failed to validate Aave recent topics response"
      );
      throw new Error("Invalid Aave recent topics response.");
    }

    return {
      page,
      topics: this.mapRecentTopics(parsed.data),
      hasMore: Boolean(parsed.data.topic_list.more_topics_url),
      moreTopicsUrl: parsed.data.topic_list.more_topics_url ?? undefined
    };
  }

  async fetchCategoryTopicPage(
    category: AaveForumCategory,
    options: { page?: number } = {}
  ): Promise<AaveForumTopicPage> {
    const page = options.page ?? 0;
    const payload = await this.fetchJson(`${category.path}?page=${page}`);
    const parsed = aaveRecentTopicsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { category, issues: parsed.error.issues },
        "Failed to validate Aave category topics response"
      );
      throw new Error("Invalid Aave category topics response.");
    }

    return {
      page,
      topics: this.mapRecentTopics(parsed.data),
      hasMore: Boolean(parsed.data.topic_list.more_topics_url),
      moreTopicsUrl: parsed.data.topic_list.more_topics_url ?? undefined
    };
  }

  private async fetchJson(pathname: string): Promise<unknown> {
    const url = new URL(pathname, this.apiBaseUrl);
    this.logger?.debug({ url: url.toString() }, "Fetching Aave forum JSON");

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "governance-tracking/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Aave forum request failed with ${response.status}: ${url}`);
    }

    return response.json();
  }

  private mapRecentTopics(payload: AaveRecentTopicsResponse): AaveForumTopic[] {
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
        user?.name || user?.username || topic.last_poster_username || "unknown";

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

  private mapCategories(payload: AaveSiteResponse): AaveForumCategory[] {
    const categoriesById = new Map(
      payload.categories.map((category) => [category.id, category])
    );

    return payload.categories
      .filter((category) => !category.read_restricted)
      .map((category) => {
        const pathParts: string[] = [];
        let current: AaveSiteResponse["categories"][number] | undefined = category;

        while (current) {
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
}
