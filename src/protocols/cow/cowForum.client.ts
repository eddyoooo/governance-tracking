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

export const cowRecentTopicsResponseSchema = discourseRecentTopicsResponseSchema;
export const cowSiteResponseSchema = discourseSiteResponseSchema;
export type CowRecentTopicsResponse = DiscourseRecentTopicsResponse;
export type CowSiteResponse = DiscourseSiteResponse;
export type CowForumCategory = DiscourseForumCategory;
export type CowForumTopic = DiscourseForumTopic;
export type CowForumTopicPage = DiscourseForumTopicPage;

export interface CowForumClientOptions {
  baseUrl: string;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Logger, "debug" | "error">;
}

export class CowForumClient {
  private readonly baseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Pick<Logger, "debug" | "error">;

  constructor(options: CowForumClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  async fetchRecentTopics(
    options: { page?: number } = {}
  ): Promise<CowForumTopic[]> {
    const topicPage = await this.fetchRecentTopicPage(options);

    return topicPage.topics;
  }

  async fetchCategories(): Promise<CowForumCategory[]> {
    const payload = await this.fetchJson("/site.json");
    const parsed = cowSiteResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { issues: parsed.error.issues },
        "Failed to validate CoW site response"
      );
      throw new Error("Invalid CoW site response.");
    }

    return mapDiscourseCategories(parsed.data);
  }

  async fetchRecentTopicPage(
    options: { page?: number } = {}
  ): Promise<CowForumTopicPage> {
    const page = options.page ?? 0;
    const payload = await this.fetchJson(`/latest.json?page=${page}`);
    const parsed = cowRecentTopicsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { issues: parsed.error.issues },
        "Failed to validate CoW recent topics response"
      );
      throw new Error("Invalid CoW recent topics response.");
    }

    return toDiscourseTopicPage(page, parsed.data, this.baseUrl);
  }

  async fetchCategoryTopicPage(
    category: CowForumCategory,
    options: { page?: number } = {}
  ): Promise<CowForumTopicPage> {
    const page = options.page ?? 0;
    const payload = await this.fetchJson(`${category.path}?page=${page}`);
    const parsed = cowRecentTopicsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger?.error(
        { category, issues: parsed.error.issues },
        "Failed to validate CoW category topics response"
      );
      throw new Error("Invalid CoW category topics response.");
    }

    return toDiscourseTopicPage(page, parsed.data, this.baseUrl);
  }

  private async fetchJson(pathname: string): Promise<unknown> {
    return fetchDiscourseJson({
      apiBaseUrl: this.apiBaseUrl,
      pathname,
      forumLabel: "CoW forum",
      fetchImpl: this.fetchImpl,
      logger: this.logger
    });
  }
}
