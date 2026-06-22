import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";
import type {
  ProposalQuery,
  ProposalRepository,
  ProposalSort,
  UpsertProposalOptions,
  UpsertResult
} from "./proposal.repository.js";

const DEFAULT_PROPOSAL_LIMIT = 100;

const sortFields: Record<ProposalSort, keyof StoredProposal> = {
  publishedAt_desc: "publishedAt",
  publishedAt_asc: "publishedAt",
  firstSeenAt_desc: "firstSeenAt",
  firstSeenAt_asc: "firstSeenAt",
  lastSeenAt_desc: "lastSeenAt",
  lastSeenAt_asc: "lastSeenAt"
};

function sortDirection(sort: ProposalSort): "asc" | "desc" {
  return sort.endsWith("_asc") ? "asc" : "desc";
}

function hasMeaningfulProposalChange(
  existing: StoredProposal,
  proposal: NormalizedGovernanceItem
): boolean {
  return (
    existing.protocol !== proposal.protocol ||
    existing.sourceType !== proposal.sourceType ||
    existing.sourceId !== proposal.sourceId ||
    existing.title !== proposal.title ||
    existing.publisherName !== proposal.publisherName ||
    existing.sourceUrl !== proposal.sourceUrl ||
    existing.publishedAt !== proposal.publishedAt ||
    existing.rawHash !== proposal.rawHash
  );
}

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

    const now = new Date().toISOString();
    const storedProposal: StoredProposal = {
      ...existing,
      ...proposal,
      id: existing?.id ?? proposal.id,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      notificationStatus:
        existing?.notificationStatus ?? options.notificationStatusForNew ?? "skipped",
      notificationError: existing?.notificationError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

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

  async findAll(query: ProposalQuery = {}): Promise<StoredProposal[]> {
    const limit = query.limit ?? DEFAULT_PROPOSAL_LIMIT;
    const offset = query.offset ?? 0;
    const sort = query.sort ?? "publishedAt_desc";
    const sortField = sortFields[sort];
    const direction = sortDirection(sort);

    return [...this.proposals.values()]
      .filter((proposal) => !query.protocol || proposal.protocol === query.protocol)
      .filter(
        (proposal) =>
          !query.publisherName || proposal.publisherName === query.publisherName
      )
      .filter((proposal) => !query.sourceType || proposal.sourceType === query.sourceType)
      .filter(
        (proposal) =>
          !query.notificationStatus ||
          proposal.notificationStatus === query.notificationStatus
      )
      .sort((left, right) => {
        const compared = String(left[sortField]).localeCompare(String(right[sortField]));

        return direction === "asc" ? compared : -compared;
      })
      .slice(offset, offset + limit);
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
      [...this.proposals.values()].find(
        (proposal) =>
          proposal.protocol === protocol &&
          proposal.sourceType === sourceType &&
          proposal.sourceId === sourceId
      ) ?? null
    );
  }

  async findByNotificationStatus(
    status: StoredProposal["notificationStatus"],
    query: ProposalQuery = {}
  ): Promise<StoredProposal[]> {
    return this.findAll({
      ...query,
      notificationStatus: status
    });
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
