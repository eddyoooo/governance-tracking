import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";
import { createProposalId } from "../utils/hash.js";
import type { ProposalSort, UpsertProposalOptions } from "./proposal.repository.js";

export const DEFAULT_PROPOSAL_LIMIT = 100;

export const proposalSortFields: Record<ProposalSort, keyof StoredProposal> = {
  publishedAt_desc: "publishedAt",
  publishedAt_asc: "publishedAt",
  firstSeenAt_desc: "firstSeenAt",
  firstSeenAt_asc: "firstSeenAt",
  lastSeenAt_desc: "lastSeenAt",
  lastSeenAt_asc: "lastSeenAt"
};

export const proposalSortValues = Object.keys(proposalSortFields) as ProposalSort[];

export function proposalSortDirection(sort: ProposalSort): "asc" | "desc" {
  return sort.endsWith("_asc") ? "asc" : "desc";
}

export function proposalIdFromSourceIdentity(
  protocol: string,
  sourceType: string,
  sourceId: string
): string {
  return createProposalId(protocol, sourceType, sourceId);
}

export function hasMeaningfulProposalChange(
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

export function buildStoredProposal(
  proposal: NormalizedGovernanceItem,
  existing?: StoredProposal | null,
  options: UpsertProposalOptions = {},
  now = new Date().toISOString()
): StoredProposal {
  return {
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
}
