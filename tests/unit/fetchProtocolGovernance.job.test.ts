import { describe, expect, it, jest } from "@jest/globals";
import { FetchProtocolGovernanceJob } from "../../src/jobs/fetchProtocolGovernance.job.js";
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
}

function createJob(
  adapter = createFakeProtocolAdapter(),
  proposalRepository = new MemoryProposalRepository(),
  fetchRunRepository = new RecordingFetchRunRepository()
) {
  const registry = new ProtocolRegistry();
  registry.register(adapter);

  return {
    job: new FetchProtocolGovernanceJob(
      registry,
      proposalRepository,
      fetchRunRepository,
      createSilentLogger()
    ),
    proposalRepository,
    fetchRunRepository
  };
}

describe("FetchProtocolGovernanceJob", () => {
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
      storedCount: 1,
      skippedCount: 1
    });
    expect(result.run.status).toBe("success");
    expect(fetchRunRepository.upserts.map((run) => run.status)).toEqual([
      "running",
      "success"
    ]);
    expect(fetchRunRepository.upserts[1]).toMatchObject({
      protocol: "lido",
      fetchedCount: 2,
      storedCount: 1,
      skippedCount: 1
    });
    expect(await proposalRepository.findAll()).toHaveLength(1);
    expect((await proposalRepository.findAll())[0]).toMatchObject({
      sourceId: "1001",
      publisherName: "Allowed Publisher"
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
      storedCount: 0,
      skippedCount: 1
    });
    expect(await proposalRepository.findAll()).toEqual([]);
  });

  it("throws for unknown protocols without recording a fetch run", async () => {
    const { job, fetchRunRepository } = createJob();

    await expect(job.run("missing")).rejects.toThrow(
      "Unknown protocol adapter: missing"
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

    resolveFetch([createRawGovernanceItem()]);
    await expect(firstRun).resolves.toMatchObject({
      fetchedCount: 1,
      storedCount: 1,
      skippedCount: 0
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
      errorMessage: "Lido is unavailable"
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
        rawHash: "a".repeat(64),
        status: "new"
      }));
    const { job, fetchRunRepository } = createJob(
      createFakeProtocolAdapter({
        fetchRecent,
        normalize: normalize as never
      })
    );

    await expect(job.run("lido")).rejects.toThrow("Normalizer broke");
    await expect(job.run("lido")).resolves.toMatchObject({
      fetchedCount: 1,
      storedCount: 1,
      skippedCount: 0
    });

    expect(fetchRunRepository.upserts.map((run) => run.status)).toEqual([
      "running",
      "failed",
      "running",
      "success"
    ]);
  });
});
