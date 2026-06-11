import type { Logger } from "pino";
import type {
  FetchRecentOptions,
  GovernanceSource,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../types.js";
import { LidoForumClient } from "./lidoForum.client.js";
import { normalizeLidoForumItem } from "./lido.normalizer.js";

export interface LidoAdapterOptions {
  enabled: boolean;
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  allowedPublishers: string[];
  maxPages: number;
  logger?: Logger;
  client?: LidoForumClient;
}

export class LidoAdapter implements ProtocolAdapter {
  readonly protocol = "lido";
  readonly source: GovernanceSource;
  readonly enabled: boolean;
  readonly publisherAllowlist: string[];
  private readonly client: LidoForumClient;
  private readonly logger?: Logger;
  private readonly maxPages: number;

  constructor(options: LidoAdapterOptions) {
    this.enabled = options.enabled;
    this.publisherAllowlist = options.allowedPublishers;
    this.maxPages = options.maxPages;
    this.source = {
      protocol: this.protocol,
      type: "forum",
      name: "Lido Research Forum",
      baseUrl: options.forumBaseUrl
    };
    this.client =
      options.client ??
      new LidoForumClient({
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
    const items: RawGovernanceItem[] = [];

    for (let page = 0; page < this.maxPages; page += 1) {
      const topicPage = await this.client.fetchRecentTopicPage({ page });
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

      items.push(...pageItems);

      const shouldStop =
        pageItems.length === 0 ||
        (await options.shouldStopAfterPage?.({
          page,
          items: pageItems,
          hasMore: topicPage.hasMore
        }));

      if (shouldStop || !topicPage.hasMore) {
        return items;
      }
    }

    this.logger?.warn(
      { protocol: this.protocol, maxPages: this.maxPages, fetchedCount: items.length },
      "Reached Lido proposal pagination limit before exhausting pages"
    );

    return items;
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeLidoForumItem(item);
  }
}
