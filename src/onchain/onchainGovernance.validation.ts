import { hashObject } from "../utils/hash.js";
import { assertGovernanceDecisionObservation } from "./governanceDecision.js";
import { parseProposalCounter } from "./onchainGovernance.coverage.js";
import type {
  EvmGovernanceAdapter,
  GovernanceBlockReference,
  GovernanceContractEvent,
  GovernanceSourceState,
  GovernanceSourceValidation
} from "./types.js";

export async function assertCanonicalCursor(
  state: GovernanceSourceState,
  validation: GovernanceSourceValidation,
  adapter: EvmGovernanceAdapter
): Promise<void> {
  const finalizedBlock = validation.latestFinalizedBlock.number;

  if (state.cursorBlockNumber > finalizedBlock) {
    throw new Error(
      `Stored on-chain governance cursor ${state.cursorBlockNumber} is ahead of finalized block ${finalizedBlock}.`
    );
  }

  if (state.baselineTargetBlock > finalizedBlock) {
    throw new Error(
      `Stored on-chain governance baseline target ${state.baselineTargetBlock} is ahead of finalized block ${finalizedBlock}.`
    );
  }

  if (
    state.cursorBlockNumber < adapter.deploymentBlock ||
    !state.cursorBlockHash
  ) {
    return;
  }

  const canonicalCursorBlock = await adapter.getBlock(state.cursorBlockNumber);
  assertReturnedBlock(
    canonicalCursorBlock,
    state.cursorBlockNumber,
    "canonical cursor"
  );

  if (
    canonicalCursorBlock.hash.toLowerCase() !==
    state.cursorBlockHash.toLowerCase()
  ) {
    throw new Error(
      `Previously finalized on-chain governance cursor block ${state.cursorBlockNumber} changed hash; refusing to advance.`
    );
  }
}

export function blockRanges(
  fromBlock: number,
  toBlock: number,
  maxRange: number
): Array<{ from: number; to: number }> {
  if (
    !Number.isSafeInteger(fromBlock) ||
    fromBlock < 0 ||
    !Number.isSafeInteger(toBlock) ||
    toBlock < 0
  ) {
    throw new Error(
      "On-chain governance block range bounds must be non-negative safe integers."
    );
  }

  if (!Number.isSafeInteger(maxRange) || maxRange <= 0) {
    throw new Error(
      "On-chain governance block range must be a positive safe integer."
    );
  }

  if (fromBlock > toBlock) {
    return [];
  }

  const ranges: Array<{ from: number; to: number }> = [];

  for (let from = fromBlock; from <= toBlock; from += maxRange) {
    ranges.push({ from, to: Math.min(toBlock, from + maxRange - 1) });
  }

  return ranges;
}

export function groupEventsByProposal(
  events: GovernanceContractEvent[]
): Map<string, GovernanceContractEvent[]> {
  const grouped = new Map<string, GovernanceContractEvent[]>();

  for (const event of events) {
    grouped.set(event.proposalId, [
      ...(grouped.get(event.proposalId) ?? []),
      event
    ]);
  }

  return grouped;
}

export function trackedProposalEvents(
  events: GovernanceContractEvent[],
  initialProposalId: string,
  proposalCount: string
): GovernanceContractEvent[] {
  const initial = parseProposalCounter(initialProposalId, "initialProposalId");
  const count = parseProposalCounter(proposalCount, "proposalCount");

  return events.filter((event) => {
    const proposalId = parseProposalCounter(
      event.proposalId,
      "event proposalId"
    );

    if (proposalId > count) {
      throw new Error(
        `Governor emitted proposal id ${proposalId} above finalized proposalCount ${count}.`
      );
    }

    return proposalId > initial;
  });
}

export function assertSourceMatchesAdapter(
  state: GovernanceSourceState,
  adapter: EvmGovernanceAdapter
): void {
  if (
    state.protocol !== adapter.protocol ||
    state.sourceKey !== adapter.sourceKey ||
    state.sourceType !== adapter.sourceType ||
    state.chainId !== adapter.chainId ||
    state.contractAddress.toLowerCase() !==
      adapter.contractAddress.toLowerCase() ||
    state.deploymentBlock !== adapter.deploymentBlock
  ) {
    throw new Error(
      `Stored governance source state does not match adapter ${adapter.sourceKey}.`
    );
  }
}

export function assertSourceValidation(
  adapter: EvmGovernanceAdapter,
  validation: GovernanceSourceValidation
): void {
  if (validation.chainId !== adapter.chainId) {
    throw new Error(
      `On-chain governance validation chain id ${validation.chainId} does not match adapter chain id ${adapter.chainId}.`
    );
  }

  assertSafeBlockNumber(
    validation.latestFinalizedBlock.number,
    "finalized block number"
  );
  if (validation.latestFinalizedBlock.number < adapter.deploymentBlock) {
    throw new Error(
      `On-chain governance finalized block ${validation.latestFinalizedBlock.number} predates deployment block ${adapter.deploymentBlock}.`
    );
  }
  assertBlockHash(validation.latestFinalizedBlock.hash, "finalized block hash");
  if (!Number.isFinite(Date.parse(validation.latestFinalizedBlock.timestamp))) {
    throw new Error("On-chain governance finalized block timestamp is invalid.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(validation.implementationAddress)) {
    throw new Error("On-chain governance implementation address is invalid.");
  }

  parseProposalCounter(validation.initialProposalId, "initialProposalId");
  parseProposalCounter(validation.proposalCount, "proposalCount");
  parseProposalCounter(validation.votingDelay, "votingDelay");
  parseProposalCounter(validation.votingPeriod, "votingPeriod");
  parseProposalCounter(validation.proposalThreshold, "proposalThreshold");
  parseProposalCounter(validation.quorumVotes, "quorumVotes");
}

export function assertStoredSourceState(
  state: GovernanceSourceState,
  adapter: EvmGovernanceAdapter
): void {
  if (state.baselineStatus !== "seeding" && state.baselineStatus !== "complete") {
    throw new Error("Stored on-chain governance baseline status is invalid.");
  }
  if (
    state.replayMode !== undefined &&
    state.replayMode !== null &&
    state.replayMode !== "silent" &&
    state.replayMode !== "live"
  ) {
    throw new Error("Stored on-chain governance replay mode is invalid.");
  }
  if (
    (state.replayMode === "silent" && state.baselineStatus !== "seeding") ||
    (state.replayMode === "live" && state.baselineStatus !== "complete")
  ) {
    throw new Error(
      "Stored on-chain governance replay mode is inconsistent with baseline status."
    );
  }
  if (!new Set(["seeding", "healthy", "failed"]).has(state.healthStatus)) {
    throw new Error("Stored on-chain governance health status is invalid.");
  }

  for (const [label, blockNumber] of [
    ["baseline target", state.baselineTargetBlock],
    ["cursor", state.cursorBlockNumber],
    ["latest finalized", state.latestFinalizedBlockNumber]
  ] as const) {
    assertSafeBlockNumber(blockNumber, `stored ${label} block number`);
  }

  if (state.baselineTargetBlock < adapter.deploymentBlock) {
    throw new Error(
      "Stored on-chain governance baseline target predates contract deployment."
    );
  }
  if (state.cursorBlockNumber < adapter.deploymentBlock - 1) {
    throw new Error(
      "Stored on-chain governance cursor predates contract deployment."
    );
  }
  if (state.latestFinalizedBlockNumber < adapter.deploymentBlock) {
    throw new Error(
      "Stored on-chain governance finalized head predates contract deployment."
    );
  }

  assertBlockHash(state.latestFinalizedBlockHash, "stored finalized block hash");
  if (state.cursorBlockNumber >= adapter.deploymentBlock) {
    if (!state.cursorBlockHash) {
      throw new Error("Stored on-chain governance cursor hash is missing.");
    }
    assertBlockHash(state.cursorBlockHash, "stored cursor block hash");
  } else if (state.cursorBlockHash !== null) {
    throw new Error(
      "Stored on-chain governance pre-deployment cursor must not have a hash."
    );
  }

  if (
    !Number.isSafeInteger(state.consecutiveFailures) ||
    state.consecutiveFailures < 0
  ) {
    throw new Error(
      "Stored on-chain governance consecutive failure count is invalid."
    );
  }
}

export function validateGovernanceEvents(
  events: GovernanceContractEvent[],
  fromBlock: number,
  toBlock: number
): GovernanceContractEvent[] {
  if (!Array.isArray(events)) {
    throw new Error(
      "On-chain governance adapter returned a non-array event result."
    );
  }

  const unique = new Map<string, GovernanceContractEvent>();
  const eventTypes = new Set(["created", "canceled", "queued", "executed"]);

  for (const event of events) {
    if (!event || typeof event !== "object") {
      throw new Error("On-chain governance adapter returned a malformed event.");
    }
    if (!eventTypes.has(event.type)) {
      throw new Error(`On-chain governance event type is invalid: ${event.type}`);
    }
    if (!/^[1-9]\d*$/.test(event.proposalId)) {
      throw new Error(
        `On-chain governance event proposal id is invalid: ${event.proposalId}`
      );
    }
    assertSafeBlockNumber(event.blockNumber, "event block number");
    if (event.blockNumber < fromBlock || event.blockNumber > toBlock) {
      throw new Error(
        `On-chain governance event ${event.id} is outside requested block range ${fromBlock}-${toBlock}.`
      );
    }
    assertBlockHash(event.blockHash, "event block hash");
    assertBlockHash(event.transactionHash, "event transaction hash");
    if (!Number.isSafeInteger(event.logIndex) || event.logIndex < 0) {
      throw new Error("On-chain governance event log index is invalid.");
    }
    if (event.id !== `${event.transactionHash}:${event.logIndex}`) {
      throw new Error(
        "On-chain governance event id does not match its transaction and log index."
      );
    }

    const existing = unique.get(event.id);
    if (existing) {
      if (hashObject(existing) !== hashObject(event)) {
        throw new Error(`On-chain governance event ${event.id} is conflicting.`);
      }
      continue;
    }
    unique.set(event.id, event);
  }

  return [...unique.values()].sort(
    (left, right) =>
      left.blockNumber - right.blockNumber || left.logIndex - right.logIndex
  );
}

export function assertReturnedBlock(
  block: GovernanceBlockReference,
  expectedBlockNumber: number,
  purpose: string
): void {
  assertSafeBlockNumber(block.number, `${purpose} block number`);
  if (block.number !== expectedBlockNumber) {
    throw new Error(
      `On-chain governance adapter returned block ${block.number} for requested ${purpose} block ${expectedBlockNumber}.`
    );
  }
  assertBlockHash(block.hash, `${purpose} block hash`);
  if (!Number.isFinite(Date.parse(block.timestamp))) {
    throw new Error(
      `On-chain governance ${purpose} block timestamp is invalid.`
    );
  }
}

export function assertDecisionMatchesRequest(
  observation: Awaited<ReturnType<EvmGovernanceAdapter["getDecision"]>>,
  adapter: EvmGovernanceAdapter,
  proposalId: string,
  expectedDecisionId: string,
  observedAtBlock: number
): void {
  assertGovernanceDecisionObservation(observation);

  if (
    observation.id !== expectedDecisionId ||
    observation.sourceKey !== adapter.sourceKey ||
    observation.protocol !== adapter.protocol ||
    observation.sourceType !== adapter.sourceType ||
    observation.chainId !== adapter.chainId ||
    observation.governorAddress.toLowerCase() !==
      adapter.contractAddress.toLowerCase() ||
    observation.proposalId !== proposalId
  ) {
    throw new Error(
      `On-chain governance decision ${proposalId} does not match its requested source identity.`
    );
  }
  if (observation.lastObservedBlockNumber !== observedAtBlock) {
    throw new Error(
      `On-chain governance decision ${proposalId} was observed at block ${observation.lastObservedBlockNumber}, expected ${observedAtBlock}.`
    );
  }
}

export function assertImplementationUnchanged(
  storedImplementation: string,
  currentImplementation: string
): void {
  if (
    storedImplementation.toLowerCase() !== currentImplementation.toLowerCase()
  ) {
    throw new Error(
      `Governor implementation changed from ${storedImplementation} to ${currentImplementation}; review the new implementation before resuming scans.`
    );
  }
}

function assertSafeBlockNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function assertBlockHash(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
}
