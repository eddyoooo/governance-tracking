import type { Logger } from "pino";
import { filterByPublisherAllowlist } from "../protocols/allowlist.js";
import { NoopNotificationService } from "../notifications/noopNotification.service.js";
import type { NotificationService } from "../notifications/notification.service.js";
import { notifyProposal } from "../notifications/proposalNotifications.js";
import type { ProtocolRegistry } from "../protocols/registry.js";
import { createFetchRunId } from "../utils/hash.js";
import type { FetchRun, FetchRunRepository } from "../storage/fetchRun.repository.js";
import type { ProposalRepository } from "../storage/proposal.repository.js";

export interface FetchProtocolResult {
  run: FetchRun;
  protocol: string;
  fetchedCount: number;
  allowlistedCount: number;
  storedNewCount: number;
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
  notifyOnNewProposal?: boolean;
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
  private readonly notifyOnNewProposal: boolean;

  constructor(
    private readonly registry: ProtocolRegistry,
    private readonly proposalRepository: ProposalRepository,
    private readonly fetchRunRepository: FetchRunRepository,
    private readonly logger: Logger,
    options: FetchProtocolGovernanceJobOptions = {}
  ) {
    this.notificationService =
      options.notificationService ?? new NoopNotificationService();
    this.notifyOnNewProposal = options.notifyOnNewProposal ?? false;
  }

  async run(protocol: string): Promise<FetchProtocolResult> {
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
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 0,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    };

    await this.fetchRunRepository.upsert(run);

    let fetchedCount = 0;
    let allowlistedCount = 0;
    let skippedCount = 0;
    let storedNewCount = 0;
    let updatedExistingCount = 0;
    let unchangedExistingCount = 0;
    let notificationSentCount = 0;
    let notificationFailedCount = 0;
    const errors: string[] = [];

    try {
      this.logger.info({ protocol, runId }, "Starting governance fetch");
      const rawItems = await adapter.fetchRecent({
        shouldStopAfterPage: async ({ page, items, hasMore }) => {
          const allowedOnPage = filterByPublisherAllowlist(
            items,
            adapter.publisherAllowlist
          ).allowed;

          if (allowedOnPage.length === 0) {
            return false;
          }

          const knownAllowedItems = await Promise.all(
            allowedOnPage.map((item) =>
              this.proposalRepository.findBySourceIdentity(
                item.protocol,
                item.sourceType,
                item.sourceId
              )
            )
          );
          const shouldStop = knownAllowedItems.every(Boolean);

          if (shouldStop && hasMore) {
            this.logger.info(
              {
                protocol,
                runId,
                page,
                allowlistedItemsOnPage: allowedOnPage.length
              },
              "Stopping pagination after reaching already-known allowlisted proposals"
            );
          }

          return shouldStop;
        }
      });
      fetchedCount = rawItems.length;
      const filtered = filterByPublisherAllowlist(rawItems, adapter.publisherAllowlist);
      allowlistedCount = filtered.allowed.length;
      skippedCount = filtered.skipped.length;
      const notificationStatusForNew =
        this.notificationService.enabled && this.notifyOnNewProposal
          ? "pending"
          : "skipped";

      for (const rawItem of filtered.allowed) {
        const normalizedItem = adapter.normalize(rawItem);
        const upsertResult = await this.proposalRepository.upsert(normalizedItem, {
          notificationStatusForNew
        });

        if (upsertResult.created) {
          storedNewCount += 1;

          if (upsertResult.proposal.notificationStatus === "pending") {
            const notificationResult = await notifyProposal(
              upsertResult.proposal,
              this.proposalRepository,
              this.notificationService,
              this.logger
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

      const finishedAt = new Date().toISOString();
      const finishedRun: FetchRun = {
        ...run,
        finishedAt,
        status: "success",
        fetchedCount,
        allowlistedCount,
        storedNewCount,
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
          updatedExistingCount: finishedRun.updatedExistingCount,
          unchangedExistingCount: finishedRun.unchangedExistingCount,
          skippedCount: finishedRun.skippedCount,
          notificationSentCount: finishedRun.notificationSentCount,
          notificationFailedCount: finishedRun.notificationFailedCount
        },
        "Finished governance fetch"
      );

      return {
        run: finishedRun,
        protocol: finishedRun.protocol,
        fetchedCount: finishedRun.fetchedCount,
        allowlistedCount: finishedRun.allowlistedCount,
        storedNewCount: finishedRun.storedNewCount,
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedRun: FetchRun = {
        ...run,
        finishedAt: new Date().toISOString(),
        status: "failed",
        fetchedCount,
        allowlistedCount,
        storedNewCount,
        updatedExistingCount,
        unchangedExistingCount,
        skippedCount,
        notificationSentCount,
        notificationFailedCount,
        errors: [...errors, errorMessage]
      };

      await this.fetchRunRepository.upsert(failedRun);
      this.logger.error({ protocol, runId, error }, "Governance fetch failed");
      throw error;
    } finally {
      this.runningProtocols.delete(protocol);
    }
  }
}
