import { describe, expect, it, jest } from "@jest/globals";
import { UniswapOnchainGovernanceAdapter } from "../../src/onchain/uniswap/uniswapOnchain.adapter.js";
import { testEnv } from "../helpers/builders.js";
import {
  createGovernanceContractEvent,
  createGovernanceObservation,
  createStoredGovernanceDecision,
  TEST_GOVERNOR_ADDRESS,
  TEST_IMPLEMENTATION_ADDRESS,
  TEST_SOURCE_KEY,
  testBlockHash
} from "../helpers/onchainBuilders.js";

describe("UniswapOnchainGovernanceAdapter", () => {
  it("exposes source configuration and delegates every chain operation", async () => {
    const validation = {
      chainId: 1,
      latestFinalizedBlock: {
        number: 200,
        hash: testBlockHash(200),
        timestamp: "2026-09-01T00:00:00.000Z"
      },
      implementationAddress: TEST_IMPLEMENTATION_ADDRESS,
      proposalCount: "1",
      initialProposalId: "0",
      votingDelay: "13140",
      votingPeriod: "40320",
      proposalThreshold: "1000000000000000000000000",
      quorumVotes: "40000000000000000000000000"
    };
    const block = validation.latestFinalizedBlock;
    const events = [createGovernanceContractEvent()];
    const observation = createGovernanceObservation();
    const existing = createStoredGovernanceDecision();
    const client = {
      sourceKey: TEST_SOURCE_KEY,
      governorAddress: TEST_GOVERNOR_ADDRESS,
      validateSource: jest.fn(async () => validation),
      getBlock: jest.fn(async () => block),
      getEvents: jest.fn(async () => events),
      getDecision: jest.fn(async () => observation)
    };
    const adapter = new UniswapOnchainGovernanceAdapter(
      testEnv({
        ETHEREUM_RPC_URL: "https://example.com/rpc",
        UNISWAP_ONCHAIN_ENABLED: "true",
        UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "true",
        ENABLE_TELEGRAM_NOTIFICATIONS: "true"
      }),
      client as never
    );

    expect(adapter).toMatchObject({
      sourceKey: TEST_SOURCE_KEY,
      protocol: "uniswap",
      sourceType: "onchain",
      chainId: 1,
      contractAddress: TEST_GOVERNOR_ADDRESS,
      deploymentBlock: 13_059_157,
      maxLogBlockRange: 10_000,
      reorgOverlapBlocks: 64,
      enabled: true,
      notificationsEnabled: true
    });
    await expect(adapter.validateSource()).resolves.toBe(validation);
    await expect(adapter.getBlock(200)).resolves.toBe(block);
    await expect(adapter.getEvents(100, 200)).resolves.toBe(events);
    await expect(
      adapter.getDecision("1", events, existing, 200)
    ).resolves.toBe(observation);
    expect(client.getBlock).toHaveBeenCalledWith(200);
    expect(client.getEvents).toHaveBeenCalledWith(100, 200);
    expect(client.getDecision).toHaveBeenCalledWith("1", events, existing, 200);
  });
});
