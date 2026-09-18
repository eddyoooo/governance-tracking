import { describe, expect, it } from "@jest/globals";
import {
  ScriptedUniswapOnchainDemoAdapter,
  UNISWAP_PROPOSAL_100_CAPTURED_ACTION_COUNT
} from "../../src/demoFixtures/scriptedUniswapOnchainDemo.adapter.js";

describe("ScriptedUniswapOnchainDemoAdapter", () => {
  it("replays the real proposal 100 lifecycle without network access", async () => {
    const adapter = new ScriptedUniswapOnchainDemoAdapter(false);

    await expect(adapter.validateSource()).resolves.toMatchObject({
      proposalCount: "99",
      initialProposalId: "99",
      latestFinalizedBlock: { number: 25_554_833 }
    });
    await expect(
      adapter.getEvents(adapter.deploymentBlock, adapter.deploymentBlock)
    ).resolves.toEqual([]);

    adapter.revealCreation();
    const createdEvents = await adapter.getEvents(25_554_834, 25_554_834);
    const created = await adapter.getDecision(
      "100",
      createdEvents,
      null,
      25_554_834
    );

    expect(created).toMatchObject({
      proposalId: "100",
      title: "Activate v4 Protocol Fees (Part 1/2)",
      status: "pending",
      forVotes: "0",
      votingEndedAt: undefined,
      createdBlockNumber: 25_554_834
    });
    expect(createdEvents.map((event) => event.type)).toEqual(["created"]);

    adapter.revealExecution();
    const lifecycle = await adapter.getEvents(25_554_835, 25_622_665);
    const executed = await adapter.getDecision(
      "100",
      lifecycle,
      null,
      25_622_665
    );

    expect(lifecycle.map((event) => event.type)).toEqual(["queued", "executed"]);
    expect(executed).toMatchObject({
      status: "executed",
      voteOutcome: "succeeded",
      executionOutcome: "executed",
      votingEndedAt: "2026-07-25T07:29:47.000Z",
      forVotes: "46604582791345472235524184",
      againstVotes: "1274746482273310161174620",
      abstainVotes: "1813590659889870399210",
      queuedBlockNumber: 25_608_297,
      queuedTransactionHash:
        "0xe6499cc2e740c9548ac28cafea1e235fc6c9f305e444c2b412124fa066748d90",
      executedBlockNumber: 25_622_665,
      executedTransactionHash:
        "0x451b7fd02b38fbd8cf8ed52cbaf6c87c12322fe078f08e5f3b26b059266e4604"
    });
    expect(UNISWAP_PROPOSAL_100_CAPTURED_ACTION_COUNT).toBe(7);
    expect(executed.actions).toHaveLength(1);
    expect(executed.rawHash).not.toBe(created.rawHash);
  });

  it("never enables customer delivery unless the demo explicitly requests it", () => {
    expect(new ScriptedUniswapOnchainDemoAdapter(false).notificationsEnabled).toBe(
      false
    );
    expect(new ScriptedUniswapOnchainDemoAdapter(true).notificationsEnabled).toBe(
      true
    );
  });

  it("rejects proposal ids outside the saved demo slice", async () => {
    const adapter = new ScriptedUniswapOnchainDemoAdapter(false);
    adapter.revealCreation();

    await expect(adapter.getDecision("99", [], null, 1)).rejects.toThrow(
      "Unknown scripted Uniswap proposal: 99"
    );
  });
});
