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
    expect(first.proposal.firstSeenAt).toBe("2026-06-05T00:00:00.000Z");
    expect(second.proposal.createdAt).toBe("2026-06-05T00:00:00.000Z");
    expect(second.proposal.firstSeenAt).toBe("2026-06-05T00:00:00.000Z");
    expect(second.proposal.updatedAt).toBe("2026-06-05T06:00:00.000Z");
  });

  it("skips writes when an existing proposal has no meaningful source changes", async () => {
    const repository = new MemoryProposalRepository();
    const initial = normalizeLidoForumItem(
      createRawGovernanceItem({
        fetchedAt: "2026-06-05T00:00:00.000Z"
      })
    );
    const sameSourceLaterFetch = {
      ...initial,
      fetchedAt: "2026-06-05T06:00:00.000Z"
    };

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    const first = await repository.upsert(initial);

    jest.setSystemTime(new Date("2026-06-05T06:00:00.000Z"));
    const second = await repository.upsert(sameSourceLaterFetch);

    expect(first).toMatchObject({
      created: true,
      updated: true
    });
    expect(second).toMatchObject({
      created: false,
      updated: false
    });
    expect(second.proposal).toMatchObject({
      fetchedAt: "2026-06-05T00:00:00.000Z",
      firstSeenAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z"
    });
  });

  it("deduplicates by source identity even when the incoming id changes", async () => {
    const repository = new MemoryProposalRepository();
    const normalized = normalizeLidoForumItem(createRawGovernanceItem());

    const first = await repository.upsert(normalized);
    const second = await repository.upsert({
      ...normalized,
      id: "accidental_new_id",
      title: "Updated through source identity"
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposal.id).toBe(normalized.id);
    expect(await repository.findAll()).toHaveLength(1);
    expect(await repository.findById("accidental_new_id")).toBeNull();
  });

  it("sets notification status for new proposals and preserves it on updates", async () => {
    const repository = new MemoryProposalRepository();
    const normalized = normalizeLidoForumItem(createRawGovernanceItem());

    const first = await repository.upsert(normalized, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(first.proposal.id, "sent");
    const second = await repository.upsert({
      ...normalized,
      title: "Updated title"
    });

    expect(first.proposal.notificationStatus).toBe("pending");
    expect(second.proposal.notificationStatus).toBe("sent");
  });

  it("updates mutable source fields while preserving first-seen and notification state", async () => {
    const repository = new MemoryProposalRepository();
    const initial = normalizeLidoForumItem(
      createRawGovernanceItem({
        sourceId: "1001",
        title: "Original title",
        publisherName: "Original Publisher",
        sourceUrl: "https://research.lido.fi/t/original/1001",
        publishedAt: "2026-05-01T10:00:00.000Z",
        fetchedAt: "2026-05-01T11:00:00.000Z",
        raw: {
          id: 1001,
          title: "Original title"
        }
      })
    );
    const changed = normalizeLidoForumItem(
      createRawGovernanceItem({
        sourceId: "1001",
        title: "Changed title",
        publisherName: "Changed Publisher",
        sourceUrl: "https://research.lido.fi/t/changed/1001",
        publishedAt: "2026-05-02T10:00:00.000Z",
        fetchedAt: "2026-05-02T11:00:00.000Z",
        raw: {
          id: 1001,
          title: "Changed title",
          extra: "new upstream payload field"
        }
      })
    );

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    const first = await repository.upsert(initial, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(first.proposal.id, "failed", "boom");

    jest.setSystemTime(new Date("2026-06-05T06:00:00.000Z"));
    const second = await repository.upsert(changed, {
      notificationStatusForNew: "pending"
    });

    expect(second.created).toBe(false);
    expect(second.proposal).toMatchObject({
      title: "Changed title",
      publisherName: "Changed Publisher",
      sourceUrl: "https://research.lido.fi/t/changed/1001",
      publishedAt: "2026-05-02T10:00:00.000Z",
      fetchedAt: "2026-05-02T11:00:00.000Z",
      firstSeenAt: "2026-06-05T00:00:00.000Z",
      createdAt: "2026-06-05T00:00:00.000Z",
      notificationStatus: "failed",
      notificationError: "boom"
    });
    expect(second.proposal.rawHash).toBe(changed.rawHash);
    expect(second.proposal.rawHash).not.toBe(initial.rawHash);
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

  it("filters by query fields, applies limits, offsets, and sort order", async () => {
    const repository = new MemoryProposalRepository();
    const lido = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1001",
        publisherName: "Allowed Publisher",
        publishedAt: "2026-05-01T10:00:00.000Z"
      })
    );
    const aave = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "aave",
        sourceId: "1002",
        publisherName: "Allowed Publisher",
        publishedAt: "2026-05-02T10:00:00.000Z"
      })
    );
    const secondLido = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1003",
        publisherName: "DAO Ops",
        publishedAt: "2026-05-03T10:00:00.000Z"
      })
    );

    await repository.upsertMany([lido, aave, secondLido]);
    await repository.updateNotificationStatus(secondLido.id, "sent");

    const proposals = await repository.findAll({
      protocol: "lido",
      publisherName: "DAO Ops",
      sourceType: "forum",
      notificationStatus: "sent",
      limit: 1,
      offset: 0,
      sort: "publishedAt_desc"
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].protocol).toBe("lido");
    expect(proposals[0].sourceId).toBe("1003");

    await expect(
      repository.findAll({ sort: "publishedAt_asc", limit: 1, offset: 1 })
    ).resolves.toMatchObject([{ sourceId: "1002" }]);
  });

  it("sorts by firstSeenAt and keeps pagination stable for dashboard reads", async () => {
    const repository = new MemoryProposalRepository();
    const first = normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "1001" }));
    const second = normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "1002" }));
    const third = normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "1003" }));

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    await repository.upsert(first);

    jest.setSystemTime(new Date("2026-06-05T00:10:00.000Z"));
    await repository.upsert(second);

    jest.setSystemTime(new Date("2026-06-05T00:20:00.000Z"));
    await repository.upsert(third);

    await expect(
      repository.findAll({
        sort: "firstSeenAt_asc",
        limit: 2,
        offset: 1
      })
    ).resolves.toMatchObject([{ sourceId: "1002" }, { sourceId: "1003" }]);

    await expect(
      repository.findAll({
        sort: "firstSeenAt_desc",
        limit: 2
      })
    ).resolves.toMatchObject([{ sourceId: "1003" }, { sourceId: "1002" }]);
  });

  it("returns null for unknown proposal ids", async () => {
    const repository = new MemoryProposalRepository();

    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  it("finds proposals by source identity", async () => {
    const repository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceType: "forum",
        sourceId: "1001"
      })
    );

    await repository.upsert(proposal);

    await expect(
      repository.findBySourceIdentity("lido", "forum", "1001")
    ).resolves.toMatchObject({
      id: proposal.id,
      protocol: "lido",
      sourceId: "1001"
    });
    await expect(
      repository.findBySourceIdentity("lido", "forum", "missing")
    ).resolves.toBeNull();
  });

  it("finds pending notifications and clears notification errors after success", async () => {
    const repository = new MemoryProposalRepository();
    const first = normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "1001" }));
    const second = normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "1002" }));

    await repository.upsert(first, { notificationStatusForNew: "pending" });
    await repository.upsert(second, { notificationStatusForNew: "skipped" });
    await repository.updateNotificationStatus(first.id, "failed", "Telegram failed");

    await expect(
      repository.findByNotificationStatus("failed")
    ).resolves.toMatchObject([{ sourceId: "1001", notificationError: "Telegram failed" }]);

    await repository.updateNotificationStatus(first.id, "sent");

    await expect(repository.findById(first.id)).resolves.toMatchObject({
      notificationStatus: "sent"
    });
    expect((await repository.findById(first.id))?.notificationError).toBeUndefined();
  });

  it("returns null when updating notification status for an unknown proposal", async () => {
    const repository = new MemoryProposalRepository();

    await expect(
      repository.updateNotificationStatus("missing", "sent")
    ).resolves.toBeNull();
    await expect(repository.findAll()).resolves.toEqual([]);
  });
});
