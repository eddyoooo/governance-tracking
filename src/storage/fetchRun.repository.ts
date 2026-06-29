import {
  type CollectionReference,
  type DocumentData,
  type Firestore
} from "firebase-admin/firestore";

export type FetchRunStatus = "running" | "success" | "failed";

export interface FetchRun {
  id: string;
  protocol: string;
  startedAt: string;
  finishedAt?: string;
  status: FetchRunStatus;
  fetchedCount: number;
  allowlistedCount: number;
  storedNewCount: number;
  updatedExistingCount: number;
  unchangedExistingCount: number;
  skippedCount: number;
  notificationSentCount: number;
  notificationFailedCount: number;
  errors: string[];
}

export interface FetchRunRepository {
  upsert(run: FetchRun): Promise<void>;
  findById(id: string): Promise<FetchRun | null>;
  findAll(limit?: number): Promise<FetchRun[]>;
}

export class MemoryFetchRunRepository implements FetchRunRepository {
  private readonly runs = new Map<string, FetchRun>();

  clear(): void {
    this.runs.clear();
  }

  async upsert(run: FetchRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async findById(id: string): Promise<FetchRun | null> {
    return this.runs.get(id) ?? null;
  }

  async findAll(limit = 100): Promise<FetchRun[]> {
    return [...this.runs.values()]
      .sort((left, right) => {
        const compared = left.startedAt.localeCompare(right.startedAt);

        return -compared;
      })
      .slice(0, limit);
  }
}

export class FirestoreFetchRunRepository implements FetchRunRepository {
  private readonly collection: CollectionReference<DocumentData>;

  constructor(db: Firestore) {
    this.collection = db.collection("fetchRuns");
  }

  async upsert(run: FetchRun): Promise<void> {
    await this.collection.doc(run.id).set(run, { merge: true });
  }

  async findById(id: string): Promise<FetchRun | null> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as FetchRun;
  }

  async findAll(limit = 100): Promise<FetchRun[]> {
    const snapshot = await this.collection
      .orderBy("startedAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data() as FetchRun);
  }
}
