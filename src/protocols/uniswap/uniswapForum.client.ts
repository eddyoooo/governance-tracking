import type { Logger } from "pino";
import {
  discourseRecentTopicsResponseSchema,
  discourseSiteResponseSchema,
  fetchDiscourseJson,
  mapDiscourseCategories,
  toDiscourseTopicPage,
  type DiscourseForumCategory,
  type DiscourseForumTopic,
  type DiscourseForumTopicPage,
  type DiscourseRecentTopicsResponse,
  type DiscourseSiteResponse
} from "../discourse/discourseForum.client.js";

export const uniswapRecentTopicsResponseSchema = discourseRecentTopicsResponseSchema;
export const uniswapSiteResponseSchema = discourseSiteResponseSchema;
export type UniswapRecentTopicsResponse = DiscourseRecentTopicsResponse;
export type UniswapSiteResponse = DiscourseSiteResponse;
export type UniswapForumCategory = DiscourseForumCategory;
export type UniswapForumTopic = DiscourseForumTopic;
export type UniswapForumTopicPage = DiscourseForumTopicPage;

export interface UniswapForumClientOptions {
  baseUrl: string;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
}

export class UniswapForumClient {
  private readonly baseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;

  constructor(options: UniswapForumClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  async fetchRecentTopics(
    options: { page?: number } = {}
  ): Promise<UniswapForumTopic[]> {
    const topicPage = await this.fetchRecentTopicPage(options);

    return topicPage.topics;
  }

  async fetchCategories(): Promise<UniswapForumCategory[]> {
    const payload = await this.fetchJson("/site.json");
    const parsed = uniswapSiteResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { issues: parsed.error.issues },
        "Failed to validate Uniswap site response"
      );
      throw new Error("Invalid Uniswap site response.");
    }

    return mapDiscourseCategories(parsed.data);
  }

  async fetchRecentTopicPage(
    options: { page?: number } = {}
  ): Promise<UniswapForumTopicPage> {
    const page = options.page ?? 0;
    const payload = await this.fetchJson(`/latest.json?page=${page}`);
    const parsed = uniswapRecentTopicsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { issues: parsed.error.issues },
        "Failed to validate Uniswap recent topics response"
      );
      throw new Error("Invalid Uniswap recent topics response.");
    }

    return toDiscourseTopicPage(page, parsed.data, this.baseUrl);
  }

  async fetchCategoryTopicPage(
    category: UniswapForumCategory,
    options: { page?: number } = {}
  ): Promise<UniswapForumTopicPage> {
    const page = options.page ?? 0;
    const payload = await this.fetchJson(`${category.path}?page=${page}`);
    const parsed = uniswapRecentTopicsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { category, issues: parsed.error.issues },
        "Failed to validate Uniswap category topics response"
      );
      throw new Error("Invalid Uniswap category topics response.");
    }

    return toDiscourseTopicPage(page, parsed.data, this.baseUrl);
  }

  private async fetchJson(pathname: string): Promise<unknown> {
    return fetchDiscourseJson({
      apiBaseUrl: this.apiBaseUrl,
      pathname,
      forumLabel: "Uniswap forum",
      fetchImpl: this.fetchImpl,
      logger: this.logger
    });
  }
}
