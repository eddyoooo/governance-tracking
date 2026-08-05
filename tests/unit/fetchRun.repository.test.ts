import { describe, expect, it } from "@jest/globals";
import {
  MemoryFetchRunRepository,
  type FetchRun
} from "../../src/storage/fetchRun.repository.js";

function createRun(overrides: Partial<FetchRun> = {}): FetchRun {
  return {
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
    errors: [],
    ...overrides
  };
}

describe("MemoryFetchRunRepository", () => {
  it("stores and retrieves fetch runs by id", async () => {
    const repository = new MemoryFetchRunRepository();
    const run = createRun();

    await repository.upsert(run);

    await expect(repository.findById(run.id)).resolves.toEqual(run);
  });

  it("merges repeated upserts by replacing the run state", async () => {
    const repository = new MemoryFetchRunRepository();
    const running = createRun();
    const finished = createRun({
      finishedAt: "2026-06-05T00:01:00.000Z",
      status: "success",
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      skippedCount: 1
    });

    await repository.upsert(running);
    await repository.upsert(finished);

    await expect(repository.findById(running.id)).resolves.toEqual(finished);
  });

  it("returns null for unknown fetch run ids", async () => {
    const repository = new MemoryFetchRunRepository();

    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  it("lists latest fetch runs newest first with a limit", async () => {
    const repository = new MemoryFetchRunRepository();

    await repository.upsert(
      createRun({
        id: "older",
        startedAt: "2026-06-05T00:00:00.000Z"
      })
    );
    await repository.upsert(
      createRun({
        id: "newer",
        startedAt: "2026-06-06T00:00:00.000Z"
      })
    );

    await expect(repository.findAll()).resolves.toMatchObject([
      { id: "newer" },
      { id: "older" }
    ]);
    await expect(repository.findAll(1)).resolves.toMatchObject([{ id: "newer" }]);
  });

  it("finds the latest run for one protocol without being displaced by other protocols", async () => {
    const repository = new MemoryFetchRunRepository();

    await repository.upsert(
      createRun({
        id: "aave-latest",
        protocol: "aave",
        startedAt: "2026-06-05T00:00:00.000Z"
      })
    );
    await repository.upsert(
      createRun({
        id: "lido-newer-global",
        protocol: "lido",
        startedAt: "2026-06-06T00:00:00.000Z"
      })
    );

    await expect(repository.findLatestByProtocol("aave")).resolves.toMatchObject({
      id: "aave-latest"
    });
    await expect(repository.findLatestByProtocol("uniswap")).resolves.toBeNull();
  });

  it("finds the latest successful run while ignoring newer failed and running attempts", async () => {
    const repository = new MemoryFetchRunRepository();

    await repository.upsert(
      createRun({
        id: "successful",
        protocol: "uniswap",
        startedAt: "2026-06-05T00:00:00.000Z",
        finishedAt: "2026-06-05T00:01:00.000Z",
        status: "success"
      })
    );
    await repository.upsert(
      createRun({
        id: "failed",
        protocol: "uniswap",
        startedAt: "2026-06-06T00:00:00.000Z",
        finishedAt: "2026-06-06T00:01:00.000Z",
        status: "failed"
      })
    );
    await repository.upsert(
      createRun({
        id: "running",
        protocol: "uniswap",
        startedAt: "2026-06-07T00:00:00.000Z",
        status: "running"
      })
    );

    await expect(
      repository.findLatestSuccessfulByProtocol("uniswap")
    ).resolves.toMatchObject({ id: "successful" });
    await expect(
      repository.findLatestSuccessfulByProtocol("aave")
    ).resolves.toBeNull();
  });

  it("clears in-memory fetch run state for repeatable demo runs", async () => {
    const repository = new MemoryFetchRunRepository();

    await repository.upsert(createRun());
    expect(await repository.findAll()).toHaveLength(1);

    repository.clear();

    await expect(repository.findAll()).resolves.toEqual([]);
    await expect(repository.findById("fetchRun_lido_test")).resolves.toBeNull();
  });
});
