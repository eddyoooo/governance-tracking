import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";
import type {
  ProposalRepository,
  ProposalNotificationStateUpdater,
  UpsertProposalOptions,
  UpsertResult
} from "./proposal.repository.js";
import {
  applyProposalNotificationState,
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

  async existsForProtocol(protocol: string): Promise<boolean> {
    return [...this.proposals.values()].some(
      (proposal) => proposal.protocol === protocol
    );
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

  async countByNotificationStatus(
    status: StoredProposal["notificationStatus"]
  ): Promise<number> {
    return [...this.proposals.values()].filter(
      (proposal) => proposal.notificationStatus === status
    ).length;
  }

  async updateNotificationState(
    id: string,
    updater: ProposalNotificationStateUpdater
  ): Promise<StoredProposal | null> {
    const existing = await this.findById(id);

    if (!existing) {
      return null;
    }

    const updated = applyProposalNotificationState(existing, updater(existing));
    this.proposals.set(updated.id, updated);

    return updated;
  }

  async updateNotificationStatus(
    id: string,
    status: StoredProposal["notificationStatus"],
    error?: string
  ): Promise<StoredProposal | null> {
    return this.updateNotificationState(id, (proposal) => ({
      notificationStatus: status,
      notificationError: error,
      notificationDeliveries: proposal.notificationDeliveries
    }));
  }
}
