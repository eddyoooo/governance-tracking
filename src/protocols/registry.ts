import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { isMemoryMode } from "../config/env.js";
import { AaveAdapter } from "./aave/aave.adapter.js";
import { createAaveDemoClient } from "./aave/aave.demoClient.js";
import { LidoAdapter } from "./lido/lido.adapter.js";
import { createLidoDemoClient } from "./lido/lido.demoClient.js";
import type { ProtocolAdapter } from "./types.js";

export class ProtocolRegistry {
  private readonly adapters = new Map<string, ProtocolAdapter>();

  register(adapter: ProtocolAdapter): void {
    this.adapters.set(adapter.protocol, adapter);
  }

  get(protocol: string): ProtocolAdapter | undefined {
    return this.adapters.get(protocol);
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

  return registry;
}
