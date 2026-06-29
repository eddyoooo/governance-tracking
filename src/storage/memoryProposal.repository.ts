import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";
import type {
  ProposalRepository,
  UpsertProposalOptions,
  UpsertResult
} from "./proposal.repository.js";
import {
  buildStoredProposal,
  hasMeaningfulProposalChange,
  proposalIdFromSourceIdentity
} from "./proposal.repositoryUtils.js";

export class MemoryProposalRepository implements ProposalRepository {
  private readonly proposals = new Map<string, StoredProposal>();

  clear(): void {
    this.proposals.clear();
  }

  async upsert(
    proposal: NormalizedGovernanceItem,
    options: UpsertProposalOptions = {}
  ): Promise<UpsertResult> {
    const existing = await this.findBySourceIdentity(
      proposal.protocol,
      proposal.sourceType,
      proposal.sourceId
    );

    if (existing && !hasMeaningfulProposalChange(existing, proposal)) {
      return {
        proposal: existing,
        created: false,
        updated: false
      };
    }

    const storedProposal = buildStoredProposal(proposal, existing, options);

    this.proposals.set(storedProposal.id, storedProposal);

    return {
      proposal: storedProposal,
      created: !existing,
      updated: true
    };
  }

  async upsertMany(
    proposals: NormalizedGovernanceItem[],
    options: UpsertProposalOptions = {}
  ): Promise<UpsertResult[]> {
    const results: UpsertResult[] = [];

    for (const proposal of proposals) {
      results.push(await this.upsert(proposal, options));
    }

    return results;
  }

  async findAll(): Promise<StoredProposal[]> {
    return [...this.proposals.values()];
  }

  async findById(id: string): Promise<StoredProposal | null> {
    return this.proposals.get(id) ?? null;
  }

  async findBySourceIdentity(
    protocol: string,
    sourceType: string,
    sourceId: string
  ): Promise<StoredProposal | null> {
    return (
      this.proposals.get(proposalIdFromSourceIdentity(protocol, sourceType, sourceId)) ??
      null
    );
  }

  async findByNotificationStatus(
    status: StoredProposal["notificationStatus"],
    limit = 100
  ): Promise<StoredProposal[]> {
    return [...this.proposals.values()]
      .filter((proposal) => proposal.notificationStatus === status)
      .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt))
      .slice(0, limit);
  }

  async updateNotificationStatus(
    id: string,
    status: StoredProposal["notificationStatus"],
    error?: string
  ): Promise<StoredProposal | null> {
    const existing = await this.findById(id);

    if (!existing) {
      return null;
    }

    const updated: StoredProposal = {
      ...existing,
      notificationStatus: status,
      notificationError: error,
      updatedAt: new Date().toISOString()
    };

    if (!error) {
      delete updated.notificationError;
    }

    this.proposals.set(updated.id, updated);

    return updated;
  }
}
