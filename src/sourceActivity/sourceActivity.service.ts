import type { Env } from "../config/env.js";
import type {
  GovernanceSource,
  RawGovernanceItem
} from "../protocols/types.js";
import type {
  SourceActivityRecord,
  SourceActivityRepository,
  SourceActivityStatus
} from "../storage/sourceActivity.repository.js";

export interface SourceActivityConfig {
  warningDays: number;
  criticalDays: number;
  minFetchedCount: number;
}

export interface UpdateSourceActivityOptions {
  repository: SourceActivityRepository;
  source: GovernanceSource;
  rawItems: RawGovernanceItem[];
  fetchedAt: string;
  config: SourceActivityConfig;
}

export function sourceActivityConfigFromEnv(env: Env): SourceActivityConfig {
  return {
    warningDays: env.sourceActivityWarningDays,
    criticalDays: env.sourceActivityCriticalDays,
    minFetchedCount: env.sourceActivityMinFetchedCount
  };
}

export function findNewestRawGovernanceItem(
  rawItems: RawGovernanceItem[]
): RawGovernanceItem | null {
  const itemsWithValidPublishedAt = rawItems.filter((item) =>
    Number.isFinite(Date.parse(item.publishedAt))
  );

  return (
    itemsWithValidPublishedAt.sort(
      (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    )[0] ?? null
  );
}

export async function updateSourceActivity(
  options: UpdateSourceActivityOptions
): Promise<SourceActivityRecord> {
  const existing = await options.repository.findByProtocol(
    options.source.protocol
  );
  const newestRawItem = findNewestRawGovernanceItem(options.rawItems);
  const sourceAdvanced = Boolean(
    newestRawItem &&
      (existing?.latestRawSourceId !== newestRawItem.sourceId ||
        existing?.latestRawPublishedAt !== newestRawItem.publishedAt)
  );
  const consecutiveStaleRuns =
    existing && !sourceAdvanced ? existing.consecutiveStaleRuns + 1 : 0;
  const statusResult = computeSourceActivityStatus({
    fetchedAt: options.fetchedAt,
    latestRawPublishedAt: newestRawItem?.publishedAt,
    fetchedCount: options.rawItems.length,
    config: options.config
  });
  const record: SourceActivityRecord = {
    protocol: options.source.protocol,
    sourceType: options.source.type,
    latestRawSourceId: newestRawItem?.sourceId ?? existing?.latestRawSourceId,
    latestRawPublishedAt:
      newestRawItem?.publishedAt ?? existing?.latestRawPublishedAt,
    lastFetchedAt: options.fetchedAt,
    lastFetchedCount: options.rawItems.length,
    consecutiveStaleRuns,
    status: statusResult.status,
    statusReason: statusResult.statusReason,
    warningThresholdDays: options.config.warningDays,
    criticalThresholdDays: options.config.criticalDays,
    minFetchedCount: options.config.minFetchedCount,
    createdAt: existing?.createdAt ?? options.fetchedAt,
    updatedAt: options.fetchedAt
  };

  await options.repository.upsert(record);

  return record;
}

function computeSourceActivityStatus(options: {
  fetchedAt: string;
  latestRawPublishedAt?: string;
  fetchedCount: number;
  config: SourceActivityConfig;
}): { status: SourceActivityStatus; statusReason?: string } {
  if (options.fetchedCount < options.config.minFetchedCount) {
    return {
      status: "critical",
      statusReason: `Fetched ${options.fetchedCount} raw item(s), below minimum ${options.config.minFetchedCount}.`
    };
  }

  if (!options.latestRawPublishedAt) {
    return {
      status: "critical",
      statusReason: "No valid raw item publishedAt timestamp was found."
    };
  }

  const latestPublishedAt = Date.parse(options.latestRawPublishedAt);
  const fetchedAt = Date.parse(options.fetchedAt);

  if (!Number.isFinite(latestPublishedAt) || !Number.isFinite(fetchedAt)) {
    return {
      status: "critical",
      statusReason: "Source activity timestamps could not be parsed."
    };
  }

  const ageDays = Math.max(
    0,
    Math.floor((fetchedAt - latestPublishedAt) / 86_400_000)
  );

  if (ageDays >= options.config.criticalDays) {
    return {
      status: "critical",
      statusReason: `Newest raw source item is ${ageDays} day(s) old, at or above critical threshold ${options.config.criticalDays}.`
    };
  }

  if (ageDays >= options.config.warningDays) {
    return {
      status: "warning",
      statusReason: `Newest raw source item is ${ageDays} day(s) old, at or above warning threshold ${options.config.warningDays}.`
    };
  }

  return { status: "healthy" };
}
