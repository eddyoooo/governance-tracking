import type { Logger } from "pino";
import type {
  GovernanceSource,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../types.js";
import { collectDiscourseTopicPages } from "../discourse/discoursePagination.js";
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
    if (!this.enabled) {
      this.logger?.info({ protocol: this.protocol }, "Skipping disabled protocol adapter");
      return [];
    }

    const fetchedAt = new Date().toISOString();
    const itemsBySourceId = new Map<string, RawGovernanceItem>();
    const feedFailures: Array<{
      feed: string;
      error: unknown;
    }> = [];
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
          "Reached Uniswap global latest pagination limit before exhausting pages",
        laterPageFailureMessage:
          "Stopped Uniswap global latest pagination after a later page failed"
      });
      successfulFeedCount += 1;
    } catch (error) {
      feedFailures.push({ feed: "global latest", error });
    }

    let categories: Awaited<
      ReturnType<UniswapForumClient["fetchCategories"]>
    > = [];

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
            "Reached Uniswap category pagination limit before exhausting pages",
          laterPageFailureMessage:
            "Stopped Uniswap category pagination after a later page failed"
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
        `Uniswap forum fetch failed because no governance feed could be read: ${feedFailures
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
        "Uniswap forum fetch completed with partial feed failures"
      );
    }

    return [...itemsBySourceId.values()];
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeUniswapForumItem(item);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
