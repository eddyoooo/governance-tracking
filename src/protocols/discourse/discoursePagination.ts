import type { Logger } from "pino";
import type {
  GovernanceFetchBatch,
  GovernanceSourceType,
  RawGovernanceItem
} from "../types.js";
import { errorMessage, safeErrorDetails } from "../../utils/errors.js";
import type {
  DiscourseForumCategory,
  DiscourseForumTopicPage
} from "./discourseForum.client.js";

export interface CollectDiscourseTopicPagesOptions {
  protocol: string;
  sourceType: GovernanceSourceType;
  fetchedAt: string;
  itemsBySourceId: Map<string, RawGovernanceItem>;
  maxPages: number;
  fetchPage: (
    page: number
  ) => Promise<Pick<DiscourseForumTopicPage, "topics" | "hasMore">>;
  logger?: Pick<Logger, "info" | "warn">;
  logContext?: Record<string, unknown>;
  paginationLimitMessage: string;
  laterPageFailureMessage: string;
}

export async function collectDiscourseTopicPages(
  options: CollectDiscourseTopicPagesOptions
): Promise<string[]> {
  for (let page = 0; page < options.maxPages; page += 1) {
    let topicPage: Pick<DiscourseForumTopicPage, "topics" | "hasMore">;

    try {
      topicPage = await options.fetchPage(page);
    } catch (error) {
      if (page === 0) {
        throw error;
      }

      options.logger?.warn(
        {
          protocol: options.protocol,
          failedPage: page,
          fetchedCount: options.itemsBySourceId.size,
          error: safeErrorDetails(error),
          ...options.logContext
        },
        options.laterPageFailureMessage
      );
      return [`${options.protocol} page ${page} failed: ${errorMessage(error)}`];
    }

    const pageItems = topicPage.topics.map((topic) => ({
      protocol: options.protocol,
      sourceType: options.sourceType,
      sourceId: topic.sourceId,
      title: topic.title,
      publisherName: topic.publisherName,
      publisherTrustLevel: topic.publisherTrustLevel,
      sourceUrl: topic.sourceUrl,
      publishedAt: topic.publishedAt,
      fetchedAt: options.fetchedAt,
      raw: topic.raw
    }));

    for (const item of pageItems) {
      if (!options.itemsBySourceId.has(item.sourceId)) {
        options.itemsBySourceId.set(item.sourceId, item);
      }
    }

    if (pageItems.length === 0 || !topicPage.hasMore) {
      return [];
    }
  }

  options.logger?.info(
    {
      protocol: options.protocol,
      maxPages: options.maxPages,
      fetchedCount: options.itemsBySourceId.size,
      ...options.logContext
    },
    options.paginationLimitMessage
  );
  return [];
}

interface DiscourseForumFeeds {
  fetchRecentTopicPage(options: { page: number }): Promise<DiscourseForumTopicPage>;
  fetchCategories(): Promise<DiscourseForumCategory[]>;
  fetchCategoryTopicPage(
    category: DiscourseForumCategory,
    options: { page: number }
  ): Promise<DiscourseForumTopicPage>;
}

export async function collectDiscourseForumTopics(options: {
  protocol: string;
  label: string;
  sourceType: GovernanceSourceType;
  maxPages: number;
  categoryMaxPages: number;
  client: DiscourseForumFeeds;
  logger?: Pick<Logger, "info" | "warn">;
}): Promise<GovernanceFetchBatch> {
  const fetchedAt = new Date().toISOString();
  const itemsBySourceId = new Map<string, RawGovernanceItem>();
  const warnings: string[] = [];
  const feedFailures: Array<{ feed: string; error: unknown }> = [];
  let successfulFeedCount = 0;
  const readFeed = async (
    feed: string,
    maxPages: number,
    fetchPage: CollectDiscourseTopicPagesOptions["fetchPage"],
    logContext?: Record<string, unknown>
  ) => {
    try {
      const feedType = logContext ? "category" : "global latest";
      const pageWarnings = await collectDiscourseTopicPages({
        protocol: options.protocol,
        sourceType: options.sourceType,
        fetchedAt,
        itemsBySourceId,
        maxPages,
        fetchPage,
        logger: options.logger,
        logContext,
        paginationLimitMessage:
          `Reached ${options.label} ${feedType} pagination limit before exhausting pages`,
        laterPageFailureMessage:
          `Stopped ${options.label} ${feedType} pagination after a later page failed`
      });
      warnings.push(...pageWarnings);
      successfulFeedCount++;
    } catch (error) {
      feedFailures.push({ feed, error });
    }
  };

  await readFeed("global latest", options.maxPages, (page) =>
    options.client.fetchRecentTopicPage({ page })
  );
  let categories: DiscourseForumCategory[] = [];
  try {
    categories = await options.client.fetchCategories();
  } catch (error) {
    feedFailures.push({ feed: "category discovery", error });
  }
  for (const category of categories) {
    await readFeed(
      `category ${category.id} (${category.name})`,
      options.categoryMaxPages,
      (page) => options.client.fetchCategoryTopicPage(category, { page }),
      {
        categoryId: category.id,
        categoryName: category.name,
        categoryPath: category.path
      }
    );
  }
  warnings.push(...feedFailures.map(({ feed, error }) => `${feed}: ${errorMessage(error)}`));
  if (successfulFeedCount === 0) {
    throw new Error(
      `${options.label} forum fetch failed because no governance feed could be read: ${warnings.join("; ")}`
    );
  }
  if (feedFailures.length > 0) {
    options.logger?.warn(
      {
        protocol: options.protocol,
        failedFeedCount: feedFailures.length,
        successfulFeedCount,
        failures: feedFailures.map(({ feed, error }) => ({
          feed,
          error: safeErrorDetails(error)
        }))
      },
      `${options.label} forum fetch completed with partial feed failures`
    );
  }
  return { items: [...itemsBySourceId.values()], warnings };
}
