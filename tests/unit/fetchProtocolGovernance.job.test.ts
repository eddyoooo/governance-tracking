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
import { TelegramNotificationService } from "../../src/notifications/index.js";
import { ProtocolRegistry } from "../../src/protocols/registry.js";
import type { RawGovernanceItem } from "../../src/protocols/types.js";
import {
  type FetchRun,
  type FetchRunRepository
} from "../../src/storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemoryProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import {
  MemorySourceActivityRepository,
  type SourceActivityRepository
} from "../../src/storage/sourceActivity.repository.js";
import {
  createFakeProtocolAdapter,
  createRawGovernanceItem,
  createSilentLogger,
  createTelegramApiSuccessResponse
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

  async findLatestByProtocol(protocol: string): Promise<FetchRun | null> {
    return (
      [...this.runs.values()]
        .filter((run) => run.protocol === protocol)
        .sort((left, right) => -left.startedAt.localeCompare(right.startedAt))[0] ??
      null
    );
  }

  async findLatestSuccessfulByProtocol(
    protocol: string
  ): Promise<FetchRun | null> {
    return (
      [...this.runs.values()]
        .filter(
          (run) => run.protocol === protocol && run.status === "success"
        )
        .sort((left, right) => -left.startedAt.localeCompare(right.startedAt))[0] ??
      null
    );
  }
}

class FailsOnceFetchRunRepository extends RecordingFetchRunRepository {
  private remainingFailures = 1;

  async upsert(run: FetchRun): Promise<void> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("Initial fetch run write failed");
    }

    await super.upsert(run);
  }
}

class AlwaysFailingFetchRunRepository implements FetchRunRepository {
  async upsert(): Promise<void> {
    throw new Error("Fetch run repository unavailable");
  }

  async findById(): Promise<null> {
    return null;
  }

  async findAll(): Promise<FetchRun[]> {
    return [];
  }

  async findLatestByProtocol(): Promise<null> {
    return null;
  }

  async findLatestSuccessfulByProtocol(): Promise<null> {
    return null;
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

  getRecipients() {
    return [{ key: "recipient-1", maskedId: "*****1111" }];
  }

  async send(
    message: NotificationMessage,
    _recipientKeys?: readonly string[]
  ): Promise<void> {
    this.messages.push(message);

    if (this.fail) {
      throw new Error("Telegram exploded");
    }
  }
}

class FailingSourceActivityRepository implements SourceActivityRepository {
  async upsert(): Promise<void> {
    throw new Error("Source activity write failed");
  }

  async findByProtocol(): Promise<null> {
    return null;
  }

  async findAll(): Promise<[]> {
    return [];
  }
}

function createJob(
  adapter = createFakeProtocolAdapter(),
  proposalRepository = new MemoryProposalRepository(),
  fetchRunRepository = new RecordingFetchRunRepository(),
  sourceActivityRepositoryOrNotificationService?:
    | SourceActivityRepository
    | NotificationService,
  notificationService?: NotificationService
) {
  const registry = new ProtocolRegistry();
  registry.register(adapter);
  const sourceActivityRepository =
    sourceActivityRepositoryOrNotificationService &&
    "findByProtocol" in sourceActivityRepositoryOrNotificationService
      ? sourceActivityRepositoryOrNotificationService
      : new MemorySourceActivityRepository();
  const resolvedNotificationService =
    sourceActivityRepositoryOrNotificationService &&
    "findByProtocol" in sourceActivityRepositoryOrNotificationService
      ? notificationService
      : sourceActivityRepositoryOrNotificationService;
  const protocolStateRepository = new MemoryProtocolStateRepository();

  return {
    job: new FetchProtocolGovernanceJob(
      registry,
      proposalRepository,
      fetchRunRepository,
      sourceActivityRepository,
      createSilentLogger(),
      {
        notificationService: resolvedNotificationService,
        protocolStateRepository,
        sourceActivityConfig: {
          warningDays: 365,
          criticalDays: 730,
          minFetchedCount: 1
        }
      }
    ),
    proposalRepository,
    fetchRunRepository,
    sourceActivityRepository,
    protocolStateRepository
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
    const { job, proposalRepository, fetchRunRepository, sourceActivityRepository } = createJob(
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
      baselineSeededCount: 1,
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
      baselineSeededCount: 1,
      updatedExistingCount: 0,
      skippedCount: 1
    });
    expect(await proposalRepository.findAll()).toHaveLength(1);
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      sourceId: "1001",
      publisherName: "Allowed Publisher",
      notificationStatus: "skipped"
    });
    await expect(sourceActivityRepository.findByProtocol("lido")).resolves.toMatchObject({
      protocol: "lido",
      latestRawSourceId: "1001",
      lastFetchedCount: 2,
      status: "healthy"
    });
  });

  it.each(["lido", "aave", "uniswap", "cow"] as const)(
    "silently seeds an empty %s database, then notifies only later discoveries",
    async (protocol) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-06-05T08:00:00.000Z"));
      const oldItem = createRawGovernanceItem({
        protocol,
        sourceId: "1001",
        title: `${protocol} baseline item`,
        publishedAt: "2026-06-04T10:00:00.000Z"
      });
      const newItem = createRawGovernanceItem({
        protocol,
        sourceId: "1002",
        title: `${protocol} newly discovered item`,
        publishedAt: "2026-06-05T12:00:00.000Z"
      });
      let includeNewItem = false;
      const notificationService = new RecordingNotificationService();
      const { job, proposalRepository, protocolStateRepository } = createJob(
        createFakeProtocolAdapter({
          protocol,
          fetchRecent: jest.fn(async () =>
            includeNewItem ? [oldItem, newItem] : [oldItem]
          )
        }),
        new MemoryProposalRepository(),
        new RecordingFetchRunRepository(),
        notificationService
      );

      const baseline = await job.run(protocol);
      includeNewItem = true;
      jest.setSystemTime(new Date("2026-06-06T08:00:00.000Z"));
      const discovery = await job.run(protocol);

      expect(baseline).toMatchObject({
        storedNewCount: 1,
        baselineSeededCount: 1,
        notificationSentCount: 0,
        notificationFailedCount: 0
      });
      expect(discovery).toMatchObject({
        storedNewCount: 1,
        baselineSeededCount: 0,
        unchangedExistingCount: 1,
        notificationSentCount: 1,
        notificationFailedCount: 0
      });
      expect(notificationService.messages.map((message) => message.title)).toEqual([
        `${protocol} newly discovered item`
      ]);
      expect(
        (await proposalRepository.findBySourceIdentity(
          protocol,
          "forum",
          "1001"
        ))?.notificationStatus
      ).toBe("skipped");
      expect(
        (await proposalRepository.findBySourceIdentity(
          protocol,
          "forum",
          "1002"
        ))?.notificationStatus
      ).toBe("sent");
      await expect(
        protocolStateRepository.findByProtocol(protocol)
      ).resolves.toMatchObject({
        baselineStatus: "complete",
        baselineCompletedAt: expect.any(String)
      });
    }
  );

  it("treats an existing protocol dataset as an already-established baseline", async () => {
    const proposalRepository = new MemoryProposalRepository();
    const existingRaw = createRawGovernanceItem({
      sourceId: "1001",
      title: "Existing record"
    });
    await proposalRepository.upsert(
      createFakeProtocolAdapter().normalize(existingRaw),
      {
        notificationStatusForNew: "skipped"
      }
    );
    const notificationService = new RecordingNotificationService();
    const { job, protocolStateRepository } = createJob(
      createFakeProtocolAdapter({
        items: [
          existingRaw,
          createRawGovernanceItem({
            sourceId: "1002",
            title: "Actually new record"
          })
        ]
      }),
      proposalRepository,
      new RecordingFetchRunRepository(),
      notificationService
    );

    const result = await job.run("lido");

    expect(result).toMatchObject({
      storedNewCount: 1,
      baselineSeededCount: 0,
      unchangedExistingCount: 1,
      notificationSentCount: 1
    });
    expect(notificationService.messages.map((message) => message.title)).toEqual([
      "Actually new record"
    ]);
    await expect(
      protocolStateRepository.findByProtocol("lido")
    ).resolves.toMatchObject({
      baselineStatus: "complete"
    });
  });

  it.each([
    {
      label: "silently stores historical items introduced by an allowlist expansion",
      publishedAt: "2026-07-22T12:00:00.000Z",
      expectedStatus: "skipped",
      expectedSeededCount: 1,
      expectedSentCount: 0
    },
    {
      label: "notifies items published after the previous successful poll",
      publishedAt: "2026-07-23T12:00:00.000Z",
      expectedStatus: "sent",
      expectedSeededCount: 0,
      expectedSentCount: 1
    }
  ])(
    "$label",
    async ({
      publishedAt,
      expectedStatus,
      expectedSeededCount,
      expectedSentCount
    }) => {
      const fetchRunRepository = new RecordingFetchRunRepository();
      await fetchRunRepository.upsert({
        id: "previous-success",
        protocol: "uniswap",
        startedAt: "2026-07-23T07:55:00.000Z",
        finishedAt: "2026-07-23T08:00:00.000Z",
        status: "success",
        fetchedCount: 435,
        allowlistedCount: 46,
        storedNewCount: 0,
        baselineSeededCount: 0,
        updatedExistingCount: 0,
        unchangedExistingCount: 46,
        skippedCount: 389,
        notificationSentCount: 0,
        notificationFailedCount: 0,
        errors: []
      });
      const notificationService = new RecordingNotificationService();
      const { job, proposalRepository, protocolStateRepository } = createJob(
        createFakeProtocolAdapter({
          protocol: "uniswap",
          items: [
            createRawGovernanceItem({
              protocol: "uniswap",
              sourceId: "26168",
              publisherName: "Uniswap Labs",
              title: "Protocol Fee Expansion",
              publishedAt
            })
          ],
          publisherAllowlist: ["UniswapLabs"]
        }),
        new MemoryProposalRepository(),
        fetchRunRepository,
        notificationService
      );
      await protocolStateRepository.initializeBaseline("uniswap", true);

      const result = await job.run("uniswap");
      const stored = await proposalRepository.findBySourceIdentity(
        "uniswap",
        "forum",
        "26168"
      );

      expect(result).toMatchObject({
        storedNewCount: 1,
        baselineSeededCount: expectedSeededCount,
        notificationSentCount: expectedSentCount,
        notificationFailedCount: 0
      });
      expect(stored?.notificationStatus).toBe(expectedStatus);
      expect(notificationService.messages).toHaveLength(expectedSentCount);
    }
  );

  it("uses the previous successful poll rather than a newer failed run when deciding notification freshness", async () => {
    const fetchRunRepository = new RecordingFetchRunRepository();
    const baseRun = {
      protocol: "uniswap",
      fetchedCount: 435,
      allowlistedCount: 46,
      storedNewCount: 0,
      baselineSeededCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 46,
      skippedCount: 389,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    };
    await fetchRunRepository.upsert({
      ...baseRun,
      id: "previous-success",
      startedAt: "2026-07-22T07:55:00.000Z",
      finishedAt: "2026-07-22T08:00:00.000Z",
      status: "success"
    });
    await fetchRunRepository.upsert({
      ...baseRun,
      id: "newer-failure",
      startedAt: "2026-07-23T07:55:00.000Z",
      finishedAt: "2026-07-23T08:00:00.000Z",
      status: "failed",
      errors: ["Forum unavailable"]
    });
    const notificationService = new RecordingNotificationService();
    const { job, protocolStateRepository } = createJob(
      createFakeProtocolAdapter({
        protocol: "uniswap",
        items: [
          createRawGovernanceItem({
            protocol: "uniswap",
            sourceId: "26169",
            publisherName: "Uniswap Labs",
            publishedAt: "2026-07-22T12:00:00.000Z"
          })
        ],
        publisherAllowlist: ["UniswapLabs"]
      }),
      new MemoryProposalRepository(),
      fetchRunRepository,
      notificationService
    );
    await protocolStateRepository.initializeBaseline("uniswap", true);

    await expect(job.run("uniswap")).resolves.toMatchObject({
      storedNewCount: 1,
      baselineSeededCount: 0,
      notificationSentCount: 1
    });
    expect(notificationService.messages).toHaveLength(1);
  });

  it("keeps an interrupted initial baseline in seeding mode until a full fetch succeeds", async () => {
    const fetchRecent = jest
      .fn<() => Promise<RawGovernanceItem[]>>()
      .mockRejectedValueOnce(new Error("Forum temporarily unavailable"))
      .mockResolvedValueOnce([createRawGovernanceItem()]);
    const notificationService = new RecordingNotificationService();
    const { job, proposalRepository, protocolStateRepository } = createJob(
      createFakeProtocolAdapter({ fetchRecent }),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );

    await expect(job.run("lido")).rejects.toThrow(
      "Forum temporarily unavailable"
    );
    await expect(
      protocolStateRepository.findByProtocol("lido")
    ).resolves.toMatchObject({
      baselineStatus: "seeding"
    });

    const recovered = await job.run("lido");

    expect(recovered).toMatchObject({
      storedNewCount: 1,
      baselineSeededCount: 1,
      notificationSentCount: 0
    });
    expect(notificationService.messages).toEqual([]);
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "skipped"
    });
    await expect(
      protocolStateRepository.findByProtocol("lido")
    ).resolves.toMatchObject({
      baselineStatus: "complete"
    });
  });

  it("does not complete an empty first baseline when the source minimum is not met", async () => {
    const fetchRecent = jest
      .fn<() => Promise<RawGovernanceItem[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createRawGovernanceItem()]);
    const notificationService = new RecordingNotificationService();
    const { job, proposalRepository, protocolStateRepository } = createJob(
      createFakeProtocolAdapter({ fetchRecent }),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );

    const emptyRun = await job.run("lido");

    expect(emptyRun).toMatchObject({
      fetchedCount: 0,
      storedNewCount: 0,
      baselineSeededCount: 0,
      notificationSentCount: 0
    });
    await expect(
      protocolStateRepository.findByProtocol("lido")
    ).resolves.toMatchObject({
      baselineStatus: "seeding"
    });

    const healthyRun = await job.run("lido");

    expect(healthyRun).toMatchObject({
      fetchedCount: 1,
      storedNewCount: 1,
      baselineSeededCount: 1,
      notificationSentCount: 0
    });
    expect(notificationService.messages).toEqual([]);
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "skipped"
    });
    await expect(
      protocolStateRepository.findByProtocol("lido")
    ).resolves.toMatchObject({
      baselineStatus: "complete"
    });
  });

  it("records a successful run when all fetched items are skipped", async () => {
    const { job, proposalRepository, sourceActivityRepository } = createJob(
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
    await expect(sourceActivityRepository.findByProtocol("lido")).resolves.toMatchObject({
      latestRawSourceId: "1002",
      lastFetchedCount: 1,
      status: "healthy"
    });
  });

  it("filters non-allowlisted publishers before normalization", async () => {
    const normalize = jest.fn(() => {
      throw new Error("Skipped items must not be normalized");
    });
    const { job, proposalRepository } = createJob(
      createFakeProtocolAdapter({
        items: [
          createRawGovernanceItem({
            sourceId: "1002",
            publisherName: "Random Person"
          })
        ],
        publisherAllowlist: ["Allowed Publisher"],
        normalize: normalize as never
      })
    );

    await expect(job.run("lido")).resolves.toMatchObject({
      fetchedCount: 1,
      allowlistedCount: 0,
      storedNewCount: 0,
      skippedCount: 1,
      errors: []
    });
    expect(normalize).not.toHaveBeenCalled();
    await expect(proposalRepository.findAll()).resolves.toEqual([]);
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
    const { job, proposalRepository, protocolStateRepository } = createJob(
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
    await protocolStateRepository.initializeBaseline("lido", true);

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
    const { job, proposalRepository, protocolStateRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );
    await protocolStateRepository.initializeBaseline("lido", true);

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

  it("fans out production Telegram proposal notifications to every configured allowed user and notifies duplicates only once", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () =>
      createTelegramApiSuccessResponse()
    );
    const notificationService = new TelegramNotificationService({
      botToken: "prod-token",
      allowedUserIds: ["111111111", "222222222"],
      fetchImpl,
      logger: createSilentLogger()
    });
    const { job, proposalRepository, protocolStateRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );
    await protocolStateRepository.initializeBaseline("lido", true);

    const first = await job.run("lido");
    const second = await job.run("lido");
    const bodies = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
    );

    expect(first).toMatchObject({
      storedNewCount: 1,
      notificationSentCount: 1,
      notificationFailedCount: 0
    });
    expect(second).toMatchObject({
      storedNewCount: 0,
      unchangedExistingCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodies.map((body) => body.chat_id)).toEqual(["111111111", "222222222"]);
    expect(JSON.stringify(bodies)).not.toContain("1549323073");
    expect(JSON.stringify(bodies)).toContain("<b>NEW GOVERNANCE ITEM TRACKED</b>");
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "sent"
    });
  });

  it("attempts every production Telegram recipient before marking a new proposal notification failed", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTelegramApiSuccessResponse())
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }));
    const notificationService = new TelegramNotificationService({
      botToken: "prod-token",
      allowedUserIds: ["111111111", "222222222"],
      fetchImpl,
      logger: createSilentLogger()
    });
    const { job, proposalRepository, protocolStateRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );
    await protocolStateRepository.initializeBaseline("lido", true);

    const result = await job.run("lido");
    const bodies = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodies.map((body) => body.chat_id)).toEqual(["111111111", "222222222"]);
    expect(result).toMatchObject({
      storedNewCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 1,
      errors: [
        expect.stringContaining(
          "Telegram delivery unresolved for 1 recipient(s)"
        )
      ]
    });
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "failed",
      notificationError: expect.stringContaining(
        "recipient 2 (*****2222) failed with 403: blocked"
      )
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
    const { job, proposalRepository, protocolStateRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );
    await protocolStateRepository.initializeBaseline("lido", true);

    const result = await job.run("lido");

    expect(result).toMatchObject({
      storedNewCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 1,
      errors: [
        expect.stringContaining(
          "Telegram delivery unresolved for 1 recipient(s)"
        )
      ]
    });
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      notificationStatus: "failed",
      notificationError: expect.stringContaining("Telegram exploded")
    });
  });

  it("does not retry failed proposal notifications during ordinary duplicate fetches", async () => {
    const notificationService = new RecordingNotificationService({ fail: true });
    const { job, proposalRepository, protocolStateRepository } = createJob(
      createFakeProtocolAdapter(),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      notificationService
    );
    await protocolStateRepository.initializeBaseline("lido", true);

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
      notificationError: expect.stringContaining("Telegram exploded")
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
      new MemorySourceActivityRepository(),
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

  it("releases the protocol run lock when the initial fetch-run write fails", async () => {
    const fetchRunRepository = new FailsOnceFetchRunRepository();
    const fetchRecent = jest.fn(async () => [createRawGovernanceItem()]);
    const { job } = createJob(
      createFakeProtocolAdapter({ fetchRecent }),
      new MemoryProposalRepository(),
      fetchRunRepository
    );

    await expect(job.run("lido")).rejects.toThrow(
      "Initial fetch run write failed"
    );

    await expect(job.run("lido")).resolves.toMatchObject({
      fetchedCount: 1,
      storedNewCount: 1
    });
    expect(fetchRecent).toHaveBeenCalledTimes(1);
    expect(fetchRunRepository.upserts.map((run) => run.status)).toEqual([
      "failed",
      "running",
      "success"
    ]);
  });

  it("keeps the original error and releases the lock if failed-run persistence also fails", async () => {
    const fetchRecent = jest.fn(async () => [createRawGovernanceItem()]);
    const { job } = createJob(
      createFakeProtocolAdapter({ fetchRecent }),
      new MemoryProposalRepository(),
      new AlwaysFailingFetchRunRepository()
    );

    await expect(job.run("lido")).rejects.toThrow(
      "Fetch run repository unavailable"
    );
    await expect(job.run("lido")).rejects.toThrow(
      "Fetch run repository unavailable"
    );
    expect(fetchRecent).not.toHaveBeenCalled();
  });

  it("records fetched count when source activity persistence fails", async () => {
    const { job, fetchRunRepository } = createJob(
      createFakeProtocolAdapter({
        items: [
          createRawGovernanceItem({ sourceId: "1001" }),
          createRawGovernanceItem({ sourceId: "1002" })
        ]
      }),
      new MemoryProposalRepository(),
      new RecordingFetchRunRepository(),
      new FailingSourceActivityRepository()
    );

    await expect(job.run("lido")).rejects.toThrow(
      "Source activity write failed"
    );
    expect(fetchRunRepository.upserts[1]).toMatchObject({
      status: "failed",
      fetchedCount: 2,
      errors: ["Source activity write failed"]
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
