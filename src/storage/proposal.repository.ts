import type {
  GovernanceSourceType,
  NormalizedGovernanceItem,
  NotificationStatus,
  StoredProposal
} from "../protocols/types.js";

export type ProposalSort =
  | "publishedAt_desc"
  | "publishedAt_asc"
  | "firstSeenAt_desc"
  | "firstSeenAt_asc";

export interface ProposalQuery {
  protocol?: string;
  publisherName?: string;
  sourceType?: GovernanceSourceType;
  notificationStatus?: NotificationStatus;
  limit?: number;
  offset?: number;
  sort?: ProposalSort;
}

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
  findAll(query?: ProposalQuery): Promise<StoredProposal[]>;
  findById(id: string): Promise<StoredProposal | null>;
  findBySourceIdentity(
    protocol: string,
    sourceType: string,
    sourceId: string
  ): Promise<StoredProposal | null>;
  findByNotificationStatus(
    status: NotificationStatus,
    query?: ProposalQuery
  ): Promise<StoredProposal[]>;
  updateNotificationStatus(
    id: string,
    status: NotificationStatus,
    error?: string
  ): Promise<StoredProposal | null>;
}
