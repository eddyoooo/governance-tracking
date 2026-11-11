import { describe, expect, it, jest } from "@jest/globals";
import { AaveOnchainGovernanceAdapter } from "../../src/onchain/aave/aaveOnchain.adapter.js";
import { aaveRpcFixture } from "../helpers/aaveBuilders.js";
import { testEnv } from "../helpers/builders.js";

describe("AaveOnchainGovernanceAdapter", () => {
  it("forwards finalized reads and historical metadata options to its isolated client", async () => {
    const { client, rpc, block } = aaveRpcFixture();
    const adapter = new AaveOnchainGovernanceAdapter(testEnv(), client);
    const decisionRead = jest.spyOn(client, "getDecision");
    await expect(adapter.validateSource()).resolves.toMatchObject({ proposalIdScheme: "zero-based-count" });
    await expect(adapter.getBlock(block)).resolves.toMatchObject({ number: block });
    await expect(adapter.getEvents(block, block)).resolves.toEqual([]);
    const observation = await adapter.getDecision("0", [], null, block, { historical: true });
    expect(observation).toMatchObject({ proposalId: "0", protocol: "aave", status: "pending" });
    expect(decisionRead).toHaveBeenCalledWith("0", [], null, block, { historical: true });
    expect(rpc.getLogs).toHaveBeenCalledWith(expect.objectContaining({
      address: adapter.contractAddress, fromBlock: BigInt(block), toBlock: BigInt(block)
    }));
    expect(adapter).toMatchObject({ enabled: false, notificationsEnabled: false, maxLogBlockRange: 10_000 });
  });

  it("propagates provider failures rather than converting them into empty successful pages", async () => {
    const { client, block } = aaveRpcFixture();
    const adapter = new AaveOnchainGovernanceAdapter(testEnv(), client);
    const error = new Error("Provider unavailable");
    jest.spyOn(client, "getEvents").mockRejectedValueOnce(error);
    await expect(adapter.getEvents(block, block)).rejects.toBe(error);
  });
});
