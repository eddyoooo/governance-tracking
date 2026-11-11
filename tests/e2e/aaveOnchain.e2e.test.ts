import { describe, expect, it } from "@jest/globals";
import { loadEnv } from "../../src/config/env.js";
import { AaveOnchainClient } from "../../src/onchain/aave/aaveOnchain.client.js";
import { aaveOnchainEventFixtures, aaveOnchainProposalFixture } from "../../src/demoFixtures/aaveOnchain.fixture.js";
import { errorMessage } from "../../src/utils/errors.js";

const describeLive = process.env.RUN_AAVE_ONCHAIN_E2E === "true" ? describe : describe.skip;
describeLive("Aave Governance V3 read-only mainnet E2E", () => {
  it("validates Governance V3 and independently replays real proposal zero's canonical lifecycle", async () => {
    try {
      const env = loadEnv({ ...process.env, STORAGE_MODE: "memory", ENABLE_SCHEDULER: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "false", ENABLE_ADMIN_STATUS_REPORTS: "false",
        AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "false", UNISWAP_ONCHAIN_ENABLED: "false",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false" });
      if (!env.ethereumRpcUrl) throw new Error("ETHEREUM_RPC_URL is required.");
      const client = new AaveOnchainClient({ rpcUrl: env.ethereumRpcUrl, metadataEnabled: false });
      const validation = await client.validateSource();
      expect(validation.proposalIdScheme).toBe("zero-based-count");
      const events = (await Promise.all(aaveOnchainEventFixtures.map((event) => client.getEvents(event.blockNumber, event.blockNumber))))
        .flat().filter((event) => event.proposalId === "0");
      for (const event of aaveOnchainEventFixtures) {
        expect(events).toContainEqual(expect.objectContaining(event));
        expect((await client.getBlock(event.blockNumber)).hash.toLowerCase()).toBe(event.blockHash.toLowerCase());
      }
      const decision = await client.getDecision("0", events, null, validation.latestFinalizedBlock.number);
      expect(decision).toMatchObject({ proposalId: "0", status: "executed", voteOutcome: "succeeded",
        forVotes: aaveOnchainProposalFixture.forVotes.toString(), againstVotes: "0",
        aave: { executionScope: "governance-core", resultReceivedAt: "2024-01-09T21:41:11.000Z" } });
      expect(decision.aave?.payloads).toEqual(aaveOnchainProposalFixture.payloads.map((payload) => ({
        ...payload,
        chain: payload.chain.toString(),
        payloadId: payload.payloadId.toString()
      })));
    } catch (error) { throw new Error(errorMessage(error)); }
  }, 120_000);
});
