import type { Logger } from "pino";
import type { NotificationPolicy } from "../../notifications/notificationPolicy.js";
import type {
  GovernanceSource,
  GovernanceFetchBatch,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../types.js";
import { collectDiscourseForumTopics } from "../discourse/discoursePagination.js";
import { AaveForumClient } from "./aaveForum.client.js";
import { normalizeAaveForumItem } from "./aave.normalizer.js";
import { aaveRoutineCapNotificationPolicy } from "./aaveNotificationPolicy.js";

export interface AaveAdapterOptions {
  enabled: boolean;
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  allowedPublishers: string[];
  maxPages: number;
  categoryMaxPages: number;
  suppressRoutineCapNotifications?: boolean;
  logger?: Logger;
  client?: AaveForumClient;
}

export class AaveAdapter implements ProtocolAdapter {
  readonly protocol = "aave";
  readonly source: GovernanceSource;
  readonly enabled: boolean;
  readonly publisherAllowlist: string[];
  readonly notificationPolicy?: NotificationPolicy;
  private readonly client: AaveForumClient;
  private readonly logger?: Logger;
  private readonly maxPages: number;
  private readonly categoryMaxPages: number;

  constructor(options: AaveAdapterOptions) {
    this.enabled = options.enabled;
    this.publisherAllowlist = options.allowedPublishers;
    this.notificationPolicy =
      options.suppressRoutineCapNotifications === false
        ? undefined
        : aaveRoutineCapNotificationPolicy;
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
      label: "Aave",
      sourceType: this.source.type,
      maxPages: this.maxPages,
      categoryMaxPages: this.categoryMaxPages,
      client: this.client,
      logger: this.logger
    });
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeAaveForumItem(item);
  }
}
