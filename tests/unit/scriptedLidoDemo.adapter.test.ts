import { describe, expect, it } from "@jest/globals";
import {
  nonAllowlistedDemoFixture,
  ScriptedLidoDemoAdapter
} from "../../src/demoFixtures/scriptedLidoDemo.adapter.js";
import { telegramTestNotificationFixtures } from "../../src/demoFixtures/telegramNotification.fixture.js";

function createAdapter(): ScriptedLidoDemoAdapter {
  return new ScriptedLidoDemoAdapter({
    allowedPublishers: telegramTestNotificationFixtures.map(
      (fixture) => fixture.publisherName
    ),
    forumBaseUrl: "https://research.lido.fi"
  });
}

describe("ScriptedLidoDemoAdapter", () => {
  it("reveals one allowlisted proposal at a time", async () => {
    const adapter = createAdapter();

    await expect(adapter.fetchRecent()).resolves.toMatchObject([
      {
        sourceId: nonAllowlistedDemoFixture.sourceId,
        publisherName: nonAllowlistedDemoFixture.publisherName
      }
    ]);

    const first = adapter.revealNext();
    expect(first).toMatchObject({
      sourceId: telegramTestNotificationFixtures[0].sourceId
    });

    await expect(adapter.fetchRecent()).resolves.toMatchObject([
      {
        sourceId: telegramTestNotificationFixtures[0].sourceId,
        publisherName: telegramTestNotificationFixtures[0].publisherName
      },
      {
        sourceId: nonAllowlistedDemoFixture.sourceId,
        publisherName: nonAllowlistedDemoFixture.publisherName
      }
    ]);
  });

  it("does not reveal beyond the configured fixture set", () => {
    const adapter = createAdapter();

    for (const fixture of telegramTestNotificationFixtures) {
      expect(adapter.revealNext()).toMatchObject({
        sourceId: fixture.sourceId
      });
    }

    expect(adapter.revealNext()).toBeNull();
  });

  it("can reveal all fixture proposals and normalize them", async () => {
    const adapter = createAdapter();

    adapter.revealAll();

    const items = await adapter.fetchRecent();
    const normalized = adapter.normalize(items[0]);

    expect(items).toHaveLength(telegramTestNotificationFixtures.length + 1);
    expect(items.map((item) => item.sourceId)).toEqual([
      ...telegramTestNotificationFixtures.map((fixture) => fixture.sourceId),
      nonAllowlistedDemoFixture.sourceId
    ]);
    expect(normalized).toMatchObject({
      protocol: "lido",
      sourceType: "forum",
      sourceId: telegramTestNotificationFixtures[0].sourceId
    });
  });
});
