import {
  type CollectionReference,
  type DocumentData,
  type Firestore
} from "firebase-admin/firestore";

export type ProtocolBaselineStatus = "seeding" | "complete";

export interface ProtocolState {
  protocol: string;
  baselineStatus: ProtocolBaselineStatus;
  baselineStartedAt: string;
  baselineCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolStateRepository {
  findByProtocol(protocol: string): Promise<ProtocolState | null>;
  initializeBaseline(
    protocol: string,
    hasExistingProposals: boolean,
    now?: string
  ): Promise<ProtocolState>;
  markBaselineComplete(protocol: string, now?: string): Promise<ProtocolState>;
}

function buildInitialState(
  protocol: string,
  hasExistingProposals: boolean,
  now: string
): ProtocolState {
  const state: ProtocolState = {
    protocol,
    baselineStatus: hasExistingProposals ? "complete" : "seeding",
    baselineStartedAt: now,
    createdAt: now,
    updatedAt: now
  };

  if (hasExistingProposals) {
    state.baselineCompletedAt = now;
  }

  return state;
}

function completeState(state: ProtocolState, now: string): ProtocolState {
  if (state.baselineStatus === "complete") {
    return state;
  }

  return {
    ...state,
    baselineStatus: "complete",
    baselineCompletedAt: now,
    updatedAt: now
  };
}

export class MemoryProtocolStateRepository implements ProtocolStateRepository {
  private readonly states = new Map<string, ProtocolState>();

  clear(): void {
    this.states.clear();
  }

  async findByProtocol(protocol: string): Promise<ProtocolState | null> {
    return this.states.get(protocol) ?? null;
  }

  async initializeBaseline(
    protocol: string,
    hasExistingProposals: boolean,
    now = new Date().toISOString()
  ): Promise<ProtocolState> {
    const existing = await this.findByProtocol(protocol);

    if (existing) {
      return existing;
    }

    const state = buildInitialState(protocol, hasExistingProposals, now);
    this.states.set(protocol, state);

    return state;
  }

  async markBaselineComplete(
    protocol: string,
    now = new Date().toISOString()
  ): Promise<ProtocolState> {
    const existing =
      (await this.findByProtocol(protocol)) ??
      buildInitialState(protocol, false, now);
    const completed = completeState(existing, now);

    this.states.set(protocol, completed);

    return completed;
  }
}

export class FirestoreProtocolStateRepository implements ProtocolStateRepository {
  private readonly collection: CollectionReference<DocumentData>;

  constructor(private readonly db: Firestore) {
    this.collection = db.collection("protocolState");
  }

  async findByProtocol(protocol: string): Promise<ProtocolState | null> {
    const snapshot = await this.collection.doc(protocol).get();

    return snapshot.exists ? (snapshot.data() as ProtocolState) : null;
  }

  async initializeBaseline(
    protocol: string,
    hasExistingProposals: boolean,
    now = new Date().toISOString()
  ): Promise<ProtocolState> {
    const ref = this.collection.doc(protocol);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);

      if (snapshot.exists) {
        return snapshot.data() as ProtocolState;
      }

      const state = buildInitialState(protocol, hasExistingProposals, now);
      transaction.create(ref, state);

      return state;
    });
  }

  async markBaselineComplete(
    protocol: string,
    now = new Date().toISOString()
  ): Promise<ProtocolState> {
    const ref = this.collection.doc(protocol);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists
        ? (snapshot.data() as ProtocolState)
        : buildInitialState(protocol, false, now);
      const completed = completeState(existing, now);

      transaction.set(ref, completed);

      return completed;
    });
  }
}
