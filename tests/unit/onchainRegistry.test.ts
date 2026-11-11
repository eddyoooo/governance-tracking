import { describe, expect, it, jest } from "@jest/globals";
import { encodeFunctionResult } from "viem";
import { AAVE_GOVERNANCE_ABI } from "../../src/onchain/aave/aaveGovernance.abi.js";
import { aaveRawProposal } from "../helpers/aaveBuilders.js";
import {
  createEvmGovernanceRegistry,
  EvmGovernanceRegistry
} from "../../src/onchain/registry.js";
import { createSilentLogger, testEnv } from "../helpers/builders.js";
import {
  createFakeEvmGovernanceAdapter,
  TEST_GOVERNOR_ADDRESS
} from "../helpers/onchainBuilders.js";

describe("EvmGovernanceRegistry", () => {
  it("wires production metadata failures to the application logger without disrupting tracking", async () => {
    const logger = createSilentLogger();
    const encoded = encodeFunctionResult({ abi: AAVE_GOVERNANCE_ABI, functionName: "getProposal",
      result: { ...aaveRawProposal(), cancellationFee: 0n } as never });
    const spy = jest.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      if (String(url).startsWith("https://rpc.example.invalid")) {
        const request = JSON.parse(options!.body as string);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: encoded }),
          { headers: { "content-type": "application/json" } });
      }
      throw new Error("Mock metadata gateway unavailable");
    });
    try {
      const registry = createEvmGovernanceRegistry(testEnv({
        AAVE_ONCHAIN_ENABLED: "true", ETHEREUM_RPC_URL: "https://rpc.example.invalid"
      }), logger);
      await expect(registry.get("aave")!.getDecision("0", [], null, 18_119_325))
        .resolves.toMatchObject({ protocol: "aave", title: "Aave governance proposal #0" });
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "0" }),
        "Aave metadata unavailable; retaining on-chain identity and proposal link");
    } finally { spy.mockRestore(); }
  });
  it("registers Aave independently or alongside Uniswap without sharing identities", () => {
    const env = testEnv({ ETHEREUM_RPC_URL: "https://example.invalid/rpc", AAVE_ONCHAIN_ENABLED: "true" });
    const aave = createEvmGovernanceRegistry(env).get(" AAVE ");
    expect(aave).toMatchObject({ protocol: "aave", chainId: 1,
      contractAddress: "0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7",
      deploymentBlock: 18_119_225, proposalIdScheme: "zero-based-count", enabled: true });
    const both = createEvmGovernanceRegistry({ ...env, uniswapOnchainEnabled: true });
    expect(both.list()).toHaveLength(2);
    expect(both.get("aave")?.sourceKey).not.toBe(both.get("uniswap")?.sourceKey);
  });
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
