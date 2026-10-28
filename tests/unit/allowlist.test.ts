import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";
import {
  filterByPublisherAllowlist,
  filterByPublisherPolicy,
  getPublisherAliases,
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

  it("matches real Aave publisher usernames without broadening short handles", () => {
    const aaveAllowlist = [
      "LlamaRisk",
      "TokenLogic",
      "Certora",
      "kpk",
      "karpatkey_TokenLogic",
      "AaveLabs",
      "stani"
    ];

    expect(matchesPublisherAllowlist("llamarisk", aaveAllowlist)).toBe(true);
    expect(matchesPublisherAllowlist("TokenLogic", aaveAllowlist)).toBe(true);
    expect(matchesPublisherAllowlist("Certora", aaveAllowlist)).toBe(true);
    expect(matchesPublisherAllowlist("KPK", aaveAllowlist)).toBe(true);
    expect(matchesPublisherAllowlist("karpatkey_TokenLogic", aaveAllowlist)).toBe(
      true
    );
    expect(matchesPublisherAllowlist("AaveLabs", aaveAllowlist)).toBe(true);
    expect(matchesPublisherAllowlist("stani", aaveAllowlist)).toBe(true);

    expect(matchesPublisherAllowlist("kp", aaveAllowlist)).toBe(false);
    expect(matchesPublisherAllowlist("karpatkey", aaveAllowlist)).toBe(false);
    expect(matchesPublisherAllowlist("Aave Grants DAO", aaveAllowlist)).toBe(false);
  });

  it("matches the canonical Uniswap Labs forum account without matching unrelated Labs accounts", () => {
    const uniswapAllowlist = [
      "haydenadams",
      "eek637",
      "devinwalsh",
      "kenneth",
      "nataliara",
      "GFXlabs",
      "UniswapFoundation",
      "UniswapLabs"
    ];

    expect(matchesPublisherAllowlist("UniswapLabs", uniswapAllowlist)).toBe(true);
    expect(matchesPublisherAllowlist("uniswaplabs", uniswapAllowlist)).toBe(true);
    expect(matchesPublisherAllowlist("Uniswap Labs", uniswapAllowlist)).toBe(
      true
    );
    expect(matchesPublisherAllowlist("UniswapFoundation", uniswapAllowlist)).toBe(
      true
    );
    expect(matchesPublisherAllowlist("OtherSwapLabs", uniswapAllowlist)).toBe(
      false
    );
  });

  it("matches every verified CoW publisher username without retaining removed authors", () => {
    const cowAllowlist = [
      "notsoformal",
      "Kowrigan",
      "harisang",
      "felixhenneke",
      "KPK"
    ];

    for (const publisher of cowAllowlist) {
      expect(matchesPublisherAllowlist(publisher, cowAllowlist)).toBe(true);
      expect(
        matchesPublisherAllowlist(publisher.toLowerCase(), cowAllowlist)
      ).toBe(true);
    }

    expect(matchesPublisherAllowlist("moo_keeper", cowAllowlist)).toBe(false);
    expect(matchesPublisherAllowlist("middleway.eth", cowAllowlist)).toBe(false);
    expect(matchesPublisherAllowlist("KPK Research", cowAllowlist)).toBe(false);
  });

  it("extracts stable Discourse username aliases from raw publisher payloads", () => {
    const item: RawGovernanceItem = {
      protocol: "uniswap",
      sourceType: "forum",
      sourceId: "25250",
      title: "Uniswap Unleashed",
      publisherName: "Devin",
      sourceUrl: "https://gov.uniswap.org/t/example/25250",
      publishedAt: "2025-02-14T02:58:56.949Z",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      raw: {
        publisher: {
          username: "devinwalsh",
          name: "Devin"
        }
      }
    };

    expect(getPublisherAliases(item)).toEqual(["Devin", "devinwalsh"]);
    expect(filterByPublisherAllowlist([item], ["devinwalsh"]).allowed).toEqual([
      item
    ]);
    expect(filterByPublisherAllowlist([item], ["random"]).skipped).toEqual([item]);
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

  it("allows an original poster through an explicitly configured trust-level policy", () => {
    const leader = {
      protocol: "lido",
      sourceType: "forum",
      sourceId: "11987",
      title: "Unveiling Lido Lend: Security-First Lending",
      publisherName: "Izzy",
      publisherTrustLevel: 4,
      sourceUrl:
        "https://research.lido.fi/t/unveiling-lido-lend-security-first-lending/11987",
      publishedAt: "2026-10-27T08:00:00.000Z",
      fetchedAt: "2026-10-28T08:00:00.000Z",
      raw: {}
    } satisfies RawGovernanceItem;

    expect(
      filterByPublisherPolicy([leader], {
        publisherAllowlist: ["Different Publisher"],
        publisherTrustLevelAllowlist: [4]
      }).allowed
    ).toEqual([leader]);
    expect(
      filterByPublisherPolicy([leader], {
        publisherAllowlist: ["Different Publisher"]
      }).skipped
    ).toEqual([leader]);
  });

  it("does not broaden trust-level matching below the configured level", () => {
    const regular = {
      protocol: "lido",
      sourceType: "forum",
      sourceId: "11988",
      title: "Regular author topic",
      publisherName: "Regular Author",
      publisherTrustLevel: 3,
      sourceUrl: "https://research.lido.fi/t/regular-author-topic/11988",
      publishedAt: "2026-10-27T08:00:00.000Z",
      fetchedAt: "2026-10-28T08:00:00.000Z",
      raw: {}
    } satisfies RawGovernanceItem;

    const result = filterByPublisherPolicy([regular], {
      publisherAllowlist: [],
      publisherTrustLevelAllowlist: [4]
    });

    expect(result.allowed).toEqual([]);
    expect(result.skipped).toEqual([regular]);
  });
});
