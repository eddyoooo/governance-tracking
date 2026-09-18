import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type PublicClient
} from "viem";
import { mainnet } from "viem/chains";
import { hashObject } from "../../utils/hash.js";
import {
  createGovernanceDecisionId,
  extractGovernanceTitle,
  outcomesForStatus
} from "../governanceDecision.js";
import type {
  GovernanceBlockReference,
  GovernanceContractEvent,
  GovernanceDecisionObservation,
  GovernanceSourceValidation,
  GovernanceVoteOutcome,
  StoredGovernanceDecision
} from "../types.js";
import {
  assertBlockNumber,
  assertContractCode,
  assertDecisionEventConsistency,
  assertMatchingAddress,
  assertProposalId,
  assertProposalStateConsistency,
  blockReference,
  canonicalCancellationReference,
  compareContractEvents,
  firstEvent,
  governorStatus,
  latestEvent,
  normalizeActions,
  normalizeContractEvent,
  normalizeNativeState,
  normalizeProposalTuple,
  serializeContractValue,
  toSafeNumber,
  uintString,
  uintValue
} from "./uniswapOnchain.codec.js";
import {
  UNISWAP_GOVERNANCE_EVENTS,
  UNISWAP_GOVERNOR_ABI
} from "./uniswapGovernor.abi.js";

export const UNISWAP_MAINNET_CHAIN_ID = 1;
export const UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK = 13_059_157;
export const UNISWAP_ONCHAIN_LOG_BLOCK_RANGE = 10_000;
export const UNISWAP_ONCHAIN_REORG_OVERLAP_BLOCKS = 64;

export interface UniswapOnchainClientOptions {
  rpcUrl?: string;
  governorAddress: string;
  timelockAddress: string;
  uniTokenAddress: string;
  publicClient?: PublicClient;
}

export class UniswapOnchainClient {
  readonly sourceKey: string;
  readonly governorAddress: Address;
  readonly timelockAddress: Address;
  readonly uniTokenAddress: Address;
  private readonly client: PublicClient;

  constructor(options: UniswapOnchainClientOptions) {
    this.governorAddress = getAddress(options.governorAddress);
    this.timelockAddress = getAddress(options.timelockAddress);
    this.uniTokenAddress = getAddress(options.uniTokenAddress);
    this.sourceKey = `uniswap:onchain:${UNISWAP_MAINNET_CHAIN_ID}:${this.governorAddress.toLowerCase()}`;

    if (!options.publicClient && !options.rpcUrl) {
      throw new Error("UniswapOnchainClient requires an Ethereum RPC URL.");
    }

    this.client =
      options.publicClient ??
      createPublicClient({
        chain: mainnet,
        transport: http(options.rpcUrl, {
          retryCount: 3,
          retryDelay: 500,
          timeout: 15_000
        })
      });
  }

  async validateSource(): Promise<GovernanceSourceValidation> {
    const [chainId, finalizedBlock] = await Promise.all([
      this.client.getChainId(),
      this.client.getBlock({ blockTag: "finalized" })
    ]);

    if (chainId !== UNISWAP_MAINNET_CHAIN_ID) {
      throw new Error(
        `Uniswap governance RPC must use Ethereum mainnet chain id 1; received ${chainId}.`
      );
    }

    const finalizedReference = blockReference(finalizedBlock);

    if (finalizedReference.number < UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK) {
      throw new Error(
        `Ethereum finalized block ${finalizedReference.number} predates the Uniswap Governor deployment block ${UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK}.`
      );
    }

    const finalizedBlockNumber = BigInt(finalizedReference.number);
    const [
      governorCode,
      timelockCode,
      uniCode,
      configuredTimelock,
      configuredUni,
      implementationAddress,
      proposalCount,
      initialProposalId,
      votingDelay,
      votingPeriod,
      proposalThreshold,
      quorumVotes
    ] = await Promise.all([
      this.client.getCode({
        address: this.governorAddress,
        blockNumber: finalizedBlockNumber
      }),
      this.client.getCode({
        address: this.timelockAddress,
        blockNumber: finalizedBlockNumber
      }),
      this.client.getCode({
        address: this.uniTokenAddress,
        blockNumber: finalizedBlockNumber
      }),
      this.readGovernor("timelock", undefined, finalizedBlockNumber),
      this.readGovernor("uni", undefined, finalizedBlockNumber),
      this.readGovernor("implementation", undefined, finalizedBlockNumber),
      this.readGovernor("proposalCount", undefined, finalizedBlockNumber),
      this.readGovernor("initialProposalId", undefined, finalizedBlockNumber),
      this.readGovernor("votingDelay", undefined, finalizedBlockNumber),
      this.readGovernor("votingPeriod", undefined, finalizedBlockNumber),
      this.readGovernor("proposalThreshold", undefined, finalizedBlockNumber),
      this.readGovernor("quorumVotes", undefined, finalizedBlockNumber)
    ]);

    assertContractCode("GovernorBravo", governorCode);
    assertContractCode("Timelock", timelockCode);
    assertContractCode("UNI token", uniCode);
    assertMatchingAddress("Governor Timelock", configuredTimelock, this.timelockAddress);
    assertMatchingAddress("Governor UNI token", configuredUni, this.uniTokenAddress);
    const implementation = getAddress(String(implementationAddress));
    const implementationCode = await this.client.getCode({
      address: implementation,
      blockNumber: finalizedBlockNumber
    });
    assertContractCode("Governor implementation", implementationCode);
    const normalizedProposalCount = uintString(
      proposalCount,
      "Governor proposalCount"
    );
    const normalizedInitialProposalId = uintString(
      initialProposalId,
      "Governor initialProposalId"
    );

    if (BigInt(normalizedProposalCount) < BigInt(normalizedInitialProposalId)) {
      throw new Error(
        `Governor proposalCount ${normalizedProposalCount} is below initialProposalId ${normalizedInitialProposalId}.`
      );
    }

    return {
      chainId,
      latestFinalizedBlock: finalizedReference,
      implementationAddress: implementation,
      proposalCount: normalizedProposalCount,
      initialProposalId: normalizedInitialProposalId,
      votingDelay: uintString(votingDelay, "Governor votingDelay"),
      votingPeriod: uintString(votingPeriod, "Governor votingPeriod"),
      proposalThreshold: uintString(
        proposalThreshold,
        "Governor proposalThreshold"
      ),
      quorumVotes: uintString(quorumVotes, "Governor quorumVotes")
    };
  }

  async getBlock(blockNumber: number): Promise<GovernanceBlockReference> {
    assertBlockNumber(blockNumber, "requested block number");
    const reference = blockReference(
      await this.client.getBlock({ blockNumber: BigInt(blockNumber) })
    );

    if (reference.number !== blockNumber) {
      throw new Error(
        `Ethereum RPC returned block ${reference.number} while loading block ${blockNumber}.`
      );
    }

    return reference;
  }

  async getEvents(
    fromBlock: number,
    toBlock: number
  ): Promise<GovernanceContractEvent[]> {
    assertBlockNumber(fromBlock, "log range start");
    assertBlockNumber(toBlock, "log range end");

    if (fromBlock < UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK) {
      throw new Error(
        `Uniswap governance log range cannot start before deployment block ${UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK}.`
      );
    }

    if (toBlock < fromBlock) {
      throw new Error("Uniswap governance log range end must not precede start.");
    }

    if (toBlock - fromBlock + 1 > UNISWAP_ONCHAIN_LOG_BLOCK_RANGE) {
      throw new Error(
        `Uniswap governance log range exceeds ${UNISWAP_ONCHAIN_LOG_BLOCK_RANGE} blocks.`
      );
    }

    const logs = await this.client.getLogs({
      address: this.governorAddress,
      events: UNISWAP_GOVERNANCE_EVENTS,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
      strict: true
    });

    const uniqueEvents = new Map<string, GovernanceContractEvent>();

    for (const log of logs) {
      const event = normalizeContractEvent(log);

      if (event.blockNumber < fromBlock || event.blockNumber > toBlock) {
        throw new Error(
          `Ethereum RPC returned governance event ${event.id} outside requested block range ${fromBlock}-${toBlock}.`
        );
      }

      const duplicate = uniqueEvents.get(event.id);
      if (duplicate) {
        if (hashObject(duplicate) !== hashObject(event)) {
          throw new Error(
            `Ethereum RPC returned conflicting governance event ${event.id}.`
          );
        }
        continue;
      }

      uniqueEvents.set(event.id, event);
    }

    return [...uniqueEvents.values()].sort(compareContractEvents);
  }

  async getDecision(
    proposalId: string,
    events: GovernanceContractEvent[],
    existing: StoredGovernanceDecision | null,
    observedAtBlock: number
  ): Promise<GovernanceDecisionObservation> {
    assertProposalId(proposalId);
    assertBlockNumber(observedAtBlock, "proposal observation block");
    const numericProposalId = BigInt(proposalId);
    const blockNumber = BigInt(observedAtBlock);
    const [proposal, nativeState, actionsResult] = await Promise.all([
      this.readGovernor("proposals", [numericProposalId], blockNumber),
      this.readGovernor("state", [numericProposalId], blockNumber),
      this.readGovernor("getActions", [numericProposalId], blockNumber)
    ]);
    const proposalTuple = normalizeProposalTuple(proposal);

    if (proposalTuple[0] !== numericProposalId) {
      throw new Error(
        `Governor returned proposal ${proposalTuple[0]} while loading ${proposalId}.`
      );
    }

    const status = governorStatus(normalizeNativeState(nativeState));
    const unrelatedEvent = events.find((event) => event.proposalId !== proposalId);
    if (unrelatedEvent) {
      throw new Error(
        `Proposal ${proposalId} received event data for proposal ${unrelatedEvent.proposalId}.`
      );
    }
    const relevantEvents = events;
    const createdEvent = latestEvent(relevantEvents, "created");
    const canceledEvent = firstEvent(relevantEvents, "canceled");
    const cancellationReference = canonicalCancellationReference(
      canceledEvent,
      existing
    );
    const queuedEvent = latestEvent(relevantEvents, "queued");
    const executedEvent = latestEvent(relevantEvents, "executed");
    const actions = normalizeActions(actionsResult);
    const startBlock = toSafeNumber(proposalTuple[3], "proposal start block");
    const endBlock = toSafeNumber(proposalTuple[4], "proposal end block");
    assertProposalStateConsistency(
      proposalTuple,
      status,
      startBlock,
      endBlock,
      observedAtBlock
    );
    assertDecisionEventConsistency(
      proposalId,
      proposalTuple,
      status,
      actions,
      relevantEvents,
      observedAtBlock
    );
    const outcomes =
      status === "canceled"
        ? {
            voteOutcome: await this.resolveCanceledVoteOutcome({
              proposal: proposalTuple,
              existing,
              cancellationBlock: cancellationReference.blockNumber,
              endBlock,
              observedAtBlock
            }),
            executionOutcome: "canceled" as const
          }
        : outcomesForStatus(status);
    const votingEndedAt = await this.resolveVotingEndedAt(
      existing,
      outcomes.voteOutcome,
      endBlock
    );
    const description = createdEvent?.description ?? existing?.description;
    const observationWithoutHash = {
      id: createGovernanceDecisionId({
        protocol: "uniswap",
        chainId: UNISWAP_MAINNET_CHAIN_ID,
        governorAddress: this.governorAddress,
        proposalId
      }),
      sourceKey: this.sourceKey,
      protocol: "uniswap",
      sourceType: "onchain" as const,
      chainId: UNISWAP_MAINNET_CHAIN_ID,
      governorAddress: this.governorAddress,
      proposalId,
      proposer: getAddress(proposalTuple[1]),
      title: extractGovernanceTitle(description, proposalId),
      description,
      sourceUrl: `https://vote.uniswapfoundation.org/proposals/${proposalId}`,
      status,
      ...outcomes,
      startBlock,
      endBlock,
      votingEndedAt,
      eta: proposalTuple[2] === 0n ? null : proposalTuple[2].toString(),
      forVotes: proposalTuple[5].toString(),
      againstVotes: proposalTuple[6].toString(),
      abstainVotes: proposalTuple[7].toString(),
      actions,
      createdBlockNumber: createdEvent?.blockNumber,
      createdTransactionHash: createdEvent?.transactionHash,
      canceledBlockNumber: cancellationReference.blockNumber ?? undefined,
      canceledTransactionHash:
        cancellationReference.transactionHash ?? undefined,
      queuedBlockNumber: queuedEvent?.blockNumber,
      queuedTransactionHash: queuedEvent?.transactionHash,
      executedBlockNumber: executedEvent?.blockNumber,
      executedTransactionHash: executedEvent?.transactionHash,
      lastObservedBlockNumber: observedAtBlock
    };

    return {
      ...observationWithoutHash,
      rawHash: hashObject({
        proposal: proposalTuple.map(serializeContractValue),
        actions,
        description: description ?? null,
        status
      })
    };
  }

  private readGovernor(
    functionName:
      | "proposalCount"
      | "initialProposalId"
      | "timelock"
      | "uni"
      | "implementation"
      | "votingDelay"
      | "votingPeriod"
      | "proposalThreshold"
      | "quorumVotes"
      | "state"
      | "proposals"
      | "getActions",
    args?: readonly [bigint],
    blockNumber?: bigint
  ): Promise<unknown> {
    return this.client.readContract({
      address: this.governorAddress,
      abi: UNISWAP_GOVERNOR_ABI,
      functionName,
      ...(args ? { args } : {}),
      ...(blockNumber !== undefined ? { blockNumber } : {})
    } as never);
  }

  private async resolveCanceledVoteOutcome(options: {
    proposal: ReturnType<typeof normalizeProposalTuple>;
    existing: StoredGovernanceDecision | null;
    cancellationBlock: number | null;
    endBlock: number;
    observedAtBlock: number;
  }): Promise<GovernanceVoteOutcome> {
    if (options.proposal[2] !== 0n) {
      return "succeeded";
    }

    if (
      options.existing?.voteOutcome === "succeeded" ||
      options.existing?.voteOutcome === "defeated"
    ) {
      return options.existing.voteOutcome;
    }

    if (
      options.cancellationBlock === null ||
      options.cancellationBlock <= options.endBlock
    ) {
      return "canceled";
    }

    const quorumVotes = uintValue(
      await this.readGovernor(
        "quorumVotes",
        undefined,
        BigInt(options.observedAtBlock)
      ),
      "Governor quorumVotes"
    );

    return options.proposal[5] > options.proposal[6] &&
      options.proposal[5] >= quorumVotes
      ? "succeeded"
      : "defeated";
  }

  private async resolveVotingEndedAt(
    existing: StoredGovernanceDecision | null,
    voteOutcome: GovernanceVoteOutcome,
    endBlock: number
  ): Promise<string | undefined> {
    if (existing?.votingEndedAt) {
      return existing.votingEndedAt;
    }

    if (voteOutcome !== "succeeded" && voteOutcome !== "defeated") {
      return undefined;
    }

    return (await this.getBlock(endBlock)).timestamp;
  }
}
