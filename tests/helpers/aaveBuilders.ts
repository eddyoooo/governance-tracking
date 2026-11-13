import { jest } from "@jest/globals";
import type { PublicClient } from "viem";
import { AaveOnchainClient, AAVE_GOVERNANCE_ADDRESS, AAVE_GOVERNANCE_DEPLOYMENT_BLOCK } from "../../src/onchain/aave/aaveOnchain.client.js";
import { testBlockHash } from "./onchainBuilders.js";

export const AAVE_IMPLEMENTATION = "0x58BcB647C4beFf253B4B6996c62F737B783f2cDd";
export const AAVE_IPFS_HASH = "0xf92585de2ff0761e3d86d0e3253d2f49b2a916ef63784834f5e7230efb1bd194";
export function aaveRawProposal(overrides: Record<string, unknown> = {}) {
  return {
    state: 1, accessLevel: 1, creationTime: 1704488567, votingDuration: 0,
    votingActivationTime: 0, queuingTime: 0, cancelTimestamp: 0,
    creator: "0xf71fc92e2949ccF6A5Fd369a0b402ba80Bc61E02",
    votingPortal: "0x9b24C168d6A76b5459B1d47071a54962a4df36c3",
    snapshotBlockHash: testBlockHash(1), ipfsHash: AAVE_IPFS_HASH,
    forVotes: 0n, againstVotes: 0n,
    payloads: [{ chain: 1n, accessLevel: 1,
      payloadsController: "0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5", payloadId: 43n }],
    ...overrides
  };
}

export function aaveRpcFixture() {
  const block = AAVE_GOVERNANCE_DEPLOYMENT_BLOCK + 100;
  let proposal = aaveRawProposal();
  const rpc = {
    getChainId: jest.fn(async () => 1),
    getCode: jest.fn(async () => "0x1234"),
    getStorageAt: jest.fn(async () => `0x${AAVE_IMPLEMENTATION.slice(2).padStart(64, "0")}`),
    getBlock: jest.fn(async (input: { blockNumber?: bigint }) => ({
      number: input.blockNumber ?? BigInt(block),
      hash: testBlockHash(Number(input.blockNumber ?? block)), timestamp: 1704836471n
    })),
    readContract: jest.fn(async (input: { functionName: string }) => {
      if (input.functionName === "NAME") return "Aave Governance v3";
      if (input.functionName === "getProposalsCount") return 1n;
      return proposal;
    }),
    getLogs: jest.fn(async (_input: { fromBlock: bigint; toBlock: bigint }): Promise<unknown[]> => [])
  };
  const client = new AaveOnchainClient({ publicClient: rpc as unknown as PublicClient, metadataEnabled: false });
  return { rpc, client, block, setProposal: (next: ReturnType<typeof aaveRawProposal>) => { proposal = next; } };
}

export function aaveLog(type = "ProposalCreated", overrides: Record<string, unknown> = {}) {
  return {
    address: AAVE_GOVERNANCE_ADDRESS, eventName: type,
    args: { proposalId: 0n, creator: aaveRawProposal().creator, ipfsHash: AAVE_IPFS_HASH,
      votesFor: 0n, votesAgainst: 0n, snapshotBlockHash: testBlockHash(1), votingDuration: 259200 },
    blockNumber: BigInt(AAVE_GOVERNANCE_DEPLOYMENT_BLOCK + 1),
    blockHash: testBlockHash(AAVE_GOVERNANCE_DEPLOYMENT_BLOCK + 1),
    transactionHash: testBlockHash(15), logIndex: 0, removed: false,
    ...overrides
  };
}
