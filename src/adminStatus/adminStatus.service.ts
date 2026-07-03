import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import type { ProtocolRegistry } from "../protocols/registry.js";
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
    const result = await buildAdminStatusReport({
      env: this.options.env,
      protocolRegistry: this.options.protocolRegistry,
      fetchRunRepository: this.options.fetchRunRepository,
      proposalRepository: this.options.proposalRepository,
      sourceActivityRepository: this.options.sourceActivityRepository
    });

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
  const enabledProtocols = options.protocolRegistry
    .list()
    .filter((adapter) => adapter.enabled)
    .map((adapter) => adapter.protocol);
  const fetchRuns = await options.fetchRunRepository.findAll(50);
  const pendingNotifications =
    await options.proposalRepository.findByNotificationStatus("pending", 20);
  const failedNotifications =
    await options.proposalRepository.findByNotificationStatus("failed", 20);
  const sourceActivityRecords = await options.sourceActivityRepository.findAll(100);
  const problems: string[] = [];
  const latestByProtocol = new Map<string, FetchRun>();
  const sourceActivityByProtocol = new Map<string, SourceActivityRecord>();

  for (const run of fetchRuns) {
    if (!latestByProtocol.has(run.protocol)) {
      latestByProtocol.set(run.protocol, run);
    }
  }

  for (const record of sourceActivityRecords) {
    sourceActivityByProtocol.set(record.protocol, record);
  }

  if (enabledProtocols.length === 0) {
    problems.push("No protocol adapters are enabled.");
  }

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

  for (const run of fetchRuns.filter((fetchRun) => fetchRun.status === "failed")) {
    problems.push(
      `${run.protocol} fetch failed at ${run.finishedAt ?? run.startedAt}${
        run.errors.length > 0 ? `: ${run.errors.join("; ")}` : "."
      }`
    );
  }

  for (const run of fetchRuns.filter((fetchRun) => fetchRun.notificationFailedCount > 0)) {
    problems.push(
      `${run.protocol} had ${run.notificationFailedCount} notification failure(s) in fetch run ${run.id}.`
    );
  }

  if (failedNotifications.length > 0) {
    problems.push(
      `${failedNotifications.length} proposal notification(s) are marked failed.`
    );
  }

  if (options.env.enableSourceActivityAlerts) {
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
      pendingNotificationCount: pendingNotifications.length,
      failedNotificationCount: failedNotifications.length,
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
  pendingNotificationCount: number;
  failedNotificationCount: number;
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
      `unchanged ${run.unchangedExistingCount}`,
      `skipped ${run.skippedCount}`,
      `notification failures ${run.notificationFailedCount}`
    ].join("; ");
  });
  const problemLines =
    options.problems.length > 0
      ? options.problems.map((problem) => `- ${escapeTelegramHtml(problem)}`)
      : ["- None detected."];
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

  return [
    "<b>GOVERNANCE MONITOR DAILY STATUS</b>",
    `Status: ${options.healthy ? "OK" : "ATTENTION REQUIRED"}`,
    `Checked at: ${escapeTelegramHtml(options.checkedAt)}`,
    `Storage: ${escapeTelegramHtml(options.env.demoMode ? "memory" : options.env.storageMode)}`,
    `Scheduler: ${options.env.enableScheduler ? "enabled" : "disabled"}`,
    `Enabled protocols: ${escapeTelegramHtml(options.enabledProtocols.join(", ") || "none")}`,
    `Pending notifications: ${options.pendingNotificationCount}`,
    `Failed notifications: ${options.failedNotificationCount}`,
    "",
    "Latest fetches:",
    ...latestFetchLines,
    "",
    "Source activity:",
    ...sourceActivityLines,
    "",
    "Problems:",
    ...problemLines
  ].join("\n");
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
