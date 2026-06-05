import type { Logger } from "pino";
import type {
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

  constructor(options: LidoAdapterOptions) {
    this.enabled = options.enabled;
    this.publisherAllowlist = options.allowedPublishers;
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

  async fetchRecent(): Promise<RawGovernanceItem[]> {
    if (!this.enabled) {
      this.logger?.info({ protocol: this.protocol }, "Skipping disabled protocol adapter");
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const topics = await this.client.fetchRecentTopics();

    return topics.map((topic) => ({
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
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeLidoForumItem(item);
  }
}
