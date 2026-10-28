import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import type { ProtocolRegistry } from "../protocols/registry.js";
import type { StoredProposal } from "../protocols/types.js";
import type { EvmGovernanceRegistry } from "../onchain/registry.js";
import type {
  GovernanceLifecycleEvent,
  GovernanceScanRun,
  GovernanceSourceState
} from "../onchain/types.js";
import type { FetchRun } from "../storage/fetchRun.repository.js";
import type { FetchRunRepository } from "../storage/fetchRun.repository.js";
import type { GovernanceRepository } from "../storage/governance.repository.js";
import type { ProposalRepository } from "../storage/proposal.repository.js";
import type {
  SourceActivityRecord,
  SourceActivityRepository
} from "../storage/sourceActivity.repository.js";
import { errorMessage } from "../utils/errors.js";
import { TelegramAdminStatusNotifier } from "./telegramAdminStatus.service.js";

const ONCHAIN_SCAN_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

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
      governanceRepository?: GovernanceRepository;
      evmGovernanceRegistry?: EvmGovernanceRegistry;
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
        sourceActivityRepository: this.options.sourceActivityRepository,
        governanceRepository: this.options.governanceRepository,
        evmGovernanceRegistry: this.options.evmGovernanceRegistry
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
  governanceRepository?: GovernanceRepository;
  evmGovernanceRegistry?: EvmGovernanceRegistry;
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
  governanceRepository?: GovernanceRepository;
  evmGovernanceRegistry?: EvmGovernanceRegistry;
  checkedAt?: Date;
}): Promise<AdminStatusReportResult> {
  const checkedAt = options.checkedAt ?? new Date();
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
  const enabledOnchainAdapters =
    options.evmGovernanceRegistry?.list().filter((adapter) => adapter.enabled) ?? [];
  const onchainReads = await readOnchainAdminStatus(
    enabledOnchainAdapters.map((adapter) => adapter.sourceKey),
    options.governanceRepository
  );
  const fetchRuns = fetchRunsResult.records ?? [];
  const pendingNotificationCount = sumOptionalCounts(
    pendingNotificationCountResult.count,
    onchainReads.pendingNotificationCount
  );
  const failedNotificationCount = sumOptionalCounts(
    failedNotificationCountResult.count,
    onchainReads.failedNotificationCount
  );
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

  problems.push(...onchainReads.errors);

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
            latestRun.errors.length > 0
              ? `: ${latestRun.errors.map(errorMessage).join("; ")}`
              : "."
          }`
        );
      } else if (
        options.env.nodeEnv === "production" &&
        options.env.enableScheduler
      ) {
        const finishedAt = Date.parse(latestRun.finishedAt ?? "");
        const ageMs = checkedAt.getTime() - finishedAt;

        if (
          !Number.isFinite(finishedAt) ||
          ageMs < 0 ||
          ageMs > options.env.fetchRunMaxAgeHours * 3_600_000
        ) {
          problems.push(
            `${protocol} latest successful fetch is missing, invalid, or older than ${options.env.fetchRunMaxAgeHours} hour(s).`
          );
        }
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

  for (const adapter of enabledOnchainAdapters) {
    const sourceState = onchainReads.sourceStates.find(
      (state) => state.sourceKey === adapter.sourceKey
    );
    const latestScan = onchainReads.latestScans.get(adapter.sourceKey);

    if (!sourceState) {
      problems.push(
        `No on-chain governance source state has been recorded for ${adapter.protocol}.`
      );
    } else {
      if (sourceState.baselineStatus !== "complete") {
        const progress = describeOnchainBaselineProgress(sourceState);

        problems.push(
          `${adapter.protocol} on-chain governance historical baseline is incomplete: ${progress.checkpointSummary}. Historical notifications remain suppressed until completion; ${progress.recoverySummary}.`
        );
      }

      if (sourceState.replayMode === "live") {
        problems.push(
          `${adapter.protocol} on-chain governance notification-enabled coverage replay is pending; deterministic lifecycle IDs will prevent duplicate alerts.`
        );
      }

      if (sourceState.healthStatus !== "healthy") {
        problems.push(
          `${adapter.protocol} on-chain governance source is ${sourceState.healthStatus}${
            sourceState.consecutiveFailures > 0
              ? ` after ${sourceState.consecutiveFailures} consecutive failure(s)`
              : ""
          }${
            sourceState.lastError ? `: ${errorMessage(sourceState.lastError)}` : "."
          }`
        );
      }

      if (
        sourceState.baselineStatus === "complete" &&
        sourceState.cursorBlockNumber < sourceState.latestFinalizedBlockNumber
      ) {
        problems.push(
          `${adapter.protocol} on-chain governance cursor is ${sourceState.latestFinalizedBlockNumber - sourceState.cursorBlockNumber} finalized block(s) behind.`
        );
      }
    }

    if (!latestScan) {
      problems.push(
        `No on-chain governance scan has been recorded for ${adapter.protocol}.`
      );
    } else if (latestScan.status !== "success") {
      problems.push(
        `${adapter.protocol} latest on-chain governance scan is ${latestScan.status}${
          latestScan.errors.length > 0
            ? `: ${latestScan.errors.map(errorMessage).join("; ")}`
            : "."
        }`
      );
    }

    if (latestScan) {
      const latestScanTimestamp = latestScan.finishedAt ?? latestScan.startedAt;
      const latestScanAt = Date.parse(latestScanTimestamp);

      if (!Number.isFinite(latestScanAt)) {
        problems.push(
          `${adapter.protocol} latest on-chain governance scan has an invalid timestamp: ${latestScanTimestamp}.`
        );
      } else if (checkedAt.getTime() - latestScanAt > ONCHAIN_SCAN_STALE_AFTER_MS) {
        problems.push(
          `${adapter.protocol} latest on-chain governance scan is older than 12 hours (${latestScanTimestamp}).`
        );
      }
    }
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
    message: appendOnchainAdminStatus(
      formatAdminStatusMessage({
        env: options.env,
        enabledProtocols,
        latestByProtocol,
        sourceActivityByProtocol,
        pendingNotificationCount,
        failedNotificationCount,
        failedNotifications: failedNotifications ?? null,
        healthy,
        problems,
        checkedAt: checkedAt.toISOString()
      }),
      enabledOnchainAdapters.map((adapter) => adapter.sourceKey),
      onchainReads
    )
  };
}

interface OnchainAdminStatusReads {
  sourceStates: GovernanceSourceState[];
  latestScans: Map<string, GovernanceScanRun>;
  pendingNotificationCount: number | null;
  failedNotificationCount: number | null;
  failedNotifications: GovernanceLifecycleEvent[] | null;
  errors: string[];
}

async function readOnchainAdminStatus(
  sourceKeys: string[],
  repository: GovernanceRepository | undefined
): Promise<OnchainAdminStatusReads> {
  if (sourceKeys.length === 0 || !repository) {
    return {
      sourceStates: [],
      latestScans: new Map(),
      pendingNotificationCount: 0,
      failedNotificationCount: 0,
      failedNotifications: [],
      errors: []
    };
  }

  const sourceStatesResult = await readReportSection(
    () => repository.findAllSourceStates(100),
    "on-chain governance source states"
  );
  const pendingResult = await readReportCount(
    () => repository.countByNotificationStatus("pending"),
    "pending on-chain governance notification count"
  );
  const failedResult = await readReportCount(
    () => repository.countByNotificationStatus("failed"),
    "failed on-chain governance notification count"
  );
  const failedDetailsResult = await readReportSection(
    () => repository.findByNotificationStatus("failed", 20),
    "failed on-chain governance notification details"
  );
  const latestScans = new Map<string, GovernanceScanRun>();
  const errors = [
    sourceStatesResult.error,
    pendingResult.error,
    failedResult.error,
    failedDetailsResult.error
  ].filter((error): error is string => Boolean(error));

  await Promise.all(
    sourceKeys.map(async (sourceKey) => {
      const scanResult = await readReportValue(
        () => repository.findLatestScanRunBySource(sourceKey),
        `latest ${sourceKey} on-chain governance scan`
      );

      if (scanResult.error) {
        errors.push(scanResult.error);
      } else if (scanResult.value) {
        latestScans.set(sourceKey, scanResult.value);
      }
    })
  );

  return {
    sourceStates: sourceStatesResult.records ?? [],
    latestScans,
    pendingNotificationCount: pendingResult.count,
    failedNotificationCount: failedResult.count,
    failedNotifications: failedDetailsResult.records,
    errors
  };
}

function appendOnchainAdminStatus(
  message: string,
  sourceKeys: string[],
  reads: OnchainAdminStatusReads
): string {
  if (sourceKeys.length === 0) {
    return message;
  }

  const sourceLines = sourceKeys.map((sourceKey) => {
    const state = reads.sourceStates.find((item) => item.sourceKey === sourceKey);
    const scan = reads.latestScans.get(sourceKey);

    if (!state) {
      return `- ${escapeTelegramHtml(sourceKey)}: no source state recorded`;
    }

    const baselineSummary =
      state.baselineStatus === "complete"
        ? "baseline complete"
        : `baseline seeding (${describeOnchainBaselineProgress(state).checkpointSummary}; historical alerts suppressed)`;

    return [
      `- ${escapeTelegramHtml(sourceKey)}: ${escapeTelegramHtml(state.healthStatus)}`,
      escapeTelegramHtml(baselineSummary),
      `cursor ${state.cursorBlockNumber}/${state.latestFinalizedBlockNumber}`,
      `last attempt ${escapeTelegramHtml(state.lastAttemptAt)}`,
      `last success ${escapeTelegramHtml(state.lastSuccessfulScanAt ?? "never")}`,
      `consecutive failures ${state.consecutiveFailures}`,
      `latest scan ${escapeTelegramHtml(scan?.status ?? "not recorded")}`,
      `replay ${escapeTelegramHtml(state.replayMode ?? "none")}`
    ].join("; ");
  });
  const failedLines = formatFailedGovernanceNotificationLines(
    reads.failedNotifications,
    reads.failedNotificationCount
  );

  return enforceTelegramMessageLimit(
    [message, "", "On-chain governance:", ...sourceLines, ...failedLines].join(
      "\n"
    )
  );
}

function describeOnchainBaselineProgress(state: GovernanceSourceState): {
  checkpointSummary: string;
  recoverySummary: string;
} {
  const firstBlock = state.deploymentBlock;
  const targetBlock = state.baselineTargetBlock;
  const totalBlocks = Math.max(0, targetBlock - firstBlock + 1);
  const boundedCursor = Math.min(
    Math.max(state.cursorBlockNumber, firstBlock - 1),
    targetBlock
  );
  const checkpointedBlocks =
    totalBlocks === 0 ? 0 : Math.max(0, boundedCursor - firstBlock + 1);
  const remainingBlocks = Math.max(0, totalBlocks - checkpointedBlocks);
  const progressPercent =
    totalBlocks === 0 ? 0 : (checkpointedBlocks / totalBlocks) * 100;
  const checkpointSummary = `${checkpointedBlocks}/${totalBlocks} block(s) checkpointed (${formatProgressPercent(
    progressPercent
  )}); ${remainingBlocks} block(s) remaining`;

  if (remainingBlocks === 0) {
    return {
      checkpointSummary,
      recoverySummary:
        "all target blocks are checkpointed but baseline completion has not been recorded"
    };
  }

  return {
    checkpointSummary,
    recoverySummary: `the next scan will safely resume from block ${boundedCursor + 1}`
  };
}

function formatProgressPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}%`;
}

function formatFailedGovernanceNotificationLines(
  events: GovernanceLifecycleEvent[] | null,
  totalCount: number | null
): string[] {
  if (!events || events.length === 0) {
    return [];
  }

  const visible = events.slice(0, 5);
  const lines = [
    `Failed on-chain lifecycle notifications${
      (totalCount ?? visible.length) > visible.length
        ? ` (showing ${visible.length} of ${totalCount})`
        : ""
    }:`
  ];

  for (const event of visible) {
    const failedRecipients = Object.values(
      event.notificationDeliveries ?? {}
    ).filter((delivery) => delivery.status === "failed");
    const recipientSummary =
      failedRecipients.length > 0
        ? failedRecipients
            .slice(0, 5)
            .map(
              (delivery) =>
                `${delivery.recipientMaskedId} (${truncate(
                  errorMessage(delivery.lastError ?? "no error recorded"),
                  140
                )})`
            )
            .join(", ")
        : truncate(errorMessage(event.notificationError ?? "no error recorded"), 180);

    lines.push(
      `- ${escapeTelegramHtml(event.protocol)}/${escapeTelegramHtml(
        event.transition
      )}/${escapeTelegramHtml(event.decisionId)}; recipients ${escapeTelegramHtml(
        recipientSummary
      )}`
    );
  }

  return lines;
}

function sumOptionalCounts(
  forumCount: number | null,
  onchainCount: number | null
): number | null {
  return forumCount === null || onchainCount === null
    ? null
    : forumCount + onchainCount;
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
        truncate(
          errorMessage(delivery.lastError ?? "No notification error recorded."),
          220
        )
      )}`
  );
}

function describeNotificationFailure(
  notificationError: string | undefined,
  env: Env
): string {
  const rawError = errorMessage(
    notificationError?.trim() || "No notification error recorded."
  );
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
