import type { GovernanceSourceState } from "./types.js";

interface LifecycleCoverageDecision {
  proposalId: string;
  status: string;
  lastObservedBlockNumber: number;
  eta: string | null;
  createdBlockNumber: number | null;
  createdTransactionHash: string | null;
  canceledBlockNumber: number | null;
  canceledTransactionHash: string | null;
  queuedBlockNumber: number | null;
  queuedTransactionHash: string | null;
  executedBlockNumber: number | null;
  executedTransactionHash: string | null;
  aave?: { queuingTime: number; resultBlockNumber?: number; resultTransactionHash?: string };
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
  proposalCount: string,
  proposalIdScheme?: "zero-based-count"
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

  const first = proposalIdScheme ? initial : initial + 1n;
  const end = proposalIdScheme ? count - 1n : count;
  for (let proposalId = first; proposalId <= end; proposalId += 1n) {
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
    proposalIdScheme?: "zero-based-count";
  }
): void {
  if (state.proposalIdScheme !== validation.proposalIdScheme) {
    throw new Error("Governor proposal numbering scheme changed; refusing to scan.");
  }
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
  proposalCount: string,
  proposalIdScheme?: "zero-based-count"
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

  if (decisions.length > 0 && highestStoredProposalId > (proposalIdScheme ? count - 1n : count)) {
    throw new Error(
      `Governor proposalCount regressed below already stored proposal ${highestStoredProposalId}; received ${count}.`
    );
  }
}

export function decisionsUpToProposalId<T extends { proposalId: string }>(
  decisions: T[],
  proposalId: string,
  proposalIdScheme?: "zero-based-count"
): T[] {
  const boundary = parseProposalCounter(proposalId, "proposal boundary");

  return decisions.filter(
    (decision) =>
      (proposalIdScheme
        ? parseProposalCounter(decision.proposalId, "stored proposalId") < boundary
        : parseProposalCounter(decision.proposalId, "stored proposalId") <= boundary)
  );
}

export function findMissingLifecycleReferences(
  decisions: LifecycleCoverageDecision[],
  baselineBlock?: number
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
    // A legacy record may reflect later events. The live check still requires
    // their references after the post-baseline range has been scanned.
    if (baselineBlock !== undefined && decision.lastObservedBlockNumber > baselineBlock) {
      continue;
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
        (decision.status === "expired" && (!decision.aave || decision.aave.queuingTime > 0)) ||
        decision.status === "executed" ||
        (decision.status === "canceled" && (decision.eta !== null || (decision.aave?.queuingTime ?? 0) > 0))) &&
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
    if (decision.aave &&
        (decision.status === "defeated" || decision.status === "queued" ||
         decision.status === "executed" || decision.aave.queuingTime > 0) &&
        !hasCanonicalLifecycleReference(decision.aave.resultBlockNumber ?? null,
          decision.aave.resultTransactionHash ?? null)) {
      missing.push(`${decision.proposalId}:settled-result`);
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
