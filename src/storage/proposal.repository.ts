import type {
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
  findBySourceIdentity(
    protocol: string,
    sourceType: string,
    sourceId: string
  ): Promise<StoredProposal | null>;
  findByNotificationStatus(
    status: NotificationStatus,
    limit?: number
  ): Promise<StoredProposal[]>;
  updateNotificationStatus(
    id: string,
    status: NotificationStatus,
    error?: string
  ): Promise<StoredProposal | null>;
}
