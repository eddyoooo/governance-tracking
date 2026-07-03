import { describe, expect, it } from "@jest/globals";
import {
  findNewestRawGovernanceItem,
  updateSourceActivity
} from "../../src/sourceActivity/sourceActivity.service.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import { createFakeProtocolAdapter, createRawGovernanceItem } from "../helpers/builders.js";

const config = {
  warningDays: 14,
  criticalDays: 30,
  minFetchedCount: 1
};

describe("source activity watchdog", () => {
  it("finds the newest raw governance item by publishedAt", () => {
    const newest = createRawGovernanceItem({
      sourceId: "newest",
      publishedAt: "2026-07-02T00:00:00.000Z"
    });
    const oldest = createRawGovernanceItem({
      sourceId: "oldest",
      publishedAt: "2026-06-01T00:00:00.000Z"
    });

    expect(findNewestRawGovernanceItem([oldest, newest])?.sourceId).toBe(
      "newest"
    );
    expect(
      findNewestRawGovernanceItem([
        createRawGovernanceItem({ publishedAt: "not-a-date" })
      ])
    ).toBeNull();
  });

  it("records healthy source activity when raw forum items are recent", async () => {
    const repository = new MemorySourceActivityRepository();
    const adapter = createFakeProtocolAdapter({ protocol: "aave" });
    const record = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [
        createRawGovernanceItem({
          protocol: "aave",
          sourceId: "25170",
          publishedAt: "2026-07-01T00:00:00.000Z"
        })
      ],
      fetchedAt: "2026-07-02T00:00:00.000Z",
      config
    });

    expect(record).toMatchObject({
      protocol: "aave",
      sourceType: "forum",
      latestRawSourceId: "25170",
      latestRawPublishedAt: "2026-07-01T00:00:00.000Z",
      lastFetchedCount: 1,
      consecutiveStaleRuns: 0,
      status: "healthy"
    });
    await expect(repository.findByProtocol("aave")).resolves.toMatchObject({
      latestRawSourceId: "25170",
      status: "healthy"
    });
  });

  it("increments stale runs when the raw source does not advance", async () => {
    const repository = new MemorySourceActivityRepository();
    const adapter = createFakeProtocolAdapter({ protocol: "uniswap" });
    const rawItem = createRawGovernanceItem({
      protocol: "uniswap",
      sourceId: "26035",
      publishedAt: "2026-07-01T00:00:00.000Z"
    });

    await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [rawItem],
      fetchedAt: "2026-07-02T00:00:00.000Z",
      config
    });
    const second = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [rawItem],
      fetchedAt: "2026-07-02T06:00:00.000Z",
      config
    });

    expect(second).toMatchObject({
      consecutiveStaleRuns: 1,
      status: "healthy"
    });
  });

  it("resets stale runs when the raw source advances again", async () => {
    const repository = new MemorySourceActivityRepository();
    const adapter = createFakeProtocolAdapter({ protocol: "aave" });
    const firstRawItem = createRawGovernanceItem({
      protocol: "aave",
      sourceId: "25170",
      publishedAt: "2026-07-01T00:00:00.000Z"
    });

    await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [firstRawItem],
      fetchedAt: "2026-07-02T00:00:00.000Z",
      config
    });
    await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [firstRawItem],
      fetchedAt: "2026-07-02T06:00:00.000Z",
      config
    });
    const advanced = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [
        createRawGovernanceItem({
          protocol: "aave",
          sourceId: "25171",
          publishedAt: "2026-07-02T05:00:00.000Z"
        }),
        firstRawItem
      ],
      fetchedAt: "2026-07-02T06:15:00.000Z",
      config
    });

    expect(advanced).toMatchObject({
      latestRawSourceId: "25171",
      latestRawPublishedAt: "2026-07-02T05:00:00.000Z",
      consecutiveStaleRuns: 0,
      status: "healthy"
    });
  });

  it("marks old source activity as warning or critical by age", async () => {
    const repository = new MemorySourceActivityRepository();
    const adapter = createFakeProtocolAdapter({ protocol: "lido" });
    const warning = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [
        createRawGovernanceItem({
          publishedAt: "2026-06-15T00:00:00.000Z"
        })
      ],
      fetchedAt: "2026-07-02T00:00:00.000Z",
      config
    });
    const critical = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [
        createRawGovernanceItem({
          sourceId: "older",
          publishedAt: "2026-05-01T00:00:00.000Z"
        })
      ],
      fetchedAt: "2026-07-02T00:00:00.000Z",
      config
    });

    expect(warning.status).toBe("warning");
    expect(warning.statusReason).toContain("17 day(s) old");
    expect(critical.status).toBe("critical");
    expect(critical.statusReason).toContain("62 day(s) old");
  });

  it("marks empty raw fetches as critical while preserving previous latest source", async () => {
    const repository = new MemorySourceActivityRepository();
    const adapter = createFakeProtocolAdapter({ protocol: "aave" });

    await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [
        createRawGovernanceItem({
          protocol: "aave",
          sourceId: "25170",
          publishedAt: "2026-07-01T00:00:00.000Z"
        })
      ],
      fetchedAt: "2026-07-02T00:00:00.000Z",
      config
    });
    const empty = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [],
      fetchedAt: "2026-07-02T06:00:00.000Z",
      config
    });

    expect(empty).toMatchObject({
      latestRawSourceId: "25170",
      lastFetchedCount: 0,
      consecutiveStaleRuns: 1,
      status: "critical"
    });
    expect(empty.statusReason).toBe(
      "Fetched 0 raw item(s), below minimum 1."
    );
  });

  it("marks low-volume raw fetches as critical even when the newest item is recent", async () => {
    const repository = new MemorySourceActivityRepository();
    const adapter = createFakeProtocolAdapter({ protocol: "uniswap" });
    const lowVolume = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [
        createRawGovernanceItem({
          protocol: "uniswap",
          sourceId: "26035",
          publishedAt: "2026-07-02T05:00:00.000Z"
        })
      ],
      fetchedAt: "2026-07-02T06:00:00.000Z",
      config: {
        ...config,
        minFetchedCount: 2
      }
    });

    expect(lowVolume).toMatchObject({
      lastFetchedCount: 1,
      status: "critical"
    });
    expect(lowVolume.statusReason).toBe(
      "Fetched 1 raw item(s), below minimum 2."
    );
  });

  it("treats future-dated source items as recent instead of falsely stale", async () => {
    const repository = new MemorySourceActivityRepository();
    const adapter = createFakeProtocolAdapter({ protocol: "lido" });
    const record = await updateSourceActivity({
      repository,
      source: adapter.source,
      rawItems: [
        createRawGovernanceItem({
          protocol: "lido",
          sourceId: "future",
          publishedAt: "2026-07-03T00:00:00.000Z"
        })
      ],
      fetchedAt: "2026-07-02T00:00:00.000Z",
      config
    });

    expect(record).toMatchObject({
      latestRawSourceId: "future",
      status: "healthy"
    });
  });
});
