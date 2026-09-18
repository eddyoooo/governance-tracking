import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { NotificationService } from "../notifications/notification.service.js";
import {
  ProposalNotificationDispatcher,
  type ProposalNotificationResult
} from "../notifications/proposalNotifications.js";
import type { GovernanceRepository } from "../storage/governance.repository.js";
import { errorMessage, safeErrorDetails } from "../utils/errors.js";
import { sha256 } from "../utils/hash.js";
import { createGovernanceDecisionId } from "./governanceDecision.js";
import {
  assertProposalCountCoversStoredDecisions,
  assertProposalSequenceUnchanged,
  decisionsUpToProposalId,
  findMissingLifecycleReferences,
  findMissingProposalIds,
  formatMissingLifecycleReferences,
  formatMissingProposalIds,
  historicalCoverageError,
  historicalLifecycleCoverageError,
  liveCoverageError,
  liveLifecycleCoverageError
} from "./onchainGovernance.coverage.js";
import {
  assertCanonicalCursor,
  assertDecisionMatchesRequest,
  assertImplementationUnchanged,
  assertReturnedBlock,
  assertSourceMatchesAdapter,
  assertSourceValidation,
  assertStoredSourceState,
  blockRanges,
  groupEventsByProposal,
  trackedProposalEvents,
  validateGovernanceEvents
} from "./onchainGovernance.validation.js";
import type {
  EvmGovernanceAdapter,
  GovernanceContractEvent,
  GovernanceLifecycleEvent,
  GovernanceScanResult,
  GovernanceScanRun,
  GovernanceSourceState,
  GovernanceSourceValidation,
  StoredGovernanceDecision
} from "./types.js";
import type { EvmGovernanceRegistry } from "./registry.js";

export class OnchainScanAlreadyRunningError extends Error {
  constructor(readonly protocol: string) {
    super(`On-chain governance scan already running for protocol: ${protocol}`);
    this.name = "OnchainScanAlreadyRunningError";
  }
}

export class UnknownOnchainGovernanceSourceError extends Error {
  constructor(readonly protocol: string) {
    super(`On-chain governance source is not enabled for protocol: ${protocol}`);
    this.name = "UnknownOnchainGovernanceSourceError";
  }
}

export class OnchainGovernanceScanJob {
  private readonly runningSources = new Set<string>();

  constructor(
    private readonly registry: EvmGovernanceRegistry,
    private readonly repository: GovernanceRepository,
    private readonly notificationService: NotificationService,
    readonly notificationDispatcher: ProposalNotificationDispatcher<GovernanceLifecycleEvent>,
    private readonly logger: Pick<Logger, "debug" | "error" | "info" | "warn">
  ) {}

  async run(protocolInput: string): Promise<GovernanceScanResult> {
    const protocol = protocolInput.trim().toLowerCase();
    const adapter = this.registry.get(protocol);

    if (!adapter || !adapter.enabled) {
      throw new UnknownOnchainGovernanceSourceError(protocol);
    }

    if (this.runningSources.has(adapter.sourceKey)) {
      throw new OnchainScanAlreadyRunningError(protocol);
    }

    this.runningSources.add(adapter.sourceKey);

    try {
      const startedAt = new Date().toISOString();
      const existingState = await this.repository.findSourceState(adapter.sourceKey);
      const run: GovernanceScanRun = {
        id: createGovernanceScanRunId(adapter.sourceKey, startedAt),
        sourceKey: adapter.sourceKey,
        protocol,
        startedAt,
        status: "running",
        baselineSeeding: existingState?.baselineStatus !== "complete",
        cursorBefore:
          existingState?.cursorBlockNumber ?? adapter.deploymentBlock - 1,
        cursorAfter:
          existingState?.cursorBlockNumber ?? adapter.deploymentBlock - 1,
        latestFinalizedBlock: existingState?.latestFinalizedBlockNumber ?? 0,
        rangesScanned: 0,
        contractEventsRead: 0,
        decisionsCreated: 0,
        decisionsUpdated: 0,
        decisionsUnchanged: 0,
        lifecycleEventsCreated: 0,
        notificationSentCount: 0,
        notificationFailedCount: 0,
        errors: []
      };

      await this.repository.upsertScanRun(run);
      this.logger.info(
        { protocol, sourceKey: adapter.sourceKey, runId: run.id },
        "Starting on-chain governance scan"
      );

      try {
        const validation = await adapter.validateSource();
        assertSourceValidation(adapter, validation);
        run.latestFinalizedBlock = validation.latestFinalizedBlock.number;
        let sourceState =
          existingState ??
          (await this.repository.initializeSourceState(
            initialSourceState(adapter, validation, startedAt)
          ));

        sourceState = await this.ensureProposalBoundaryState(
          adapter,
          sourceState,
          validation,
          startedAt
        );

        assertSourceMatchesAdapter(sourceState, adapter);
        assertStoredSourceState(sourceState, adapter);
        assertImplementationUnchanged(
          sourceState.implementationAddress,
          validation.implementationAddress
        );
        assertProposalSequenceUnchanged(sourceState, validation);
        const knownDecisions = await this.repository.findDecisionsBySource(
          adapter.sourceKey
        );
        assertProposalCountCoversStoredDecisions(
          knownDecisions,
          validation.proposalCount
        );
        await assertCanonicalCursor(sourceState, validation, adapter);
        const baselineSeeding = sourceState.baselineStatus === "seeding";
        run.baselineSeeding = baselineSeeding;
        const observationBlock = validation.latestFinalizedBlock.number;

        sourceState = baselineSeeding
          ? await this.completeHistoricalBaseline(
              adapter,
              sourceState,
              validation,
              observationBlock,
              run
            )
          : await this.scanEstablishedSource(
              adapter,
              sourceState,
              validation,
              observationBlock,
              knownDecisions,
              run
            );

        const finishedAt = new Date().toISOString();
        sourceState = requirePersistedSourceState(
          await this.repository.updateSourceState(
            adapter.sourceKey,
            (current) => ({
              ...current,
              latestFinalizedBlockNumber: validation.latestFinalizedBlock.number,
              latestFinalizedBlockHash: validation.latestFinalizedBlock.hash,
              replayMode: null,
              healthStatus: "healthy",
              consecutiveFailures: 0,
              lastAttemptAt: finishedAt,
              lastSuccessfulScanAt: finishedAt,
              lastError: null,
              updatedAt: finishedAt
            })
          ),
          adapter.sourceKey,
          "recording a successful scan"
        );
        run.cursorAfter = sourceState.cursorBlockNumber;
        const completedRun: GovernanceScanResult = {
          ...run,
          status: "success",
          finishedAt
        };
        await this.repository.upsertScanRun(completedRun);
        this.logger.info(
          {
            protocol,
            runId: run.id,
            baselineSeeding,
            cursorBefore: run.cursorBefore,
            cursorAfter: run.cursorAfter,
            latestFinalizedBlock: run.latestFinalizedBlock,
            rangesScanned: run.rangesScanned,
            contractEventsRead: run.contractEventsRead,
            decisionsCreated: run.decisionsCreated,
            decisionsUpdated: run.decisionsUpdated,
            decisionsUnchanged: run.decisionsUnchanged,
            lifecycleEventsCreated: run.lifecycleEventsCreated,
            notificationSentCount: run.notificationSentCount,
            notificationFailedCount: run.notificationFailedCount
          },
          "Finished on-chain governance scan"
        );

        return completedRun;
      } catch (error) {
        const message = errorMessage(error);
        const finishedAt = new Date().toISOString();
        run.errors.push(message);
        const failedRun: GovernanceScanResult = {
          ...run,
          status: "failed",
          finishedAt
        };

        await this.recordFailure(adapter.sourceKey, message, finishedAt);
        try {
          await this.repository.upsertScanRun(failedRun);
        } catch (persistenceError) {
          this.logger.error(
            {
              protocol,
              sourceKey: adapter.sourceKey,
              persistenceError: safeErrorDetails(persistenceError)
            },
            "Failed to persist failed on-chain governance scan run"
          );
        }
        this.logger.error(
          {
            protocol,
            sourceKey: adapter.sourceKey,
            runId: run.id,
            error: safeErrorDetails(error)
          },
          "On-chain governance scan failed"
        );
        throw error;
      }
    } finally {
      this.runningSources.delete(adapter.sourceKey);
    }
  }

  private async completeHistoricalBaseline(
    adapter: EvmGovernanceAdapter,
    sourceState: GovernanceSourceState,
    validation: GovernanceSourceValidation,
    observationBlock: number,
    run: GovernanceScanRun
  ): Promise<GovernanceSourceState> {
    const historicalProposalIds = new Set<string>();
    sourceState = await this.scanBlockRanges(
      adapter,
      sourceState,
      sourceState.cursorBlockNumber + 1,
      sourceState.baselineTargetBlock,
      observationBlock,
      true,
      validation,
      run,
      historicalProposalIds
    );
    await this.refreshActiveDecisions(
      adapter,
      historicalProposalIds,
      observationBlock,
      true,
      run
    );

    const baselineDecisions = await this.repository.findDecisionsBySource(
      adapter.sourceKey
    );
    const historicalGaps = findMissingProposalIds(
      baselineDecisions,
      sourceState.initialProposalId,
      sourceState.baselineProposalCount
    );

    if (historicalGaps.length > 0) {
      await this.resetForSilentCoverageReplay(
        adapter,
        validation,
        historicalGaps,
        new Date().toISOString()
      );
      throw historicalCoverageError(historicalGaps);
    }

    const historicalLifecycleGaps = findMissingLifecycleReferences(
      baselineDecisions
    );
    if (historicalLifecycleGaps.length > 0) {
      await this.resetForSilentLifecycleReplay(
        adapter,
        validation,
        historicalLifecycleGaps,
        new Date().toISOString()
      );
      throw historicalLifecycleCoverageError(historicalLifecycleGaps);
    }

    const baselineCompletedAt = new Date().toISOString();
    sourceState = requirePersistedSourceState(
      await this.repository.updateSourceState(
        adapter.sourceKey,
        (current) => ({
          ...current,
          baselineStatus: "complete",
          replayMode: null,
          healthStatus: "healthy",
          consecutiveFailures: 0,
          lastAttemptAt: baselineCompletedAt,
          lastError: null,
          updatedAt: baselineCompletedAt
        })
      ),
      adapter.sourceKey,
      "completing its historical baseline"
    );

    const catchUpProposalIds = new Set<string>();
    sourceState = await this.scanBlockRanges(
      adapter,
      sourceState,
      sourceState.cursorBlockNumber + 1,
      observationBlock,
      observationBlock,
      false,
      validation,
      run,
      catchUpProposalIds
    );

    await this.assertLiveCoverage(adapter, sourceState, validation);

    return sourceState;
  }

  private async scanEstablishedSource(
    adapter: EvmGovernanceAdapter,
    sourceState: GovernanceSourceState,
    validation: GovernanceSourceValidation,
    observationBlock: number,
    knownDecisions: StoredGovernanceDecision[],
    run: GovernanceScanRun
  ): Promise<GovernanceSourceState> {
    const historicalGaps = findMissingProposalIds(
      knownDecisions,
      sourceState.initialProposalId,
      sourceState.baselineProposalCount
    );

    if (historicalGaps.length > 0) {
      await this.resetForSilentCoverageReplay(
        adapter,
        validation,
        historicalGaps,
        new Date().toISOString()
      );
      throw historicalCoverageError(historicalGaps);
    }

    if (sourceState.replayMode !== "live") {
      const historicalLifecycleGaps = findMissingLifecycleReferences(
        decisionsUpToProposalId(
          knownDecisions,
          sourceState.baselineProposalCount
        )
      );
      if (historicalLifecycleGaps.length > 0) {
        await this.resetForSilentLifecycleReplay(
          adapter,
          validation,
          historicalLifecycleGaps,
          new Date().toISOString()
        );
        throw historicalLifecycleCoverageError(historicalLifecycleGaps);
      }
    }

    const processedProposalIds = new Set<string>();
    const scanFrom = Math.max(
      adapter.deploymentBlock,
      sourceState.cursorBlockNumber + 1 - adapter.reorgOverlapBlocks
    );
    sourceState = await this.scanBlockRanges(
      adapter,
      sourceState,
      scanFrom,
      observationBlock,
      observationBlock,
      false,
      validation,
      run,
      processedProposalIds
    );
    await this.refreshActiveDecisions(
      adapter,
      processedProposalIds,
      observationBlock,
      false,
      run
    );

    await this.assertLiveCoverage(adapter, sourceState, validation);

    return sourceState;
  }

  private async assertLiveCoverage(
    adapter: EvmGovernanceAdapter,
    sourceState: GovernanceSourceState,
    validation: GovernanceSourceValidation
  ): Promise<void> {
    const liveDecisions = await this.repository.findDecisionsBySource(
      adapter.sourceKey
    );
    const liveGaps = findMissingProposalIds(
      liveDecisions,
      sourceState.initialProposalId,
      validation.proposalCount
    );

    if (liveGaps.length > 0) {
      await this.rewindForLiveCoverageRetry(
        adapter,
        validation,
        liveGaps,
        new Date().toISOString()
      );
      throw liveCoverageError(liveGaps);
    }

    const liveLifecycleGaps = findMissingLifecycleReferences(liveDecisions);
    if (liveLifecycleGaps.length > 0) {
      await this.rewindForLiveLifecycleRetry(
        adapter,
        validation,
        liveLifecycleGaps,
        new Date().toISOString()
      );
      throw liveLifecycleCoverageError(liveLifecycleGaps);
    }
  }

  private async scanBlockRanges(
    adapter: EvmGovernanceAdapter,
    sourceState: GovernanceSourceState,
    scanFrom: number,
    targetBlock: number,
    observationBlock: number,
    suppressNotifications: boolean,
    validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
    run: GovernanceScanRun,
    processedProposalIds: Set<string>
  ): Promise<GovernanceSourceState> {
    for (const range of blockRanges(
      scanFrom,
      targetBlock,
      adapter.maxLogBlockRange
    )) {
      const sourceEvents = validateGovernanceEvents(
        await adapter.getEvents(range.from, range.to),
        range.from,
        range.to
      );
      const events = trackedProposalEvents(
        sourceEvents,
        validation.initialProposalId,
        validation.proposalCount
      );
      run.rangesScanned += 1;
      run.contractEventsRead += events.length;
      const byProposal = groupEventsByProposal(events);

      for (const [proposalId, proposalEvents] of byProposal) {
        processedProposalIds.add(proposalId);
        await this.synchronizeDecision(
          adapter,
          proposalId,
          proposalEvents,
          observationBlock,
          suppressNotifications,
          run
        );
      }

      const cursorBlock = await adapter.getBlock(range.to);
      assertReturnedBlock(cursorBlock, range.to, "cursor");
      sourceState = requirePersistedSourceState(
        await this.repository.updateSourceState(
          adapter.sourceKey,
          (current) => {
            const advancesCursor = range.to >= current.cursorBlockNumber;

            return {
              ...current,
              cursorBlockNumber: advancesCursor
                ? range.to
                : current.cursorBlockNumber,
              cursorBlockHash: advancesCursor
                ? cursorBlock.hash
                : current.cursorBlockHash,
              latestFinalizedBlockNumber: validation.latestFinalizedBlock.number,
              latestFinalizedBlockHash: validation.latestFinalizedBlock.hash,
              healthStatus: suppressNotifications ? "seeding" : "healthy",
              consecutiveFailures: 0,
              lastAttemptAt: run.startedAt,
              lastError: null,
              updatedAt: new Date().toISOString()
            };
          }
        ),
        adapter.sourceKey,
        "advancing its finalized cursor"
      );
      run.cursorAfter = sourceState.cursorBlockNumber;
      this.logger.debug(
        {
          protocol: adapter.protocol,
          fromBlock: range.from,
          toBlock: range.to,
          eventCount: events.length,
          ignoredLegacyEventCount: sourceEvents.length - events.length,
          suppressNotifications
        },
        "Finished on-chain governance block range"
      );
    }

    return sourceState;
  }

  private async refreshActiveDecisions(
    adapter: EvmGovernanceAdapter,
    processedProposalIds: Set<string>,
    observationBlock: number,
    suppressNotifications: boolean,
    run: GovernanceScanRun
  ): Promise<void> {
    const activeDecisions = await this.repository.findNonTerminalDecisions(
      adapter.sourceKey
    );

    for (const decision of activeDecisions) {
      if (processedProposalIds.has(decision.proposalId)) {
        continue;
      }

      await this.synchronizeDecision(
        adapter,
        decision.proposalId,
        [],
        observationBlock,
        suppressNotifications,
        run
      );
    }
  }

  private async ensureProposalBoundaryState(
    adapter: EvmGovernanceAdapter,
    sourceState: GovernanceSourceState,
    validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
    now: string
  ): Promise<GovernanceSourceState> {
    const legacyState = sourceState as Partial<GovernanceSourceState>;

    if (
      legacyState.initialProposalId !== undefined &&
      legacyState.baselineProposalCount !== undefined
    ) {
      return sourceState;
    }

    this.logger.warn(
      { sourceKey: adapter.sourceKey, baselineStatus: sourceState.baselineStatus },
      "Upgrading legacy on-chain governance source state"
    );

    return requirePersistedSourceState(
      await this.repository.updateSourceState(adapter.sourceKey, (current) => ({
        ...current,
        initialProposalId: validation.initialProposalId,
        baselineProposalCount: validation.proposalCount,
        ...(current.baselineStatus === "seeding"
          ? {
              baselineTargetBlock: validation.latestFinalizedBlock.number,
              cursorBlockNumber: adapter.deploymentBlock - 1,
              cursorBlockHash: null,
              latestFinalizedBlockNumber: validation.latestFinalizedBlock.number,
              latestFinalizedBlockHash: validation.latestFinalizedBlock.hash
            }
          : {}),
        updatedAt: now
      })),
      adapter.sourceKey,
      "upgrading legacy proposal boundaries"
    );
  }

  private async synchronizeDecision(
    adapter: EvmGovernanceAdapter,
    proposalId: string,
    events: GovernanceContractEvent[],
    observedAtBlock: number,
    suppressNotifications: boolean,
    run: GovernanceScanRun
  ): Promise<void> {
    const decisionId = decisionIdFromEventsOrSource(adapter, proposalId);
    const existing = await this.repository.findDecisionById(decisionId);
    const observation = await adapter.getDecision(
      proposalId,
      events,
      existing,
      observedAtBlock
    );
    assertDecisionMatchesRequest(
      observation,
      adapter,
      proposalId,
      decisionId,
      observedAtBlock
    );
    const notificationsEnabled =
      !suppressNotifications &&
      adapter.notificationsEnabled &&
      this.notificationService.enabled;
    const result = await this.repository.upsertDecision(observation, {
      notificationStatusForNewEvents: notificationsEnabled
        ? "pending"
        : "skipped"
    });

    if (result.created) {
      run.decisionsCreated += 1;
    } else if (result.updated) {
      run.decisionsUpdated += 1;
    } else {
      run.decisionsUnchanged += 1;
    }

    run.lifecycleEventsCreated += result.lifecycleEventsCreated.length;

    for (const lifecycleEvent of result.lifecycleEventsCreated) {
      if (lifecycleEvent.notificationStatus !== "pending") {
        continue;
      }

      const notificationResult =
        await this.notificationDispatcher.notifyNewProposal(lifecycleEvent);
      countNotificationResult(notificationResult, run);
    }
  }

  private async recordFailure(
    sourceKey: string,
    message: string,
    failedAt: string
  ): Promise<void> {
    try {
      const updated = await this.repository.updateSourceState(sourceKey, (current) => ({
        ...current,
        healthStatus: "failed",
        consecutiveFailures: current.consecutiveFailures + 1,
        lastAttemptAt: failedAt,
        lastError: message,
        updatedAt: failedAt
      }));
      if (!updated) {
        this.logger.error(
          { sourceKey },
          "On-chain governance source state disappeared while recording failure"
        );
      }
    } catch (stateError) {
      this.logger.error(
        { sourceKey, error: safeErrorDetails(stateError) },
        "Failed to record on-chain source failure state"
      );
    }
  }

  private async resetForSilentCoverageReplay(
    adapter: EvmGovernanceAdapter,
    validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
    missingProposalIds: string[],
    resetAt: string
  ): Promise<void> {
    await this.resetCoverageCursor(
      adapter,
      validation,
      "seeding",
      "silent",
      `Missing proposal id(s): ${formatMissingProposalIds(missingProposalIds)}`,
      resetAt,
      "resetting its silent coverage replay"
    );
  }

  private async rewindForLiveCoverageRetry(
    adapter: EvmGovernanceAdapter,
    validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
    missingProposalIds: string[],
    resetAt: string
  ): Promise<void> {
    await this.resetCoverageCursor(
      adapter,
      validation,
      "complete",
      "live",
      `Missing proposal id(s): ${formatMissingProposalIds(missingProposalIds)}`,
      resetAt,
      "rewinding its live coverage cursor"
    );
  }

  private async resetForSilentLifecycleReplay(
    adapter: EvmGovernanceAdapter,
    validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
    missingReferences: string[],
    resetAt: string
  ): Promise<void> {
    await this.resetCoverageCursor(
      adapter,
      validation,
      "seeding",
      "silent",
      `Missing canonical lifecycle reference(s): ${formatMissingLifecycleReferences(
        missingReferences
      )}`,
      resetAt,
      "resetting its silent lifecycle replay"
    );
  }

  private async rewindForLiveLifecycleRetry(
    adapter: EvmGovernanceAdapter,
    validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
    missingReferences: string[],
    resetAt: string
  ): Promise<void> {
    await this.resetCoverageCursor(
      adapter,
      validation,
      "complete",
      "live",
      `Missing canonical lifecycle reference(s): ${formatMissingLifecycleReferences(
        missingReferences
      )}`,
      resetAt,
      "rewinding its live lifecycle cursor"
    );
  }

  private async resetCoverageCursor(
    adapter: EvmGovernanceAdapter,
    validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
    baselineStatus: GovernanceSourceState["baselineStatus"],
    replayMode: NonNullable<GovernanceSourceState["replayMode"]>,
    lastError: string,
    resetAt: string,
    operation: string
  ): Promise<void> {
    requirePersistedSourceState(
      await this.repository.updateSourceState(adapter.sourceKey, (current) => ({
        ...current,
        baselineStatus,
        replayMode,
        cursorBlockNumber: adapter.deploymentBlock - 1,
        cursorBlockHash: null,
        latestFinalizedBlockNumber: validation.latestFinalizedBlock.number,
        latestFinalizedBlockHash: validation.latestFinalizedBlock.hash,
        healthStatus: "failed",
        lastAttemptAt: resetAt,
        lastError,
        updatedAt: resetAt
      })),
      adapter.sourceKey,
      operation
    );
  }
}

function requirePersistedSourceState(
  state: GovernanceSourceState | null,
  sourceKey: string,
  operation: string
): GovernanceSourceState {
  if (!state) {
    throw new Error(
      `On-chain governance source state ${sourceKey} disappeared while ${operation}.`
    );
  }

  return state;
}

function initialSourceState(
  adapter: EvmGovernanceAdapter,
  validation: Awaited<ReturnType<EvmGovernanceAdapter["validateSource"]>>,
  now: string
): GovernanceSourceState {
  return {
    sourceKey: adapter.sourceKey,
    protocol: adapter.protocol,
    sourceType: "onchain",
    chainId: adapter.chainId,
    contractAddress: adapter.contractAddress,
    deploymentBlock: adapter.deploymentBlock,
    initialProposalId: validation.initialProposalId,
    baselineStatus: "seeding",
    replayMode: "silent",
    baselineTargetBlock: validation.latestFinalizedBlock.number,
    baselineProposalCount: validation.proposalCount,
    cursorBlockNumber: adapter.deploymentBlock - 1,
    cursorBlockHash: null,
    latestFinalizedBlockNumber: validation.latestFinalizedBlock.number,
    latestFinalizedBlockHash: validation.latestFinalizedBlock.hash,
    implementationAddress: validation.implementationAddress,
    healthStatus: "seeding",
    consecutiveFailures: 0,
    lastAttemptAt: now,
    lastSuccessfulScanAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };
}

function decisionIdFromEventsOrSource(
  adapter: EvmGovernanceAdapter,
  proposalId: string
): string {
  return createGovernanceDecisionId({
    protocol: adapter.protocol,
    chainId: adapter.chainId,
    governorAddress: adapter.contractAddress,
    proposalId
  });
}

function countNotificationResult(
  result: ProposalNotificationResult,
  run: GovernanceScanRun
): void {
  if (result.status === "sent") {
    run.notificationSentCount += 1;
  }

  if (result.status === "failed") {
    run.notificationFailedCount += 1;
    if (result.error) {
      run.errors.push(result.error);
    }
  }
}

function createGovernanceScanRunId(
  sourceKey: string,
  startedAt: string
): string {
  return `governanceScan_${sha256(
    `${sourceKey}:${startedAt}:${randomUUID()}`
  ).slice(0, 16)}`;
}

export {
  blockRanges,
  findMissingLifecycleReferences,
  findMissingProposalIds,
  groupEventsByProposal
};
