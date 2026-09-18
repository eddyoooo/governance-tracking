import { hashObject, sha256 } from "../utils/hash.js";
import type {
  GovernanceAction,
  GovernanceDecisionObservation,
  GovernanceDecisionStatus,
  GovernanceExecutionOutcome,
  GovernanceTransitionType,
  GovernanceVoteOutcome,
  StoredGovernanceDecision
} from "./types.js";

const GOVERNANCE_STATUSES = new Set<GovernanceDecisionStatus>([
  "pending",
  "active",
  "canceled",
  "defeated",
  "succeeded",
  "queued",
  "expired",
  "executed"
]);
const VOTE_FIELDS = ["forVotes", "againstVotes", "abstainVotes"] as const;

const TERMINAL_STATUSES = new Set<GovernanceDecisionStatus>([
  "canceled",
  "executed"
]);
const QUEUE_REFERENCE_STATES = new Set<GovernanceDecisionStatus>([
  "queued",
  "expired",
  "executed",
  "canceled"
]);

const ALLOWED_STATUS_TRANSITIONS: Record<
  GovernanceDecisionStatus,
  ReadonlySet<GovernanceDecisionStatus>
> = {
  pending: new Set([
    "active",
    "canceled",
    "defeated",
    "succeeded",
    "queued",
    "expired",
    "executed"
  ]),
  active: new Set([
    "canceled",
    "defeated",
    "succeeded",
    "queued",
    "expired",
    "executed"
  ]),
  succeeded: new Set(["canceled", "queued", "expired", "executed"]),
  queued: new Set(["canceled", "expired", "executed"]),
  canceled: new Set(),
  defeated: new Set(["canceled"]),
  expired: new Set(["canceled"]),
  executed: new Set()
};

export function createGovernanceDecisionId(options: {
  protocol: string;
  chainId: number;
  governorAddress: string;
  proposalId: string;
}): string {
  const identity = `${options.protocol}:onchain:${options.chainId}:${options.governorAddress.toLowerCase()}:${options.proposalId}`;

  return `${options.protocol}_onchain_${options.chainId}_${options.proposalId}_${sha256(identity).slice(0, 12)}`;
}

export function createGovernanceLifecycleEventId(
  decisionId: string,
  transition: GovernanceTransitionType
): string {
  return `governanceEvent_${sha256(`${decisionId}:${transition}`).slice(0, 24)}`;
}

export function extractGovernanceTitle(
  description: string | undefined,
  proposalId: string
): string {
  const firstContentLine = (description ?? "")
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const cleaned = firstContentLine
    ?.replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim();

  if (!cleaned) {
    return `Uniswap governance proposal #${proposalId}`;
  }

  return cleaned.length <= 300 ? cleaned : `${cleaned.slice(0, 297)}...`;
}

export function outcomesForStatus(status: GovernanceDecisionStatus): {
  voteOutcome: GovernanceVoteOutcome;
  executionOutcome: GovernanceExecutionOutcome;
} {
  switch (status) {
    case "pending":
    case "active":
      return { voteOutcome: "pending", executionOutcome: "not_started" };
    case "defeated":
      return { voteOutcome: "defeated", executionOutcome: "not_started" };
    case "canceled":
      return { voteOutcome: "canceled", executionOutcome: "canceled" };
    case "succeeded":
      return { voteOutcome: "succeeded", executionOutcome: "awaiting_queue" };
    case "queued":
      return { voteOutcome: "succeeded", executionOutcome: "queued" };
    case "expired":
      return { voteOutcome: "succeeded", executionOutcome: "expired" };
    case "executed":
      return { voteOutcome: "succeeded", executionOutcome: "executed" };
  }
}

export function isTerminalGovernanceStatus(
  status: GovernanceDecisionStatus
): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function assertValidGovernanceStatusTransition(
  previous: GovernanceDecisionStatus,
  current: GovernanceDecisionStatus
): void {
  if (previous === current) {
    return;
  }

  if (!ALLOWED_STATUS_TRANSITIONS[previous].has(current)) {
    throw new Error(
      `Invalid governance status transition: ${previous} -> ${current}`
    );
  }
}

export function deriveGovernanceTransitions(
  previous: StoredGovernanceDecision | null,
  current: StoredGovernanceDecision
): GovernanceTransitionType[] {
  if (!previous) {
    switch (current.status) {
      case "pending":
      case "active":
        return ["created"];
      case "queued":
        return ["created", "succeeded", "queued"];
      case "expired":
      case "executed":
        return ["created", "succeeded", "queued", current.status];
      case "canceled":
        if (wasQueued(current)) {
          return ["created", "succeeded", "queued", "canceled"];
        }

        return current.voteOutcome === "succeeded" ||
          current.voteOutcome === "defeated"
          ? ["created", current.voteOutcome, "canceled"]
          : ["created", "canceled"];
      case "defeated":
      case "succeeded":
        return ["created", current.status];
    }
  }

  if (previous.status === current.status) {
    if (
      current.status === "canceled" &&
      previous.voteOutcome === "canceled" &&
      (current.voteOutcome === "succeeded" ||
        current.voteOutcome === "defeated")
    ) {
      return [current.voteOutcome];
    }

    return [];
  }

  assertValidGovernanceStatusTransition(previous.status, current.status);

  if (
    current.status === "canceled" &&
    !wasQueued(previous) &&
    wasQueued(current)
  ) {
    if (previous.status === "pending" || previous.status === "active") {
      return ["succeeded", "queued", "canceled"];
    }

    if (previous.status === "succeeded") {
      return ["queued", "canceled"];
    }
  }

  if (
    current.status === "canceled" &&
    (previous.status === "pending" || previous.status === "active") &&
    (current.voteOutcome === "succeeded" ||
      current.voteOutcome === "defeated")
  ) {
    return [current.voteOutcome, "canceled"];
  }

  if (current.status === "queued") {
    return previous.status === "pending" || previous.status === "active"
      ? ["succeeded", "queued"]
      : ["queued"];
  }

  if (current.status === "expired" || current.status === "executed") {
    if (previous.status === "pending" || previous.status === "active") {
      return ["succeeded", "queued", current.status];
    }

    if (previous.status === "succeeded") {
      return ["queued", current.status];
    }
  }

  return current.status === "pending" || current.status === "active"
    ? []
    : [current.status];
}

export function mergeGovernanceDecision(
  existing: StoredGovernanceDecision | null,
  observationInput: GovernanceDecisionObservation,
  now: string
): {
  decision: StoredGovernanceDecision;
  created: boolean;
  updated: boolean;
} {
  const observation = normalizeCanceledVoteOutcome(existing, observationInput);
  assertGovernanceDecisionObservation(observation);

  if (existing) {
    assertSameDecisionIdentity(existing, observation);
    assertValidGovernanceStatusTransition(existing.status, observation.status);
    assertImmutableProposalData(existing, observation);
    assertMonotonicObservation(existing, observation);
  }

  const decision: StoredGovernanceDecision = {
    ...observation,
    title:
      observation.title ??
      existing?.title ??
      `Uniswap governance proposal #${observation.proposalId}`,
    description: observation.description ?? existing?.description ?? "",
    votingEndedAt:
      observation.votingEndedAt ?? existing?.votingEndedAt ?? null,
    createdBlockNumber:
      observation.createdBlockNumber ?? existing?.createdBlockNumber ?? null,
    createdTransactionHash:
      observation.createdTransactionHash ??
      existing?.createdTransactionHash ??
      null,
    canceledBlockNumber:
      observation.canceledBlockNumber ?? existing?.canceledBlockNumber ?? null,
    canceledTransactionHash:
      observation.canceledTransactionHash ??
      existing?.canceledTransactionHash ??
      null,
    queuedBlockNumber:
      observation.queuedBlockNumber ?? existing?.queuedBlockNumber ?? null,
    queuedTransactionHash:
      observation.queuedTransactionHash ??
      existing?.queuedTransactionHash ??
      null,
    executedBlockNumber:
      observation.executedBlockNumber ?? existing?.executedBlockNumber ?? null,
    executedTransactionHash:
      observation.executedTransactionHash ??
      existing?.executedTransactionHash ??
      null,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSyncedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  assertGovernanceDecisionObservation(decision);
  const updated = !existing || hasMeaningfulDecisionChange(existing, decision);

  if (existing && !updated) {
    return { decision: existing, created: false, updated: false };
  }

  return { decision, created: !existing, updated: true };
}

export function assertGovernanceDecisionObservation(
  observation: GovernanceDecisionObservation | StoredGovernanceDecision
): void {
  if (!GOVERNANCE_STATUSES.has(observation.status)) {
    throw new Error(`Invalid governance decision status: ${observation.status}`);
  }

  const expectedOutcomes = outcomesForStatus(observation.status);
  const validCanceledVoteOutcome =
    observation.status === "canceled" &&
    observation.executionOutcome === "canceled" &&
    (observation.voteOutcome === "canceled" ||
      observation.voteOutcome === "succeeded" ||
      observation.voteOutcome === "defeated") &&
    (!wasQueued(observation) || observation.voteOutcome === "succeeded");
  if (
    !validCanceledVoteOutcome &&
    (observation.voteOutcome !== expectedOutcomes.voteOutcome ||
      observation.executionOutcome !== expectedOutcomes.executionOutcome)
  ) {
    throw new Error(
      `Governance decision outcomes do not match status ${observation.status}.`
    );
  }

  if (!/^[1-9]\d*$/.test(observation.proposalId)) {
    throw new Error(
      `Governance decision proposal id must be a positive integer: ${observation.proposalId}`
    );
  }

  assertSafeBlockNumber(observation.startBlock, "proposal start block");
  assertSafeBlockNumber(observation.endBlock, "proposal end block");
  assertSafeBlockNumber(
    observation.lastObservedBlockNumber,
    "proposal observation block"
  );
  if (observation.endBlock <= observation.startBlock) {
    throw new Error("Governance proposal end block must be after its start block.");
  }

  if (
    observation.votingEndedAt !== undefined &&
    observation.votingEndedAt !== null &&
    !isCanonicalIsoTimestamp(observation.votingEndedAt)
  ) {
    throw new Error("Governance proposal voting end timestamp is invalid.");
  }
  if (
    observation.votingEndedAt !== undefined &&
    observation.votingEndedAt !== null &&
    observation.voteOutcome !== "succeeded" &&
    observation.voteOutcome !== "defeated"
  ) {
    throw new Error(
      "Governance proposal voting end timestamp requires a final vote outcome."
    );
  }

  if (observation.eta !== null) {
    parseUnsignedInteger(observation.eta, "proposal eta");
  }
  for (const field of VOTE_FIELDS) {
    parseUnsignedInteger(observation[field], `proposal ${field}`);
  }

  if (!Array.isArray(observation.actions)) {
    throw new Error("Governance proposal actions must be an array.");
  }
  observation.actions.forEach(assertGovernanceAction);
  assertOptionalChainReference(
    observation.createdBlockNumber,
    observation.createdTransactionHash,
    "created"
  );
  assertOptionalChainReference(
    observation.canceledBlockNumber,
    observation.canceledTransactionHash,
    "canceled"
  );
  assertOptionalChainReference(
    observation.queuedBlockNumber,
    observation.queuedTransactionHash,
    "queued"
  );
  assertOptionalChainReference(
    observation.executedBlockNumber,
    observation.executedTransactionHash,
    "executed"
  );
  assertLifecycleStateConsistency(observation);
  assertLifecycleChronology(observation);
}

function normalizeCanceledVoteOutcome(
  existing: StoredGovernanceDecision | null,
  observation: GovernanceDecisionObservation
): GovernanceDecisionObservation {
  if (observation.status !== "canceled") {
    return observation;
  }

  const previousVoteOutcome = existing?.voteOutcome;
  const containsQueueEvidence = wasQueued(observation);

  if (containsQueueEvidence && previousVoteOutcome === "defeated") {
    throw new Error(
      "A defeated governance proposal cannot later contain queue evidence."
    );
  }

  const voteOutcome = containsQueueEvidence
    ? "succeeded"
    : previousVoteOutcome === "succeeded" || previousVoteOutcome === "defeated"
      ? previousVoteOutcome
      : observation.voteOutcome;

  return {
    ...observation,
    voteOutcome
  };
}

function wasQueued(
  decision: Pick<
    GovernanceDecisionObservation | StoredGovernanceDecision,
    "eta" | "queuedBlockNumber"
  >
): boolean {
  return (
    decision.eta !== null ||
    (decision.queuedBlockNumber !== undefined &&
      decision.queuedBlockNumber !== null)
  );
}

function assertSameDecisionIdentity(
  existing: StoredGovernanceDecision,
  observation: GovernanceDecisionObservation
): void {
  const identityFields = [
    ["id", existing.id, observation.id],
    ["sourceKey", existing.sourceKey, observation.sourceKey],
    ["protocol", existing.protocol, observation.protocol],
    ["chainId", existing.chainId, observation.chainId],
    ["governorAddress", existing.governorAddress, observation.governorAddress],
    ["proposalId", existing.proposalId, observation.proposalId]
  ] as const;
  const changed = identityFields.find(([, left, right]) => left !== right);

  if (changed) {
    throw new Error(
      `Governance decision identity field ${changed[0]} cannot change.`
    );
  }
}

function assertImmutableProposalData(
  existing: StoredGovernanceDecision,
  observation: GovernanceDecisionObservation
): void {
  if (existing.proposer.toLowerCase() !== observation.proposer.toLowerCase()) {
    throw new Error("Governance proposal proposer cannot change.");
  }
  if (
    existing.startBlock !== observation.startBlock ||
    existing.endBlock !== observation.endBlock
  ) {
    throw new Error("Governance proposal voting window cannot change.");
  }
  if (hashObject(existing.actions) !== hashObject(observation.actions)) {
    throw new Error("Governance proposal actions cannot change.");
  }
  if (existing.sourceUrl !== observation.sourceUrl) {
    throw new Error("Governance proposal source URL cannot change.");
  }
  if (
    existing.votingEndedAt != null &&
    observation.votingEndedAt !== undefined &&
    observation.votingEndedAt !== existing.votingEndedAt
  ) {
    throw new Error("Governance proposal voting end timestamp cannot change.");
  }
  if (existing.eta !== null && observation.eta !== existing.eta) {
    throw new Error("Governance proposal ETA cannot change once queued.");
  }
}

function assertMonotonicObservation(
  existing: StoredGovernanceDecision,
  observation: GovernanceDecisionObservation
): void {
  if (observation.lastObservedBlockNumber < existing.lastObservedBlockNumber) {
    throw new Error(
      `Governance proposal observation block regressed from ${existing.lastObservedBlockNumber} to ${observation.lastObservedBlockNumber}.`
    );
  }

  for (const field of VOTE_FIELDS) {
    const previous = parseUnsignedInteger(existing[field], `stored proposal ${field}`);
    const current = parseUnsignedInteger(
      observation[field],
      `observed proposal ${field}`
    );

    if (current < previous) {
      throw new Error(
        `Governance proposal ${field} regressed from ${previous} to ${current}.`
      );
    }
  }
}

function assertGovernanceAction(action: GovernanceAction, index: number): void {
  if (!action || typeof action !== "object") {
    throw new Error(`Governance proposal action ${index} is malformed.`);
  }
  if (action.index !== index) {
    throw new Error(
      `Governance proposal action index ${action.index} does not match position ${index}.`
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(action.target)) {
    throw new Error(`Governance proposal action ${index} target is invalid.`);
  }
  parseUnsignedInteger(action.value, `proposal action ${index} value`);
  if (typeof action.signature !== "string") {
    throw new Error(`Governance proposal action ${index} signature is invalid.`);
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(action.calldata)) {
    throw new Error(`Governance proposal action ${index} calldata is invalid.`);
  }
}

function assertOptionalChainReference(
  blockNumber: number | null | undefined,
  transactionHash: string | null | undefined,
  transition: string
): void {
  const hasBlock = blockNumber !== undefined && blockNumber !== null;
  const hasTransaction =
    transactionHash !== undefined && transactionHash !== null;

  if (hasBlock !== hasTransaction) {
    throw new Error(
      `Governance proposal ${transition} block and transaction must be recorded together.`
    );
  }
  if (hasBlock) {
    assertSafeBlockNumber(blockNumber, `${transition} block`);
  }
  if (hasTransaction && !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new Error(
      `Governance proposal ${transition} transaction hash is invalid.`
    );
  }
}

function assertSafeBlockNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function parseUnsignedInteger(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer: ${value}`);
  }

  return BigInt(value);
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = new Date(value);

  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function assertLifecycleChronology(
  observation: GovernanceDecisionObservation | StoredGovernanceDecision
): void {
  const references = [
    ["created", observation.createdBlockNumber],
    ["canceled", observation.canceledBlockNumber],
    ["queued", observation.queuedBlockNumber],
    ["executed", observation.executedBlockNumber]
  ] as const;

  for (const [transition, blockNumber] of references) {
    if (
      blockNumber !== undefined &&
      blockNumber !== null &&
      blockNumber > observation.lastObservedBlockNumber
    ) {
      throw new Error(
        `Governance proposal ${transition} block cannot be after its observation block.`
      );
    }
  }

  const created = observation.createdBlockNumber;
  if (created !== undefined && created !== null) {
    for (const [transition, blockNumber] of references.slice(1)) {
      if (
        blockNumber !== undefined &&
        blockNumber !== null &&
        blockNumber < created
      ) {
        throw new Error(
          `Governance proposal ${transition} block cannot precede its creation block.`
        );
      }
    }
  }

  const queued = observation.queuedBlockNumber;
  if (queued !== undefined && queued !== null) {
    for (const [transition, blockNumber] of [
      ["canceled", observation.canceledBlockNumber],
      ["executed", observation.executedBlockNumber]
    ] as const) {
      if (
        blockNumber !== undefined &&
        blockNumber !== null &&
        blockNumber < queued
      ) {
        throw new Error(
          `Governance proposal ${transition} block cannot precede its queue block.`
        );
      }
    }
  }
}

function assertLifecycleStateConsistency(
  observation: GovernanceDecisionObservation | StoredGovernanceDecision
): void {
  if (
    observation.canceledTransactionHash != null &&
    observation.status !== "canceled"
  ) {
    throw new Error(
      `Governance proposal cancellation reference is incompatible with status ${observation.status}.`
    );
  }

  if (
    observation.queuedTransactionHash != null &&
    !QUEUE_REFERENCE_STATES.has(observation.status)
  ) {
    throw new Error(
      `Governance proposal queue reference is incompatible with status ${observation.status}.`
    );
  }

  if (
    observation.executedTransactionHash != null &&
    observation.status !== "executed"
  ) {
    throw new Error(
      `Governance proposal execution reference is incompatible with status ${observation.status}.`
    );
  }
}

function hasMeaningfulDecisionChange(
  existing: StoredGovernanceDecision,
  candidate: StoredGovernanceDecision
): boolean {
  const ignored = new Set([
    "firstSeenAt",
    "lastSyncedAt",
    "createdAt",
    "updatedAt",
    "lastObservedBlockNumber"
  ]);
  const comparable = (value: StoredGovernanceDecision) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !ignored.has(key))
    );

  return hashObject(comparable(existing)) !== hashObject(comparable(candidate));
}
