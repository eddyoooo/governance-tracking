import { parseAbi, parseAbiItem } from "viem";

export const UNISWAP_GOVERNOR_ABI = parseAbi([
  "function proposalCount() view returns (uint256)",
  "function initialProposalId() view returns (uint256)",
  "function timelock() view returns (address)",
  "function uni() view returns (address)",
  "function implementation() view returns (address)",
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
  "function quorumVotes() view returns (uint256)",
  "function state(uint256 proposalId) view returns (uint8)",
  "function proposals(uint256 proposalId) view returns (uint256 id, address proposer, uint256 eta, uint256 startBlock, uint256 endBlock, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, bool canceled, bool executed)",
  "function getActions(uint256 proposalId) view returns (address[] targets, uint256[] values, string[] signatures, bytes[] calldatas)"
]);

export const UNISWAP_GOVERNANCE_EVENTS = [
  parseAbiItem(
    "event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)"
  ),
  parseAbiItem("event ProposalCanceled(uint256 id)"),
  parseAbiItem("event ProposalQueued(uint256 id, uint256 eta)"),
  parseAbiItem("event ProposalExecuted(uint256 id)")
] as const;
