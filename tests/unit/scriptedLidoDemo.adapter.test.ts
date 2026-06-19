import { describe, expect, it } from "@jest/globals";
import {
  nonAllowlistedDemoFixture,
  ScriptedLidoDemoAdapter
} from "../../src/demoFixtures/scriptedLidoDemo.adapter.js";
import { telegramTestNotificationFixtures } from "../../src/demoFixtures/telegramNotification.fixture.js";

const lidoTelegramFixtures = telegramTestNotificationFixtures.filter(
  (fixture) => fixture.protocol === "lido"
);

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
      sourceId: lidoTelegramFixtures[0].sourceId
    });

    await expect(adapter.fetchRecent()).resolves.toMatchObject([
      {
        sourceId: lidoTelegramFixtures[0].sourceId,
        publisherName: lidoTelegramFixtures[0].publisherName
      },
      {
        sourceId: nonAllowlistedDemoFixture.sourceId,
        publisherName: nonAllowlistedDemoFixture.publisherName
      }
    ]);
  });

  it("does not reveal beyond the configured fixture set", () => {
    const adapter = createAdapter();

    for (const fixture of lidoTelegramFixtures) {
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

    expect(items).toHaveLength(lidoTelegramFixtures.length + 1);
    expect(items.map((item) => item.sourceId)).toEqual([
      ...lidoTelegramFixtures.map((fixture) => fixture.sourceId),
      nonAllowlistedDemoFixture.sourceId
    ]);
    expect(normalized).toMatchObject({
      protocol: "lido",
      sourceType: "forum",
      sourceId: lidoTelegramFixtures[0].sourceId
    });
  });
});
