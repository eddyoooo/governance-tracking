import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { isMemoryMode } from "../config/env.js";
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

  return registry;
}
