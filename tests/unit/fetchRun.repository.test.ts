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
    storedCount: 0,
    skippedCount: 0,
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
      storedCount: 1,
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
});
