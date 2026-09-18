import { getAddress, type Address } from "viem";
import { hashObject } from "../../utils/hash.js";
import type {
  GovernanceAction,
  GovernanceBlockReference,
  GovernanceContractEvent,
  GovernanceDecisionStatus,
  StoredGovernanceDecision
} from "../types.js";

const GOVERNOR_STATES: GovernanceDecisionStatus[] = [
  "pending",
  "active",
  "canceled",
  "defeated",
  "succeeded",
  "queued",
  "expired",
  "executed"
];

const QUEUE_EVENT_STATES = new Set<GovernanceDecisionStatus>([
  "queued",
  "expired",
  "executed",
  "canceled"
]);

export function normalizeContractEvent(log: {
  eventName?: string;
  args?: unknown;
  blockNumber: bigint | null;
  blockHash: `0x${string}` | null;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
}): GovernanceContractEvent {
  if (
    log.blockNumber === null ||
    log.blockHash === null ||
    log.transactionHash === null ||
    log.logIndex === null
  ) {
    throw new Error("Uniswap governance returned an unconfirmed event log.");
  }

  if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0) {
    throw new Error("Uniswap governance returned an invalid event log index.");
  }

  assertBytes32(log.blockHash, "event block hash");
  assertBytes32(log.transactionHash, "event transaction hash");

  if (!log.args || typeof log.args !== "object" || Array.isArray(log.args)) {
    throw new Error("Uniswap governance returned malformed event arguments.");
  }

  const args = log.args as Record<string, unknown>;
  const proposalId = String(args.id);
  assertProposalId(proposalId);
  const base = {
    id: `${log.transactionHash}:${log.logIndex}`,
    proposalId,
    blockNumber: toSafeNumber(log.blockNumber, "event block number"),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex
  };

  switch (log.eventName) {
    case "ProposalCreated": {
      const targets = args.targets as readonly Address[];
      const values = args.values as readonly bigint[];
      const signatures = args.signatures as readonly string[];
      const calldatas = args.calldatas as readonly `0x${string}`[];

      if (typeof args.description !== "string") {
        throw new Error("Uniswap governance proposal description is not a string.");
      }

      return {
        ...base,
        type: "created",
        proposer: getAddress(String(args.proposer)),
        startBlock: toSafeNumber(args.startBlock as bigint, "start block"),
        endBlock: toSafeNumber(args.endBlock as bigint, "end block"),
        description: args.description,
        actions: normalizeActions([targets, values, signatures, calldatas])
      };
    }
    case "ProposalCanceled":
      return { ...base, type: "canceled" };
    case "ProposalQueued":
      return {
        ...base,
        type: "queued",
        eta: uintString(args.eta, "queued proposal eta")
      };
    case "ProposalExecuted":
      return { ...base, type: "executed" };
    default:
      throw new Error(`Unsupported Uniswap governance event: ${log.eventName}`);
  }
}

export function normalizeActions(values: unknown): GovernanceAction[] {
  if (!Array.isArray(values) || values.length !== 4) {
    throw new Error("Governor returned a malformed proposal action tuple.");
  }

  const [targets, amounts, signatures, calldatas] = values;

  if (
    !Array.isArray(targets) ||
    !Array.isArray(amounts) ||
    !Array.isArray(signatures) ||
    !Array.isArray(calldatas)
  ) {
    throw new Error("Governor returned malformed proposal action arrays.");
  }

  if (
    targets.length !== amounts.length ||
    targets.length !== signatures.length ||
    targets.length !== calldatas.length
  ) {
    throw new Error("Governor proposal action arrays have inconsistent lengths.");
  }
  if (targets.length === 0) {
    throw new Error("Governor proposal must contain at least one action.");
  }
  if (targets.length > 10) {
    throw new Error("Governor proposal exceeds the supported 10-action limit.");
  }

  return targets.map((target, index) => {
    const amount = amounts[index];
    const signature = signatures[index];
    const calldata = calldatas[index];

    if (typeof target !== "string") {
      throw new Error(`Governor action ${index} target is not an address.`);
    }
    if (typeof signature !== "string") {
      throw new Error(`Governor action ${index} signature is not a string.`);
    }
    if (typeof calldata !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(calldata)) {
      throw new Error(`Governor action ${index} calldata is not valid hex bytes.`);
    }

    return {
      index,
      target: getAddress(target),
      value: uintString(amount, `Governor action ${index} value`),
      signature,
      calldata
    };
  });
}

export function normalizeProposalTuple(value: unknown): readonly [
  bigint,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  boolean
] {
  if (!Array.isArray(value) || value.length !== 10) {
    throw new Error("Governor returned a malformed proposal tuple.");
  }

  const proposer = value[1];
  if (typeof proposer !== "string") {
    throw new Error("Governor proposal proposer is not an address.");
  }
  if (typeof value[8] !== "boolean" || typeof value[9] !== "boolean") {
    throw new Error("Governor proposal flags are malformed.");
  }

  return [
    uintValue(value[0], "Governor proposal id"),
    getAddress(proposer),
    uintValue(value[2], "Governor proposal eta"),
    uintValue(value[3], "Governor proposal startBlock"),
    uintValue(value[4], "Governor proposal endBlock"),
    uintValue(value[5], "Governor proposal forVotes"),
    uintValue(value[6], "Governor proposal againstVotes"),
    uintValue(value[7], "Governor proposal abstainVotes"),
    value[8],
    value[9]
  ];
}

export function normalizeNativeState(value: unknown): number {
  const state = typeof value === "bigint" ? Number(value) : value;

  if (!Number.isSafeInteger(state) || Number(state) < 0) {
    throw new Error(`Governor returned malformed proposal state ${String(value)}.`);
  }

  return Number(state);
}

export function latestEvent(
  events: GovernanceContractEvent[],
  type: GovernanceContractEvent["type"]
): GovernanceContractEvent | undefined {
  return events.filter((event) => event.type === type).sort(compareContractEvents).at(-1);
}

export function firstEvent(
  events: GovernanceContractEvent[],
  type: GovernanceContractEvent["type"]
): GovernanceContractEvent | undefined {
  return events.filter((event) => event.type === type).sort(compareContractEvents)[0];
}

export function canonicalCancellationReference(
  event: GovernanceContractEvent | undefined,
  existing: StoredGovernanceDecision | null
): { blockNumber: number | null; transactionHash: string | null } {
  // Governor Bravo permits repeated cancel calls; the first event is the state transition.
  if (
    existing?.canceledBlockNumber != null &&
    existing.canceledTransactionHash != null &&
    (!event || existing.canceledBlockNumber <= event.blockNumber)
  ) {
    return {
      blockNumber: existing.canceledBlockNumber,
      transactionHash: existing.canceledTransactionHash
    };
  }

  return {
    blockNumber: event?.blockNumber ?? null,
    transactionHash: event?.transactionHash ?? null
  };
}

export function compareContractEvents(
  left: GovernanceContractEvent,
  right: GovernanceContractEvent
): number {
  return left.blockNumber - right.blockNumber || left.logIndex - right.logIndex;
}

export function governorStatus(nativeState: number): GovernanceDecisionStatus {
  const status = GOVERNOR_STATES[nativeState];

  if (!status) {
    throw new Error(`Governor returned unsupported proposal state ${nativeState}.`);
  }

  return status;
}

export function assertProposalId(proposalId: string): void {
  if (!/^[1-9]\d*$/.test(proposalId)) {
    throw new Error(`Invalid Uniswap governance proposal id: ${proposalId}`);
  }
}

export function assertBlockNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

export function uintValue(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}

export function uintString(value: unknown, label: string): string {
  return uintValue(value, label).toString();
}

export function assertContractCode(name: string, code: string | undefined): void {
  if (!code || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
    throw new Error(`${name} contract has no bytecode at its configured address.`);
  }
}

export function assertMatchingAddress(
  name: string,
  actual: unknown,
  expected: Address
): void {
  if (getAddress(String(actual)) !== expected) {
    throw new Error(
      `${name} address mismatch: expected ${expected}, received ${String(actual)}.`
    );
  }
}

export function toSafeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the JavaScript safe integer range.`);
  }

  return Number(value);
}

export function blockReference(block: {
  number: bigint | null;
  hash: `0x${string}` | null;
  timestamp: bigint;
}): GovernanceBlockReference {
  if (!block.hash || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
    throw new Error("Ethereum RPC returned a block without a valid hash.");
  }

  const timestampSeconds = toSafeNumber(
    uintValue(block.timestamp, "block timestamp"),
    "block timestamp"
  );
  const timestamp = new Date(timestampSeconds * 1000);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("block timestamp is outside the JavaScript Date range.");
  }

  return {
    number: toSafeNumber(
      uintValue(block.number, "block number"),
      "block number"
    ),
    hash: block.hash,
    timestamp: timestamp.toISOString()
  };
}

export function assertProposalStateConsistency(
  proposal: ReturnType<typeof normalizeProposalTuple>,
  status: GovernanceDecisionStatus,
  startBlock: number,
  endBlock: number,
  observedAtBlock: number
): void {
  const eta = proposal[2];
  const canceled = proposal[8];
  const executed = proposal[9];

  if (endBlock <= startBlock) {
    throw new Error("Governor proposal end block must be after its start block.");
  }
  if (canceled !== (status === "canceled")) {
    throw new Error(
      `Governor proposal canceled flag is inconsistent with state ${status}.`
    );
  }
  if (executed !== (status === "executed")) {
    throw new Error(
      `Governor proposal executed flag is inconsistent with state ${status}.`
    );
  }

  if (status === "pending" && observedAtBlock > startBlock) {
    throw new Error("Governor pending proposal is already past its start block.");
  }
  if (
    status === "active" &&
    (observedAtBlock <= startBlock || observedAtBlock > endBlock)
  ) {
    throw new Error("Governor active proposal is outside its voting window.");
  }
  if (
    ["defeated", "succeeded", "queued", "expired", "executed"].includes(
      status
    ) &&
    observedAtBlock <= endBlock
  ) {
    throw new Error(
      `Governor ${status} proposal has not passed its voting end block.`
    );
  }

  if (
    ["queued", "expired", "executed"].includes(status) &&
    eta === 0n
  ) {
    throw new Error(`Governor ${status} proposal must have a non-zero ETA.`);
  }
  if (
    ["pending", "active", "defeated", "succeeded"].includes(status) &&
    eta !== 0n
  ) {
    throw new Error(`Governor ${status} proposal must not have a queued ETA.`);
  }
}

export function assertDecisionEventConsistency(
  proposalId: string,
  proposal: ReturnType<typeof normalizeProposalTuple>,
  status: GovernanceDecisionStatus,
  actions: GovernanceAction[],
  events: GovernanceContractEvent[],
  observedAtBlock: number
): void {
  const observedEventTypes = new Set<GovernanceContractEvent["type"]>();

  for (const event of events) {
    if (event.blockNumber > observedAtBlock) {
      throw new Error(
        `Proposal ${proposalId} event ${event.id} is after observation block ${observedAtBlock}.`
      );
    }
    if (event.type !== "canceled" && observedEventTypes.has(event.type)) {
      throw new Error(
        `Proposal ${proposalId} returned multiple ${event.type} events.`
      );
    }
    observedEventTypes.add(event.type);
  }

  const created = latestEvent(events, "created");
  if (created?.proposer && getAddress(created.proposer) !== proposal[1]) {
    throw new Error(`Proposal ${proposalId} proposer differs from its creation event.`);
  }
  if (created?.startBlock !== undefined && created.startBlock !== Number(proposal[3])) {
    throw new Error(`Proposal ${proposalId} start block differs from its creation event.`);
  }
  if (created?.endBlock !== undefined && created.endBlock !== Number(proposal[4])) {
    throw new Error(`Proposal ${proposalId} end block differs from its creation event.`);
  }
  if (created?.actions && hashObject(created.actions) !== hashObject(actions)) {
    throw new Error(`Proposal ${proposalId} actions differ from its creation event.`);
  }

  const queued = latestEvent(events, "queued");
  if (queued?.eta !== undefined && queued.eta !== proposal[2].toString()) {
    throw new Error(`Proposal ${proposalId} ETA differs from its queue event.`);
  }

  const canceled = latestEvent(events, "canceled");
  if (canceled && status !== "canceled") {
    throw new Error(
      `Proposal ${proposalId} has a cancellation event but Governor state is ${status}.`
    );
  }
  if (queued && !QUEUE_EVENT_STATES.has(status)) {
    throw new Error(
      `Proposal ${proposalId} has a queue event but Governor state is ${status}.`
    );
  }

  const executed = latestEvent(events, "executed");
  if (executed && status !== "executed") {
    throw new Error(
      `Proposal ${proposalId} has an execution event but Governor state is ${status}.`
    );
  }
}

function assertBytes32(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Uniswap governance ${label} is not a 32-byte hex value.`);
  }
}

export function serializeContractValue(value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
