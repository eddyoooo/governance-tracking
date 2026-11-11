import type { Logger } from "pino";
import type {
  GovernanceSource,
  GovernanceFetchBatch,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../types.js";
import { collectDiscourseForumTopics } from "../discourse/discoursePagination.js";
import { UniswapForumClient } from "./uniswapForum.client.js";
import { normalizeUniswapForumItem } from "./uniswap.normalizer.js";

export interface UniswapAdapterOptions {
  enabled: boolean;
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  allowedPublishers: string[];
  maxPages: number;
  categoryMaxPages: number;
  logger?: Logger;
  client?: UniswapForumClient;
}

export class UniswapAdapter implements ProtocolAdapter {
  readonly protocol = "uniswap";
  readonly source: GovernanceSource;
  readonly enabled: boolean;
  readonly publisherAllowlist: string[];
  private readonly client: UniswapForumClient;
  private readonly logger?: Logger;
  private readonly maxPages: number;
  private readonly categoryMaxPages: number;

  constructor(options: UniswapAdapterOptions) {
    this.enabled = options.enabled;
    this.publisherAllowlist = options.allowedPublishers;
    this.maxPages = options.maxPages;
    this.categoryMaxPages = options.categoryMaxPages;
    this.source = {
      protocol: this.protocol,
      type: "forum",
      name: "Uniswap Governance Forum",
      baseUrl: options.forumBaseUrl
    };
    this.client =
      options.client ??
      new UniswapForumClient({
        baseUrl: options.forumBaseUrl,
        apiBaseUrl: options.forumApiBaseUrl,
        logger: options.logger
      });
    this.logger = options.logger;
  }

  async fetchRecent(): Promise<RawGovernanceItem[]> {
    return (await this.fetchRecentWithDiagnostics()).items;
  }

  async fetchRecentWithDiagnostics(): Promise<GovernanceFetchBatch> {
    if (!this.enabled) {
      this.logger?.info({ protocol: this.protocol }, "Skipping disabled protocol adapter");
      return { items: [], warnings: [] };
    }

    return collectDiscourseForumTopics({
      protocol: this.protocol,
      label: "Uniswap",
      sourceType: this.source.type,
      maxPages: this.maxPages,
      categoryMaxPages: this.categoryMaxPages,
      client: this.client,
      logger: this.logger
    });
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeUniswapForumItem(item);
  }
}
