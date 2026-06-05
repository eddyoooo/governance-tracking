import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import type { RawGovernanceItem } from "../../src/protocols/types.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { createRawGovernanceItem } from "../helpers/builders.js";

async function loadRawFixture(name: string): Promise<RawGovernanceItem> {
  return JSON.parse(
    await readFile(new URL(`../fixtures/lido/${name}`, import.meta.url), "utf8")
  ) as RawGovernanceItem;
}

describe("MemoryProposalRepository", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("upserts proposals by deterministic id", async () => {
    const repository = new MemoryProposalRepository();
    const raw = await loadRawFixture("allowed-publisher-raw.json");
    const normalized = normalizeLidoForumItem(raw);

    const first = await repository.upsert(normalized);
    const second = await repository.upsert({
      ...normalized,
      title: "Updated title"
    });
    const stored = await repository.findById(normalized.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(stored?.title).toBe("Updated title");
    expect(await repository.findAll()).toHaveLength(1);
  });

  it("preserves createdAt and updates updatedAt on repeated upserts", async () => {
    const repository = new MemoryProposalRepository();
    const normalized = normalizeLidoForumItem(createRawGovernanceItem());

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    const first = await repository.upsert(normalized);

    jest.setSystemTime(new Date("2026-06-05T06:00:00.000Z"));
    const second = await repository.upsert({
      ...normalized,
      title: "Updated title"
    });

    expect(first.proposal.createdAt).toBe("2026-06-05T00:00:00.000Z");
    expect(first.proposal.updatedAt).toBe("2026-06-05T00:00:00.000Z");
    expect(second.proposal.createdAt).toBe("2026-06-05T00:00:00.000Z");
    expect(second.proposal.updatedAt).toBe("2026-06-05T06:00:00.000Z");
  });

  it("upserts many proposals in order and reports created flags", async () => {
    const repository = new MemoryProposalRepository();
    const first = normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "1001" }));
    const second = normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "1002" }));

    const initial = await repository.upsertMany([first, second]);
    const repeated = await repository.upsertMany([first]);

    expect(initial.map((result) => result.created)).toEqual([true, true]);
    expect(repeated.map((result) => result.created)).toEqual([false]);
    expect(await repository.findAll()).toHaveLength(2);
  });

  it("sorts proposals by publishedAt descending", async () => {
    const repository = new MemoryProposalRepository();
    const older = normalizeLidoForumItem(
      createRawGovernanceItem({
        sourceId: "older",
        publishedAt: "2026-05-01T10:00:00.000Z"
      })
    );
    const newer = normalizeLidoForumItem(
      createRawGovernanceItem({
        sourceId: "newer",
        publishedAt: "2026-05-03T10:00:00.000Z"
      })
    );

    await repository.upsertMany([older, newer]);

    expect((await repository.findAll()).map((proposal) => proposal.sourceId)).toEqual([
      "newer",
      "older"
    ]);
  });

  it("filters by protocol and applies limits", async () => {
    const repository = new MemoryProposalRepository();
    const lido = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1001",
        publishedAt: "2026-05-01T10:00:00.000Z"
      })
    );
    const aave = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "aave",
        sourceId: "1002",
        publishedAt: "2026-05-02T10:00:00.000Z"
      })
    );
    const secondLido = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1003",
        publishedAt: "2026-05-03T10:00:00.000Z"
      })
    );

    await repository.upsertMany([lido, aave, secondLido]);

    const proposals = await repository.findAll({ protocol: "lido", limit: 1 });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].protocol).toBe("lido");
    expect(proposals[0].sourceId).toBe("1003");
  });

  it("returns null for unknown proposal ids", async () => {
    const repository = new MemoryProposalRepository();

    await expect(repository.findById("missing")).resolves.toBeNull();
  });
});
