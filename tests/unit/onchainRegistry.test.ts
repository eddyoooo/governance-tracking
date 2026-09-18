import { describe, expect, it } from "@jest/globals";
import {
  createEvmGovernanceRegistry,
  EvmGovernanceRegistry
} from "../../src/onchain/registry.js";
import { testEnv } from "../helpers/builders.js";
import {
  createFakeEvmGovernanceAdapter,
  TEST_GOVERNOR_ADDRESS
} from "../helpers/onchainBuilders.js";

describe("EvmGovernanceRegistry", () => {
  it("normalizes protocol lookup", () => {
    const first = createFakeEvmGovernanceAdapter().adapter;
    const registry = new EvmGovernanceRegistry([first]);

    expect(registry.list()).toEqual([first]);
    expect(registry.get(" UNISWAP ")).toBe(first);
    expect(registry.get("aave")).toBeUndefined();
  });

  it("rejects duplicate and blank protocol registrations", () => {
    const first = createFakeEvmGovernanceAdapter().adapter;
    const duplicate = { ...createFakeEvmGovernanceAdapter().adapter };
    const blank = { ...first, protocol: "   " };

    expect(() => new EvmGovernanceRegistry([first, duplicate])).toThrow(
      "Duplicate on-chain governance adapter registered for protocol: uniswap"
    );
    expect(() => new EvmGovernanceRegistry([blank])).toThrow(
      "adapter protocol cannot be blank"
    );
  });

  it("rejects duplicate source keys even when protocol names differ", () => {
    const first = createFakeEvmGovernanceAdapter().adapter;
    const second = { ...first, protocol: "aave" };

    expect(() => new EvmGovernanceRegistry([first, second])).toThrow(
      `Duplicate on-chain governance source key registered: ${first.sourceKey}`
    );
  });

  it.each([
    ["source key", { sourceKey: "   " }, "source key cannot be blank"],
    ["chain id", { chainId: 0 }, "chain id must be positive"],
    [
      "unsafe chain id",
      { chainId: Number.MAX_SAFE_INTEGER + 1 },
      "chain id must be positive"
    ],
    ["contract", { contractAddress: "0xbad" }, "contract address is invalid"],
    ["deployment", { deploymentBlock: 0 }, "deployment block must be positive"],
    ["log range", { maxLogBlockRange: 0 }, "log block range must be positive"],
    [
      "overlap",
      { reorgOverlapBlocks: -1 },
      "reorg overlap must be a non-negative safe integer"
    ],
    [
      "unsafe overlap",
      { reorgOverlapBlocks: Number.MAX_SAFE_INTEGER + 1 },
      "reorg overlap must be a non-negative safe integer"
    ]
  ] as const)(
    "rejects malformed adapter %s configuration",
    (_name, override, message) => {
      const adapter = {
        ...createFakeEvmGovernanceAdapter().adapter,
        ...override
      };

      expect(() => new EvmGovernanceRegistry([adapter])).toThrow(message);
    }
  );

  it("does not instantiate an RPC client when on-chain governance is disabled", () => {
    const registry = createEvmGovernanceRegistry(testEnv());

    expect(registry.list()).toEqual([]);
  });

  it("registers the configured Uniswap mainnet source when enabled", () => {
    const registry = createEvmGovernanceRegistry(
      testEnv({
        ETHEREUM_RPC_URL: "https://example.com/rpc",
        UNISWAP_ONCHAIN_ENABLED: "true"
      })
    );

    expect(registry.get("uniswap")).toMatchObject({
      protocol: "uniswap",
      sourceType: "onchain",
      chainId: 1,
      contractAddress: TEST_GOVERNOR_ADDRESS,
      deploymentBlock: 13_059_157,
      maxLogBlockRange: 10_000,
      reorgOverlapBlocks: 64,
      enabled: true,
      notificationsEnabled: false
    });
  });
});
