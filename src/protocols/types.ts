export type GovernanceSourceType = "forum" | "snapshot" | "onchain";
export type ProposalStatus = "new" | "seen" | "archived";
export type NotificationStatus = "pending" | "sent" | "skipped" | "failed";

export interface GovernanceSource {
  protocol: string;
  type: GovernanceSourceType;
  name: string;
  baseUrl: string;
}

export interface RawGovernanceItem {
  protocol: string;
  sourceType: GovernanceSourceType;
  sourceId: string;
  title: string;
  publisherName: string;
  sourceUrl: string;
  publishedAt: string;
  fetchedAt: string;
  raw: unknown;
}

export interface NormalizedGovernanceItem {
  id: string;
  protocol: string;
  sourceType: GovernanceSourceType;
  sourceId: string;
  title: string;
  publisherName: string;
  sourceUrl: string;
  publishedAt: string;
  fetchedAt: string;
  rawHash: string;
  status: ProposalStatus;
}

export interface StoredProposal extends NormalizedGovernanceItem {
  firstSeenAt: string;
  lastSeenAt: string;
  notificationStatus: NotificationStatus;
  notificationError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolAdapter {
  protocol: string;
  source: GovernanceSource;
  enabled: boolean;
  publisherAllowlist: string[];
  fetchRecent(): Promise<RawGovernanceItem[]>;
  normalize(item: RawGovernanceItem): NormalizedGovernanceItem;
}
