import { parseAbi } from "viem";

// Governance V3 interfaces: aave-dao/aave-governance-v3/src/interfaces/IGovernanceCore.sol.
export const AAVE_GOVERNANCE_EVENTS = parseAbi([
  "event ProposalCreated(uint256 indexed proposalId, address indexed creator, uint8 indexed accessLevel, bytes32 ipfsHash)",
  "event VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)",
  "event ProposalQueued(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)",
  "event ProposalFailed(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)",
  "event ProposalCanceled(uint256 indexed proposalId)",
  "event ProposalExecuted(uint256 indexed proposalId)"
]);

export const AAVE_GOVERNANCE_ABI = parseAbi([
  "function NAME() view returns (string)",
  "function getProposalsCount() view returns (uint256)",
  "function COOLDOWN_PERIOD() view returns (uint256)",
  "function getProposal(uint256 proposalId) view returns ((uint8 state, uint8 accessLevel, uint40 creationTime, uint24 votingDuration, uint40 votingActivationTime, uint40 queuingTime, uint40 cancelTimestamp, address creator, address votingPortal, bytes32 snapshotBlockHash, bytes32 ipfsHash, uint128 forVotes, uint128 againstVotes, uint256 cancellationFee, (uint256 chain, uint8 accessLevel, address payloadsController, uint40 payloadId)[] payloads))"
]);
