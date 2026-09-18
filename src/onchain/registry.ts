import type { Env } from "../config/env.js";
import type { EvmGovernanceAdapter } from "./types.js";
import { UniswapOnchainGovernanceAdapter } from "./uniswap/uniswapOnchain.adapter.js";

export class EvmGovernanceRegistry {
  private readonly adapters: Map<string, EvmGovernanceAdapter>;

  constructor(adapters: EvmGovernanceAdapter[]) {
    this.adapters = new Map();
    const sourceKeys = new Set<string>();

    for (const adapter of adapters) {
      const protocol = adapter.protocol.trim().toLowerCase();

      if (!protocol) {
        throw new Error("On-chain governance adapter protocol cannot be blank.");
      }
      if (this.adapters.has(protocol)) {
        throw new Error(
          `Duplicate on-chain governance adapter registered for protocol: ${protocol}`
        );
      }
      assertAdapterConfiguration(adapter);
      if (sourceKeys.has(adapter.sourceKey)) {
        throw new Error(
          `Duplicate on-chain governance source key registered: ${adapter.sourceKey}`
        );
      }

      this.adapters.set(protocol, adapter);
      sourceKeys.add(adapter.sourceKey);
    }
  }

  get(protocol: string): EvmGovernanceAdapter | undefined {
    return this.adapters.get(protocol.trim().toLowerCase());
  }

  list(): EvmGovernanceAdapter[] {
    return [...this.adapters.values()];
  }
}

function assertAdapterConfiguration(adapter: EvmGovernanceAdapter): void {
  if (!adapter.sourceKey.trim()) {
    throw new Error("On-chain governance adapter source key cannot be blank.");
  }
  if (!Number.isSafeInteger(adapter.chainId) || adapter.chainId <= 0) {
    throw new Error("On-chain governance adapter chain id must be positive.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(adapter.contractAddress)) {
    throw new Error("On-chain governance adapter contract address is invalid.");
  }
  if (!Number.isSafeInteger(adapter.deploymentBlock) || adapter.deploymentBlock <= 0) {
    throw new Error("On-chain governance adapter deployment block must be positive.");
  }
  if (!Number.isSafeInteger(adapter.maxLogBlockRange) || adapter.maxLogBlockRange <= 0) {
    throw new Error("On-chain governance adapter log block range must be positive.");
  }
  if (
    !Number.isSafeInteger(adapter.reorgOverlapBlocks) ||
    adapter.reorgOverlapBlocks < 0
  ) {
    throw new Error(
      "On-chain governance adapter reorg overlap must be a non-negative safe integer."
    );
  }
}

export function createEvmGovernanceRegistry(env: Env): EvmGovernanceRegistry {
  const adapters: EvmGovernanceAdapter[] = [];

  if (env.uniswapOnchainEnabled) {
    adapters.push(new UniswapOnchainGovernanceAdapter(env));
  }

  return new EvmGovernanceRegistry(adapters);
}
