import type { Logger } from "pino";
import { filterByPublisherPolicy } from "../protocols/allowlist.js";
import { NoopNotificationService } from "../notifications/noopNotification.service.js";
import type { NotificationService } from "../notifications/notification.service.js";
import { ProposalNotificationDispatcher } from "../notifications/proposalNotifications.js";
import type { ProtocolRegistry } from "../protocols/registry.js";
import {
  sourceActivityConfigFromEnv,
  updateSourceActivity,
  type SourceActivityConfig
} from "../sourceActivity/sourceActivity.service.js";
import { createFetchRunId } from "../utils/hash.js";
import type { Env } from "../config/env.js";
import type { FetchRun, FetchRunRepository } from "../storage/fetchRun.repository.js";
import type { ProposalRepository } from "../storage/proposal.repository.js";
import {
  MemoryProtocolStateRepository,
  type ProtocolStateRepository
} from "../storage/protocolState.repository.js";
import type { SourceActivityRepository } from "../storage/sourceActivity.repository.js";
import { errorMessage, safeErrorDetails } from "../utils/errors.js";

export interface FetchProtocolResult {
  run: FetchRun;
  protocol: string;
  fetchedCount: number;
  allowlistedCount: number;
  storedNewCount: number;
  baselineSeededCount: number;
  updatedExistingCount: number;
  unchangedExistingCount: number;
  skippedCount: number;
  notificationSentCount: number;
  notificationFailedCount: number;
  startedAt: string;
  finishedAt: string;
  errors: string[];
}

export interface FetchProtocolGovernanceJobOptions {
  notificationService?: NotificationService;
  notificationDispatcher?: ProposalNotificationDispatcher;
  protocolStateRepository?: ProtocolStateRepository;
  sourceActivityConfig?: SourceActivityConfig;
}

export class FetchAlreadyRunningError extends Error {
  constructor(readonly protocol: string) {
    super(`Fetch already running for protocol: ${protocol}`);
    this.name = "FetchAlreadyRunningError";
  }
}

export class UnknownProtocolAdapterError extends Error {
  constructor(readonly protocol: string) {
    super(`Unknown protocol adapter: ${protocol}`);
    this.name = "UnknownProtocolAdapterError";
  }
}

export class FetchProtocolGovernanceJob {
  private readonly runningProtocols = new Set<string>();
  private readonly notificationService: NotificationService;
  readonly notificationDispatcher: ProposalNotificationDispatcher;
  private readonly protocolStateRepository: ProtocolStateRepository;

  constructor(
    private readonly registry: ProtocolRegistry,
    private readonly proposalRepository: ProposalRepository,
    private readonly fetchRunRepository: FetchRunRepository,
    private readonly sourceActivityRepository: SourceActivityRepository,
    private readonly logger: Logger,
    options: FetchProtocolGovernanceJobOptions = {}
  ) {
    this.notificationService =
      options.notificationService ?? new NoopNotificationService();
    this.notificationDispatcher =
      options.notificationDispatcher ??
      new ProposalNotificationDispatcher(
        this.proposalRepository,
        this.notificationService,
        this.logger
      );
    this.protocolStateRepository =
      options.protocolStateRepository ?? new MemoryProtocolStateRepository();
    this.sourceActivityConfig = options.sourceActivityConfig;
  }

  private readonly sourceActivityConfig?: SourceActivityConfig;

  static sourceActivityConfigFromEnv(env: Env): SourceActivityConfig {
    return sourceActivityConfigFromEnv(env);
  }

  async run(protocolInput: string): Promise<FetchProtocolResult> {
    const protocol = protocolInput.trim().toLowerCase();

    if (this.runningProtocols.has(protocol)) {
      throw new FetchAlreadyRunningError(protocol);
    }

    const adapter = this.registry.get(protocol);

    if (!adapter) {
      throw new UnknownProtocolAdapterError(protocol);
    }

    this.runningProtocols.add(protocol);
    const startedAt = new Date().toISOString();
    const runId = createFetchRunId(protocol, startedAt);
    const run: FetchRun = {
      id: runId,
      protocol,
      startedAt,
      status: "running",
      fetchedCount: 0,
      allowlistedCount: 0,
      storedNewCount: 0,
      baselineSeededCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 0,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    };

    let fetchedCount = 0;
    let allowlistedCount = 0;
    let skippedCount = 0;
    let storedNewCount = 0;
    let baselineSeededCount = 0;
    let updatedExistingCount = 0;
    let unchangedExistingCount = 0;
    let notificationSentCount = 0;
    let notificationFailedCount = 0;
    const errors: string[] = [];

    try {
      const previousSuccessfulRun =
        await this.fetchRunRepository.findLatestSuccessfulByProtocol(protocol);
      await this.fetchRunRepository.upsert(run);
      this.logger.info({ protocol, runId }, "Starting governance fetch");
      const existingProtocolState =
        await this.protocolStateRepository.findByProtocol(protocol);
      const protocolState =
        existingProtocolState ??
        (await this.protocolStateRepository.initializeBaseline(
          protocol,
          await this.proposalRepository.existsForProtocol(protocol),
          startedAt
        ));
      const baselineSeeding = protocolState.baselineStatus === "seeding";
      const rawItems = await adapter.fetchRecent();
      fetchedCount = rawItems.length;
      const sourceActivityConfig =
        this.sourceActivityConfig ??
        {
          warningDays: 14,
          criticalDays: 30,
          minFetchedCount: 1
        };
      const sourceActivity = await updateSourceActivity({
        repository: this.sourceActivityRepository,
        source: adapter.source,
        rawItems,
        fetchedAt: new Date().toISOString(),
        config: sourceActivityConfig
      });
      const filtered = filterByPublisherPolicy(rawItems, {
        publisherAllowlist: adapter.publisherAllowlist,
        publisherTrustLevelAllowlist:
          adapter.publisherTrustLevelAllowlist
      });
      allowlistedCount = filtered.allowed.length;
      skippedCount = filtered.skipped.length;

      for (const rawItem of filtered.allowed) {
        const historicalSeed =
          !baselineSeeding &&
          this.notificationService.enabled &&
          wasPublishedByPreviousSuccessfulRun(
            rawItem.publishedAt,
            previousSuccessfulRun
          );
        const notificationStatusForNew =
          baselineSeeding ||
          historicalSeed ||
          !this.notificationService.enabled
            ? "skipped"
            : "pending";
        const normalizedItem = adapter.normalize(rawItem);
        const upsertResult = await this.proposalRepository.upsert(normalizedItem, {
          notificationStatusForNew
        });

        if (upsertResult.created) {
          storedNewCount += 1;

          if (baselineSeeding || historicalSeed) {
            baselineSeededCount += 1;
          }

          if (upsertResult.proposal.notificationStatus === "pending") {
            const notificationResult =
              await this.notificationDispatcher.notifyNewProposal(
                upsertResult.proposal
              );

            if (notificationResult.status === "sent") {
              notificationSentCount += 1;
            }

            if (notificationResult.status === "failed") {
              notificationFailedCount += 1;
              if (notificationResult.error) {
                errors.push(notificationResult.error);
              }
            }
          }
        } else {
          if (upsertResult.updated) {
            updatedExistingCount += 1;
          } else {
            unchangedExistingCount += 1;
          }
        }
      }

      if (
        baselineSeeding &&
        fetchedCount >= sourceActivityConfig.minFetchedCount
      ) {
        await this.protocolStateRepository.markBaselineComplete(
          protocol,
          new Date().toISOString()
        );
      } else if (baselineSeeding) {
        this.logger.warn(
          {
            protocol,
            fetchedCount,
            minFetchedCount: sourceActivityConfig.minFetchedCount
          },
          "Protocol baseline remains in seeding mode because the fetch returned too few items"
        );
      }

      const finishedAt = new Date().toISOString();
      const finishedRun: FetchRun = {
        ...run,
        finishedAt,
        status: "success",
        fetchedCount,
        allowlistedCount,
        storedNewCount,
        baselineSeededCount,
        updatedExistingCount,
        unchangedExistingCount,
        skippedCount,
        notificationSentCount,
        notificationFailedCount,
        errors
      };

      await this.fetchRunRepository.upsert(finishedRun);
      this.logger.info(
        {
          protocol,
          runId,
          fetchedCount: finishedRun.fetchedCount,
          allowlistedCount: finishedRun.allowlistedCount,
          storedNewCount: finishedRun.storedNewCount,
          baselineSeededCount: finishedRun.baselineSeededCount,
          updatedExistingCount: finishedRun.updatedExistingCount,
          unchangedExistingCount: finishedRun.unchangedExistingCount,
          skippedCount: finishedRun.skippedCount,
          notificationSentCount: finishedRun.notificationSentCount,
          notificationFailedCount: finishedRun.notificationFailedCount
        },
        "Finished governance fetch"
      );

      if (sourceActivity.status !== "healthy") {
        this.logger.warn(
          {
            protocol,
            sourceActivityStatus: sourceActivity.status,
            sourceActivityReason: sourceActivity.statusReason
          },
          "Source activity watchdog reported non-healthy status"
        );
      }

      return {
        run: finishedRun,
        protocol: finishedRun.protocol,
        fetchedCount: finishedRun.fetchedCount,
        allowlistedCount: finishedRun.allowlistedCount,
        storedNewCount: finishedRun.storedNewCount,
        baselineSeededCount: finishedRun.baselineSeededCount ?? 0,
        updatedExistingCount: finishedRun.updatedExistingCount,
        unchangedExistingCount: finishedRun.unchangedExistingCount,
        skippedCount: finishedRun.skippedCount,
        notificationSentCount: finishedRun.notificationSentCount,
        notificationFailedCount: finishedRun.notificationFailedCount,
        startedAt: finishedRun.startedAt,
        finishedAt,
        errors: finishedRun.errors
      };
    } catch (error) {
      const message = errorMessage(error);
      const failedRun: FetchRun = {
        ...run,
        finishedAt: new Date().toISOString(),
        status: "failed",
        fetchedCount,
        allowlistedCount,
        storedNewCount,
        baselineSeededCount,
        updatedExistingCount,
        unchangedExistingCount,
        skippedCount,
        notificationSentCount,
        notificationFailedCount,
        errors: [...errors, message]
      };

      try {
        await this.fetchRunRepository.upsert(failedRun);
      } catch (fetchRunError) {
        this.logger.error(
          {
            protocol,
            runId,
            error: safeErrorDetails(error),
            fetchRunError: safeErrorDetails(fetchRunError)
          },
          "Failed to record failed governance fetch"
        );
        throw error;
      }

      this.logger.error(
        { protocol, runId, error: safeErrorDetails(error) },
        "Governance fetch failed"
      );
      throw error;
    } finally {
      this.runningProtocols.delete(protocol);
    }
  }
}

function wasPublishedByPreviousSuccessfulRun(
  publishedAt: string,
  previousSuccessfulRun: FetchRun | null
): boolean {
  if (!previousSuccessfulRun) {
    return false;
  }

  const publishedTimestamp = Date.parse(publishedAt);
  const previousRunTimestamp = Date.parse(
    previousSuccessfulRun.finishedAt ?? previousSuccessfulRun.startedAt
  );

  return (
    Number.isFinite(publishedTimestamp) &&
    Number.isFinite(previousRunTimestamp) &&
    publishedTimestamp <= previousRunTimestamp
  );
}
