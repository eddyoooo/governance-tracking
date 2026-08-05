import type { Logger } from "pino";
import type {
  GovernanceSourceType,
  RawGovernanceItem
} from "../types.js";
import type { DiscourseForumTopicPage } from "./discourseForum.client.js";

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
): Promise<void> {
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
          error,
          ...options.logContext
        },
        options.laterPageFailureMessage
      );
      return;
    }

    const pageItems = topicPage.topics.map((topic) => ({
      protocol: options.protocol,
      sourceType: options.sourceType,
      sourceId: topic.sourceId,
      title: topic.title,
      publisherName: topic.publisherName,
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
      return;
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
}
