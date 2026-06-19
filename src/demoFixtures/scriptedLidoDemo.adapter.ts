import type {
  GovernanceSource,
  NormalizedGovernanceItem,
  ProtocolAdapter,
  RawGovernanceItem
} from "../protocols/types.js";
import { normalizeLidoForumItem } from "../protocols/lido/lido.normalizer.js";
import {
  telegramTestNotificationFixtures,
  type TelegramTestNotificationFixture
} from "./telegramNotification.fixture.js";

const nonAllowlistedDemoFixture: TelegramTestNotificationFixture = {
  protocol: "lido",
  sourceType: "forum",
  sourceId: "11597",
  publisherName: "Vladimir",
  title: "CMv2 Prover Bot Funding",
  sourceUrl: "https://research.lido.fi/t/cmv2-prover-bot-funding/11597",
  publishedAt: "2026-05-28T09:44:50.475Z"
};

export interface ScriptedLidoDemoAdapterOptions {
  allowedPublishers: string[];
  forumBaseUrl: string;
  includeNonAllowlistedItem?: boolean;
}

export class ScriptedLidoDemoAdapter implements ProtocolAdapter {
  readonly protocol = "lido";
  readonly enabled = true;
  readonly source: GovernanceSource;
  readonly publisherAllowlist: string[];
  private visibleAllowlistedCount = 0;
  private readonly includeNonAllowlistedItem: boolean;

  constructor(options: ScriptedLidoDemoAdapterOptions) {
    this.publisherAllowlist = options.allowedPublishers;
    this.includeNonAllowlistedItem = options.includeNonAllowlistedItem ?? true;
    this.source = {
      protocol: this.protocol,
      type: "forum",
      name: "Lido Research Forum",
      baseUrl: options.forumBaseUrl
    };
  }

  get totalAllowlistedFixtures(): number {
    return telegramTestNotificationFixtures.length;
  }

  revealNext(): TelegramTestNotificationFixture | null {
    if (this.visibleAllowlistedCount >= telegramTestNotificationFixtures.length) {
      return null;
    }

    const fixture = telegramTestNotificationFixtures[this.visibleAllowlistedCount];
    this.visibleAllowlistedCount += 1;

    return fixture;
  }

  revealAll(): void {
    this.visibleAllowlistedCount = telegramTestNotificationFixtures.length;
  }

  async fetchRecent(): Promise<RawGovernanceItem[]> {
    const fetchedAt = new Date().toISOString();
    const visibleFixtures = telegramTestNotificationFixtures.slice(
      0,
      this.visibleAllowlistedCount
    );
    const fixtures = this.includeNonAllowlistedItem
      ? [...visibleFixtures, nonAllowlistedDemoFixture]
      : visibleFixtures;

    return fixtures.map((fixture) => this.toRawGovernanceItem(fixture, fetchedAt));
  }

  normalize(item: RawGovernanceItem): NormalizedGovernanceItem {
    return normalizeLidoForumItem(item);
  }

  private toRawGovernanceItem(
    fixture: TelegramTestNotificationFixture,
    fetchedAt: string
  ): RawGovernanceItem {
    return {
      protocol: fixture.protocol,
      sourceType: "forum",
      sourceId: fixture.sourceId,
      title: fixture.title,
      publisherName: fixture.publisherName,
      sourceUrl: fixture.sourceUrl,
      publishedAt: fixture.publishedAt,
      fetchedAt,
      raw: {
        topic: {
          id: Number(fixture.sourceId),
          title: fixture.title,
          created_at: fixture.publishedAt
        },
        publisher: {
          name: fixture.publisherName
        }
      }
    };
  }
}

export { nonAllowlistedDemoFixture };
