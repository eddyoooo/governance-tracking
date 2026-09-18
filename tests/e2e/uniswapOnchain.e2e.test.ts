import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";
import { z } from "zod";
import { loadEnv } from "../../src/config/env.js";
import { UniswapOnchainClient } from "../../src/onchain/uniswap/uniswapOnchain.client.js";
import { errorMessage } from "../../src/utils/errors.js";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const fixtureSchema = z.object({
  observedAtBlock: z.number().int().positive(),
  chainId: z.literal(1),
  governorAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  proposal: z.object({
    id: z.string().regex(/^[1-9]\d*$/),
    proposer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
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
      target: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      value: z.string().regex(/^\d+$/),
      signature: z.string(),
      calldata: z.string().regex(/^0x[0-9a-fA-F]*$/)
    })
  }),
  events: z.array(
    z.object({
      type: z.enum(["created", "queued", "executed"]),
      blockNumber: z.number().int().positive(),
      blockHash: hash,
      transactionHash: hash,
      logIndex: z.number().int().nonnegative()
    })
  ).length(3)
});

const describeLive =
  process.env.RUN_UNISWAP_ONCHAIN_E2E === "true" ? describe : describe.skip;

describeLive("Uniswap on-chain read-only E2E", () => {
  it(
    "validates the configured mainnet source and replays a known complete proposal lifecycle",
    async () => {
      try {
      const env = loadEnv({
        ...process.env,
        NODE_ENV: "test",
        STORAGE_MODE: "memory",
        DEMO_MODE: "false",
        ENABLE_SCHEDULER: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "false",
        ENABLE_ADMIN_STATUS_REPORTS: "false",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
        LOG_LEVEL: "silent"
      });
      if (!env.ethereumRpcUrl) {
        throw new Error(
          "ETHEREUM_RPC_URL is required for the opt-in Uniswap on-chain E2E test."
        );
      }

      const fixture = fixtureSchema.parse(
        JSON.parse(
          await readFile(
            new URL("../fixtures/uniswap/onchain-proposal-100.json", import.meta.url),
            "utf8"
          )
        )
      );
      const client = new UniswapOnchainClient({
        rpcUrl: env.ethereumRpcUrl,
        governorAddress: env.uniswapGovernorAddress,
        timelockAddress: env.uniswapTimelockAddress,
        uniTokenAddress: env.uniswapUniTokenAddress
      });
      const validation = await client.validateSource();

      expect(validation).toMatchObject({
        chainId: fixture.chainId,
        initialProposalId: "8"
      });
      expect(validation.latestFinalizedBlock.number).toBeGreaterThanOrEqual(
        fixture.observedAtBlock
      );
      expect(BigInt(validation.proposalCount)).toBeGreaterThanOrEqual(
        BigInt(fixture.proposal.id)
      );
      expect(BigInt(validation.votingDelay)).toBeGreaterThan(0n);
      expect(BigInt(validation.votingPeriod)).toBeGreaterThan(0n);
      expect(BigInt(validation.proposalThreshold)).toBeGreaterThan(0n);
      expect(BigInt(validation.quorumVotes)).toBeGreaterThan(0n);

      const lifecycleEvents = (
        await Promise.all(
          fixture.events.map((event) =>
            client.getEvents(event.blockNumber, event.blockNumber)
          )
        )
      )
        .flat()
        .filter((event) => event.proposalId === fixture.proposal.id);

      expect(lifecycleEvents).toHaveLength(3);
      expect(lifecycleEvents.map((event) => event.type)).toEqual([
        "created",
        "queued",
        "executed"
      ]);
      for (const expected of fixture.events) {
        expect(lifecycleEvents).toContainEqual(
          expect.objectContaining({
            type: expected.type,
            blockNumber: expected.blockNumber,
            blockHash: expected.blockHash,
            transactionHash: expected.transactionHash,
            logIndex: expected.logIndex
          })
        );
      }

      const decision = await client.getDecision(
        fixture.proposal.id,
        lifecycleEvents,
        null,
        validation.latestFinalizedBlock.number
      );

      expect(decision).toMatchObject({
        proposalId: fixture.proposal.id,
        proposer: fixture.proposal.proposer,
        title: fixture.proposal.title,
        status: fixture.proposal.status,
        voteOutcome: "succeeded",
        executionOutcome: "executed",
        startBlock: fixture.proposal.startBlock,
        endBlock: fixture.proposal.endBlock,
        votingEndedAt: fixture.proposal.votingEndedAt,
        eta: fixture.proposal.eta,
        forVotes: fixture.proposal.forVotes,
        againstVotes: fixture.proposal.againstVotes,
        abstainVotes: fixture.proposal.abstainVotes
      });
      expect(decision.actions).toHaveLength(fixture.proposal.actionCount);
      expect(decision.actions[0]).toMatchObject(fixture.proposal.firstAction);
      expect(decision.lastObservedBlockNumber).toBe(
        validation.latestFinalizedBlock.number
      );
      } catch (error) {
        throw new Error(errorMessage(error));
      }
    },
    120_000
  );
});
