import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import type { RawGovernanceItem } from "../../src/protocols/types.js";

async function loadRawFixture(name: string): Promise<RawGovernanceItem> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/lido/${name}`, import.meta.url), "utf8")
  ) as RawGovernanceItem;
}

describe("Lido normalizer", () => {
  it("normalizes raw forum items into the internal MVP shape", async () => {
    const raw = await loadRawFixture("allowed-publisher-raw.json");
    const normalized = normalizeLidoForumItem(raw);

    expect(normalized).toMatchObject({
      protocol: "lido",
      sourceType: "forum",
      sourceId: "1001",
      title: "Allowed Lido Proposal",
      publisherName: "Allowed Publisher"
    });
    expect(normalized.id).toMatch(/^lido_forum_1001_/);
    expect(normalized.rawHash).toHaveLength(64);
  });

  it("is deterministic for the same protocol/source/raw payload", async () => {
    const raw = await loadRawFixture("allowed-publisher-raw.json");
    const first = normalizeLidoForumItem(raw);
    const second = normalizeLidoForumItem({
      ...raw,
      raw: {
        title: "Allowed Lido Proposal",
        id: 1001
      }
    });

    expect(first.id).toBe(second.id);
    expect(first.rawHash).toBe(second.rawHash);
  });

  it("changes deterministic id when the source id changes", async () => {
    const raw = await loadRawFixture("allowed-publisher-raw.json");
    const first = normalizeLidoForumItem(raw);
    const second = normalizeLidoForumItem({
      ...raw,
      sourceId: "1002"
    });

    expect(first.id).not.toBe(second.id);
  });
});
