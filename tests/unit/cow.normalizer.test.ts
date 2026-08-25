import { describe, expect, it } from "@jest/globals";
import { normalizeCowForumItem } from "../../src/protocols/cow/cow.normalizer.js";
import { createRawGovernanceItem } from "../helpers/builders.js";

describe("CoW normalizer", () => {
  const raw = createRawGovernanceItem({
    protocol: "cow",
    sourceId: "3527",
    title: "CoW DAO Monthly Recap: July 2026",
    publisherName: "MooKeeper",
    sourceUrl: "https://forum.cow.fi/t/cow-dao-monthly-recap-july-2026/3527",
    publishedAt: "2026-08-04T12:47:10.847Z",
    fetchedAt: "2026-08-05T08:00:00.000Z",
    raw: {
      topic: { id: 3527 },
      publisher: { username: "moo_keeper", name: "MooKeeper" }
    }
  });

  it("normalizes the common proposal shape with a deterministic CoW id", () => {
    const normalized = normalizeCowForumItem(raw);

    expect(normalized).toMatchObject({
      id: expect.stringMatching(/^cow_forum_3527_[a-f0-9]{10}$/),
      protocol: "cow",
      sourceType: "forum",
      sourceId: "3527",
      title: "CoW DAO Monthly Recap: July 2026",
      publisherName: "MooKeeper"
    });
    expect(normalized.rawHash).toHaveLength(64);
  });

  it("keeps identity stable across source-content changes", () => {
    const original = normalizeCowForumItem(raw);
    const changed = normalizeCowForumItem({ ...raw, title: `${raw.title} updated` });

    expect(changed.id).toBe(original.id);
    expect(changed.rawHash).not.toBe(original.rawHash);
  });

  it("ignores volatile Discourse activity counters in the source hash", () => {
    const first = normalizeCowForumItem({
      ...raw,
      raw: { topic: { id: 3527, views: 10, reply_count: 1 } }
    });
    const second = normalizeCowForumItem({
      ...raw,
      raw: { topic: { id: 3527, views: 999, reply_count: 20 } }
    });

    expect(first.rawHash).toBe(second.rawHash);
  });
});
