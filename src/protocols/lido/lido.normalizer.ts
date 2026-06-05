import { createProposalId, hashObject } from "../../utils/hash.js";
import type { NormalizedGovernanceItem, RawGovernanceItem } from "../types.js";

export function normalizeLidoForumItem(
  item: RawGovernanceItem
): NormalizedGovernanceItem {
  return {
    id: createProposalId(item.protocol, item.sourceType, item.sourceId),
    protocol: item.protocol,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    title: item.title,
    publisherName: item.publisherName,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    rawHash: hashObject(item.raw),
    status: "new"
  };
}
