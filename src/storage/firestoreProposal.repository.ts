import {
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Query
} from "firebase-admin/firestore";
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
  firstSeenAt_asc: "firstSeenAt"
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

function cleanStoredProposal(proposal: StoredProposal): StoredProposal {
  const cleaned: StoredProposal = {
    id: proposal.id,
    protocol: proposal.protocol,
    sourceType: proposal.sourceType,
    sourceId: proposal.sourceId,
    title: proposal.title,
    publisherName: proposal.publisherName,
    sourceUrl: proposal.sourceUrl,
    publishedAt: proposal.publishedAt,
    fetchedAt: proposal.fetchedAt,
    rawHash: proposal.rawHash,
    firstSeenAt: proposal.firstSeenAt,
    notificationStatus: proposal.notificationStatus,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt
  };

  if (proposal.notificationError) {
    cleaned.notificationError = proposal.notificationError;
  }

  return cleaned;
}

export class FirestoreProposalRepository implements ProposalRepository {
  private readonly collection: CollectionReference<DocumentData>;

  constructor(db: Firestore) {
    this.collection = db.collection("proposals");
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

    const ref = this.collection.doc(existing?.id ?? proposal.id);
    const now = new Date().toISOString();
    const storedProposal: StoredProposal = {
      ...existing,
      ...proposal,
      id: existing?.id ?? proposal.id,
      firstSeenAt: existing?.firstSeenAt ?? now,
      notificationStatus:
        existing?.notificationStatus ?? options.notificationStatusForNew ?? "skipped",
      notificationError: existing?.notificationError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await ref.set(cleanStoredProposal(storedProposal));

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
    let firestoreQuery: Query<DocumentData> = this.collection;

    if (query.protocol) {
      firestoreQuery = firestoreQuery.where("protocol", "==", query.protocol);
    }

    if (query.publisherName) {
      firestoreQuery = firestoreQuery.where("publisherName", "==", query.publisherName);
    }

    if (query.sourceType) {
      firestoreQuery = firestoreQuery.where("sourceType", "==", query.sourceType);
    }

    if (query.notificationStatus) {
      firestoreQuery = firestoreQuery.where(
        "notificationStatus",
        "==",
        query.notificationStatus
      );
    }

    const sort = query.sort ?? "publishedAt_desc";

    firestoreQuery = firestoreQuery
      .orderBy(sortFields[sort], sortDirection(sort))
      .offset(query.offset ?? 0)
      .limit(query.limit ?? DEFAULT_PROPOSAL_LIMIT);

    const snapshot = await firestoreQuery.get();

    return snapshot.docs.map((doc) => cleanStoredProposal(doc.data() as StoredProposal));
  }

  async findById(id: string): Promise<StoredProposal | null> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return null;
    }

    return cleanStoredProposal(snapshot.data() as StoredProposal);
  }

  async findBySourceIdentity(
    protocol: string,
    sourceType: string,
    sourceId: string
  ): Promise<StoredProposal | null> {
    const snapshot = await this.collection
      .where("protocol", "==", protocol)
      .where("sourceType", "==", sourceType)
      .where("sourceId", "==", sourceId)
      .limit(1)
      .get();
    const [doc] = snapshot.docs;

    return doc ? cleanStoredProposal(doc.data() as StoredProposal) : null;
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
    const ref = this.collection.doc(id);
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      return null;
    }

    const existing = snapshot.data() as StoredProposal;
    const updated: StoredProposal = {
      ...existing,
      notificationStatus: status,
      notificationError: error,
      updatedAt: new Date().toISOString()
    };

    if (!error) {
      delete updated.notificationError;
    }

    await ref.set(cleanStoredProposal(updated));

    return cleanStoredProposal(updated);
  }
}
