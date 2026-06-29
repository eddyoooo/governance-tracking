import type { Logger } from "pino";
import {
  discourseRecentTopicsResponseSchema,
  fetchDiscourseJson,
  toDiscourseTopicPage,
  type DiscourseForumTopic,
  type DiscourseForumTopicPage,
  type DiscourseRecentTopicsResponse
} from "../discourse/discourseForum.client.js";

export const lidoRecentTopicsResponseSchema = discourseRecentTopicsResponseSchema;
export type LidoRecentTopicsResponse = DiscourseRecentTopicsResponse;
export type LidoForumTopic = DiscourseForumTopic;
export type LidoForumTopicPage = DiscourseForumTopicPage;

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
    const topicPage = await this.fetchRecentTopicPage(options);

    return topicPage.topics;
  }

  async fetchRecentTopicPage(
    options: { page?: number } = {}
  ): Promise<LidoForumTopicPage> {
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

    return toDiscourseTopicPage(page, parsed.data, this.baseUrl);
  }

  private async fetchJson(pathname: string): Promise<unknown> {
    return fetchDiscourseJson({
      apiBaseUrl: this.apiBaseUrl,
      pathname,
      forumLabel: "Lido forum",
      fetchImpl: this.fetchImpl,
      logger: this.logger
    });
  }
}
