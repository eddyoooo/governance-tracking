import { hashObject } from "../utils/hash.js";
import { createGovernanceDecisionId, outcomesForStatus } from "../onchain/governanceDecision.js";
import type {
  EvmGovernanceAdapter,
  GovernanceBlockReference,
  GovernanceContractEvent,
  GovernanceDecisionObservation,
  GovernanceDecisionStatus,
  GovernanceSourceValidation,
  StoredGovernanceDecision
} from "../onchain/types.js";

const GOVERNOR_ADDRESS = "0x408ED6354d4973f66138C91495F2f2FCbd8724C3";
const IMPLEMENTATION_ADDRESS = "0x53a328F4086d7C0F1Fa19e594c9b842125263026";
const PROPOSER_ADDRESS = "0x927c7fD078FC406059957a691c21F6E0fC4A959C";
const CREATED_BLOCK = 25_554_834;
const VOTING_ENDED_AT = "2026-07-25T07:29:47.000Z";
const QUEUED_BLOCK = 25_608_297;
const EXECUTED_BLOCK = 25_622_665;

export const UNISWAP_PROPOSAL_100_CAPTURED_ACTION_COUNT = 7;

export class ScriptedUniswapOnchainDemoAdapter
  implements EvmGovernanceAdapter
{
  readonly sourceKey = `uniswap:onchain:1:${GOVERNOR_ADDRESS.toLowerCase()}`;
  readonly protocol = "uniswap";
  readonly sourceType = "onchain" as const;
  readonly chainId = 1;
  readonly contractAddress = GOVERNOR_ADDRESS;
  readonly deploymentBlock = CREATED_BLOCK - 1;
  readonly maxLogBlockRange = 100_000;
  readonly reorgOverlapBlocks = 0;
  readonly enabled = true;
  private phase: "baseline" | "created" | "executed" = "baseline";

  constructor(readonly notificationsEnabled: boolean) {}

  revealCreation(): void {
    this.phase = "created";
  }

  revealExecution(): void {
    this.phase = "executed";
  }

  async validateSource(): Promise<GovernanceSourceValidation> {
    const finalizedBlock = this.finalizedBlock();

    return {
      chainId: 1,
      latestFinalizedBlock: this.block(finalizedBlock),
      implementationAddress: IMPLEMENTATION_ADDRESS,
      proposalCount: this.phase === "baseline" ? "99" : "100",
      initialProposalId: "99",
      votingDelay: "13140",
      votingPeriod: "40320",
      proposalThreshold: "1000000000000000000000000",
      quorumVotes: "40000000000000000000000000"
    };
  }

  async getBlock(blockNumber: number): Promise<GovernanceBlockReference> {
    return this.block(blockNumber);
  }

  async getEvents(
    fromBlock: number,
    toBlock: number
  ): Promise<GovernanceContractEvent[]> {
    return this.events().filter(
      (event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock
    );
  }

  async getDecision(
    proposalId: string,
    _events: GovernanceContractEvent[],
    _existing: StoredGovernanceDecision | null,
    observedAtBlock: number
  ): Promise<GovernanceDecisionObservation> {
    if (proposalId !== "100" || this.phase === "baseline") {
      throw new Error(`Unknown scripted Uniswap proposal: ${proposalId}`);
    }

    const status: GovernanceDecisionStatus =
      this.phase === "created" ? "pending" : "executed";
    const outcomes = outcomesForStatus(status);
    const observation = {
      id: createGovernanceDecisionId({
        protocol: this.protocol,
        chainId: this.chainId,
        governorAddress: this.contractAddress,
        proposalId
      }),
      sourceKey: this.sourceKey,
      protocol: this.protocol,
      sourceType: this.sourceType,
      chainId: this.chainId,
      governorAddress: this.contractAddress,
      proposalId,
      proposer: PROPOSER_ADDRESS,
      title: "Activate v4 Protocol Fees (Part 1/2)",
      description: "# Activate v4 Protocol Fees (Part 1/2)",
      sourceUrl: "https://vote.uniswapfoundation.org/proposals/100",
      status,
      ...outcomes,
      startBlock: 25_567_974,
      endBlock: 25_608_294,
      votingEndedAt:
        this.phase === "executed" ? VOTING_ENDED_AT : undefined,
      eta: this.phase === "executed" ? "1785137423" : null,
      forVotes:
        this.phase === "executed" ? "46604582791345472235524184" : "0",
      againstVotes:
        this.phase === "executed" ? "1274746482273310161174620" : "0",
      abstainVotes:
        this.phase === "executed" ? "1813590659889870399210" : "0",
      actions: [
        {
          index: 0,
          target: "0x000000000004444c5dc75cB358380D2e3dE08A90",
          value: "0",
          signature: "",
          calldata:
            "0x2d77138900000000000000000000000089a5d5bf00a27d55c02951e49078a5c5771051db"
        }
      ],
      createdBlockNumber: CREATED_BLOCK,
      createdTransactionHash:
        "0xa8ea4b2d438c82462ada1e24ed265d617963c667d4dcca3a67f94e1073cc5a3d",
      queuedBlockNumber:
        this.phase === "executed" ? QUEUED_BLOCK : undefined,
      queuedTransactionHash:
        this.phase === "executed"
          ? "0xe6499cc2e740c9548ac28cafea1e235fc6c9f305e444c2b412124fa066748d90"
          : undefined,
      executedBlockNumber:
        this.phase === "executed" ? EXECUTED_BLOCK : undefined,
      executedTransactionHash:
        this.phase === "executed"
          ? "0x451b7fd02b38fbd8cf8ed52cbaf6c87c12322fe078f08e5f3b26b059266e4604"
          : undefined,
      lastObservedBlockNumber: observedAtBlock
    };

    return {
      ...observation,
      rawHash: hashObject(observation)
    };
  }

  private finalizedBlock(): number {
    if (this.phase === "baseline") {
      return CREATED_BLOCK - 1;
    }

    return this.phase === "created" ? CREATED_BLOCK : EXECUTED_BLOCK;
  }

  private events(): GovernanceContractEvent[] {
    if (this.phase === "baseline") {
      return [];
    }

    const events: GovernanceContractEvent[] = [
      {
        id: "0xa8ea4b2d438c82462ada1e24ed265d617963c667d4dcca3a67f94e1073cc5a3d:633",
        type: "created",
        proposalId: "100",
        blockNumber: CREATED_BLOCK,
        blockHash:
          "0xf6b1e4b120d54101fa28007a468461a93c1b60fb33f20b20e1ad747b448005a3",
        transactionHash:
          "0xa8ea4b2d438c82462ada1e24ed265d617963c667d4dcca3a67f94e1073cc5a3d",
        logIndex: 633,
        proposer: PROPOSER_ADDRESS,
        startBlock: 25_567_974,
        endBlock: 25_608_294,
        description: "# Activate v4 Protocol Fees (Part 1/2)"
      }
    ];

    if (this.phase === "executed") {
      events.push(
        {
          id: "0xe6499cc2e740c9548ac28cafea1e235fc6c9f305e444c2b412124fa066748d90:482",
          type: "queued",
          proposalId: "100",
          blockNumber: QUEUED_BLOCK,
          blockHash:
            "0x050fdfd7b208f3514b39fae2afaf073224fb75b335403efa0b42636aa41f718f",
          transactionHash:
            "0xe6499cc2e740c9548ac28cafea1e235fc6c9f305e444c2b412124fa066748d90",
          logIndex: 482,
          eta: "1785137423"
        },
        {
          id: "0x451b7fd02b38fbd8cf8ed52cbaf6c87c12322fe078f08e5f3b26b059266e4604:715",
          type: "executed",
          proposalId: "100",
          blockNumber: EXECUTED_BLOCK,
          blockHash:
            "0xbd4fe8a4cb8f2e128d71e031d3aa3e92df14f30e09aba410fab81417f90751ac",
          transactionHash:
            "0x451b7fd02b38fbd8cf8ed52cbaf6c87c12322fe078f08e5f3b26b059266e4604",
          logIndex: 715
        }
      );
    }

    return events;
  }

  private block(blockNumber: number): GovernanceBlockReference {
    return {
      number: blockNumber,
      hash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
      timestamp: "2026-07-27T11:46:00.000Z"
    };
  }
}
