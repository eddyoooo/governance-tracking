import type { NotificationMessage } from "../notifications/notification.service.js";

export interface TelegramTestNotificationFixture extends NotificationMessage {
  sourceId: string;
  publishedAt: string;
}

// Real Lido proposal-category records sampled from research.lido.fi for Telegram demos.
export const telegramTestNotificationFixtures: TelegramTestNotificationFixture[] = [
  {
    protocol: "lido",
    sourceType: "forum",
    sourceId: "11624",
    publisherName: "Lido Labs Foundation - Operations Team",
    title: "Lido Labs proposes Nemo as a new director",
    sourceUrl: "https://research.lido.fi/t/lido-labs-proposes-nemo-as-a-new-director/11624",
    publishedAt: "2026-06-04T11:21:25.131Z"
  },
  {
    protocol: "lido",
    sourceType: "forum",
    sourceId: "10894",
    publisherName: "Lido | Finance Team",
    title: "Liquid Buybacks: NEST execution with LDO/wstETH liquidity",
    sourceUrl: "https://research.lido.fi/t/liquid-buybacks-nest-execution-with-ldo-wsteth-liquidity/10894",
    publishedAt: "2025-11-11T09:48:17.677Z"
  },
  {
    protocol: "lido",
    sourceType: "forum",
    sourceId: "11358",
    publisherName: "Lido Ecosystem Foundation - Operations Team",
    title: "Utilizing Market Opportunities: stETH / LDO trade",
    sourceUrl: "https://research.lido.fi/t/utilizing-market-opportunities-steth-ldo-trade/11358",
    publishedAt: "2026-03-27T14:41:43.902Z"
  }
];

export function createTelegramTestNotification(
  overrides: Partial<NotificationMessage> = {}
): NotificationMessage {
  return {
    ...telegramTestNotificationFixtures[0],
    ...overrides
  };
}

export function createTelegramTestNotifications(
  overrides: Partial<NotificationMessage> = {}
): NotificationMessage[] {
  return telegramTestNotificationFixtures.map((fixture) => ({
    ...fixture,
    ...overrides
  }));
}
