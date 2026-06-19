import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";
import {
  filterByPublisherAllowlist,
  matchesPublisherAllowlist,
  normalizePublisherName
} from "../../src/protocols/allowlist.js";
import type { RawGovernanceItem } from "../../src/protocols/types.js";

async function loadRawFixture(name: string): Promise<RawGovernanceItem> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/lido/${name}`, import.meta.url), "utf8")
  ) as RawGovernanceItem;
}

describe("publisher allowlist", () => {
  it("normalizes casing, punctuation, and repeated whitespace", () => {
    expect(normalizePublisherName("  DAO,   Operations!!!  ")).toBe(
      "dao operations"
    );
  });

  it("matches case-insensitive and trimmed publisher names", () => {
    expect(matchesPublisherAllowlist(" allowed publisher ", ["Allowed Publisher"])).toBe(
      true
    );
  });

  it("matches punctuation and small separator differences", () => {
    expect(matchesPublisherAllowlist("DAO Operations", ["DAO-Operations"])).toBe(
      true
    );
  });

  it("matches configured Lido publisher names despite separator differences", () => {
    expect(
      matchesPublisherAllowlist("Lido Finance Team", ["Lido | Finance Team"])
    ).toBe(true);
    expect(
      matchesPublisherAllowlist("lido labs foundation operations team", [
        "Lido Labs Foundation - Operations Team"
      ])
    ).toBe(true);
  });

  it("allows small publisher typos", () => {
    expect(matchesPublisherAllowlist("Allowd Publisher", ["Allowed Publisher"])).toBe(
      true
    );
  });

  it("does not match when the allowlist is empty or blank", () => {
    expect(matchesPublisherAllowlist("Allowed Publisher", [])).toBe(false);
    expect(matchesPublisherAllowlist("Allowed Publisher", ["  "])).toBe(false);
    expect(matchesPublisherAllowlist("   ", ["Allowed Publisher"])).toBe(false);
  });

  it("does not match unrelated publishers", () => {
    expect(matchesPublisherAllowlist("Random Person", ["Allowed Publisher"])).toBe(false);
  });

  it("does not over-match meaningfully different publisher names", () => {
    expect(matchesPublisherAllowlist("Allowed Publisher Labs", ["Allowed Publisher"])).toBe(
      false
    );
  });

  it("does not typo-match very short names", () => {
    expect(matchesPublisherAllowlist("B", ["A"])).toBe(false);
    expect(matchesPublisherAllowlist("ABCD", ["ABCE"])).toBe(false);
    expect(matchesPublisherAllowlist("ABCD", ["ABCD"])).toBe(true);
  });

  it("filters raw governance items into allowed and skipped groups", async () => {
    const allowed = await loadRawFixture("allowed-publisher-raw.json");
    const skipped = await loadRawFixture("non-allowed-publisher-raw.json");
    const result = filterByPublisherAllowlist([allowed, skipped], ["Allowed Publisher"]);

    expect(result.allowed).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.allowed[0].sourceId).toBe("1001");
    expect(result.skipped[0].sourceId).toBe("1002");
  });
});
