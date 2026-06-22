import { hashObject } from "../utils/hash.js";
import type { RawGovernanceItem } from "./types.js";

export function hashSourceContent(item: RawGovernanceItem): string {
  return hashObject({
    protocol: item.protocol,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    title: item.title,
    publisherName: item.publisherName,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt
  });
}
