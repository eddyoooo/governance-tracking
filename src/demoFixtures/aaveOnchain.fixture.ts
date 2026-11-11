import type { GovernanceContractEvent } from "../onchain/types.js";

// Read-only Ethereum snapshot of Aave Governance V3 proposal 0, captured 2026-11-09.
export const aaveOnchainProposalFixture = {
  state: 4, accessLevel: 1, creationTime: 1704488567, votingDuration: 259200,
  votingActivationTime: 1704575039, queuingTime: 1704836471, cancelTimestamp: 0,
  creator: "0xf71fc92e2949ccF6A5Fd369a0b402ba80Bc61E02",
  votingPortal: "0x9b24C168d6A76b5459B1d47071a54962a4df36c3",
  snapshotBlockHash: "0x5fc22e778c4d066a057daf1233a010f88a366ebdc4d1cae2f7ed77023bf7c8e7",
  ipfsHash: "0xf92585de2ff0761e3d86d0e3253d2f49b2a916ef63784834f5e7230efb1bd194",
  forVotes: 425306287773343762214587n, againstVotes: 0n,
  payloads: [
    { chain: 1n, accessLevel: 1, payloadsController: "0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5", payloadId: 43n },
    { chain: 137n, accessLevel: 1, payloadsController: "0x401B5D0294E23637c18fcc38b1Bca814CDa2637C", payloadId: 24n },
    { chain: 43114n, accessLevel: 1, payloadsController: "0x1140CB7CAfAcC745771C2Ea31e7B5C653c5d0B80", payloadId: 10n },
    { chain: 10n, accessLevel: 1, payloadsController: "0x0E1a3Af1f9cC76A62eD31eDedca291E63632e7c4", payloadId: 8n },
    { chain: 42161n, accessLevel: 1, payloadsController: "0x89644CA1bB8064760312AE4F03ea41b05dA3637C", payloadId: 7n },
    { chain: 8453n, accessLevel: 1, payloadsController: "0x2DC219E716793fb4b21548C0f009Ba3Af753ab01", payloadId: 5n },
    { chain: 100n, accessLevel: 1, payloadsController: "0x9A1F491B86D09fC1484b5fab10041B189B60756b", payloadId: 2n }
  ]
};

export const aaveOnchainEventFixtures: GovernanceContractEvent[] = [
  { type: "created", blockNumber: 18943610, blockHash: "0xe3f25c90491ef8fe77ed0c8ef0e4b2a19e3f67ed06790f400923badf52215368",
    transactionHash: "0x7862affd49d0394f369d21ac0de6387e7cf20d7000fb2359737d0232d4b27440", logIndex: 70 },
  { type: "activated", blockNumber: 18950681, blockHash: "0xe46909cc0f7be71a29d704885269bd71d18f8a9ca10e00e61950b6e871eb6964",
    transactionHash: "0xb053ae2784553007df70938d01aa4e74c1fc0029be5a0a7a57c05360a5f93586", logIndex: 67 },
  { type: "queued", blockNumber: 18972146, blockHash: "0x649b645661fa6f23084882ec7265a286805bc1c42e4990ce5d329ef88489fc0a",
    transactionHash: "0x314dcfd4e24741ef25755fed3588b4854128037b7abc8b73815655eb2f4ffd6c", logIndex: 135 },
  { type: "executed", blockNumber: 18972147, blockHash: "0xa13a34ac8515455703ec93ee058efca2a0a08b6c34f95803dcc405b73ff7a043",
    transactionHash: "0x2dc882a9e865e3c3e11294812c00776621e9c6ae0b7d3abf50b5828debefdbfc", logIndex: 153 }
].map((event) => ({ ...event, type: event.type as GovernanceContractEvent["type"],
  proposalId: "0", id: `${event.transactionHash}:${event.logIndex}` }));
