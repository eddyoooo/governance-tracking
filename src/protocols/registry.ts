import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { LidoAdapter } from "./lido/lido.adapter.js";
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

  registry.register(
    new LidoAdapter({
      enabled: env.lidoEnabled,
      forumBaseUrl: env.lidoForumBaseUrl,
      forumApiBaseUrl: env.lidoForumApiBaseUrl,
      allowedPublishers: env.lidoAllowedPublishers,
      logger
    })
  );

  return registry;
}
