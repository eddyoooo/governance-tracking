import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";
import { z } from "zod";
import {
  buildGovernanceLifecycleMessage,
  formatUniVotes
} from "../../src/onchain/governanceNotifications.js";
import { createGovernanceDecisionId } from "../../src/onchain/governanceDecision.js";
import { formatTelegramGovernanceMessage } from "../../src/notifications/telegramNotification.service.js";
import type { StoredGovernanceDecision } from "../../src/onchain/types.js";

const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const fixtureSchema = z.object({
  capturedAt: z.string(),
  observedAtBlock: z.number().int().positive(),
  chainId: z.literal(1),
  governorAddress: address,
  proposal: z.object({
    id: z.string().regex(/^[1-9]\d*$/),
    proposer: address,
    title: z.string().min(1),
    status: z.literal("executed"),
    startBlock: z.number().int().positive(),
    endBlock: z.number().int().positive(),
    votingEndedAt: z.string().datetime({ offset: true }),
    eta: z.string().regex(/^\d+$/),
    forVotes: z.string().regex(/^\d+$/),
    againstVotes: z.string().regex(/^\d+$/),
    abstainVotes: z.string().regex(/^\d+$/),
    actionCount: z.number().int().positive(),
    firstAction: z.object({
      target: address,
      value: z.string().regex(/^\d+$/),
      signature: z.string(),
      calldata: z.string().regex(/^0x[0-9a-f]*$/)
    }),
    sourceUrl: z.string().url(),
    rawHash: z.string().regex(/^[0-9a-f]{64}$/)
  }),
  events: z.array(
    z.object({
      type: z.enum(["created", "queued", "executed"]),
      blockNumber: z.number().int().positive(),
      blockHash: hash,
      transactionHash: hash,
      logIndex: z.number().int().nonnegative()
    })
  )
});

async function loadFixture() {
  const contents = await readFile(
    new URL("../fixtures/uniswap/onchain-proposal-100.json", import.meta.url),
    "utf8"
  );

  return fixtureSchema.parse(JSON.parse(contents));
}

describe("real Uniswap Governor Bravo fixture", () => {
  it("retains the real proposal identity, lifecycle, votes, and action metadata", async () => {
    const fixture = await loadFixture();

    expect(fixture.proposal.id).toBe("100");
    expect(fixture.proposal.title).toBe("Activate v4 Protocol Fees (Part 1/2)");
    expect(fixture.proposal.actionCount).toBe(7);
    expect(fixture.proposal.endBlock).toBeGreaterThan(fixture.proposal.startBlock);
    expect(fixture.proposal.votingEndedAt).toBe("2026-07-25T07:29:47.000Z");
    expect(fixture.events.map((event) => event.type)).toEqual([
      "created",
      "queued",
      "executed"
    ]);
    expect(fixture.events.map((event) => event.blockNumber)).toEqual(
      [...fixture.events]
        .sort((left, right) => left.blockNumber - right.blockNumber)
        .map((event) => event.blockNumber)
    );
    expect(BigInt(fixture.proposal.forVotes)).toBeGreaterThan(
      BigInt(fixture.proposal.againstVotes)
    );
    expect(formatUniVotes(fixture.proposal.forVotes)).toBe(
      "46,604,582.79 UNI"
    );
  });

  it("produces the expected customer-facing execution notification from real values", async () => {
    const fixture = await loadFixture();
    const proposal = fixture.proposal;
    const decision: StoredGovernanceDecision = {
      id: createGovernanceDecisionId({
        protocol: "uniswap",
        chainId: fixture.chainId,
        governorAddress: fixture.governorAddress,
        proposalId: proposal.id
      }),
      sourceKey: `uniswap:onchain:1:${fixture.governorAddress.toLowerCase()}`,
      protocol: "uniswap",
      sourceType: "onchain",
      chainId: fixture.chainId,
      governorAddress: fixture.governorAddress,
      proposalId: proposal.id,
      proposer: proposal.proposer,
      title: proposal.title,
      description: proposal.title,
      sourceUrl: proposal.sourceUrl,
      status: "executed",
      voteOutcome: "succeeded",
      executionOutcome: "executed",
      startBlock: proposal.startBlock,
      endBlock: proposal.endBlock,
      votingEndedAt: proposal.votingEndedAt,
      eta: proposal.eta,
      forVotes: proposal.forVotes,
      againstVotes: proposal.againstVotes,
      abstainVotes: proposal.abstainVotes,
      actions: [{ index: 0, ...proposal.firstAction }],
      createdBlockNumber: fixture.events[0].blockNumber,
      createdTransactionHash: fixture.events[0].transactionHash,
      canceledBlockNumber: null,
      canceledTransactionHash: null,
      queuedBlockNumber: fixture.events[1].blockNumber,
      queuedTransactionHash: fixture.events[1].transactionHash,
      executedBlockNumber: fixture.events[2].blockNumber,
      executedTransactionHash: fixture.events[2].transactionHash,
      lastObservedBlockNumber: fixture.observedAtBlock,
      rawHash: proposal.rawHash,
      firstSeenAt: "2026-09-15T00:00:00.000Z",
      lastSyncedAt: "2026-09-15T00:00:00.000Z",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z"
    };

    expect(
      formatTelegramGovernanceMessage(
        buildGovernanceLifecycleMessage(decision, "executed")
      )
    ).toBe(
      "<b>GOVERNANCE PROPOSAL EXECUTED</b>\n" +
        "Protocol: <b>UNISWAP</b>\n" +
        "Status: Executed\n" +
        "Title: Activate v4 Protocol Fees (Part 1/2)\n" +
        "Link: https://vote.uniswapfoundation.org/proposals/100"
    );
  });

  it("produces the concise vote-result notification with the real end-block time", async () => {
    const fixture = await loadFixture();
    const proposal = fixture.proposal;
    const decision = {
      id: "uniswap-onchain-proposal-100",
      sourceKey: `uniswap:onchain:1:${fixture.governorAddress.toLowerCase()}`,
      protocol: "uniswap",
      sourceType: "onchain",
      chainId: fixture.chainId,
      governorAddress: fixture.governorAddress,
      proposalId: proposal.id,
      proposer: proposal.proposer,
      title: proposal.title,
      description: proposal.title,
      sourceUrl: proposal.sourceUrl,
      status: "succeeded",
      voteOutcome: "succeeded",
      executionOutcome: "awaiting_queue",
      startBlock: proposal.startBlock,
      endBlock: proposal.endBlock,
      votingEndedAt: proposal.votingEndedAt,
      eta: null,
      forVotes: proposal.forVotes,
      againstVotes: proposal.againstVotes,
      abstainVotes: proposal.abstainVotes,
      actions: [{ index: 0, ...proposal.firstAction }],
      createdBlockNumber: fixture.events[0].blockNumber,
      createdTransactionHash: fixture.events[0].transactionHash,
      canceledBlockNumber: null,
      canceledTransactionHash: null,
      queuedBlockNumber: null,
      queuedTransactionHash: null,
      executedBlockNumber: null,
      executedTransactionHash: null,
      lastObservedBlockNumber: proposal.endBlock + 1,
      rawHash: proposal.rawHash,
      firstSeenAt: "2026-09-15T00:00:00.000Z",
      lastSyncedAt: "2026-09-15T00:00:00.000Z",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z"
    } satisfies StoredGovernanceDecision;

    expect(
      formatTelegramGovernanceMessage(
        buildGovernanceLifecycleMessage(decision, "succeeded")
      )
    ).toBe(
      "<b>ON-CHAIN GOVERNANCE VOTE RESULT</b>\n" +
        "Protocol: <b>UNISWAP</b>\n" +
        "Status: Succeeded\n" +
        "Voting ended: 2026-07-25 07:29 UTC\n" +
        "For: 46,604,582.79 UNI (97.33%)\n" +
        "Against: 1,274,746.48 UNI (2.66%)\n" +
        "Abstain: 1,813.59 UNI (0.01%)\n" +
        "Title: Activate v4 Protocol Fees (Part 1/2)\n" +
        "Link: https://vote.uniswapfoundation.org/proposals/100"
    );
  });
});
