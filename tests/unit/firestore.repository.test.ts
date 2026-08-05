import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Firestore } from "firebase-admin/firestore";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import {
  FirestoreFetchRunRepository,
  type FetchRun
} from "../../src/storage/fetchRun.repository.js";
import { FirestoreProposalRepository } from "../../src/storage/firestoreProposal.repository.js";
import { FirestoreProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import {
  FirestoreSourceActivityRepository,
  type SourceActivityRecord
} from "../../src/storage/sourceActivity.repository.js";
import { createRawGovernanceItem } from "../helpers/builders.js";

type StoredDocument = Record<string, unknown>;

interface FakeFirestoreOptions {
  failSourceIdentityCompositeIndex?: boolean;
  sourceIdentityQueryError?: unknown;
}

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

  create(data: StoredDocument) {
    if (this.documents.has(this.id)) {
      throw new Error(`Document already exists: ${this.id}`);
    }

    this.documents.set(this.id, data);
  }
}

class FakeQuery {
  constructor(
    protected readonly documents: Map<string, StoredDocument>,
    private readonly options: FakeFirestoreOptions = {},
    private readonly filters: Array<{ field: string; value: string }> = [],
    private readonly limitCount?: number,
    private readonly orderField = "publishedAt",
    private readonly orderDirection: "asc" | "desc" = "desc"
  ) {}

  where(field: string, _operator: string, value: string): FakeQuery {
    return new FakeQuery(
      this.documents,
      this.options,
      [...this.filters, { field, value }],
      this.limitCount,
      this.orderField,
      this.orderDirection
    );
  }

  orderBy(field: string, direction: "asc" | "desc"): FakeQuery {
    if (
      field === "firstSeenAt" &&
      this.filters.some((filter) => filter.field === "notificationStatus")
    ) {
      throw new Error(
        "The query requires an index for notificationStatus + firstSeenAt."
      );
    }

    return new FakeQuery(
      this.documents,
      this.options,
      this.filters,
      this.limitCount,
      field,
      direction
    );
  }

  limit(limitCount: number): FakeQuery {
    return new FakeQuery(
      this.documents,
      this.options,
      this.filters,
      limitCount,
      this.orderField,
      this.orderDirection
    );
  }

  count() {
    return {
      get: async () => {
        const count = [...this.documents.values()].filter((document) =>
          this.filters.every(
            (filter) => document[filter.field] === filter.value
          )
        ).length;

        return {
          data: () => ({ count })
        };
      }
    };
  }

  async get() {
    const isSourceIdentityQuery = ["protocol", "sourceType", "sourceId"].every(
      (field) => this.filters.some((filter) => filter.field === field)
    );

    if (isSourceIdentityQuery && this.options.sourceIdentityQueryError) {
      throw this.options.sourceIdentityQueryError;
    }

    if (this.options.failSourceIdentityCompositeIndex && isSourceIdentityQuery) {
      const error = new Error(
        "The query requires an index for protocol + sourceType + sourceId."
      ) as Error & { code: number; details: string };

      error.code = 9;
      error.details =
        "The query requires an index. You can create it in Firestore.";
      throw error;
    }

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
      .slice(0, this.limitCount ?? 100)
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

class FakeTransaction {
  async get(target: { get(): Promise<unknown> }) {
    return target.get();
  }

  set(
    ref: FakeDocumentReference,
    data: StoredDocument,
    options?: { merge?: boolean }
  ): FakeTransaction {
    void ref.set(data, options);

    return this;
  }

  create(ref: FakeDocumentReference, data: StoredDocument): FakeTransaction {
    ref.create(data);

    return this;
  }
}

function createFakeFirestore(
  seed: Record<string, Record<string, StoredDocument>> = {},
  options: FakeFirestoreOptions = {}
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

      return new FakeCollectionReference(collections.get(name) ?? new Map(), options);
    },
    runTransaction: async (updateFunction: (transaction: FakeTransaction) => unknown) =>
      updateFunction(new FakeTransaction())
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
      firstSeenAt: "2026-06-05T00:00:00.000Z",
      lastSeenAt: "2026-06-05T06:00:00.000Z",
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
      lastSeenAt: "2026-06-05T00:00:00.000Z",
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

  it("stores a canonical source-identity id even when a new adapter supplies a different id", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    const result = await repository.upsert({
      ...proposal,
      id: "non_canonical_adapter_id"
    });

    expect(result.proposal.id).toBe(proposal.id);
    await expect(repository.findById(proposal.id)).resolves.toEqual(
      result.proposal
    );
    await expect(
      repository.findById("non_canonical_adapter_id")
    ).resolves.toBeNull();
  });

  it("falls back to source identity fields for legacy Firestore proposal documents", async () => {
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({
        proposals: {
          legacy_doc_id: {
            ...proposal,
            id: "legacy_doc_id",
            firstSeenAt: "2026-06-05T00:00:00.000Z",
            lastSeenAt: "2026-06-05T00:00:00.000Z",
            notificationStatus: "skipped",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:00.000Z"
          }
        }
      })
    );

    const result = await repository.upsert({
      ...proposal,
      title: "Updated legacy document"
    });

    expect(result.created).toBe(false);
    expect(result.proposal).toMatchObject({
      id: "legacy_doc_id",
      title: "Updated legacy document"
    });
    await expect(repository.findAll()).resolves.toHaveLength(1);
  });

  it("does not require the legacy source-identity index when inserting deterministic Firestore documents", async () => {
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({}, { failSourceIdentityCompositeIndex: true })
    );

    await expect(repository.upsert(proposal)).resolves.toMatchObject({
      created: true,
      updated: true,
      proposal: {
        id: proposal.id,
        sourceId: proposal.sourceId
      }
    });
    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      id: proposal.id,
      sourceId: proposal.sourceId
    });
  });

  it("returns null instead of failing when optional legacy source-identity lookup needs an index", async () => {
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({}, { failSourceIdentityCompositeIndex: true })
    );

    await expect(
      repository.findBySourceIdentity("lido", "forum", "missing")
    ).resolves.toBeNull();
  });

  it("does not hide non-index failures from legacy source-identity reads", async () => {
    const storageError = new Error("Firestore permission denied");
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({}, { sourceIdentityQueryError: storageError })
    );

    await expect(
      repository.findBySourceIdentity("lido", "forum", "missing")
    ).rejects.toBe(storageError);
  });

  it("does not insert a proposal when the legacy dedupe lookup fails unexpectedly", async () => {
    const storageError = new Error("Firestore transport unavailable");
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({}, { sourceIdentityQueryError: storageError })
    );
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    await expect(repository.upsert(proposal)).rejects.toBe(storageError);
    await expect(repository.findById(proposal.id)).resolves.toBeNull();
  });

  it("prefers deterministic Firestore proposal documents over legacy source-identity matches", async () => {
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({
        proposals: {
          [proposal.id]: {
            ...proposal,
            firstSeenAt: "2026-06-05T00:00:00.000Z",
            lastSeenAt: "2026-06-05T00:00:00.000Z",
            notificationStatus: "skipped",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:00.000Z"
          },
          legacy_doc_id: {
            ...proposal,
            id: "legacy_doc_id",
            title: "Legacy duplicate",
            firstSeenAt: "2026-06-04T00:00:00.000Z",
            lastSeenAt: "2026-06-04T00:00:00.000Z",
            notificationStatus: "skipped",
            createdAt: "2026-06-04T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z"
          }
        }
      })
    );

    await expect(
      repository.findBySourceIdentity("lido", "forum", proposal.sourceId)
    ).resolves.toMatchObject({
      id: proposal.id,
      title: proposal.title
    });
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

  it("strips obsolete proposal fields while preserving lifecycle fields", async () => {
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
      lastSeenAt: "2026-06-05T00:00:00.000Z",
      notificationStatus: "skipped"
    });
    expect(stored).not.toHaveProperty("status");
  });

  it("backfills lastSeenAt from firstSeenAt when reading older Firestore documents", async () => {
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({
        proposals: {
          [proposal.id]: {
            ...proposal,
            firstSeenAt: "2026-06-05T00:00:00.000Z",
            notificationStatus: "skipped",
            createdAt: "2026-06-05T00:00:00.000Z",
            updatedAt: "2026-06-05T00:00:00.000Z"
          }
        }
      })
    );

    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      firstSeenAt: "2026-06-05T00:00:00.000Z",
      lastSeenAt: "2026-06-05T00:00:00.000Z"
    });
  });

  it("backfills missing lifecycle and notification fields from older Firestore documents", async () => {
    const proposal = normalizeLidoForumItem(
      createRawGovernanceItem({
        fetchedAt: "2026-06-05T12:00:00.000Z"
      })
    );
    const repository = new FirestoreProposalRepository(
      createFakeFirestore({
        proposals: {
          [proposal.id]: {
            ...proposal
          }
        }
      })
    );

    await expect(repository.findById(proposal.id)).resolves.toMatchObject({
      firstSeenAt: "2026-06-05T12:00:00.000Z",
      lastSeenAt: "2026-06-05T12:00:00.000Z",
      notificationStatus: "skipped",
      createdAt: "2026-06-05T12:00:00.000Z",
      updatedAt: "2026-06-05T12:00:00.000Z"
    });
  });

  it("lists proposal documents for internal monitor audit without dashboard filters", async () => {
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

    const stored = await repository.findAll();

    expect(stored).toHaveLength(3);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "lido",
          sourceId: "1001"
        }),
        expect.objectContaining({
          protocol: "lido",
          sourceId: "1002"
        }),
        expect.objectContaining({
          protocol: "aave",
          sourceId: "1003"
        })
      ])
    );
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

  it("finds notification-pending Firestore proposals in oldest-first order", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const olderPending = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1001",
        publisherName: "Allowed Publisher",
        publishedAt: "2026-05-01T10:00:00.000Z"
      })
    );
    const newerPending = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1002",
        publisherName: "DAO Ops",
        publishedAt: "2026-05-03T10:00:00.000Z"
      })
    );
    const skipped = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "aave",
        sourceId: "1003",
        publisherName: "DAO Ops",
        publishedAt: "2026-05-02T10:00:00.000Z"
      })
    );

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    await repository.upsert(olderPending, {
      notificationStatusForNew: "pending"
    });

    jest.setSystemTime(new Date("2026-06-05T01:00:00.000Z"));
    await repository.upsert(skipped, {
      notificationStatusForNew: "skipped"
    });

    jest.setSystemTime(new Date("2026-06-05T02:00:00.000Z"));
    await repository.upsert(newerPending, {
      notificationStatusForNew: "pending"
    });

    await expect(
      repository.findByNotificationStatus("pending")
    ).resolves.toMatchObject([
      {
        id: olderPending.id,
        notificationStatus: "pending",
        firstSeenAt: "2026-06-05T00:00:00.000Z"
      },
      {
        id: newerPending.id,
        notificationStatus: "pending",
        firstSeenAt: "2026-06-05T02:00:00.000Z"
      }
    ]);

    await expect(
      repository.findByNotificationStatus("pending", 1)
    ).resolves.toMatchObject([{ id: olderPending.id }]);
  });

  it("returns null when updating notification status for an unknown Firestore proposal", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());

    await expect(
      repository.updateNotificationStatus("missing", "sent")
    ).resolves.toBeNull();
  });

  it("checks protocol existence and counts notification states without composite indexes", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const lido = normalizeLidoForumItem(
      createRawGovernanceItem({ sourceId: "lido-1", protocol: "lido" })
    );
    const aave = normalizeLidoForumItem(
      createRawGovernanceItem({ sourceId: "aave-1", protocol: "aave" })
    );

    await repository.upsert(lido, {
      notificationStatusForNew: "pending"
    });
    await repository.upsert(aave, {
      notificationStatusForNew: "skipped"
    });
    await repository.updateNotificationStatus(lido.id, "failed", "Telegram down");

    await expect(repository.existsForProtocol("lido")).resolves.toBe(true);
    await expect(repository.existsForProtocol("aave")).resolves.toBe(true);
    await expect(repository.existsForProtocol("uniswap")).resolves.toBe(false);
    await expect(
      repository.countByNotificationStatus("failed")
    ).resolves.toBe(1);
    await expect(
      repository.countByNotificationStatus("skipped")
    ).resolves.toBe(1);
    await expect(
      repository.countByNotificationStatus("pending")
    ).resolves.toBe(0);
  });

  it("transactionally persists recipient delivery state and clears aggregate errors", async () => {
    const repository = new FirestoreProposalRepository(createFakeFirestore());
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    await repository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });
    await repository.updateNotificationState(proposal.id, () => ({
      notificationStatus: "failed",
      notificationError: "Telegram failed",
      notificationDeliveries: {
        recipientHash: {
          recipientKey: "recipientHash",
          recipientMaskedId: "*****1111",
          status: "failed",
          attemptCount: 1,
          createdAt: "2026-07-24T10:00:00.000Z",
          updatedAt: "2026-07-24T10:00:00.000Z",
          nextRetryAt: "2026-07-24T10:15:00.000Z",
          lastError: "Telegram failed"
        }
      }
    }));
    await repository.updateNotificationState(proposal.id, (stored) => ({
      notificationStatus: "sent",
      notificationDeliveries: {
        recipientHash: {
          ...stored.notificationDeliveries?.recipientHash!,
          status: "sent",
          attemptCount: 2,
          updatedAt: "2026-07-24T10:15:00.000Z",
          sentAt: "2026-07-24T10:15:00.000Z"
        }
      }
    }));

    const delivered = await repository.findById(proposal.id);

    expect(delivered).toMatchObject({
      notificationStatus: "sent",
      notificationDeliveries: {
        recipientHash: {
          recipientMaskedId: "*****1111",
          status: "sent",
          attemptCount: 2
        }
      }
    });
    expect(delivered).not.toHaveProperty("notificationError");
  });
});

describe("FirestoreProtocolStateRepository", () => {
  it("creates a seeding baseline once and completes it idempotently", async () => {
    const repository = new FirestoreProtocolStateRepository(createFakeFirestore());

    const initial = await repository.initializeBaseline(
      "lido",
      false,
      "2026-07-24T08:00:00.000Z"
    );
    const repeated = await repository.initializeBaseline(
      "lido",
      true,
      "2026-07-24T08:05:00.000Z"
    );
    const completed = await repository.markBaselineComplete(
      "lido",
      "2026-07-24T08:10:00.000Z"
    );
    const completedAgain = await repository.markBaselineComplete(
      "lido",
      "2026-07-24T08:20:00.000Z"
    );

    expect(initial).toMatchObject({
      protocol: "lido",
      baselineStatus: "seeding",
      baselineStartedAt: "2026-07-24T08:00:00.000Z"
    });
    expect(repeated).toEqual(initial);
    expect(completed).toMatchObject({
      baselineStatus: "complete",
      baselineCompletedAt: "2026-07-24T08:10:00.000Z"
    });
    expect(completedAgain).toEqual(completed);
    await expect(repository.findByProtocol("lido")).resolves.toEqual(completed);
  });

  it("marks an already-populated protocol complete on first initialization", async () => {
    const repository = new FirestoreProtocolStateRepository(createFakeFirestore());

    await expect(
      repository.initializeBaseline(
        "aave",
        true,
        "2026-07-24T09:00:00.000Z"
      )
    ).resolves.toMatchObject({
      protocol: "aave",
      baselineStatus: "complete",
      baselineStartedAt: "2026-07-24T09:00:00.000Z",
      baselineCompletedAt: "2026-07-24T09:00:00.000Z"
    });
  });

  it("can complete a missing baseline atomically after an interrupted state write", async () => {
    const repository = new FirestoreProtocolStateRepository(createFakeFirestore());

    await expect(repository.findByProtocol("uniswap")).resolves.toBeNull();
    await expect(
      repository.markBaselineComplete(
        "uniswap",
        "2026-07-24T10:00:00.000Z"
      )
    ).resolves.toMatchObject({
      protocol: "uniswap",
      baselineStatus: "complete",
      baselineStartedAt: "2026-07-24T10:00:00.000Z",
      baselineCompletedAt: "2026-07-24T10:00:00.000Z"
    });
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

  it("lists latest Firestore fetch runs by startedAt with a limit", async () => {
    const repository = new FirestoreFetchRunRepository(createFakeFirestore());
    const older: FetchRun = {
      id: "older",
      protocol: "lido",
      startedAt: "2026-06-05T00:00:00.000Z",
      status: "success",
      fetchedCount: 1,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 0,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    };
    const newer: FetchRun = {
      ...older,
      id: "newer",
      startedAt: "2026-06-06T00:00:00.000Z"
    };

    await repository.upsert(older);
    await repository.upsert(newer);

    await expect(repository.findAll()).resolves.toMatchObject([
      { id: "newer" },
      { id: "older" }
    ]);
    await expect(repository.findAll(1)).resolves.toMatchObject([{ id: "newer" }]);
    await expect(repository.findLatestByProtocol("lido")).resolves.toMatchObject({
      id: "newer"
    });
    await expect(repository.findLatestByProtocol("aave")).resolves.toBeNull();
  });

  it("finds the latest successful Firestore run without requiring a status composite index", async () => {
    const repository = new FirestoreFetchRunRepository(createFakeFirestore());
    const successful: FetchRun = {
      id: "successful",
      protocol: "uniswap",
      startedAt: "2026-06-05T00:00:00.000Z",
      finishedAt: "2026-06-05T00:01:00.000Z",
      status: "success",
      fetchedCount: 10,
      allowlistedCount: 2,
      storedNewCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 2,
      skippedCount: 8,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    };
    const failed: FetchRun = {
      ...successful,
      id: "newer-failed",
      startedAt: "2026-06-06T00:00:00.000Z",
      finishedAt: "2026-06-06T00:01:00.000Z",
      status: "failed",
      errors: ["Forum unavailable"]
    };

    await repository.upsert(successful);
    await repository.upsert(failed);

    await expect(
      repository.findLatestSuccessfulByProtocol("uniswap")
    ).resolves.toMatchObject({ id: "successful" });
    await expect(
      repository.findLatestSuccessfulByProtocol("aave")
    ).resolves.toBeNull();
  });
});

describe("FirestoreSourceActivityRepository", () => {
  it("upserts and lists source activity records by updatedAt", async () => {
    const repository = new FirestoreSourceActivityRepository(createFakeFirestore());
    const older: SourceActivityRecord = {
      protocol: "lido",
      sourceType: "forum",
      latestRawSourceId: "1001",
      latestRawPublishedAt: "2026-06-01T00:00:00.000Z",
      lastFetchedAt: "2026-07-01T00:00:00.000Z",
      lastFetchedCount: 30,
      consecutiveStaleRuns: 4,
      status: "warning",
      statusReason: "Newest raw source item is 30 day(s) old.",
      warningThresholdDays: 14,
      criticalThresholdDays: 30,
      minFetchedCount: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };
    const newer: SourceActivityRecord = {
      ...older,
      protocol: "aave",
      latestRawSourceId: "25170",
      status: "healthy",
      updatedAt: "2026-07-02T00:00:00.000Z"
    };

    await repository.upsert(older);
    await repository.upsert(newer);

    await expect(repository.findByProtocol("aave")).resolves.toMatchObject({
      protocol: "aave",
      latestRawSourceId: "25170",
      status: "healthy"
    });
    await expect(repository.findByProtocol("missing")).resolves.toBeNull();
    await expect(repository.findAll()).resolves.toMatchObject([
      { protocol: "aave" },
      { protocol: "lido" }
    ]);
    await expect(repository.findAll(1)).resolves.toMatchObject([
      { protocol: "aave" }
    ]);
  });
});
