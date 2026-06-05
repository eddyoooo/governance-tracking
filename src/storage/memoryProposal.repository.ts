import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";
import type {
  ProposalQuery,
  ProposalRepository,
  UpsertResult
} from "./proposal.repository.js";

export class MemoryProposalRepository implements ProposalRepository {
  private readonly proposals = new Map<string, StoredProposal>();

  async upsert(proposal: NormalizedGovernanceItem): Promise<UpsertResult> {
    const existing = this.proposals.get(proposal.id);
    const now = new Date().toISOString();
    const storedProposal: StoredProposal = {
      ...existing,
      ...proposal,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.proposals.set(proposal.id, storedProposal);

    return {
      proposal: storedProposal,
      created: !existing
    };
  }

  async upsertMany(proposals: NormalizedGovernanceItem[]): Promise<UpsertResult[]> {
    const results: UpsertResult[] = [];

    for (const proposal of proposals) {
      results.push(await this.upsert(proposal));
    }

    return results;
  }

  async findAll(query: ProposalQuery = {}): Promise<StoredProposal[]> {
    const limit = query.limit ?? 100;

    return [...this.proposals.values()]
      .filter((proposal) => !query.protocol || proposal.protocol === query.protocol)
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, limit);
  }

  async findById(id: string): Promise<StoredProposal | null> {
    return this.proposals.get(id) ?? null;
  }
}
