import type { Logger } from "pino";
import type {
  FetchRecentOptions,
  GovernanceSource,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../types.js";
import {
  AaveForumClient,
  type AaveForumTopicPage
} from "./aaveForum.client.js";
import { normalizeAaveForumItem } from "./aave.normalizer.js";

export interface AaveAdapterOptions {
  enabled: boolean;
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  allowedPublishers: string[];
  maxPages: number;
  categoryMaxPages: number;
  logger?: Logger;
  client?: AaveForumClient;
}

export class AaveAdapter implements ProtocolAdapter {
  readonly protocol = "aave";
  readonly source: GovernanceSource;
  readonly enabled: boolean;
  readonly publisherAllowlist: string[];
  private readonly client: AaveForumClient;
  private readonly logger?: Logger;
  private readonly maxPages: number;
  private readonly categoryMaxPages: number;

  constructor(options: AaveAdapterOptions) {
    this.enabled = options.enabled;
    this.publisherAllowlist = options.allowedPublishers;
    this.maxPages = options.maxPages;
    this.categoryMaxPages = options.categoryMaxPages;
    this.source = {
      protocol: this.protocol,
      type: "forum",
      name: "Aave Governance Forum",
      baseUrl: options.forumBaseUrl
    };
    this.client =
      options.client ??
      new AaveForumClient({
        baseUrl: options.forumBaseUrl,
        apiBaseUrl: options.forumApiBaseUrl,
        logger: options.logger
      });
    this.logger = options.logger;
  }

  async fetchRecent(options: FetchRecentOptions = {}): Promise<RawGovernanceItem[]> {
    if (!this.enabled) {
      this.logger?.info({ protocol: this.protocol }, "Skipping disabled protocol adapter");
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const itemsBySourceId = new Map<string, RawGovernanceItem>();

    await this.fetchTopicPages({
      fetchedAt,
      itemsBySourceId,
      maxPages: this.maxPages,
      fetchPage: (page) => this.client.fetchRecentTopicPage({ page }),
      fetchOptions: options,
      paginationLimitMessage:
        "Reached Aave global latest pagination limit before exhausting pages"
    });

    const categories = await this.client.fetchCategories();

    for (const category of categories) {
      await this.fetchTopicPages({
        fetchedAt,
        itemsBySourceId,
        maxPages: this.categoryMaxPages,
        fetchPage: (page) => this.client.fetchCategoryTopicPage(category, { page }),
        fetchOptions: options,
        logContext: {
          categoryId: category.id,
          categoryName: category.name,
          categoryPath: category.path
        },
        paginationLimitMessage:
          "Reached Aave category pagination limit before exhausting pages"
      });
    }

    return [...itemsBySourceId.values()];
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeAaveForumItem(item);
  }

  private async fetchTopicPages(options: {
    fetchedAt: string;
    itemsBySourceId: Map<string, RawGovernanceItem>;
    maxPages: number;
    fetchPage: (page: number) => Promise<Pick<AaveForumTopicPage, "topics" | "hasMore">>;
    fetchOptions: FetchRecentOptions;
    logContext?: Record<string, unknown>;
    paginationLimitMessage: string;
  }): Promise<void> {
    const { fetchedAt, itemsBySourceId, fetchPage } = options;

    for (let page = 0; page < options.maxPages; page += 1) {
      const topicPage = await fetchPage(page);
      const pageItems = topicPage.topics.map((topic) => ({
        protocol: this.protocol,
        sourceType: this.source.type,
        sourceId: topic.sourceId,
        title: topic.title,
        publisherName: topic.publisherName,
        sourceUrl: topic.sourceUrl,
        publishedAt: topic.publishedAt,
        fetchedAt,
        raw: topic.raw
      }));

      for (const item of pageItems) {
        if (!itemsBySourceId.has(item.sourceId)) {
          itemsBySourceId.set(item.sourceId, item);
        }
      }

      const shouldStop =
        pageItems.length === 0 ||
        (await options.fetchOptions.shouldStopAfterPage?.({
          page,
          items: pageItems,
          hasMore: topicPage.hasMore
        }));

      if (shouldStop || !topicPage.hasMore) {
        return;
      }
    }

    this.logger?.warn(
      {
        protocol: this.protocol,
        maxPages: options.maxPages,
        fetchedCount: itemsBySourceId.size,
        ...options.logContext
      },
      options.paginationLimitMessage
    );
  }
}
