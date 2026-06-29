import { jest } from "@jest/globals";
import type { Logger } from "pino";
import { loadEnv, type Env } from "../../src/config/env.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import type {
  GovernanceSource,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../../src/protocols/types.js";

export function testEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    STORAGE_MODE: "memory",
    DEMO_MODE: "true",
    ENABLE_SCHEDULER: "false",
    LOG_LEVEL: "silent",
    ...overrides
  });
}

export function createSilentLogger(): Logger {
  return {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  } as unknown as Logger;
}

export function createRawGovernanceItem(
  overrides: Partial<RawGovernanceItem> = {}
): RawGovernanceItem {
  return {
    protocol: "lido",
    sourceType: "forum",
    sourceId: "1001",
    title: "Allowed Lido Proposal",
    publisherName: "Allowed Publisher",
    sourceUrl: "https://research.lido.fi/t/allowed-lido-proposal/1001",
    publishedAt: "2026-05-01T10:00:00.000Z",
    fetchedAt: "2026-05-03T10:00:00.000Z",
    raw: {
      id: 1001,
      title: "Allowed Lido Proposal"
    },
    ...overrides
  };
}

export interface FakeProtocolAdapterOptions {
  protocol?: string;
  enabled?: boolean;
  source?: GovernanceSource;
  publisherAllowlist?: string[];
  items?: RawGovernanceItem[];
  fetchRecent?: () => Promise<RawGovernanceItem[]>;
  normalize?: (item: RawGovernanceItem) => NormalizedGovernanceItem;
}

export function createFakeProtocolAdapter(
  options: FakeProtocolAdapterOptions = {}
): ProtocolAdapter {
  const protocol = options.protocol ?? "lido";

  return {
    protocol,
    enabled: options.enabled ?? true,
    source:
      options.source ??
      {
        protocol,
        type: "forum",
        name: "Test Forum",
        baseUrl: "https://example.com"
      },
    publisherAllowlist: options.publisherAllowlist ?? ["Allowed Publisher"],
    fetchRecent:
      options.fetchRecent ??
      jest.fn(async () => options.items ?? [createRawGovernanceItem({ protocol })]),
    normalize: options.normalize ?? normalizeLidoForumItem
  };
}
