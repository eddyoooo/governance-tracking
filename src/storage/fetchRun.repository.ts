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
  storedCount: number;
  skippedCount: number;
  errorMessage?: string;
}

export interface FetchRunRepository {
  upsert(run: FetchRun): Promise<void>;
  findById(id: string): Promise<FetchRun | null>;
}

export class MemoryFetchRunRepository implements FetchRunRepository {
  private readonly runs = new Map<string, FetchRun>();

  async upsert(run: FetchRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async findById(id: string): Promise<FetchRun | null> {
    return this.runs.get(id) ?? null;
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
}
