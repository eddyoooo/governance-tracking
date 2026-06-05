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
  UpsertResult
} from "./proposal.repository.js";

export class FirestoreProposalRepository implements ProposalRepository {
  private readonly collection: CollectionReference<DocumentData>;

  constructor(db: Firestore) {
    this.collection = db.collection("proposals");
  }

  async upsert(proposal: NormalizedGovernanceItem): Promise<UpsertResult> {
    const ref = this.collection.doc(proposal.id);
    const snapshot = await ref.get();
    const existing = snapshot.exists ? (snapshot.data() as StoredProposal) : null;
    const now = new Date().toISOString();
    const storedProposal: StoredProposal = {
      ...existing,
      ...proposal,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await ref.set(storedProposal, { merge: true });

    return {
      proposal: storedProposal,
      created: !snapshot.exists
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
    let firestoreQuery: Query<DocumentData> = this.collection;

    if (query.protocol) {
      firestoreQuery = firestoreQuery.where("protocol", "==", query.protocol);
    }

    firestoreQuery = firestoreQuery
      .orderBy("publishedAt", "desc")
      .limit(query.limit ?? 100);

    const snapshot = await firestoreQuery.get();

    return snapshot.docs.map((doc) => doc.data() as StoredProposal);
  }

  async findById(id: string): Promise<StoredProposal | null> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as StoredProposal;
  }
}
