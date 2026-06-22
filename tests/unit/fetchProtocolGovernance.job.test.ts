import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  FetchAlreadyRunningError,
  FetchProtocolGovernanceJob,
  UnknownProtocolAdapterError
} from "../../src/jobs/fetchProtocolGovernance.job.js";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/index.js";
import { ProtocolRegistry } from "../../src/protocols/registry.js";
import type { RawGovernanceItem } from "../../src/protocols/types.js";
import {
  type FetchRun,
  type FetchRunRepository
} from "../../src/storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import {
  createFakeProtocolAdapter,
  createRawGovernanceItem,
  createSilentLogger
} from "../helpers/builders.js";

class RecordingFetchRunRepository implements FetchRunRepository {
  readonly upserts: FetchRun[] = [];
  private readonly runs = new Map<string, FetchRun>();

  async upsert(run: FetchRun): Promise<void> {
    this.upserts.push(run);
    this.runs.set(run.id, run);
  }

  async findById(id: string): Promise<FetchRun | null> {
    return this.runs.get(id) ?? null;
  }

  async findAll(): Promise<FetchRun[]> {
    return [...this.runs.values()];
  }
}

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled: boolean;
  readonly messages: NotificationMessage[] = [];
  private readonly fail: boolean;

  constructor(
    options: {
      enabled?: boolean;
      fail?: boolean;
    } = {}
  ) {
    this.enabled = options.enabled ?? true;
    this.fail = options.fail ?? false;
  }

  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(message);

    if (this.fail) {
      throw new Error("Telegram exploded");
    }
  }
}

function createJob(
  adapter = createFakeProtocolAdapter(),
  proposalRepository = new MemoryProposalRepository(),
  fetchRunRepository = new RecordingFetchRunRepository(),
  notificationService?: NotificationService
) {
  const registry = new ProtocolRegistry();
  registry.register(adapter);

  return {
    job: new FetchProtocolGovernanceJob(
      registry,
      proposalRepository,
      fetchRunRepository,
      createSilentLogger(),
      {
        notificationService
      }
    ),
    proposalRepository,
    fetchRunRepository
  };
}

describe("FetchProtocolGovernanceJob", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fetches, filters, normalizes, stores, and records a successful run", async () => {
    const allowed = createRawGovernanceItem({
      sourceId: "1001",
      publisherName: "Allowed Publisher"
    });
    const skipped = createRawGovernanceItem({
      sourceId: "1002",
      publisherName: "Random Person"
    });
    const { job, proposalRepository, fetchRunRepository } = createJob(
      createFakeProtocolAdapter({
        items: [allowed, skipped],
        publisherAllowlist: ["Allowed Publisher"]
      })
    );

    const result = await job.run("lido");

    expect(result).toMatchObject({
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      skippedCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    expect(result.run.status).toBe("success");
    expect(fetchRunRepository.upserts.map((run) => run.status)).toEqual([
      "running",
      "success"
    ]);
    expect(fetchRunRepository.upserts[1]).toMatchObject({
      protocol: "lido",
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      skippedCount: 1
    });
    expect(await proposalRepository.findAll()).toHaveLength(1);
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      sourceId: "1001",
      publisherName: "Allowed Publisher",
      notificationStatus: "skipped"
    });
  });

  it("records a successful run when all fetched items are skipped", async () => {
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter({
        items: [
          createRawGovernanceItem({
            sourceId: "1002",
            publisherName: "Random Person"
          })
        ],
        publisherAllowlist: ["Allowed Publisher"]
      })
    );

    const result = await job.run("lido");

    expect(result).toMatchObject({
      fetchedCount: 1,
      allowlistedCount: 0,
      storedNewCount: 0,
      updatedExistingCount: 0,
      skippedCount: 1
    });
    expect(await proposalRepository.findAll()).toEqual([]);
  });

  it("updates existing proposals instead of inserting duplicates", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));

    const fetchRecent = jest
      .fn<() => Promise<RawGovernanceItem[]>>()
      .mockResolvedValueOnce([
        createRawGovernanceItem({
          sourceId: "1001",
          title: "Original title",
          fetchedAt: "2026-06-05T00:00:00.000Z"
        })
      ])
      .mockResolvedValueOnce([
        createRawGovernanceItem({
          sourceId: "1001",
          title: "Updated title",
          fetchedAt: "2026-06-05T06:00:00.000Z"
        })
      ]);
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter({ fetchRecent })
    );

    const first = await job.run("lido");

    jest.setSystemTime(new Date("2026-06-05T06:00:00.000Z"));
    const second = await job.run("lido");
    const proposals = await proposalRepository.findAll();

    expect(first).toMatchObject({
      storedNewCount: 1,
      updatedExistingCount: 0
    });
    expect(second).toMatchObject({
      storedNewCount: 0,
      updatedExistingCount: 1
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      title: "Updated title",
      firstSeenAt: "2026-06-05T00:00:00.000Z",
      lastSeenAt: "2026-06-05T06:00:00.000Z",
      createdAt: "2026-06-05T00:00:00.000Z"
    });

    jest.useRealTimers();
  });

  it("does not rewrite unchanged existing proposals on repeated polls", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));

    const item = createRawGovernanceItem({
      sourceId: "1001",
      fetchedAt: "2026-06-05T00:00:00.000Z"
    });
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter({
        fetchRecent: jest.fn(async () => [
          {
            ...item,
            fetchedAt: new Date().toISOString()
          }
        ])
      })
    );

    const first = await job.run("lido");
    const firstStored = (await proposalRepository.findAll())[0];

    jest.setSystemTime(new Date("2026-06-05T00:15:00.000Z"));
    const second = await job.run("lido");
    const secondStored = (await proposalRepository.findAll())[0];

    expect(first).toMatchObject({
      storedNewCount: 1,
      updatedExistingCount: 0,
      unchangedExistingCount: 0
    });
    expect(second).toMatchObject({
      storedNewCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 1
    });
    expect(secondStored).toMatchObject({
      fetchedAt: firstStored.fetchedAt,
      lastSeenAt: firstStored.lastSeenAt,
      updatedAt: firstStored.updatedAt
    });
  });

  it("deduplicates duplicate source identities within the same fetch and notifies once", async () => {
    const notificationService = new RecordingNotificationService();
    const duplicate = createRawGovernanceItem({
      sourceId: "1001",
      fetchedAt: "2026-06-05T00:15:00.000Z"
    });
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter({
        items: [
          createRawGovernanceItem({
            sourceId: "1001",
            fetchedAt: "2026-06-05T00:00:00.000Z"
          }),
          duplicate
        ],
        publisherAllowlist: ["Allowed Publisher"]
      }),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );

    const result = await job.run("lido");
    const proposals = await proposalRepository.findAll();

    expect(result).toMatchObject({
      fetchedCount: 2,
      allowlistedCount: 2,
      storedNewCount: 1,
      updatedExistingCount: 0,
      unchangedExistingCount: 1,
      skippedCount: 0,
      notificationSentCount: 1,
      notificationFailedCount: 0
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      sourceId: "1001",
      notificationStatus: "sent"
    });
    expect(notificationService.messages).toHaveLength(1);
  });

  it("does not queue or send new proposal notifications when notifications are disabled", async () => {
    const notificationService = new RecordingNotificationService({ enabled: false });
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );

    const result = await job.run("lido");

    expect(result).toMatchObject({
      storedNewCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    expect(notificationService.messages).toHaveLength(0);
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "skipped"
    });
  });

  it("sends Telegram-style notifications only for newly inserted proposals", async () => {
    const notificationService = new RecordingNotificationService();
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );

    const first = await job.run("lido");
    const second = await job.run("lido");

    expect(first).toMatchObject({
      storedNewCount: 1,
      notificationSentCount: 1,
      notificationFailedCount: 0
    });
    expect(second).toMatchObject({
      storedNewCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 1,
      notificationSentCount: 0
    });
    expect(notificationService.messages).toHaveLength(1);
    expect(notificationService.messages[0]).toMatchObject({
      protocol: "lido",
      sourceType: "forum",
      publisherName: "Allowed Publisher",
      title: "Allowed Lido Proposal"
    });
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "sent"
    });
  });

  it("lets adapters run their full bounded pagination window", async () => {
    const skipped = createRawGovernanceItem({
      sourceId: "1001",
      publisherName: "Random Person"
    });
    const allowed = createRawGovernanceItem({
      sourceId: "1002",
      publisherName: "Allowed Publisher"
    });
    const fetchRecent = jest.fn(async () => [skipped, allowed]);
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter({
        fetchRecent,
        publisherAllowlist: ["Allowed Publisher"]
      })
    );

    const result = await job.run("lido");

    expect(fetchRecent).toHaveBeenCalledWith();
    expect(result).toMatchObject({
      fetchedCount: 2,
      allowlistedCount: 1,
      skippedCount: 1,
      storedNewCount: 1
    });
    await expect(
      proposalRepository.findBySourceIdentity("lido", "forum", "1002")
    ).resolves.toMatchObject({
      sourceId: "1002"
    });
  });

  it("marks notification failures without failing the fetch run", async () => {
    const notificationService = new RecordingNotificationService({ fail: true });
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );

    const result = await job.run("lido");

    expect(result).toMatchObject({
      storedNewCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 1,
      errors: ["Telegram exploded"]
    });
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "failed",
      notificationError: "Telegram exploded"
    });
  });

  it("does not retry failed proposal notifications during ordinary duplicate fetches", async () => {
    const notificationService = new RecordingNotificationService({ fail: true });
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );

    const first = await job.run("lido");
    const second = await job.run("lido");

    expect(first).toMatchObject({
      storedNewCount: 1,
      notificationFailedCount: 1
    });
    expect(second).toMatchObject({
      storedNewCount: 0,
      unchangedExistingCount: 1,
      notificationFailedCount: 0
    });
    expect(notificationService.messages).toHaveLength(1);
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "failed",
      notificationError: "Telegram exploded"
    });
  });

  it("throws for unknown protocols without recording a fetch run", async () => {
    const { job, fetchRunRepository } = createJob();

    await expect(job.run("missing")).rejects.toThrow(
      "Unknown protocol adapter: missing"
    );
    await expect(job.run("missing")).rejects.toBeInstanceOf(
      UnknownProtocolAdapterError
    );
    expect(fetchRunRepository.upserts).toEqual([]);
  });

  it("prevents overlapping runs for the same protocol", async () => {
    let resolveFetch: (items: RawGovernanceItem[]) => void = () => undefined;
    const fetchRecent = jest.fn(
      () =>
        new Promise<RawGovernanceItem[]>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const { job } = createJob(
      createFakeProtocolAdapter({
        fetchRecent
      })
    );

    const firstRun = job.run("lido");
    await Promise.resolve();
    await Promise.resolve();

    await expect(job.run("lido")).rejects.toThrow(
      "Fetch already running for protocol: lido"
    );
    await expect(job.run("lido")).rejects.toBeInstanceOf(FetchAlreadyRunningError);

    resolveFetch([createRawGovernanceItem()]);
    await expect(firstRun).resolves.toMatchObject({
      fetchedCount: 1,
      storedNewCount: 1,
      skippedCount: 0
    });
  });

  it("allows different protocols to run concurrently while blocking same-protocol overlap", async () => {
    let resolveLidoFetch: (items: RawGovernanceItem[]) => void = () => undefined;
    const lidoFetch = jest.fn(
      () =>
        new Promise<RawGovernanceItem[]>((resolve) => {
          resolveLidoFetch = resolve;
        })
    );
    const aaveFetch = jest.fn(async () => [
      createRawGovernanceItem({
        protocol: "aave",
        sourceId: "2001",
        publisherName: "AaveLabs"
      })
    ]);
    const registry = new ProtocolRegistry();
    registry.register(
      createFakeProtocolAdapter({
        protocol: "lido",
        fetchRecent: lidoFetch
      })
    );
    registry.register(
      createFakeProtocolAdapter({
        protocol: "aave",
        publisherAllowlist: ["AaveLabs"],
        fetchRecent: aaveFetch
      })
    );
    const job = new FetchProtocolGovernanceJob(
      registry,
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      createSilentLogger()
    );

    const lidoRun = job.run("lido");
    await Promise.resolve();
    await Promise.resolve();

    await expect(job.run("lido")).rejects.toBeInstanceOf(FetchAlreadyRunningError);
    await expect(job.run("aave")).resolves.toMatchObject({
      protocol: "aave",
      storedNewCount: 1
    });

    resolveLidoFetch([createRawGovernanceItem()]);
    await expect(lidoRun).resolves.toMatchObject({
      protocol: "lido",
      storedNewCount: 1
    });
  });

  it("records failed runs when fetching throws", async () => {
    const fetchRecent = jest
      .fn<() => Promise<RawGovernanceItem[]>>()
      .mockRejectedValueOnce(new Error("Lido is unavailable"));
    const { job, fetchRunRepository } = createJob(
      createFakeProtocolAdapter({
        fetchRecent
      })
    );

    await expect(job.run("lido")).rejects.toThrow("Lido is unavailable");

    expect(fetchRunRepository.upserts.map((run) => run.status)).toEqual([
      "running",
      "failed"
    ]);
    expect(fetchRunRepository.upserts[1]).toMatchObject({
      status: "failed",
      errors: ["Lido is unavailable"]
    });
  });

  it("records failed runs when normalization throws and allows a later retry", async () => {
    const fetchRecent = jest
      .fn<() => Promise<RawGovernanceItem[]>>()
      .mockResolvedValue([createRawGovernanceItem()]);
    const normalize = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Normalizer broke");
      })
      .mockImplementation((item: RawGovernanceItem) => ({
        id: `retry_${item.sourceId}`,
        protocol: item.protocol,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        title: item.title,
        publisherName: item.publisherName,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        rawHash: "a".repeat(64)
      }));
    const { job, fetchRunRepository } = createJob(
      createFakeProtocolAdapter({
        fetchRecent,
        normalize: normalize as never
      })
    );

    await expect(job.run("lido")).rejects.toThrow("Normalizer broke");
    expect(fetchRunRepository.upserts[1]).toMatchObject({
      status: "failed",
      fetchedCount: 1,
      allowlistedCount: 1,
      storedNewCount: 0,
      updatedExistingCount: 0,
      skippedCount: 0,
      errors: ["Normalizer broke"]
    });

    await expect(job.run("lido")).resolves.toMatchObject({
      fetchedCount: 1,
      storedNewCount: 1,
      skippedCount: 0
    });

    expect(fetchRunRepository.upserts.map((run) => run.status)).toEqual([
      "running",
      "failed",
      "running",
      "success"
    ]);
  });

  it("records partial counts when a later allowed item fails normalization", async () => {
    const fetchRecent = jest.fn<() => Promise<RawGovernanceItem[]>>(async () => [
      createRawGovernanceItem({
        sourceId: "1001"
      }),
      createRawGovernanceItem({
        sourceId: "1002"
      }),
      createRawGovernanceItem({
        sourceId: "1003",
        publisherName: "Random Person"
      })
    ]);
    const normalize = jest
      .fn()
      .mockImplementationOnce((item: RawGovernanceItem) => ({
        id: `normalized_${item.sourceId}`,
        protocol: item.protocol,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        title: item.title,
        publisherName: item.publisherName,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        rawHash: "a".repeat(64)
      }))
      .mockImplementationOnce(() => {
        throw new Error("Second normalizer failed");
      });
    const { job, fetchRunRepository, proposalRepository } = createJob(
      createFakeProtocolAdapter({
        fetchRecent,
        normalize: normalize as never,
        publisherAllowlist: ["Allowed Publisher"]
      })
    );

    await expect(job.run("lido")).rejects.toThrow("Second normalizer failed");

    expect(fetchRunRepository.upserts[1]).toMatchObject({
      status: "failed",
      fetchedCount: 3,
      allowlistedCount: 2,
      storedNewCount: 1,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 1,
      errors: ["Second normalizer failed"]
    });
    await expect(proposalRepository.findAll()).resolves.toHaveLength(1);
  });
});
