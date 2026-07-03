import {
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Query
} from "firebase-admin/firestore";
import type { NormalizedGovernanceItem, StoredProposal } from "../protocols/types.js";
import type {
  ProposalRepository,
  UpsertProposalOptions,
  UpsertResult
} from "./proposal.repository.js";
import {
  buildStoredProposal,
  hasMeaningfulProposalChange,
  proposalIdFromSourceIdentity
} from "./proposal.repositoryUtils.js";

function cleanStoredProposal(proposal: StoredProposal): StoredProposal {
  const firstSeenAt =
    proposal.firstSeenAt ??
    proposal.lastSeenAt ??
    proposal.fetchedAt ??
    proposal.createdAt ??
    proposal.updatedAt;
  const lastSeenAt =
    proposal.lastSeenAt ??
    firstSeenAt ??
    proposal.fetchedAt ??
    proposal.createdAt ??
    proposal.updatedAt;
  const createdAt = proposal.createdAt ?? firstSeenAt ?? proposal.fetchedAt;
  const updatedAt = proposal.updatedAt ?? lastSeenAt ?? createdAt;
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
    firstSeenAt,
    lastSeenAt,
    notificationStatus: proposal.notificationStatus ?? "skipped",
    createdAt,
    updatedAt
  };

  if (proposal.notificationError) {
    cleaned.notificationError = proposal.notificationError;
  }

  return cleaned;
}

export class FirestoreProposalRepository implements ProposalRepository {
  private readonly collection: CollectionReference<DocumentData>;
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
    this.collection = db.collection("proposals");
  }

  async upsert(
    proposal: NormalizedGovernanceItem,
    options: UpsertProposalOptions = {}
  ): Promise<UpsertResult> {
    return this.db.runTransaction(async (transaction) => {
      const deterministicRef = this.collection.doc(
        proposalIdFromSourceIdentity(
          proposal.protocol,
          proposal.sourceType,
          proposal.sourceId
        )
      );
      const deterministicSnapshot = await transaction.get(deterministicRef);
      let existing: StoredProposal | null = deterministicSnapshot.exists
        ? cleanStoredProposal(deterministicSnapshot.data() as StoredProposal)
        : null;
      let targetRef = deterministicRef;

      if (!existing) {
        const legacySnapshot = await transaction.get(
          this.sourceIdentityQuery(
            proposal.protocol,
            proposal.sourceType,
            proposal.sourceId
          )
        );
        const [legacyDocument] = legacySnapshot.docs;

        if (legacyDocument) {
          existing = cleanStoredProposal(legacyDocument.data() as StoredProposal);
          targetRef = this.collection.doc(existing.id);
        }
      }

      if (existing && !hasMeaningfulProposalChange(existing, proposal)) {
        return {
          proposal: existing,
          created: false,
          updated: false
        };
      }

      const storedProposal = buildStoredProposal(proposal, existing, options);
      const cleanedProposal = cleanStoredProposal(storedProposal);

      if (existing) {
        transaction.set(targetRef, cleanedProposal);
      } else {
        transaction.create(deterministicRef, cleanedProposal);
      }

      return {
        proposal: storedProposal,
        created: !existing,
        updated: true
      };
    });
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

  async findAll(): Promise<StoredProposal[]> {
    const snapshot = await this.collection.limit(100).get();

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

    const legacySnapshot = await this.sourceIdentityQuery(
      protocol,
      sourceType,
      sourceId
    ).get();
    const [legacyDocument] = legacySnapshot.docs;

    return legacyDocument
      ? cleanStoredProposal(legacyDocument.data() as StoredProposal)
      : null;
  }

  private sourceIdentityQuery(
    protocol: string,
    sourceType: string,
    sourceId: string
  ): Query<DocumentData> {
    return this.collection
      .where("protocol", "==", protocol)
      .where("sourceType", "==", sourceType)
      .where("sourceId", "==", sourceId)
      .limit(1);
  }

  async findByNotificationStatus(
    status: StoredProposal["notificationStatus"],
    limit = 100
  ): Promise<StoredProposal[]> {
    const snapshot = await this.collection
      .where("notificationStatus", "==", status)
      .orderBy("firstSeenAt", "asc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => cleanStoredProposal(doc.data() as StoredProposal));
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
