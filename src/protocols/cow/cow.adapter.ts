import type { Logger } from "pino";
import { collectDiscourseTopicPages } from "../discourse/discoursePagination.js";
import type {
  GovernanceSource,
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
    if (!this.enabled) {
      this.logger?.info(
        { protocol: this.protocol },
        "Skipping disabled protocol adapter"
      );
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const itemsBySourceId = new Map<string, RawGovernanceItem>();
    const feedFailures: Array<{ feed: string; error: unknown }> = [];
    let successfulFeedCount = 0;

    try {
      await collectDiscourseTopicPages({
        protocol: this.protocol,
        sourceType: this.source.type,
        fetchedAt,
        itemsBySourceId,
        maxPages: this.maxPages,
        fetchPage: (page) => this.client.fetchRecentTopicPage({ page }),
        logger: this.logger,
        paginationLimitMessage:
          "Reached CoW global latest pagination limit before exhausting pages",
        laterPageFailureMessage:
          "Stopped CoW global latest pagination after a later page failed"
      });
      successfulFeedCount += 1;
    } catch (error) {
      feedFailures.push({ feed: "global latest", error });
    }

    let categories: Awaited<ReturnType<CowForumClient["fetchCategories"]>> = [];

    try {
      categories = await this.client.fetchCategories();
    } catch (error) {
      feedFailures.push({ feed: "category discovery", error });
    }

    for (const category of categories) {
      try {
        await collectDiscourseTopicPages({
          protocol: this.protocol,
          sourceType: this.source.type,
          fetchedAt,
          itemsBySourceId,
          maxPages: this.categoryMaxPages,
          fetchPage: (page) =>
            this.client.fetchCategoryTopicPage(category, { page }),
          logger: this.logger,
          logContext: {
            categoryId: category.id,
            categoryName: category.name,
            categoryPath: category.path
          },
          paginationLimitMessage:
            "Reached CoW category pagination limit before exhausting pages",
          laterPageFailureMessage:
            "Stopped CoW category pagination after a later page failed"
        });
        successfulFeedCount += 1;
      } catch (error) {
        feedFailures.push({
          feed: `category ${category.id} (${category.name})`,
          error
        });
      }
    }

    if (successfulFeedCount === 0) {
      throw new Error(
        `CoW forum fetch failed because no governance feed could be read: ${feedFailures
          .map(({ feed, error }) => `${feed}: ${errorMessage(error)}`)
          .join("; ")}`
      );
    }

    if (feedFailures.length > 0) {
      this.logger?.warn(
        {
          protocol: this.protocol,
          failedFeedCount: feedFailures.length,
          successfulFeedCount,
          failures: feedFailures
        },
        "CoW forum fetch completed with partial feed failures"
      );
    }

    return [...itemsBySourceId.values()];
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeCowForumItem(item);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
