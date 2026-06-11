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

  it("lists fetch runs newest first with limits and offsets", async () => {
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
    await expect(
      repository.findAll({ sort: "startedAt_asc", limit: 1, offset: 1 })
    ).resolves.toMatchObject([{ id: "newer" }]);
  });
});
