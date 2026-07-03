import {
  type CollectionReference,
  type DocumentData,
  type Firestore
} from "firebase-admin/firestore";
import type { GovernanceSourceType } from "../protocols/types.js";

export type SourceActivityStatus = "healthy" | "warning" | "critical";

export interface SourceActivityRecord {
  protocol: string;
  sourceType: GovernanceSourceType;
  latestRawSourceId?: string;
  latestRawPublishedAt?: string;
  lastFetchedAt: string;
  lastFetchedCount: number;
  consecutiveStaleRuns: number;
  status: SourceActivityStatus;
  statusReason?: string;
  warningThresholdDays: number;
  criticalThresholdDays: number;
  minFetchedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceActivityRepository {
  upsert(record: SourceActivityRecord): Promise<void>;
  findByProtocol(protocol: string): Promise<SourceActivityRecord | null>;
  findAll(limit?: number): Promise<SourceActivityRecord[]>;
}

function cleanSourceActivityRecord(
  record: SourceActivityRecord
): SourceActivityRecord {
  const cleaned: SourceActivityRecord = {
    protocol: record.protocol,
    sourceType: record.sourceType,
    lastFetchedAt: record.lastFetchedAt,
    lastFetchedCount: record.lastFetchedCount,
    consecutiveStaleRuns: record.consecutiveStaleRuns,
    status: record.status,
    warningThresholdDays: record.warningThresholdDays,
    criticalThresholdDays: record.criticalThresholdDays,
    minFetchedCount: record.minFetchedCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };

  if (record.latestRawSourceId) {
    cleaned.latestRawSourceId = record.latestRawSourceId;
  }

  if (record.latestRawPublishedAt) {
    cleaned.latestRawPublishedAt = record.latestRawPublishedAt;
  }

  if (record.statusReason) {
    cleaned.statusReason = record.statusReason;
  }

  return cleaned;
}

export class MemorySourceActivityRepository
  implements SourceActivityRepository
{
  private readonly records = new Map<string, SourceActivityRecord>();

  clear(): void {
    this.records.clear();
  }

  async upsert(record: SourceActivityRecord): Promise<void> {
    this.records.set(record.protocol, cleanSourceActivityRecord(record));
  }

  async findByProtocol(protocol: string): Promise<SourceActivityRecord | null> {
    return this.records.get(protocol) ?? null;
  }

  async findAll(limit = 100): Promise<SourceActivityRecord[]> {
    return [...this.records.values()]
      .sort((left, right) => -left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, limit);
  }
}

export class FirestoreSourceActivityRepository
  implements SourceActivityRepository
{
  private readonly collection: CollectionReference<DocumentData>;

  constructor(db: Firestore) {
    this.collection = db.collection("sourceActivity");
  }

  async upsert(record: SourceActivityRecord): Promise<void> {
    await this.collection
      .doc(record.protocol)
      .set(cleanSourceActivityRecord(record), { merge: true });
  }

  async findByProtocol(protocol: string): Promise<SourceActivityRecord | null> {
    const snapshot = await this.collection.doc(protocol).get();

    if (!snapshot.exists) {
      return null;
    }

    return cleanSourceActivityRecord(snapshot.data() as SourceActivityRecord);
  }

  async findAll(limit = 100): Promise<SourceActivityRecord[]> {
    const snapshot = await this.collection
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) =>
      cleanSourceActivityRecord(doc.data() as SourceActivityRecord)
    );
  }
}
