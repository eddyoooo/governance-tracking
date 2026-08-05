import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";
import { createProposalId } from "../utils/hash.js";
import type {
  ProposalNotificationState,
  UpsertProposalOptions
} from "./proposal.repository.js";

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
  const canonicalId = proposalIdFromSourceIdentity(
    proposal.protocol,
    proposal.sourceType,
    proposal.sourceId
  );

  return {
    ...existing,
    ...proposal,
    id: existing?.id ?? canonicalId,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    notificationStatus:
      existing?.notificationStatus ?? options.notificationStatusForNew ?? "skipped",
    notificationError: existing?.notificationError,
    notificationDeliveries: existing?.notificationDeliveries,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

export function applyProposalNotificationState(
  proposal: StoredProposal,
  state: ProposalNotificationState,
  now = new Date().toISOString()
): StoredProposal {
  const updated: StoredProposal = {
    ...proposal,
    notificationStatus: state.notificationStatus,
    notificationError: state.notificationError,
    notificationDeliveries: state.notificationDeliveries,
    updatedAt: now
  };

  if (!state.notificationError) {
    delete updated.notificationError;
  }

  if (!state.notificationDeliveries) {
    delete updated.notificationDeliveries;
  }

  return updated;
}
