import type { Logger } from "pino";
import type {
  GovernanceSource,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../types.js";
import { collectDiscourseTopicPages } from "../discourse/discoursePagination.js";
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

  async fetchRecent(): Promise<RawGovernanceItem[]> {
    if (!this.enabled) {
      this.logger?.info({ protocol: this.protocol }, "Skipping disabled protocol adapter");
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const itemsBySourceId = new Map<string, RawGovernanceItem>();

    await collectDiscourseTopicPages({
      protocol: this.protocol,
      sourceType: this.source.type,
      fetchedAt,
      itemsBySourceId,
      maxPages: this.maxPages,
      fetchPage: (page) => this.client.fetchRecentTopicPage({ page }),
      logger: this.logger,
      paginationLimitMessage:
        "Reached Lido proposal pagination limit before exhausting pages",
      laterPageFailureMessage:
        "Stopped Lido proposal pagination after a later page failed"
    });

    return [...itemsBySourceId.values()];
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeLidoForumItem(item);
  }
}
