import type { GovernanceSourceState } from "./types.js";

interface LifecycleCoverageDecision {
  proposalId: string;
  status: string;
  eta: string | null;
  createdBlockNumber: number | null;
  createdTransactionHash: string | null;
  canceledBlockNumber: number | null;
  canceledTransactionHash: string | null;
  queuedBlockNumber: number | null;
  queuedTransactionHash: string | null;
  executedBlockNumber: number | null;
  executedTransactionHash: string | null;
}

export function parseProposalCounter(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Governor ${label} is not a non-negative integer: ${value}`);
  }

  return BigInt(value);
}

export function findMissingProposalIds(
  decisions: Array<{ proposalId: string }>,
  initialProposalId: string,
  proposalCount: string
): string[] {
  const initial = parseProposalCounter(initialProposalId, "initialProposalId");
  const count = parseProposalCounter(proposalCount, "proposalCount");

  if (count < initial) {
    throw new Error(
      `Governor proposalCount ${count} is below initialProposalId ${initial}.`
    );
  }

  const expectedCount = count - initial;

  if (expectedCount > 10_000n) {
    throw new Error(
      `Governor proposal range contains ${expectedCount} proposals; refusing an unbounded coverage check.`
    );
  }

  const observed = new Set(decisions.map((decision) => decision.proposalId));
  const missing: string[] = [];

  for (let proposalId = initial + 1n; proposalId <= count; proposalId += 1n) {
    if (!observed.has(proposalId.toString())) {
      missing.push(proposalId.toString());
    }
  }

  return missing;
}

export function assertProposalSequenceUnchanged(
  state: GovernanceSourceState,
  validation: {
    initialProposalId: string;
    proposalCount: string;
  }
): void {
  const storedInitial = parseProposalCounter(
    state.initialProposalId,
    "stored initialProposalId"
  );
  const currentInitial = parseProposalCounter(
    validation.initialProposalId,
    "initialProposalId"
  );
  const baselineCount = parseProposalCounter(
    state.baselineProposalCount,
    "stored baselineProposalCount"
  );
  const currentCount = parseProposalCounter(
    validation.proposalCount,
    "proposalCount"
  );

  if (storedInitial !== currentInitial) {
    throw new Error(
      `Governor initialProposalId changed from ${storedInitial} to ${currentInitial}; refusing to scan.`
    );
  }

  if (baselineCount < storedInitial) {
    throw new Error(
      `Stored Governor baselineProposalCount ${baselineCount} is below initialProposalId ${storedInitial}.`
    );
  }

  if (currentCount < baselineCount) {
    throw new Error(
      `Governor proposalCount regressed from baseline ${baselineCount} to ${currentCount}; refusing to scan.`
    );
  }
}

export function formatMissingProposalIds(proposalIds: string[]): string {
  return formatMissingItems(proposalIds);
}

export function assertProposalCountCoversStoredDecisions(
  decisions: Array<{ proposalId: string }>,
  proposalCount: string
): void {
  const count = parseProposalCounter(proposalCount, "proposalCount");
  let highestStoredProposalId = 0n;

  for (const decision of decisions) {
    const proposalId = parseProposalCounter(
      decision.proposalId,
      "stored proposalId"
    );
    if (proposalId > highestStoredProposalId) {
      highestStoredProposalId = proposalId;
    }
  }

  if (highestStoredProposalId > count) {
    throw new Error(
      `Governor proposalCount regressed below already stored proposal ${highestStoredProposalId}; received ${count}.`
    );
  }
}

export function decisionsUpToProposalId<T extends { proposalId: string }>(
  decisions: T[],
  proposalId: string
): T[] {
  const boundary = parseProposalCounter(proposalId, "proposal boundary");

  return decisions.filter(
    (decision) =>
      parseProposalCounter(decision.proposalId, "stored proposalId") <= boundary
  );
}

export function findMissingLifecycleReferences(
  decisions: LifecycleCoverageDecision[]
): string[] {
  const missing: string[] = [];

  for (const decision of decisions) {
    if (
      !hasCanonicalLifecycleReference(
        decision.createdBlockNumber,
        decision.createdTransactionHash
      )
    ) {
      missing.push(`${decision.proposalId}:created`);
    }
    if (
      decision.status === "canceled" &&
      !hasCanonicalLifecycleReference(
        decision.canceledBlockNumber,
        decision.canceledTransactionHash
      )
    ) {
      missing.push(`${decision.proposalId}:canceled`);
    }
    if (
      (decision.status === "queued" ||
        decision.status === "expired" ||
        decision.status === "executed" ||
        (decision.status === "canceled" && decision.eta !== null)) &&
      !hasCanonicalLifecycleReference(
        decision.queuedBlockNumber,
        decision.queuedTransactionHash
      )
    ) {
      missing.push(`${decision.proposalId}:queued`);
    }
    if (
      decision.status === "executed" &&
      !hasCanonicalLifecycleReference(
        decision.executedBlockNumber,
        decision.executedTransactionHash
      )
    ) {
      missing.push(`${decision.proposalId}:executed`);
    }
  }

  return missing;
}

export function formatMissingLifecycleReferences(references: string[]): string {
  return formatMissingItems(references);
}

export function liveCoverageError(missingProposalIds: string[]): Error {
  return new Error(
    `On-chain governance live coverage gap detected; missing proposal id(s): ${formatMissingProposalIds(
      missingProposalIds
    )}. The next scan will retry the notification-enabled block range.`
  );
}

export function historicalCoverageError(missingProposalIds: string[]): Error {
  return new Error(
    `On-chain governance historical coverage gap detected; missing proposal id(s): ${formatMissingProposalIds(
      missingProposalIds
    )}. The next scan will replay the baseline silently.`
  );
}

export function liveLifecycleCoverageError(
  missingReferences: string[]
): Error {
  return new Error(
    `On-chain governance live lifecycle coverage gap detected; missing canonical reference(s): ${formatMissingLifecycleReferences(
      missingReferences
    )}. The next scan will retry the notification-enabled block range.`
  );
}

export function historicalLifecycleCoverageError(
  missingReferences: string[]
): Error {
  return new Error(
    `On-chain governance historical lifecycle coverage gap detected; missing canonical reference(s): ${formatMissingLifecycleReferences(
      missingReferences
    )}. The next scan will replay the baseline silently.`
  );
}

function hasCanonicalLifecycleReference(
  blockNumber: number | null,
  transactionHash: string | null
): boolean {
  return blockNumber != null && transactionHash != null;
}

function formatMissingItems(items: string[]): string {
  const visible = items.slice(0, 20);

  return `${visible.join(", ")}${
    items.length > visible.length
      ? ` and ${items.length - visible.length} more`
      : ""
  }`;
}
