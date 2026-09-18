import {
  type CollectionReference,
  type DocumentData,
  type Firestore
} from "firebase-admin/firestore";
import type { NotificationStatus } from "../protocols/types.js";
import type { ProposalNotificationState } from "./proposal.repository.js";
import {
  createGovernanceLifecycleEventId,
  deriveGovernanceTransitions,
  isTerminalGovernanceStatus,
  mergeGovernanceDecision
} from "../onchain/governanceDecision.js";
import { buildGovernanceLifecycleMessage } from "../onchain/governanceNotifications.js";
import type {
  GovernanceDecisionObservation,
  GovernanceLifecycleEvent,
  GovernanceScanRun,
  GovernanceSourceState,
  GovernanceTransitionType,
  StoredGovernanceDecision
} from "../onchain/types.js";

export interface GovernanceDecisionUpsertOptions {
  notificationStatusForNewEvents: NotificationStatus;
  now?: string;
}

export interface GovernanceDecisionUpsertResult {
  decision: StoredGovernanceDecision;
  created: boolean;
  updated: boolean;
  lifecycleEventsCreated: GovernanceLifecycleEvent[];
}

export interface GovernanceRepository {
  findDecisionById(id: string): Promise<StoredGovernanceDecision | null>;
  findDecisionsBySource(sourceKey: string): Promise<StoredGovernanceDecision[]>;
  findNonTerminalDecisions(
    sourceKey: string
  ): Promise<StoredGovernanceDecision[]>;
  upsertDecision(
    observation: GovernanceDecisionObservation,
    options: GovernanceDecisionUpsertOptions
  ): Promise<GovernanceDecisionUpsertResult>;
  findSourceState(sourceKey: string): Promise<GovernanceSourceState | null>;
  initializeSourceState(state: GovernanceSourceState): Promise<GovernanceSourceState>;
  updateSourceState(
    sourceKey: string,
    updater: (state: GovernanceSourceState) => GovernanceSourceState
  ): Promise<GovernanceSourceState | null>;
  findAllSourceStates(limit?: number): Promise<GovernanceSourceState[]>;
  findById(id: string): Promise<GovernanceLifecycleEvent | null>;
  findByNotificationStatus(
    status: NotificationStatus,
    limit?: number
  ): Promise<GovernanceLifecycleEvent[]>;
  countByNotificationStatus(status: NotificationStatus): Promise<number>;
  updateNotificationState(
    id: string,
    updater: (event: GovernanceLifecycleEvent) => ProposalNotificationState
  ): Promise<GovernanceLifecycleEvent | null>;
  upsertScanRun(run: GovernanceScanRun): Promise<void>;
  findScanRuns(limit?: number): Promise<GovernanceScanRun[]>;
  findLatestScanRunBySource(sourceKey: string): Promise<GovernanceScanRun | null>;
}

export class MemoryGovernanceRepository implements GovernanceRepository {
  private readonly decisions = new Map<string, StoredGovernanceDecision>();
  private readonly sourceStates = new Map<string, GovernanceSourceState>();
  private readonly lifecycleEvents = new Map<string, GovernanceLifecycleEvent>();
  private readonly scanRuns = new Map<string, GovernanceScanRun>();

  clear(): void {
    this.decisions.clear();
    this.sourceStates.clear();
    this.lifecycleEvents.clear();
    this.scanRuns.clear();
  }

  async findDecisionById(id: string): Promise<StoredGovernanceDecision | null> {
    return clone(this.decisions.get(id) ?? null);
  }

  async findDecisionsBySource(
    sourceKey: string
  ): Promise<StoredGovernanceDecision[]> {
    return [...this.decisions.values()]
      .filter((decision) => decision.sourceKey === sourceKey)
      .sort(compareDecisions)
      .map(clone);
  }

  async findNonTerminalDecisions(
    sourceKey: string
  ): Promise<StoredGovernanceDecision[]> {
    return (await this.findDecisionsBySource(sourceKey)).filter(
      (decision) => !isTerminalGovernanceStatus(decision.status)
    );
  }

  async upsertDecision(
    observation: GovernanceDecisionObservation,
    options: GovernanceDecisionUpsertOptions
  ): Promise<GovernanceDecisionUpsertResult> {
    const existing = this.decisions.get(observation.id) ?? null;
    const now = options.now ?? new Date().toISOString();
    const result = mergeGovernanceDecision(existing, observation, now);
    const transitions = deriveGovernanceTransitions(existing, result.decision);
    const newTransitions = new Set(transitions);
    const candidateEvents = impliedLifecycleEvents(
      result.decision,
      options.notificationStatusForNewEvents,
      now
    );
    const lifecycleEventsCreated: GovernanceLifecycleEvent[] = [];
    const lifecycleEventUpdates: GovernanceLifecycleEvent[] = [];

    for (const candidate of candidateEvents) {
      const stored = this.lifecycleEvents.get(candidate.id);

      if (stored) {
        const merged = mergeLifecycleEventMetadata(stored, candidate, now);
        if (merged.updated) {
          lifecycleEventUpdates.push(merged.event);
        }
        continue;
      }

      if (newTransitions.has(candidate.transition)) {
        lifecycleEventsCreated.push(candidate);
      }
    }

    if (result.updated) {
      this.decisions.set(observation.id, result.decision);
    }
    for (const event of [...lifecycleEventUpdates, ...lifecycleEventsCreated]) {
      this.lifecycleEvents.set(event.id, event);
    }

    return {
      ...result,
      decision: clone(result.decision),
      lifecycleEventsCreated: lifecycleEventsCreated.map(clone)
    };
  }

  async findSourceState(
    sourceKey: string
  ): Promise<GovernanceSourceState | null> {
    return clone(this.sourceStates.get(sourceKey) ?? null);
  }

  async initializeSourceState(
    state: GovernanceSourceState
  ): Promise<GovernanceSourceState> {
    const existing = this.sourceStates.get(state.sourceKey);

    if (existing) {
      return clone(existing);
    }

    this.sourceStates.set(state.sourceKey, clone(state));
    return clone(state);
  }

  async updateSourceState(
    sourceKey: string,
    updater: (state: GovernanceSourceState) => GovernanceSourceState
  ): Promise<GovernanceSourceState | null> {
    const existing = this.sourceStates.get(sourceKey);

    if (!existing) {
      return null;
    }

    const updated = updater(clone(existing));
    assertSourceIdentity(existing, updated);
    this.sourceStates.set(sourceKey, clone(updated));

    return clone(updated);
  }

  async findAllSourceStates(limit = 100): Promise<GovernanceSourceState[]> {
    return [...this.sourceStates.values()]
      .sort((left, right) => -left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, limit)
      .map(clone);
  }

  async findById(id: string): Promise<GovernanceLifecycleEvent | null> {
    return clone(this.lifecycleEvents.get(id) ?? null);
  }

  async findByNotificationStatus(
    status: NotificationStatus,
    limit = 1_000
  ): Promise<GovernanceLifecycleEvent[]> {
    return [...this.lifecycleEvents.values()]
      .filter((event) => event.notificationStatus === status)
      .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt))
      .slice(0, limit)
      .map(clone);
  }

  async countByNotificationStatus(status: NotificationStatus): Promise<number> {
    return [...this.lifecycleEvents.values()].filter(
      (event) => event.notificationStatus === status
    ).length;
  }

  async updateNotificationState(
    id: string,
    updater: (event: GovernanceLifecycleEvent) => ProposalNotificationState
  ): Promise<GovernanceLifecycleEvent | null> {
    const existing = this.lifecycleEvents.get(id);

    if (!existing) {
      return null;
    }

    const updated = applyNotificationState(existing, updater(existing));
    this.lifecycleEvents.set(id, clone(updated));

    return clone(updated);
  }

  async upsertScanRun(run: GovernanceScanRun): Promise<void> {
    this.scanRuns.set(run.id, clone(run));
  }

  async findScanRuns(limit = 100): Promise<GovernanceScanRun[]> {
    return [...this.scanRuns.values()]
      .sort((left, right) => -left.startedAt.localeCompare(right.startedAt))
      .slice(0, limit)
      .map(clone);
  }

  async findLatestScanRunBySource(
    sourceKey: string
  ): Promise<GovernanceScanRun | null> {
    return (
      (await this.findScanRuns(Number.MAX_SAFE_INTEGER)).find(
        (run) => run.sourceKey === sourceKey
      ) ?? null
    );
  }
}

export class FirestoreGovernanceRepository implements GovernanceRepository {
  private readonly decisions: CollectionReference<DocumentData>;
  private readonly sourceStates: CollectionReference<DocumentData>;
  private readonly lifecycleEvents: CollectionReference<DocumentData>;
  private readonly scanRuns: CollectionReference<DocumentData>;

  constructor(private readonly db: Firestore) {
    this.decisions = db.collection("governanceDecisions");
    this.sourceStates = db.collection("governanceSourceStates");
    this.lifecycleEvents = db.collection("governanceEvents");
    this.scanRuns = db.collection("governanceScanRuns");
  }

  async findDecisionById(id: string): Promise<StoredGovernanceDecision | null> {
    const snapshot = await this.decisions.doc(id).get();

    return snapshot.exists
      ? (snapshot.data() as StoredGovernanceDecision)
      : null;
  }

  async findDecisionsBySource(
    sourceKey: string
  ): Promise<StoredGovernanceDecision[]> {
    const snapshot = await this.decisions.where("sourceKey", "==", sourceKey).get();

    return snapshot.docs
      .map((doc) => doc.data() as StoredGovernanceDecision)
      .sort(compareDecisions);
  }

  async findNonTerminalDecisions(
    sourceKey: string
  ): Promise<StoredGovernanceDecision[]> {
    return (await this.findDecisionsBySource(sourceKey)).filter(
      (decision) => !isTerminalGovernanceStatus(decision.status)
    );
  }

  async upsertDecision(
    observation: GovernanceDecisionObservation,
    options: GovernanceDecisionUpsertOptions
  ): Promise<GovernanceDecisionUpsertResult> {
    const decisionRef = this.decisions.doc(observation.id);
    const now = options.now ?? new Date().toISOString();

    return this.db.runTransaction(async (transaction) => {
      const decisionSnapshot = await transaction.get(decisionRef);
      const existing = decisionSnapshot.exists
        ? (decisionSnapshot.data() as StoredGovernanceDecision)
        : null;
      const result = mergeGovernanceDecision(existing, observation, now);
      const transitions = deriveGovernanceTransitions(existing, result.decision);
      const newTransitions = new Set(transitions);
      const candidateEvents = impliedLifecycleEvents(
        result.decision,
        options.notificationStatusForNewEvents,
        now
      );
      const eventSnapshots = await Promise.all(
        candidateEvents.map((event) =>
          transaction.get(this.lifecycleEvents.doc(event.id))
        )
      );
      const lifecycleEventsCreated: GovernanceLifecycleEvent[] = [];

      if (result.updated) {
        transaction.set(decisionRef, result.decision);
      }

      for (const [index, event] of candidateEvents.entries()) {
        const snapshot = eventSnapshots[index];

        if (!snapshot.exists) {
          if (newTransitions.has(event.transition)) {
            transaction.create(this.lifecycleEvents.doc(event.id), event);
            lifecycleEventsCreated.push(event);
          }
          continue;
        }

        const merged = mergeLifecycleEventMetadata(
          snapshot.data() as GovernanceLifecycleEvent,
          event,
          now
        );
        if (merged.updated) {
          transaction.set(this.lifecycleEvents.doc(event.id), merged.event);
        }
      }

      return { ...result, lifecycleEventsCreated };
    });
  }

  async findSourceState(
    sourceKey: string
  ): Promise<GovernanceSourceState | null> {
    const snapshot = await this.sourceStates.doc(sourceKey).get();

    return snapshot.exists
      ? (snapshot.data() as GovernanceSourceState)
      : null;
  }

  async initializeSourceState(
    state: GovernanceSourceState
  ): Promise<GovernanceSourceState> {
    const ref = this.sourceStates.doc(state.sourceKey);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);

      if (snapshot.exists) {
        return snapshot.data() as GovernanceSourceState;
      }

      transaction.create(ref, state);
      return state;
    });
  }

  async updateSourceState(
    sourceKey: string,
    updater: (state: GovernanceSourceState) => GovernanceSourceState
  ): Promise<GovernanceSourceState | null> {
    const ref = this.sourceStates.doc(sourceKey);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);

      if (!snapshot.exists) {
        return null;
      }

      const existing = snapshot.data() as GovernanceSourceState;
      const updated = updater(existing);
      assertSourceIdentity(existing, updated);
      transaction.set(ref, updated);

      return updated;
    });
  }

  async findAllSourceStates(limit = 100): Promise<GovernanceSourceState[]> {
    const snapshot = await this.sourceStates.orderBy("updatedAt", "desc").limit(limit).get();

    return snapshot.docs.map((doc) => doc.data() as GovernanceSourceState);
  }

  async findById(id: string): Promise<GovernanceLifecycleEvent | null> {
    const snapshot = await this.lifecycleEvents.doc(id).get();

    return snapshot.exists
      ? (snapshot.data() as GovernanceLifecycleEvent)
      : null;
  }

  async findByNotificationStatus(
    status: NotificationStatus,
    limit = 1_000
  ): Promise<GovernanceLifecycleEvent[]> {
    const snapshot = await this.lifecycleEvents
      .where("notificationStatus", "==", status)
      .get();

    return snapshot.docs
      .map((doc) => doc.data() as GovernanceLifecycleEvent)
      .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt))
      .slice(0, limit);
  }

  async countByNotificationStatus(status: NotificationStatus): Promise<number> {
    const snapshot = await this.lifecycleEvents
      .where("notificationStatus", "==", status)
      .count()
      .get();

    return snapshot.data().count;
  }

  async updateNotificationState(
    id: string,
    updater: (event: GovernanceLifecycleEvent) => ProposalNotificationState
  ): Promise<GovernanceLifecycleEvent | null> {
    const ref = this.lifecycleEvents.doc(id);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);

      if (!snapshot.exists) {
        return null;
      }

      const existing = snapshot.data() as GovernanceLifecycleEvent;
      const updated = applyNotificationState(existing, updater(existing));
      transaction.set(ref, updated);

      return updated;
    });
  }

  async upsertScanRun(run: GovernanceScanRun): Promise<void> {
    await this.scanRuns.doc(run.id).set(run, { merge: true });
  }

  async findScanRuns(limit = 100): Promise<GovernanceScanRun[]> {
    const snapshot = await this.scanRuns
      .orderBy("startedAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data() as GovernanceScanRun);
  }

  async findLatestScanRunBySource(
    sourceKey: string
  ): Promise<GovernanceScanRun | null> {
    const snapshot = await this.scanRuns.where("sourceKey", "==", sourceKey).get();

    return (
      snapshot.docs
        .map((doc) => doc.data() as GovernanceScanRun)
        .sort((left, right) => -left.startedAt.localeCompare(right.startedAt))[0] ??
      null
    );
  }
}

function buildLifecycleEvent(
  decision: StoredGovernanceDecision,
  transition: GovernanceTransitionType,
  notificationStatus: NotificationStatus,
  now: string
): GovernanceLifecycleEvent {
  return {
    id: createGovernanceLifecycleEventId(decision.id, transition),
    decisionId: decision.id,
    sourceKey: decision.sourceKey,
    protocol: decision.protocol,
    transition,
    decisionStatus: statusForTransition(decision, transition),
    blockNumber: blockNumberForTransition(decision, transition),
    transactionHash: transactionHashForTransition(decision, transition),
    message: buildGovernanceLifecycleMessage(decision, transition),
    notificationStatus,
    firstSeenAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function impliedLifecycleEvents(
  decision: StoredGovernanceDecision,
  notificationStatus: NotificationStatus,
  now: string
): GovernanceLifecycleEvent[] {
  return deriveGovernanceTransitions(null, decision).map((transition) =>
    buildLifecycleEvent(decision, transition, notificationStatus, now)
  );
}

function statusForTransition(
  decision: StoredGovernanceDecision,
  transition: GovernanceTransitionType
): StoredGovernanceDecision["status"] {
  if (transition === "created") {
    return decision.status === "active" ? "active" : "pending";
  }

  return transition;
}

function blockNumberForTransition(
  decision: StoredGovernanceDecision,
  transition: GovernanceTransitionType
): number {
  switch (transition) {
    case "created":
      return decision.createdBlockNumber ?? decision.lastObservedBlockNumber;
    case "canceled":
      return decision.canceledBlockNumber ?? decision.lastObservedBlockNumber;
    case "queued":
      return decision.queuedBlockNumber ?? decision.lastObservedBlockNumber;
    case "executed":
      return decision.executedBlockNumber ?? decision.lastObservedBlockNumber;
    case "succeeded":
    case "defeated":
      return decision.endBlock + 1;
    case "expired":
      return decision.lastObservedBlockNumber;
  }
}

function transactionHashForTransition(
  decision: StoredGovernanceDecision,
  transition: GovernanceTransitionType
): string | null {
  switch (transition) {
    case "created":
      return decision.createdTransactionHash;
    case "canceled":
      return decision.canceledTransactionHash;
    case "queued":
      return decision.queuedTransactionHash;
    case "executed":
      return decision.executedTransactionHash;
    case "succeeded":
    case "defeated":
    case "expired":
      return null;
  }
}

function mergeLifecycleEventMetadata(
  existing: GovernanceLifecycleEvent,
  candidate: GovernanceLifecycleEvent,
  now: string
): { event: GovernanceLifecycleEvent; updated: boolean } {
  if (
    existing.transactionHash &&
    candidate.transactionHash &&
    existing.transactionHash.toLowerCase() !== candidate.transactionHash.toLowerCase()
  ) {
    throw new Error(
      `Governance lifecycle event ${existing.id} transaction hash cannot change.`
    );
  }
  if (
    existing.transactionHash &&
    candidate.transactionHash &&
    existing.blockNumber !== candidate.blockNumber
  ) {
    throw new Error(
      `Governance lifecycle event ${existing.id} block number cannot change once its transaction is known.`
    );
  }

  const hasCanonicalTransaction = candidate.transactionHash !== null;
  const transactionHash = candidate.transactionHash ?? existing.transactionHash;
  const blockNumber = hasCanonicalTransaction
    ? candidate.blockNumber
    : existing.blockNumber;
  const messageChanged =
    JSON.stringify(existing.message) !== JSON.stringify(candidate.message);
  const updated =
    transactionHash !== existing.transactionHash ||
    blockNumber !== existing.blockNumber ||
    messageChanged;

  if (!updated) {
    return { event: existing, updated: false };
  }

  return {
    event: {
      ...existing,
      blockNumber,
      transactionHash,
      message: candidate.message,
      updatedAt: now
    },
    updated: true
  };
}

function applyNotificationState(
  event: GovernanceLifecycleEvent,
  state: ProposalNotificationState
): GovernanceLifecycleEvent {
  const updated: GovernanceLifecycleEvent = {
    ...event,
    notificationStatus: state.notificationStatus,
    updatedAt: new Date().toISOString()
  };

  if (state.notificationError) {
    updated.notificationError = state.notificationError;
  } else {
    delete updated.notificationError;
  }

  if (state.notificationDeliveries) {
    updated.notificationDeliveries = clone(state.notificationDeliveries);
  } else {
    delete updated.notificationDeliveries;
  }

  return updated;
}

function assertSourceIdentity(
  previous: GovernanceSourceState,
  current: GovernanceSourceState
): void {
  if (
    previous.sourceKey !== current.sourceKey ||
    previous.protocol !== current.protocol ||
    previous.sourceType !== current.sourceType ||
    previous.chainId !== current.chainId ||
    previous.contractAddress !== current.contractAddress ||
    previous.deploymentBlock !== current.deploymentBlock ||
    ((previous as Partial<GovernanceSourceState>).initialProposalId !==
      undefined &&
      previous.initialProposalId !== current.initialProposalId)
  ) {
    throw new Error("Governance source identity cannot change.");
  }
}

function compareDecisions(
  left: StoredGovernanceDecision,
  right: StoredGovernanceDecision
): number {
  const leftId = BigInt(left.proposalId);
  const rightId = BigInt(right.proposalId);

  return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
