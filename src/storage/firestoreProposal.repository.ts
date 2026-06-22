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
  UpsertProposalOptions,
  UpsertResult
} from "./proposal.repository.js";
import {
  buildStoredProposal,
  DEFAULT_PROPOSAL_LIMIT,
  hasMeaningfulProposalChange,
  proposalIdFromSourceIdentity,
  proposalSortDirection,
  proposalSortFields
} from "./proposal.repositoryUtils.js";

function cleanStoredProposal(proposal: StoredProposal): StoredProposal {
  const lastSeenAt =
    proposal.lastSeenAt ??
    proposal.firstSeenAt ??
    proposal.fetchedAt ??
    proposal.createdAt ??
    proposal.updatedAt;
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
    lastSeenAt,
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

    const storedProposal = buildStoredProposal(proposal, existing, options);
    const ref = this.collection.doc(storedProposal.id);

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
      .orderBy(proposalSortFields[sort], proposalSortDirection(sort))
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
    const deterministicSnapshot = await this.collection
      .doc(proposalIdFromSourceIdentity(protocol, sourceType, sourceId))
      .get();

    if (deterministicSnapshot.exists) {
      return cleanStoredProposal(deterministicSnapshot.data() as StoredProposal);
    }

    const legacySnapshot = await this.collection
      .where("protocol", "==", protocol)
      .where("sourceType", "==", sourceType)
      .where("sourceId", "==", sourceId)
      .limit(1)
      .get();
    const [legacyDocument] = legacySnapshot.docs;

    return legacyDocument
      ? cleanStoredProposal(legacyDocument.data() as StoredProposal)
      : null;
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
