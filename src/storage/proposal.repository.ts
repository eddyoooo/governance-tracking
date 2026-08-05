import type {
  NotificationDelivery,
  NormalizedGovernanceItem,
  NotificationStatus,
  StoredProposal
} from "../protocols/types.js";

export interface UpsertProposalOptions {
  notificationStatusForNew?: NotificationStatus;
}

export interface UpsertResult {
  proposal: StoredProposal;
  created: boolean;
  updated: boolean;
}

export interface ProposalNotificationState {
  notificationStatus: NotificationStatus;
  notificationError?: string;
  notificationDeliveries?: Record<string, NotificationDelivery>;
}

export type ProposalNotificationStateUpdater = (
  proposal: StoredProposal
) => ProposalNotificationState;

export interface ProposalRepository {
  upsert(
    proposal: NormalizedGovernanceItem,
    options?: UpsertProposalOptions
  ): Promise<UpsertResult>;
  upsertMany(
    proposals: NormalizedGovernanceItem[],
    options?: UpsertProposalOptions
  ): Promise<UpsertResult[]>;
  findAll(): Promise<StoredProposal[]>;
  findById(id: string): Promise<StoredProposal | null>;
  existsForProtocol(protocol: string): Promise<boolean>;
  findBySourceIdentity(
    protocol: string,
    sourceType: string,
    sourceId: string
  ): Promise<StoredProposal | null>;
  findByNotificationStatus(
    status: NotificationStatus,
    limit?: number
  ): Promise<StoredProposal[]>;
  countByNotificationStatus(status: NotificationStatus): Promise<number>;
  updateNotificationState(
    id: string,
    updater: ProposalNotificationStateUpdater
  ): Promise<StoredProposal | null>;
  updateNotificationStatus(
    id: string,
    status: NotificationStatus,
    error?: string
  ): Promise<StoredProposal | null>;
}
