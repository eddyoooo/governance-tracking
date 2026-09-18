import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { isMemoryMode } from "../config/env.js";
import { AaveAdapter } from "./aave/aave.adapter.js";
import { createAaveDemoClient } from "./aave/aave.demoClient.js";
import { LidoAdapter } from "./lido/lido.adapter.js";
import { createLidoDemoClient } from "./lido/lido.demoClient.js";
import { UniswapAdapter } from "./uniswap/uniswap.adapter.js";
import { createUniswapDemoClient } from "./uniswap/uniswap.demoClient.js";
import { CowAdapter } from "./cow/cow.adapter.js";
import { createCowDemoClient } from "./cow/cow.demoClient.js";
import type { ProtocolAdapter } from "./types.js";

export class ProtocolRegistry {
  private readonly adapters = new Map<string, ProtocolAdapter>();

  register(adapter: ProtocolAdapter): void {
    const protocol = adapter.protocol.trim().toLowerCase();

    if (!protocol) {
      throw new Error("Protocol adapter protocol cannot be blank.");
    }
    if (this.adapters.has(protocol)) {
      throw new Error(`Duplicate protocol adapter registered for protocol: ${protocol}`);
    }

    this.adapters.set(protocol, adapter);
  }

  get(protocol: string): ProtocolAdapter | undefined {
    return this.adapters.get(protocol.trim().toLowerCase());
  }

  list(): ProtocolAdapter[] {
    return [...this.adapters.values()];
  }
}

export function createProtocolRegistry(env: Env, logger: Logger): ProtocolRegistry {
  const registry = new ProtocolRegistry();
  const lidoClient = isMemoryMode(env)
    ? createLidoDemoClient({
        forumBaseUrl: env.lidoForumBaseUrl,
        forumApiBaseUrl: env.lidoForumApiBaseUrl,
        logger
      })
    : undefined;
  const aaveClient = isMemoryMode(env)
    ? createAaveDemoClient({
        forumBaseUrl: env.aaveForumBaseUrl,
        forumApiBaseUrl: env.aaveForumApiBaseUrl,
        logger
      })
    : undefined;
  const uniswapClient = isMemoryMode(env)
    ? createUniswapDemoClient({
        forumBaseUrl: env.uniswapForumBaseUrl,
        forumApiBaseUrl: env.uniswapForumApiBaseUrl,
        logger
      })
    : undefined;
  const cowClient = isMemoryMode(env)
    ? createCowDemoClient({
        forumBaseUrl: env.cowForumBaseUrl,
        forumApiBaseUrl: env.cowForumApiBaseUrl,
        logger
      })
    : undefined;

  registry.register(
    new LidoAdapter({
      enabled: env.lidoEnabled,
      forumBaseUrl: env.lidoForumBaseUrl,
      forumApiBaseUrl: env.lidoForumApiBaseUrl,
      allowedPublishers: env.lidoAllowedPublishers,
      maxPages: env.lidoFetchMaxPages,
      logger,
      client: lidoClient
    })
  );
  registry.register(
    new AaveAdapter({
      enabled: env.aaveEnabled,
      forumBaseUrl: env.aaveForumBaseUrl,
      forumApiBaseUrl: env.aaveForumApiBaseUrl,
      allowedPublishers: env.aaveAllowedPublishers,
      maxPages: env.aaveFetchMaxPages,
      categoryMaxPages: env.aaveCategoryFetchMaxPages,
      logger,
      client: aaveClient
    })
  );
  registry.register(
    new UniswapAdapter({
      enabled: env.uniswapEnabled,
      forumBaseUrl: env.uniswapForumBaseUrl,
      forumApiBaseUrl: env.uniswapForumApiBaseUrl,
      allowedPublishers: env.uniswapAllowedPublishers,
      maxPages: env.uniswapFetchMaxPages,
      categoryMaxPages: env.uniswapCategoryFetchMaxPages,
      logger,
      client: uniswapClient
    })
  );
  registry.register(
    new CowAdapter({
      enabled: env.cowEnabled,
      forumBaseUrl: env.cowForumBaseUrl,
      forumApiBaseUrl: env.cowForumApiBaseUrl,
      allowedPublishers: env.cowAllowedPublishers,
      maxPages: env.cowFetchMaxPages,
      categoryMaxPages: env.cowCategoryFetchMaxPages,
      logger,
      client: cowClient
    })
  );

  return registry;
}
