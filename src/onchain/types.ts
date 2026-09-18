import type {
  NotificationDelivery,
  NotificationStatus
} from "../protocols/types.js";
import type { NotificationMessage } from "../notifications/notification.service.js";

export type GovernanceDecisionStatus =
  | "pending"
  | "active"
  | "canceled"
  | "defeated"
  | "succeeded"
  | "queued"
  | "expired"
  | "executed";

export type GovernanceVoteOutcome =
  | "pending"
  | "succeeded"
  | "defeated"
  | "canceled";

export type GovernanceExecutionOutcome =
  | "not_started"
  | "awaiting_queue"
  | "queued"
  | "executed"
  | "expired"
  | "canceled";

export type GovernanceTransitionType =
  | "created"
  | "succeeded"
  | "defeated"
  | "canceled"
  | "queued"
  | "expired"
  | "executed";

export interface GovernanceAction {
  index: number;
  target: string;
  value: string;
  signature: string;
  calldata: string;
}

export interface GovernanceBlockReference {
  number: number;
  hash: string;
  timestamp: string;
}

export interface GovernanceContractEvent {
  id: string;
  type: "created" | "canceled" | "queued" | "executed";
  proposalId: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  description?: string;
  proposer?: string;
  startBlock?: number;
  endBlock?: number;
  eta?: string;
  actions?: GovernanceAction[];
}

export interface GovernanceDecisionObservation {
  id: string;
  sourceKey: string;
  protocol: string;
  sourceType: "onchain";
  chainId: number;
  governorAddress: string;
  proposalId: string;
  proposer: string;
  title?: string;
  description?: string;
  sourceUrl: string;
  status: GovernanceDecisionStatus;
  voteOutcome: GovernanceVoteOutcome;
  executionOutcome: GovernanceExecutionOutcome;
  startBlock: number;
  endBlock: number;
  votingEndedAt?: string;
  eta: string | null;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  actions: GovernanceAction[];
  createdBlockNumber?: number;
  createdTransactionHash?: string;
  canceledBlockNumber?: number;
  canceledTransactionHash?: string;
  queuedBlockNumber?: number;
  queuedTransactionHash?: string;
  executedBlockNumber?: number;
  executedTransactionHash?: string;
  lastObservedBlockNumber: number;
  rawHash: string;
}

export interface StoredGovernanceDecision
  extends Omit<
    GovernanceDecisionObservation,
    | "title"
    | "description"
    | "votingEndedAt"
    | "createdBlockNumber"
    | "createdTransactionHash"
    | "canceledBlockNumber"
    | "canceledTransactionHash"
    | "queuedBlockNumber"
    | "queuedTransactionHash"
    | "executedBlockNumber"
    | "executedTransactionHash"
  > {
  title: string;
  description: string;
  votingEndedAt: string | null;
  createdBlockNumber: number | null;
  createdTransactionHash: string | null;
  canceledBlockNumber: number | null;
  canceledTransactionHash: string | null;
  queuedBlockNumber: number | null;
  queuedTransactionHash: string | null;
  executedBlockNumber: number | null;
  executedTransactionHash: string | null;
  firstSeenAt: string;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceLifecycleEvent {
  id: string;
  decisionId: string;
  sourceKey: string;
  protocol: string;
  transition: GovernanceTransitionType;
  decisionStatus: GovernanceDecisionStatus;
  blockNumber: number;
  transactionHash: string | null;
  message: NotificationMessage;
  notificationStatus: NotificationStatus;
  notificationError?: string;
  notificationDeliveries?: Record<string, NotificationDelivery>;
  firstSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export type GovernanceSourceHealthStatus = "seeding" | "healthy" | "failed";

export interface GovernanceSourceState {
  sourceKey: string;
  protocol: string;
  sourceType: "onchain";
  chainId: number;
  contractAddress: string;
  deploymentBlock: number;
  initialProposalId: string;
  baselineStatus: "seeding" | "complete";
  replayMode?: "silent" | "live" | null;
  baselineTargetBlock: number;
  baselineProposalCount: string;
  cursorBlockNumber: number;
  cursorBlockHash: string | null;
  latestFinalizedBlockNumber: number;
  latestFinalizedBlockHash: string;
  implementationAddress: string;
  healthStatus: GovernanceSourceHealthStatus;
  consecutiveFailures: number;
  lastAttemptAt: string;
  lastSuccessfulScanAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceSourceValidation {
  chainId: number;
  latestFinalizedBlock: GovernanceBlockReference;
  implementationAddress: string;
  proposalCount: string;
  initialProposalId: string;
  votingDelay: string;
  votingPeriod: string;
  proposalThreshold: string;
  quorumVotes: string;
}

export interface EvmGovernanceAdapter {
  readonly sourceKey: string;
  readonly protocol: string;
  readonly sourceType: "onchain";
  readonly chainId: number;
  readonly contractAddress: string;
  readonly deploymentBlock: number;
  readonly maxLogBlockRange: number;
  readonly reorgOverlapBlocks: number;
  readonly enabled: boolean;
  readonly notificationsEnabled: boolean;
  validateSource(): Promise<GovernanceSourceValidation>;
  getBlock(blockNumber: number): Promise<GovernanceBlockReference>;
  getEvents(
    fromBlock: number,
    toBlock: number
  ): Promise<GovernanceContractEvent[]>;
  getDecision(
    proposalId: string,
    events: GovernanceContractEvent[],
    existing: StoredGovernanceDecision | null,
    observedAtBlock: number
  ): Promise<GovernanceDecisionObservation>;
}

export interface GovernanceScanRun {
  id: string;
  sourceKey: string;
  protocol: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "success" | "failed";
  baselineSeeding: boolean;
  cursorBefore: number;
  cursorAfter: number;
  latestFinalizedBlock: number;
  rangesScanned: number;
  contractEventsRead: number;
  decisionsCreated: number;
  decisionsUpdated: number;
  decisionsUnchanged: number;
  lifecycleEventsCreated: number;
  notificationSentCount: number;
  notificationFailedCount: number;
  errors: string[];
}

export interface GovernanceScanResult extends GovernanceScanRun {
  finishedAt: string;
}
