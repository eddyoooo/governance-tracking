import { describe, expect, it } from "@jest/globals";
import { MemoryProtocolStateRepository } from "../../src/storage/protocolState.repository.js";

describe("MemoryProtocolStateRepository", () => {
  it("keeps an empty protocol in seeding state until explicitly completed", async () => {
    const repository = new MemoryProtocolStateRepository();

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

    expect(initial).toMatchObject({
      protocol: "lido",
      baselineStatus: "seeding",
      baselineStartedAt: "2026-07-24T08:00:00.000Z"
    });
    expect(initial).not.toHaveProperty("baselineCompletedAt");
    expect(repeated).toEqual(initial);

    const completed = await repository.markBaselineComplete(
      "lido",
      "2026-07-24T08:10:00.000Z"
    );

    expect(completed).toMatchObject({
      baselineStatus: "complete",
      baselineCompletedAt: "2026-07-24T08:10:00.000Z"
    });
    await expect(
      repository.markBaselineComplete("lido", "2026-07-24T09:00:00.000Z")
    ).resolves.toEqual(completed);
  });

  it("immediately completes initialization when protocol proposals already exist", async () => {
    const repository = new MemoryProtocolStateRepository();

    await expect(
      repository.initializeBaseline(
        "aave",
        true,
        "2026-07-24T09:00:00.000Z"
      )
    ).resolves.toEqual({
      protocol: "aave",
      baselineStatus: "complete",
      baselineStartedAt: "2026-07-24T09:00:00.000Z",
      baselineCompletedAt: "2026-07-24T09:00:00.000Z",
      createdAt: "2026-07-24T09:00:00.000Z",
      updatedAt: "2026-07-24T09:00:00.000Z"
    });
  });

  it("clears all protocol state for repeatable memory-mode demos", async () => {
    const repository = new MemoryProtocolStateRepository();
    await repository.initializeBaseline("uniswap", false);

    repository.clear();

    await expect(repository.findByProtocol("uniswap")).resolves.toBeNull();
  });
});
