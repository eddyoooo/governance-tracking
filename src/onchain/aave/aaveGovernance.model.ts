import { z } from "zod";
import type { GovernanceDecisionObservation, GovernanceDecisionStatus, StoredGovernanceDecision } from "../types.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const uint = z.string().regex(/^\d+$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const aaveGovernanceDataSchema = z.object({
  nativeState: z.number().int().min(1).max(7),
  creationTime: timestamp.positive(),
  votingActivationTime: timestamp,
  votingDuration: timestamp,
  queuingTime: timestamp,
  cancelTimestamp: timestamp,
  votingPortal: address,
  snapshotBlockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  ipfsHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  metadataCid: z.string().min(1),
  resultReceivedAt: z.string().datetime()
    .refine((value) => {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) && date.toISOString() === value;
    }, "Expected canonical millisecond ISO timestamp.")
    .optional(),
  resultBlockNumber: timestamp.optional(),
  resultTransactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  payloads: z.array(z.object({
    chain: uint,
    accessLevel: z.number().int().min(1).max(2),
    payloadsController: address,
    payloadId: uint
  })).min(1).max(100),
  executionScope: z.literal("governance-core")
});

export function aaveStatus(nativeState: number): GovernanceDecisionStatus {
  const states: GovernanceDecisionStatus[] = [
    "pending", "pending", "active", "queued", "executed", "defeated", "canceled", "expired"
  ];
  if (!Number.isInteger(nativeState) || nativeState < 1 || nativeState > 7) {
    throw new Error(`Invalid Aave Governance V3 state: ${nativeState}`);
  }
  return states[nativeState];
}

export function assertAaveObservation(observation: GovernanceDecisionObservation | StoredGovernanceDecision): void {
  const data = aaveGovernanceDataSchema.parse(observation.aave);
  if (observation.protocol !== "aave" || observation.chainId !== 1 ||
      aaveStatus(data.nativeState) !== observation.status ||
      !/^(?:0|[1-9]\d*)$/.test(observation.proposalId) ||
      observation.startBlock !== undefined || observation.endBlock !== undefined ||
      observation.abstainVotes !== "0" || observation.votingEndedAt != null) {
    throw new Error("Aave governance observation has inconsistent identity, state, or voting clock.");
  }
  if ((data.votingActivationTime > 0 &&
       (data.votingActivationTime < data.creationTime || data.votingDuration === 0)) ||
      ((data.nativeState === 2 || data.nativeState === 3 || data.nativeState === 4 || data.nativeState === 5) &&
       data.votingActivationTime === 0) ||
      ((data.nativeState === 3 || data.nativeState === 4) && data.queuingTime === 0) ||
      (data.nativeState === 6 && data.cancelTimestamp === 0) ||
      (data.nativeState !== 6 && data.cancelTimestamp !== 0) ||
      (data.queuingTime > 0 && ![3, 4, 6, 7].includes(data.nativeState))) {
    throw new Error("Aave governance timestamps are inconsistent with its native state.");
  }
  const evidence = [data.resultReceivedAt, data.resultBlockNumber, data.resultTransactionHash];
  if (evidence.some((value) => value !== undefined) && evidence.some((value) => value === undefined)) {
    throw new Error("Aave settled-result timestamp, block and transaction must be recorded together.");
  }
  if ((data.queuingTime > 0 && data.queuingTime <= data.votingActivationTime + data.votingDuration) ||
      (data.resultBlockNumber !== undefined && data.resultBlockNumber > observation.lastObservedBlockNumber)) {
    throw new Error("Aave result precedes its voting window or exceeds its observation block.");
  }
}

export function aaveMetadataCid(ipfsHash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(ipfsHash) || /^0x0+$/.test(ipfsHash)) {
    throw new Error("Aave proposal metadata digest must be a nonzero bytes32.");
  }
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x1220${ipfsHash.slice(2)}`);
  let cid = "";
  while (value > 0n) {
    cid = alphabet[Number(value % 58n)] + cid;
    value /= 58n;
  }
  return cid;
}
