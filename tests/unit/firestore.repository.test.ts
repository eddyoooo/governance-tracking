import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Firestore } from "firebase-admin/firestore";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import {
  FirestoreFetchRunRepository,
  type FetchRun
} from "../../src/storage/fetchRun.repository.js";
import { FirestoreProposalRepository } from "../../src/storage/firestoreProposal.repository.js";
import { createRawGovernanceItem } from "../helpers/builders.js";

type StoredDocument = Record<string, unknown>;

class FakeDocumentReference {
  constructor(
    private readonly documents: Map<string, StoredDocument>,
    private readonly id: string
  ) {}

  async get() {
    const data = this.documents.get(this.id);

    return {
      exists: Boolean(data),
      data: () => data
    };
  }

  async set(data: StoredDocument, options?: { merge?: boolean }) {
    const existing = this.documents.get(this.id);
    this.documents.set(
      this.id,
      options?.merge ? { ...(existing ?? {}), ...data } : data
    );
  }
}

class FakeQuery {
  constructor(
    protected readonly documents: Map<string, StoredDocument>,
    private readonly filters: Array<{ field: string; value: string }> = [],
    private readonly limitCount?: number,
    private readonly offsetCount = 0,
    private readonly orderField = "publishedAt",
    private readonly orderDirection: "asc" | "desc" = "desc"
  ) {}

  where(field: string, _operator: string, value: string): FakeQuery {
    return new FakeQuery(
      this.documents,
      [...this.filters, { field, value }],
      this.limitCount,
      this.offsetCount,
      this.orderField,
      this.orderDirection
    );
  }

  orderBy(field: string, direction: "asc" | "desc"): FakeQuery {
    return new FakeQuery(
      this.documents,
      this.filters,
      this.limitCount,
      this.offsetCount,
      field,
      direction
    );
  }

  limit(limitCount: number): FakeQuery {
    return new FakeQuery(
      this.documents,
      this.filters,
      limitCount,
      this.offsetCount,
      this.orderField,
      this.orderDirection
    );
  }

  offset(offsetCount: number): FakeQuery {
    return new FakeQuery(
      this.documents,
      this.filters,
      this.limitCount,
      offsetCount,
      this.orderField,
      this.orderDirection
    );
  }

  async get() {
    const docs = [...this.documents.values()]
      .filter((document) =>
        this.filters.every((filter) => document[filter.field] === filter.value)
      )
      .sort((left, right) => {
        const compared = String(left[this.orderField] ?? "").localeCompare(
          String(right[this.orderField] ?? "")
        );

        return this.orderDirection === "asc" ? compared : -compared;
      })
      .slice(this.offsetCount, this.offsetCount + (this.limitCount ?? 100))
      .map((document) => ({
        data: () => document
      }));

    return { docs };
  }
}

class FakeCollectionReference extends FakeQuery {
  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(this.documents, id);
  }
}

function createFakeFirestore(
  seed: Record<string, Record<string, StoredDocument>> = {}
): Firestore {
  const collections = new Map(
    Object.entries(seed).map(([collectionName, documents]) => [
      collectionName,
      new Map(Object.entries(documents))
    ])
  );

  return {
    collection: (name: string) => {
      if (!collections.has(name)) {
        collections.set(name, new Map());
      }

      return new FakeCollectionReference(collections.get(name) ?? new Map());
    }
  } as unknown as Firestore;
}

describe("FirestoreProposalRepository", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("upserts proposal documents with create/update metadata", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    const first = await repository.upsert(proposal);

    jest.setSystemTime(new Date("2026-06-05T06:00:00.000Z"));
    const second = await repository.upsert({
      ...proposal,
      title: "Updated proposal"
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposal).toMatchObject({
      title: "Updated proposal",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T06:00:00.000Z"
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      title: "Updated proposal"
    });
  });

  it("skips Firestore writes when an existing proposal has no meaningful source changes", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const proposal = normalizeLidoForumItem(
      createRawGovernanceItem({
        fetchedAt: "2026-06-05T00:00:00.000Z"
      })
    );

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    const first = await repository.upsert(proposal);

    jest.setSystemTime(new Date("2026-06-05T06:00:00.000Z"));
    const second = await repository.upsert({
      ...proposal,
      fetchedAt: "2026-06-05T06:00:00.000Z"
    });

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
      updatedAt: "2026-06-05T00:00:00.000Z"
    });
  });

  it("deduplicates proposal documents by source identity and preserves the stored id", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    const first = await repository.upsert(proposal);
    const second = await repository.upsert({
      ...proposal,
      id: "accidental_new_id",
      title: "Updated through source identity"
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposal).toMatchObject({
      id: proposal.id,
      title: "Updated through source identity"
    });
    await expect(repository.findAll()).resolves.toHaveLength(1);
    await expect(repository.findById("accidental_new_id")).resolves.toBeNull();
  });

  it("updates and clears Firestore notification errors", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationStatus(proposal.id, "failed", "Telegram failed");

    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "failed",
      notificationError: "Telegram failed"
    });

    await repository.updateNotificationStatus(proposal.id, "sent");

    const stored = await repository.findById(proposal.id);
    expect(stored).toMatchObject({
      notificationStatus: "sent"
    });
    expect(stored?.notificationError).toBeUndefined();
  });

  it("strips obsolete proposal fields from older Firestore documents", async () => {
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({
        proposals: {
          [proposal.id]: {
            ...proposal,
            firstSeenAt: "2026-06-05T00:00:00.000Z",
            lastSeenAt: "2026-06-05T00:00:00.000Z",
            status: "new",
            notificationStatus: "skipped",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:00.000Z"
          }
        }
      })
    );

    const stored = await repository.findById(proposal.id);

    expect(stored).toMatchObject({
      id: proposal.id,
      notificationStatus: "skipped"
    });
    expect(stored).not.toHaveProperty("lastSeenAt");
    expect(stored).not.toHaveProperty("status");
  });

  it("finds proposal documents by protocol, newest first, with limits", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const lidoOlder = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1001",
        publishedAt: "2026-05-01T10:00:00.000Z"
      })
    );
    const lidoNewer = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1002",
        publishedAt: "2026-05-02T10:00:00.000Z"
      })
    );
    const aave = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "aave",
        sourceId: "1003",
        publishedAt: "2026-05-03T10:00:00.000Z"
      })
    );

    await repository.upsertMany([lidoOlder, lidoNewer, aave]);

    await expect(repository.findAll({ protocol: "lido", limit: 1 })).resolves.toMatchObject([
      {
        protocol: "lido",
        sourceId: "1002"
      }
    ]);
    await expect(
      repository.findBySourceIdentity("lido", "forum", "1001")
    ).resolves.toMatchObject({
      protocol: "lido",
      sourceId: "1001"
    });
    await expect(
      repository.findBySourceIdentity("lido", "forum", "missing")
    ).resolves.toBeNull();
    await expect(repository.findById("missing")).resolves.toBeNull();
  });
});

describe("FirestoreFetchRunRepository", () => {
  it("upserts and retrieves fetch run documents", async () => {
    const repository = new FirestoreFetchRunRepository(createFakeFirestore());
    const running: FetchRun = {
      id: "fetchRun_lido_test",
      protocol: "lido",
      startedAt: "2026-06-05T00:00:00.000Z",
      status: "running",
      fetchedCount: 0,
      allowlistedCount: 0,
      storedNewCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 0,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    };
    const finished: FetchRun = {
      ...running,
      finishedAt: "2026-06-05T00:01:00.000Z",
      status: "success",
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      skippedCount: 1
    };

    await repository.upsert(running);
    await repository.upsert(finished);

    await expect(repository.findById(running.id)).resolves.toEqual(finished);
    await expect(repository.findById("missing")).resolves.toBeNull();
    await expect(repository.findAll()).resolves.toEqual([finished]);
  });
});
