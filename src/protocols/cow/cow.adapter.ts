import type { Logger } from "pino";
import { collectDiscourseForumTopics } from "../discourse/discoursePagination.js";
import type {
  GovernanceSource,
  GovernanceFetchBatch,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../types.js";
import { normalizeCowForumItem } from "./cow.normalizer.js";
import { CowForumClient } from "./cowForum.client.js";

export interface CowAdapterOptions {
  enabled: boolean;
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  allowedPublishers: string[];
  maxPages: number;
  categoryMaxPages: number;
  logger?: Logger;
  client?: CowForumClient;
}

export class CowAdapter implements ProtocolAdapter {
  readonly protocol = "cow";
  readonly source: GovernanceSource;
  readonly enabled: boolean;
  readonly publisherAllowlist: string[];
  private readonly client: CowForumClient;
  private readonly logger?: Logger;
  private readonly maxPages: number;
  private readonly categoryMaxPages: number;

  constructor(options: CowAdapterOptions) {
    this.enabled = options.enabled;
    this.publisherAllowlist = options.allowedPublishers;
    this.maxPages = options.maxPages;
    this.categoryMaxPages = options.categoryMaxPages;
    this.source = {
      protocol: this.protocol,
      type: "forum",
      name: "CoW DAO Forum",
      baseUrl: options.forumBaseUrl
    };
    this.client =
      options.client ??
      new CowForumClient({
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
      label: "CoW",
      sourceType: this.source.type,
      maxPages: this.maxPages,
      categoryMaxPages: this.categoryMaxPages,
      client: this.client,
      logger: this.logger
    });
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeCowForumItem(item);
  }
}
