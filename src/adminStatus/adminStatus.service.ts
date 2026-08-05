import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import type { ProtocolRegistry } from "../protocols/registry.js";
import type { StoredProposal } from "../protocols/types.js";
import type { FetchRun } from "../storage/fetchRun.repository.js";
import type { FetchRunRepository } from "../storage/fetchRun.repository.js";
import type { ProposalRepository } from "../storage/proposal.repository.js";
import type {
  SourceActivityRecord,
  SourceActivityRepository
} from "../storage/sourceActivity.repository.js";
import { TelegramAdminStatusNotifier } from "./telegramAdminStatus.service.js";

export interface AdminStatusNotifier {
  readonly name: string;
  readonly enabled: boolean;
  send(message: string): Promise<void>;
}

export interface AdminStatusReporter {
  readonly enabled: boolean;
  sendDailyStatusReport(): Promise<AdminStatusReportResult>;
}

export interface AdminStatusReportResult {
  healthy: boolean;
  message: string;
  problems: string[];
}

export class NoopAdminStatusReporter implements AdminStatusReporter {
  readonly enabled = false;

  async sendDailyStatusReport(): Promise<AdminStatusReportResult> {
    return {
      healthy: true,
      message: "",
      problems: []
    };
  }
}

export class DailyAdminStatusReporter implements AdminStatusReporter {
  readonly enabled = true;

  constructor(
    private readonly options: {
      env: Env;
      protocolRegistry: ProtocolRegistry;
      fetchRunRepository: FetchRunRepository;
      proposalRepository: ProposalRepository;
      sourceActivityRepository: SourceActivityRepository;
      notifier: AdminStatusNotifier;
      logger?: Pick<Logger, "info" | "error">;
    }
  ) {}

  async sendDailyStatusReport(): Promise<AdminStatusReportResult> {
    let result: AdminStatusReportResult;

    try {
      result = await buildAdminStatusReport({
        env: this.options.env,
        protocolRegistry: this.options.protocolRegistry,
        fetchRunRepository: this.options.fetchRunRepository,
        proposalRepository: this.options.proposalRepository,
        sourceActivityRepository: this.options.sourceActivityRepository
      });
    } catch (error) {
      const message = errorMessage(error);

      result = {
        healthy: false,
        problems: [`Unable to build admin status report: ${message}`],
        message: formatAdminStatusMessage({
          env: this.options.env,
          enabledProtocols: [],
          latestByProtocol: new Map(),
          sourceActivityByProtocol: new Map(),
          pendingNotificationCount: null,
          failedNotificationCount: null,
          failedNotifications: null,
          healthy: false,
          problems: [`Unable to build admin status report: ${message}`],
          checkedAt: new Date().toISOString()
        })
      };
    }

    await this.options.notifier.send(result.message);
    this.options.logger?.info(
      {
        healthy: result.healthy,
        problemCount: result.problems.length,
        notifier: this.options.notifier.name
      },
      "Sent daily admin status report"
    );

    return result;
  }
}

export function createAdminStatusReporter(options: {
  env: Env;
  protocolRegistry: ProtocolRegistry;
  fetchRunRepository: FetchRunRepository;
  proposalRepository: ProposalRepository;
  sourceActivityRepository: SourceActivityRepository;
  logger: Logger;
}): AdminStatusReporter {
  if (!options.env.enableAdminStatusReports) {
    options.logger.info("Admin status reports disabled");
    return new NoopAdminStatusReporter();
  }

  if (!options.env.telegramBotToken || !options.env.telegramAdminUserId) {
    throw new Error(
      "Admin status reports are enabled but TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_USER_ID must be set."
    );
  }

  return new DailyAdminStatusReporter({
    ...options,
    notifier: new TelegramAdminStatusNotifier({
      botToken: options.env.telegramBotToken,
      adminUserId: options.env.telegramAdminUserId,
      logger: options.logger
    })
  });
}

export async function buildAdminStatusReport(options: {
  env: Env;
  protocolRegistry: ProtocolRegistry;
  fetchRunRepository: FetchRunRepository;
  proposalRepository: ProposalRepository;
  sourceActivityRepository: SourceActivityRepository;
}): Promise<AdminStatusReportResult> {
  const problems: string[] = [];
  const enabledAdapters = options.protocolRegistry
    .list()
    .filter((adapter) => adapter.enabled);
  const enabledProtocols = enabledAdapters.map((adapter) => adapter.protocol);
  const fetchRunsResult = await readReportSection(
    () => options.fetchRunRepository.findAll(50),
    "fetch runs"
  );
  const pendingNotificationCountResult = await readReportCount(
    () => options.proposalRepository.countByNotificationStatus("pending"),
    "pending notification count"
  );
  const failedNotificationCountResult = await readReportCount(
    () => options.proposalRepository.countByNotificationStatus("failed"),
    "failed notification count"
  );
  const failedNotificationsResult = await readReportSection(
    () => options.proposalRepository.findByNotificationStatus("failed", 20),
    "failed notification details"
  );
  const sourceActivityRecordsResult = await readReportSection(
    () => options.sourceActivityRepository.findAll(100),
    "source activity records"
  );
  const fetchRuns = fetchRunsResult.records ?? [];
  const pendingNotificationCount = pendingNotificationCountResult.count;
  const failedNotificationCount = failedNotificationCountResult.count;
  const failedNotifications = failedNotificationsResult.records;
  const sourceActivityRecords = sourceActivityRecordsResult.records ?? [];
  const latestByProtocol = new Map<string, FetchRun>();
  const sourceActivityByProtocol = new Map<string, SourceActivityRecord>();

  for (const result of [
    fetchRunsResult,
    failedNotificationsResult,
    sourceActivityRecordsResult
  ]) {
    if (result.error) {
      problems.push(result.error);
    }
  }

  for (const result of [
    pendingNotificationCountResult,
    failedNotificationCountResult
  ]) {
    if (result.error) {
      problems.push(result.error);
    }
  }

  for (const run of fetchRuns) {
    if (!latestByProtocol.has(run.protocol)) {
      latestByProtocol.set(run.protocol, run);
    }
  }

  for (const protocol of enabledProtocols) {
    if (latestByProtocol.has(protocol)) {
      continue;
    }

    const latestRunResult = await readReportValue(
      () => options.fetchRunRepository.findLatestByProtocol(protocol),
      `latest ${protocol} fetch run`
    );

    if (latestRunResult.error) {
      problems.push(latestRunResult.error);
    } else if (latestRunResult.value) {
      latestByProtocol.set(protocol, latestRunResult.value);
    }
  }

  for (const record of sourceActivityRecords) {
    sourceActivityByProtocol.set(record.protocol, record);
  }

  if (enabledProtocols.length === 0) {
    problems.push("No protocol adapters are enabled.");
  }

  for (const adapter of enabledAdapters) {
    if (adapter.publisherAllowlist.length === 0) {
      problems.push(
        `${adapter.protocol} is enabled but its publisher allowlist is empty.`
      );
    }
  }

  if (fetchRunsResult.records) {
    for (const protocol of enabledProtocols) {
      const latestRun = latestByProtocol.get(protocol);

      if (!latestRun) {
        problems.push(`No fetch run has been recorded for ${protocol}.`);
        continue;
      }

      if (latestRun.status !== "success") {
        problems.push(
          `${protocol} latest fetch is ${latestRun.status}${
            latestRun.errors.length > 0 ? `: ${latestRun.errors.join("; ")}` : "."
          }`
        );
      }
    }

  }

  if (pendingNotificationCount && pendingNotificationCount > 0) {
    problems.push(
      `${pendingNotificationCount} proposal notification(s) are pending automatic delivery.`
    );
  }

  if (failedNotificationCount && failedNotificationCount > 0) {
    problems.push(
      `${failedNotificationCount} proposal notification(s) have unresolved recipient deliveries.`
    );
  }

  if (options.env.enableSourceActivityAlerts && sourceActivityRecordsResult.records) {
    for (const protocol of enabledProtocols) {
      const sourceActivity = sourceActivityByProtocol.get(protocol);

      if (!sourceActivity) {
        problems.push(`No source activity record has been recorded for ${protocol}.`);
        continue;
      }

      if (sourceActivity.status !== "healthy") {
        problems.push(
          `${protocol} source activity is ${sourceActivity.status}: ${
            sourceActivity.statusReason ?? "No status reason recorded."
          }`
        );
      }
    }
  }

  const healthy = problems.length === 0;

  return {
    healthy,
    problems,
    message: formatAdminStatusMessage({
      env: options.env,
      enabledProtocols,
      latestByProtocol,
      sourceActivityByProtocol,
      pendingNotificationCount,
      failedNotificationCount,
      failedNotifications: failedNotifications ?? null,
      healthy,
      problems,
      checkedAt: new Date().toISOString()
    })
  };
}

export function formatAdminStatusMessage(options: {
  env: Env;
  enabledProtocols: string[];
  latestByProtocol: Map<string, FetchRun>;
  sourceActivityByProtocol: Map<string, SourceActivityRecord>;
  pendingNotificationCount: number | null;
  failedNotificationCount: number | null;
  failedNotifications: StoredProposal[] | null;
  healthy: boolean;
  problems: string[];
  checkedAt: string;
}): string {
  const latestFetchLines = options.enabledProtocols.map((protocol) => {
    const run = options.latestByProtocol.get(protocol);

    if (!run) {
      return `- ${escapeTelegramHtml(protocol)}: no fetch run recorded`;
    }

    return [
      `- ${escapeTelegramHtml(protocol)}: ${escapeTelegramHtml(run.status)}`,
      `finished ${escapeTelegramHtml(run.finishedAt ?? "not finished")}`,
      `fetched ${run.fetchedCount}`,
      `allowlisted ${run.allowlistedCount}`,
      `new ${run.storedNewCount}`,
      `silently seeded ${run.baselineSeededCount ?? 0}`,
      `unchanged ${run.unchangedExistingCount}`,
      `skipped ${run.skippedCount}`,
      `initial notification failures ${run.notificationFailedCount}`
    ].join("; ");
  });
  const problemLines =
    options.problems.length > 0
      ? options.problems.map((problem) => `- ${escapeTelegramHtml(problem)}`)
      : ["- None detected."];
  const failedNotificationLines = formatFailedNotificationLines(
    options.failedNotifications,
    options.failedNotificationCount,
    options.env
  );
  const sourceActivityLines = options.enabledProtocols.map((protocol) => {
    const record = options.sourceActivityByProtocol.get(protocol);

    if (!record) {
      return `- ${escapeTelegramHtml(protocol)}: no source activity recorded`;
    }

    return [
      `- ${escapeTelegramHtml(protocol)}: ${escapeTelegramHtml(record.status)}`,
      `latest raw ${escapeTelegramHtml(record.latestRawSourceId ?? "unknown")}`,
      `published ${escapeTelegramHtml(record.latestRawPublishedAt ?? "unknown")}`,
      `fetched ${record.lastFetchedCount}`,
      `stale runs ${record.consecutiveStaleRuns}`
    ].join("; ");
  });

  return enforceTelegramMessageLimit([
    "<b>GOVERNANCE MONITOR DAILY STATUS</b>",
    `Status: ${options.healthy ? "OK" : "ATTENTION REQUIRED"}`,
    `Checked at: ${escapeTelegramHtml(options.checkedAt)}`,
    `Storage: ${escapeTelegramHtml(options.env.demoMode ? "memory" : options.env.storageMode)}`,
    `Scheduler: ${options.env.enableScheduler ? "enabled" : "disabled"}`,
    `Enabled protocols: ${escapeTelegramHtml(options.enabledProtocols.join(", ") || "none")}`,
    `Pending notifications: ${formatOptionalCount(options.pendingNotificationCount)}`,
    `Failed notifications: ${formatOptionalCount(options.failedNotificationCount)}`,
    "",
    "Latest fetches:",
    ...latestFetchLines,
    "",
    "Source activity:",
    ...sourceActivityLines,
    "",
    "Problems:",
    ...problemLines,
    ...failedNotificationLines
  ].join("\n"));
}

function formatFailedNotificationLines(
  failedNotifications: StoredProposal[] | null,
  failedNotificationCount: number | null,
  env: Env
): string[] {
  if (!failedNotifications || failedNotifications.length === 0) {
    return [];
  }

  const visibleFailures = failedNotifications.slice(0, 5);
  const totalCount = failedNotificationCount ?? failedNotifications.length;
  const lines = [
    "",
    `Failed notification details${totalCount > visibleFailures.length ? ` (showing ${visibleFailures.length} of ${totalCount})` : ""}:`
  ];

  for (const proposal of visibleFailures) {
    lines.push(
      [
        `- ${escapeTelegramHtml(proposal.protocol)}/${escapeTelegramHtml(
          proposal.sourceType
        )}/${escapeTelegramHtml(proposal.sourceId)}`,
        `publisher ${escapeTelegramHtml(proposal.publisherName)}`,
        `title ${escapeTelegramHtml(truncate(proposal.title, 110))}`,
        ...formatFailedRecipientDetails(proposal, env),
        `link ${escapeTelegramHtml(proposal.sourceUrl)}`
      ].join("; ")
    );
  }

  return lines;
}

function formatFailedRecipientDetails(
  proposal: StoredProposal,
  env: Env
): string[] {
  const failedDeliveries = Object.values(
    proposal.notificationDeliveries ?? {}
  ).filter((delivery) => delivery.status === "failed");

  if (failedDeliveries.length === 0) {
    return [
      `reason ${escapeTelegramHtml(
        describeNotificationFailure(proposal.notificationError, env)
      )}`
    ];
  }

  return failedDeliveries.slice(0, 5).map(
    (delivery) =>
      `recipient ${escapeTelegramHtml(delivery.recipientMaskedId)}; attempts ${
        delivery.attemptCount
      }; next retry ${escapeTelegramHtml(
        delivery.nextRetryAt ?? "next recovery cycle"
      )}; reason ${escapeTelegramHtml(
        truncate(delivery.lastError ?? "No notification error recorded.", 220)
      )}`
  );
}

function describeNotificationFailure(
  notificationError: string | undefined,
  env: Env
): string {
  const rawError = notificationError?.trim() || "No notification error recorded.";
  const recipientMatch = rawError.match(/recipient\s+(\d+)/i);
  const recipientIndex = recipientMatch ? Number(recipientMatch[1]) : null;
  const recipientId =
    recipientIndex && recipientIndex > 0
      ? env.telegramAllowedUserIds[recipientIndex - 1]
      : undefined;
  const withRecipient =
    recipientIndex && recipientId
      ? rawError.replace(
          new RegExp(`recipient\\s+${recipientIndex}(?!\\s*\\()`, "i"),
          `recipient ${recipientIndex} (${maskTelegramUserId(recipientId)})`
        )
      : rawError;

  return truncate(redactLongNumbers(withRecipient), 320);
}

function maskTelegramUserId(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length <= 4) {
    return "[redacted]";
  }

  return `${"*".repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}

function redactLongNumbers(value: string): string {
  return value.replace(/\b\d{8,}\b/g, (match) => maskTelegramUserId(match));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function readReportSection<T>(
  read: () => Promise<T[]>,
  label: string
): Promise<{ records: T[] | null; error?: string }> {
  try {
    return {
      records: await read()
    };
  } catch (error) {
    return {
      records: null,
      error: `Unable to read ${label}: ${errorMessage(error)}`
    };
  }
}

async function readReportCount(
  read: () => Promise<number>,
  label: string
): Promise<{ count: number | null; error?: string }> {
  try {
    return {
      count: await read()
    };
  } catch (error) {
    return {
      count: null,
      error: `Unable to read ${label}: ${errorMessage(error)}`
    };
  }
}

async function readReportValue<T>(
  read: () => Promise<T>,
  label: string
): Promise<{ value: T | null; error?: string }> {
  try {
    return {
      value: await read()
    };
  } catch (error) {
    return {
      value: null,
      error: `Unable to read ${label}: ${errorMessage(error)}`
    };
  }
}

function formatOptionalCount(count: number | null): string {
  return count === null ? "unknown" : String(count);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function enforceTelegramMessageLimit(message: string): string {
  const safeLimit = 3_900;

  if (message.length <= safeLimit) {
    return message;
  }

  const suffix =
    "\n\nReport truncated. Inspect Firestore and application logs for full details.";
  const boundary = message.lastIndexOf("\n", safeLimit - suffix.length);

  return `${message.slice(0, Math.max(boundary, 0))}${suffix}`;
}
