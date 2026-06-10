import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";

export interface ProposalQuery {
  protocol?: string;
  limit?: number;
}

export interface UpsertResult {
  proposal: StoredProposal;
  created: boolean;
}

export interface ProposalRepository {
  upsert(proposal: NormalizedGovernanceItem): Promise<UpsertResult>;
  upsertMany(proposals: NormalizedGovernanceItem[]): Promise<UpsertResult[]>;
  findAll(query?: ProposalQuery): Promise<StoredProposal[]>;
  findById(id: string): Promise<StoredProposal | null>;
  findBySourceIdentity(
    protocol: string,
    sourceType: string,
    sourceId: string
  ): Promise<StoredProposal | null>;
}
