import type { Logger } from "pino";
import { z } from "zod";
import {
  discourseRecentTopicsResponseSchema,
  fetchDiscourseJson,
  toDiscourseTopicPage,
  type DiscourseForumTopic,
  type DiscourseForumTopicPage,
  type DiscourseRecentTopicsResponse
} from "../discourse/discourseForum.client.js";

export const aaveRecentTopicsResponseSchema = discourseRecentTopicsResponseSchema;
export type AaveRecentTopicsResponse = DiscourseRecentTopicsResponse;

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

export type AaveForumTopic = DiscourseForumTopic;
export type AaveForumTopicPage = DiscourseForumTopicPage;

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

    return toDiscourseTopicPage(page, parsed.data, this.baseUrl);
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

    return toDiscourseTopicPage(page, parsed.data, this.baseUrl);
  }

  private async fetchJson(pathname: string): Promise<unknown> {
    return fetchDiscourseJson({
      apiBaseUrl: this.apiBaseUrl,
      pathname,
      forumLabel: "Aave forum",
      fetchImpl: this.fetchImpl,
      logger: this.logger
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
