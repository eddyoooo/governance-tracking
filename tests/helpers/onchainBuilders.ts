import { jest } from "@jest/globals";
import { createGovernanceDecisionId, outcomesForStatus } from "../../src/onchain/governanceDecision.js";
import type {
  EvmGovernanceAdapter,
  GovernanceContractEvent,
  GovernanceDecisionObservation,
  GovernanceDecisionStatus,
  GovernanceScanRun,
  GovernanceSourceState,
  GovernanceSourceValidation,
  StoredGovernanceDecision
} from "../../src/onchain/types.js";

export const TEST_GOVERNOR_ADDRESS =
  "0x408ED6354d4973f66138C91495F2f2FCbd8724C3";
export const TEST_TIMELOCK_ADDRESS =
  "0x1a9C8182C09F50C8318d769245beA52c32BE35BC";
export const TEST_UNI_ADDRESS =
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
export const TEST_IMPLEMENTATION_ADDRESS =
  "0x53a328F4086d7C0F1Fa19e594c9b842125263026";
export const TEST_PROPOSER_ADDRESS =
  "0x92a9C92c215092720c731C96d4FF4E4c6d3B959c";
export const TEST_TARGET_ADDRESS =
  "0x0000000000000000000000000000000000000001";
export const TEST_SOURCE_KEY =
  `uniswap:onchain:1:${TEST_GOVERNOR_ADDRESS.toLowerCase()}`;

export function testBlockHash(blockNumber: number): string {
  return `0x${blockNumber.toString(16).padStart(64, "0")}`;
}

export function createGovernanceObservation(
  overrides: Partial<GovernanceDecisionObservation> = {}
): GovernanceDecisionObservation {
  const proposalId = overrides.proposalId ?? "1";
  const status = overrides.status ?? "pending";
  const outcomes = outcomesForStatus(status);

  return {
    id: createGovernanceDecisionId({
      protocol: "uniswap",
      chainId: 1,
      governorAddress: TEST_GOVERNOR_ADDRESS,
      proposalId
    }),
    sourceKey: TEST_SOURCE_KEY,
    protocol: "uniswap",
    sourceType: "onchain",
    chainId: 1,
    governorAddress: TEST_GOVERNOR_ADDRESS,
    proposalId,
    proposer: TEST_PROPOSER_ADDRESS,
    title: `Real Uniswap proposal #${proposalId}`,
    description: `# Real Uniswap proposal #${proposalId}\n\nGovernance proposal body.`,
    sourceUrl: `https://vote.uniswapfoundation.org/proposals/${proposalId}`,
    status,
    ...outcomes,
    startBlock: 102,
    endBlock: 110,
    eta: null,
    forVotes: "0",
    againstVotes: "0",
    abstainVotes: "0",
    actions: [
      {
        index: 0,
        target: TEST_TARGET_ADDRESS,
        value: "0",
        signature: "setValue(uint256)",
        calldata: "0x01"
      }
    ],
    createdBlockNumber: 101,
    createdTransactionHash: `0x${"11".repeat(32)}`,
    lastObservedBlockNumber: 120,
    rawHash: `hash-${proposalId}-${status}`,
    ...overrides
  };
}

export function createStoredGovernanceDecision(
  overrides: Partial<StoredGovernanceDecision> = {}
): StoredGovernanceDecision {
  const observation = createGovernanceObservation(overrides);
  const now = overrides.createdAt ?? "2026-09-01T00:00:00.000Z";

  return {
    ...observation,
    title: observation.title ?? `Real Uniswap proposal #${observation.proposalId}`,
    description: observation.description ?? "",
    votingEndedAt: observation.votingEndedAt ?? null,
    createdBlockNumber: observation.createdBlockNumber ?? null,
    createdTransactionHash: observation.createdTransactionHash ?? null,
    canceledBlockNumber: observation.canceledBlockNumber ?? null,
    canceledTransactionHash: observation.canceledTransactionHash ?? null,
    queuedBlockNumber: observation.queuedBlockNumber ?? null,
    queuedTransactionHash: observation.queuedTransactionHash ?? null,
    executedBlockNumber: observation.executedBlockNumber ?? null,
    executedTransactionHash: observation.executedTransactionHash ?? null,
    firstSeenAt: overrides.firstSeenAt ?? now,
    lastSyncedAt: overrides.lastSyncedAt ?? now,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now
  };
}

export function createGovernanceContractEvent(
  overrides: Partial<GovernanceContractEvent> = {}
): GovernanceContractEvent {
  const proposalId = overrides.proposalId ?? "1";
  const blockNumber = overrides.blockNumber ?? 101;
  const transactionHash =
    overrides.transactionHash ?? `0x${proposalId.padStart(64, "1")}`;

  return {
    id: `${transactionHash}:0`,
    type: "created",
    proposalId,
    blockNumber,
    blockHash: testBlockHash(blockNumber),
    transactionHash,
    logIndex: 0,
    proposer: TEST_PROPOSER_ADDRESS,
    startBlock: blockNumber + 1,
    endBlock: blockNumber + 10,
    description: `# Real Uniswap proposal #${proposalId}`,
    actions: createGovernanceObservation({ proposalId }).actions,
    ...overrides
  };
}

export function createGovernanceSourceState(
  overrides: Partial<GovernanceSourceState> = {}
): GovernanceSourceState {
  const state: GovernanceSourceState = {
    sourceKey: TEST_SOURCE_KEY,
    protocol: "uniswap",
    sourceType: "onchain",
    chainId: 1,
    contractAddress: TEST_GOVERNOR_ADDRESS,
    deploymentBlock: 100,
    initialProposalId: "0",
    baselineStatus: "complete",
    replayMode: null,
    baselineTargetBlock: 110,
    baselineProposalCount: "1",
    cursorBlockNumber: 110,
    cursorBlockHash: testBlockHash(110),
    latestFinalizedBlockNumber: 110,
    latestFinalizedBlockHash: testBlockHash(110),
    implementationAddress: TEST_IMPLEMENTATION_ADDRESS,
    healthStatus: "healthy",
    consecutiveFailures: 0,
    lastAttemptAt: "2026-09-01T00:00:00.000Z",
    lastSuccessfulScanAt: "2026-09-01T00:00:00.000Z",
    lastError: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };

  if (overrides.replayMode === undefined && overrides.baselineStatus === "seeding") {
    state.replayMode = "silent";
  }

  return state;
}

export function createGovernanceScanRun(
  overrides: Partial<GovernanceScanRun> = {}
): GovernanceScanRun {
  return {
    id: "governanceScan_test",
    sourceKey: TEST_SOURCE_KEY,
    protocol: "uniswap",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: "2026-09-01T00:01:00.000Z",
    status: "success",
    baselineSeeding: false,
    cursorBefore: 110,
    cursorAfter: 120,
    latestFinalizedBlock: 120,
    rangesScanned: 1,
    contractEventsRead: 1,
    decisionsCreated: 1,
    decisionsUpdated: 0,
    decisionsUnchanged: 0,
    lifecycleEventsCreated: 1,
    notificationSentCount: 1,
    notificationFailedCount: 0,
    errors: [],
    ...overrides
  };
}

export interface FakeEvmAdapterControl {
  adapter: EvmGovernanceAdapter;
  validation: GovernanceSourceValidation;
  events: GovernanceContractEvent[];
  statuses: Map<string, GovernanceDecisionStatus>;
  validateSource: ReturnType<typeof jest.fn>;
  getBlock: ReturnType<typeof jest.fn>;
  getEvents: ReturnType<typeof jest.fn>;
  getDecision: ReturnType<typeof jest.fn>;
}

export function createFakeEvmGovernanceAdapter(options: {
  finalizedBlock?: number;
  initialProposalId?: string;
  proposalCount?: string;
  events?: GovernanceContractEvent[];
  statuses?: Record<string, GovernanceDecisionStatus>;
  notificationsEnabled?: boolean;
  implementationAddress?: string;
  maxLogBlockRange?: number;
  reorgOverlapBlocks?: number;
  enabled?: boolean;
} = {}): FakeEvmAdapterControl {
  const finalizedBlock = options.finalizedBlock ?? 110;
  const events = options.events ?? [createGovernanceContractEvent()];
  const statuses = new Map<string, GovernanceDecisionStatus>(
    Object.entries(options.statuses ?? { "1": "pending" })
  );
  const validation: GovernanceSourceValidation = {
    chainId: 1,
    latestFinalizedBlock: {
      number: finalizedBlock,
      hash: testBlockHash(finalizedBlock),
      timestamp: "2026-09-01T00:00:00.000Z"
    },
    implementationAddress:
      options.implementationAddress ?? TEST_IMPLEMENTATION_ADDRESS,
    proposalCount: options.proposalCount ?? "1",
    initialProposalId: options.initialProposalId ?? "0",
    votingDelay: "1",
    votingPeriod: "10",
    proposalThreshold: "1000000000000000000000000",
    quorumVotes: "40000000000000000000000000"
  };
  const validateSource = jest.fn(async () => structuredClone(validation));
  const getBlock = jest.fn(async (blockNumber: number) => ({
    number: blockNumber,
    hash: testBlockHash(blockNumber),
    timestamp: "2026-09-01T00:00:00.000Z"
  }));
  const getEvents = jest.fn(async (fromBlock: number, toBlock: number) =>
    events.filter(
      (event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock
    )
  );
  const getDecision = jest.fn(
    async (
      proposalId: string,
      proposalEvents: GovernanceContractEvent[],
      existing: StoredGovernanceDecision | null,
      observedAtBlock: number
    ) => {
      const status = statuses.get(proposalId) ?? "pending";
      const createdEvent = proposalEvents.find((event) => event.type === "created");
      const canceledEvent = proposalEvents.find(
        (event) => event.type === "canceled"
      );
      const queuedEvent = proposalEvents.find((event) => event.type === "queued");
      const executedEvent = proposalEvents.find(
        (event) => event.type === "executed"
      );
      const hasQueueState =
        status === "queued" ||
        status === "expired" ||
        status === "executed" ||
        (status === "canceled" &&
          (queuedEvent !== undefined || (existing?.eta ?? null) !== null));

      return createGovernanceObservation({
        proposalId,
        status,
        eta: hasQueueState
          ? (queuedEvent?.eta ?? existing?.eta ?? "1785000000")
          : null,
        title: createdEvent?.description?.replace(/^#\s*/, "") ?? existing?.title,
        description: createdEvent?.description ?? existing?.description,
        createdBlockNumber:
          createdEvent?.blockNumber ?? existing?.createdBlockNumber ?? undefined,
        createdTransactionHash:
          createdEvent?.transactionHash ??
          existing?.createdTransactionHash ??
          undefined,
        canceledBlockNumber:
          canceledEvent?.blockNumber ?? existing?.canceledBlockNumber ?? undefined,
        canceledTransactionHash:
          canceledEvent?.transactionHash ??
          existing?.canceledTransactionHash ??
          undefined,
        queuedBlockNumber:
          queuedEvent?.blockNumber ?? existing?.queuedBlockNumber ?? undefined,
        queuedTransactionHash:
          queuedEvent?.transactionHash ??
          existing?.queuedTransactionHash ??
          undefined,
        executedBlockNumber:
          executedEvent?.blockNumber ?? existing?.executedBlockNumber ?? undefined,
        executedTransactionHash:
          executedEvent?.transactionHash ??
          existing?.executedTransactionHash ??
          undefined,
        lastObservedBlockNumber: observedAtBlock,
        rawHash: `hash-${proposalId}-${status}`
      });
    }
  );
  const adapter: EvmGovernanceAdapter = {
    sourceKey: TEST_SOURCE_KEY,
    protocol: "uniswap",
    sourceType: "onchain",
    chainId: 1,
    contractAddress: TEST_GOVERNOR_ADDRESS,
    deploymentBlock: 100,
    maxLogBlockRange: options.maxLogBlockRange ?? 10,
    reorgOverlapBlocks: options.reorgOverlapBlocks ?? 2,
    enabled: options.enabled ?? true,
    notificationsEnabled: options.notificationsEnabled ?? true,
    validateSource,
    getBlock,
    getEvents,
    getDecision
  };

  return {
    adapter,
    validation,
    events,
    statuses,
    validateSource,
    getBlock,
    getEvents,
    getDecision
  };
}
