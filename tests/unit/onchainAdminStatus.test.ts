import { describe, expect, it, jest } from "@jest/globals";
import { buildAdminStatusReport as buildReport } from "../../src/adminStatus/adminStatus.service.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import { EvmGovernanceRegistry } from "../../src/onchain/registry.js";
import { MemoryFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { MemoryGovernanceRepository } from "../../src/storage/governance.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import {
  createFakeProtocolAdapter,
  createRawGovernanceItem,
  testEnv
} from "../helpers/builders.js";
import {
  createFakeEvmGovernanceAdapter,
  createGovernanceObservation,
  createGovernanceScanRun,
  createGovernanceSourceState,
  TEST_SOURCE_KEY
} from "../helpers/onchainBuilders.js";

const DEFAULT_CHECKED_AT = new Date("2026-09-01T09:00:00.000Z");

function buildAdminStatusReport(
  options: Parameters<typeof buildReport>[0]
): ReturnType<typeof buildReport> {
  return buildReport({
    ...options,
    checkedAt: options.checkedAt ?? DEFAULT_CHECKED_AT
  });
}

async function createHealthyForumRepositories() {
  const fetchRunRepository = new MemoryFetchRunRepository();
  const proposalRepository = new MemoryProposalRepository();
  const sourceActivityRepository = new MemorySourceActivityRepository();

  await fetchRunRepository.upsert({
    id: "fetchRun_uniswap",
    protocol: "uniswap",
    startedAt: "2026-09-01T08:00:00.000Z",
    finishedAt: "2026-09-01T08:01:00.000Z",
    status: "success",
    fetchedCount: 100,
    allowlistedCount: 10,
    storedNewCount: 0,
    updatedExistingCount: 0,
    unchangedExistingCount: 10,
    skippedCount: 90,
    notificationSentCount: 0,
    notificationFailedCount: 0,
    errors: []
  });
  await sourceActivityRepository.upsert({
    protocol: "uniswap",
    sourceType: "forum",
    latestRawSourceId: "26000",
    latestRawPublishedAt: "2026-09-01T07:00:00.000Z",
    lastFetchedAt: "2026-09-01T08:01:00.000Z",
    lastFetchedCount: 100,
    consecutiveStaleRuns: 0,
    status: "healthy",
    warningThresholdDays: 14,
    criticalThresholdDays: 30,
    createdAt: "2026-09-01T08:01:00.000Z",
    updatedAt: "2026-09-01T08:01:00.000Z"
  });

  return { fetchRunRepository, proposalRepository, sourceActivityRepository };
}

function registries() {
  const control = createFakeEvmGovernanceAdapter();

  return {
    protocolRegistry: {
      list: jest.fn(() => [
        createFakeProtocolAdapter({
          protocol: "uniswap",
          publisherAllowlist: ["UniswapLabs"]
        })
      ])
    } as never,
    evmGovernanceRegistry: new EvmGovernanceRegistry([control.adapter])
  };
}

function onchainEnv() {
  return testEnv({
    ETHEREUM_RPC_URL: "https://example.com/rpc",
    UNISWAP_ONCHAIN_ENABLED: "true",
    ENABLE_SOURCE_ACTIVITY_ALERTS: "true"
  });
}

describe("daily admin status with on-chain governance", () => {
  it("reports a complete, caught-up source as healthy", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(
      createGovernanceSourceState()
    );
    await governanceRepository.upsertScanRun(createGovernanceScanRun());

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.healthy).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.message).toContain("Pending notifications: 0");
    expect(result.message).toContain("Failed notifications: 0");
    expect(result.message).toContain("On-chain governance:");
    expect(result.message).toContain(
      `- ${TEST_SOURCE_KEY}: healthy; baseline complete; cursor 110/110`
    );
    expect(result.message).toContain("latest scan success");
    expect(result.message).toContain("replay none");
  });

  it("makes a pending live coverage replay explicit", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(
      createGovernanceSourceState({
        replayMode: "live",
        cursorBlockNumber: 99,
        cursorBlockHash: null,
        healthStatus: "failed",
        consecutiveFailures: 1,
        lastError: "Missing canonical lifecycle reference(s): 100:executed"
      })
    );
    await governanceRepository.upsertScanRun(
      createGovernanceScanRun({
        status: "failed",
        errors: ["Missing canonical lifecycle reference(s): 100:executed"]
      })
    );

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toContain(
      "uniswap on-chain governance notification-enabled coverage replay is pending; deterministic lifecycle IDs will prevent duplicate alerts."
    );
    expect(result.message).toContain("replay live");
  });

  it("makes baseline progress and source-health failures visible", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(
      createGovernanceSourceState({
        baselineStatus: "seeding",
        baselineTargetBlock: 1000,
        cursorBlockNumber: 500,
        cursorBlockHash: "0xabc",
        latestFinalizedBlockNumber: 1000,
        healthStatus: "failed",
        consecutiveFailures: 2,
        lastError: "RPC request timed out"
      })
    );
    await governanceRepository.upsertScanRun(
      createGovernanceScanRun({
        status: "failed",
        errors: ["RPC request timed out"]
      })
    );

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "uniswap on-chain governance historical baseline is incomplete: 401/901 block(s) checkpointed (44.5%); 500 block(s) remaining. Historical notifications remain suppressed until completion; the next scan will safely resume from block 501.",
        "uniswap on-chain governance source is failed after 2 consecutive failure(s): RPC request timed out",
        "uniswap latest on-chain governance scan is failed: RPC request timed out"
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain(
      "baseline seeding (401/901 block(s) checkpointed (44.5%); 500 block(s) remaining; historical alerts suppressed)"
    );
    expect(result.message).toContain("last attempt 2026-09-01T00:00:00.000Z");
    expect(result.message).toContain("consecutive failures 2");
  });

  it("sanitizes authenticated RPC URLs from persisted legacy failure details", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    const secretUrl = "https://example.quiknode.pro/project/secret-token";
    await governanceRepository.initializeSourceState(
      createGovernanceSourceState({
        healthStatus: "failed",
        consecutiveFailures: 1,
        lastError: `RPC request failed at ${secretUrl}`
      })
    );
    await governanceRepository.upsertScanRun(
      createGovernanceScanRun({
        status: "failed",
        errors: [`RPC request failed at ${secretUrl}`]
      })
    );

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.problems).toEqual(
      expect.arrayContaining([
        "uniswap on-chain governance source is failed after 1 consecutive failure(s): RPC request failed at [redacted-url]",
        "uniswap latest on-chain governance scan is failed: RPC request failed at [redacted-url]"
      ])
    );
    expect(result.message).not.toContain("secret-token");
    expect(result.message).not.toContain("quiknode.pro");
  });

  it.each([
    [
      "stale successful scan",
      createGovernanceScanRun({
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: "2026-09-01T00:01:00.000Z"
      }),
      "latest on-chain governance scan is older than 12 hours"
    ],
    [
      "malformed scan timestamp",
      createGovernanceScanRun({
        startedAt: "not-a-date",
        finishedAt: undefined
      }),
      "latest on-chain governance scan has an invalid timestamp: not-a-date"
    ]
  ])("reports a %s even when source cursor values look current", async (_name, scan, problem) => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(createGovernanceSourceState());
    await governanceRepository.upsertScanRun(scan);

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository,
      checkedAt: new Date("2026-09-02T00:30:00.000Z")
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toContainEqual(expect.stringContaining(problem));
    expect(result.message).toContain(problem);
  });

  it("reports a complete source whose persisted cursor is behind", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(
      createGovernanceSourceState({
        cursorBlockNumber: 110,
        latestFinalizedBlockNumber: 125
      })
    );
    await governanceRepository.upsertScanRun(createGovernanceScanRun());

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.problems).toContain(
      "uniswap on-chain governance cursor is 15 finalized block(s) behind."
    );
  });

  it("reports an unfinished source that has never completed a scan", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(
      createGovernanceSourceState({
        baselineStatus: "seeding",
        baselineTargetBlock: 1_000,
        cursorBlockNumber: 500,
        latestFinalizedBlockNumber: 1_000,
        healthStatus: "seeding",
        lastSuccessfulScanAt: null
      })
    );

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.problems).toEqual(
      expect.arrayContaining([
        "uniswap on-chain governance historical baseline is incomplete: 401/901 block(s) checkpointed (44.5%); 500 block(s) remaining. Historical notifications remain suppressed until completion; the next scan will safely resume from block 501.",
        "No on-chain governance scan has been recorded for uniswap."
      ])
    );
    expect(result.message).toContain("last success never");
    expect(result.message).toContain("latest scan not recorded");
  });

  it("reports a baseline that has checkpointed its target but was not marked complete", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(
      createGovernanceSourceState({
        baselineStatus: "seeding",
        baselineTargetBlock: 1_000,
        cursorBlockNumber: 1_000,
        latestFinalizedBlockNumber: 1_000,
        healthStatus: "seeding",
        lastSuccessfulScanAt: null
      })
    );
    await governanceRepository.upsertScanRun(
      createGovernanceScanRun({
        status: "running",
        baselineSeeding: true,
        cursorBefore: 999,
        cursorAfter: 1_000,
        latestFinalizedBlock: 1_000,
        finishedAt: undefined
      })
    );

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "uniswap on-chain governance historical baseline is incomplete: 901/901 block(s) checkpointed (100%); 0 block(s) remaining. Historical notifications remain suppressed until completion; all target blocks are checkpointed but baseline completion has not been recorded.",
        "uniswap latest on-chain governance scan is running."
      ])
    );
    expect(result.message).toContain("Status: ATTENTION REQUIRED");
    expect(result.message).toContain("901/901 block(s) checkpointed (100%)");
    expect(result.message).toContain("historical alerts suppressed");
  });

  it("combines forum and lifecycle delivery counts and masks failed recipients", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(createGovernanceSourceState());
    await governanceRepository.upsertScanRun(createGovernanceScanRun());
    await forum.proposalRepository.upsert(
      normalizeLidoForumItem(createRawGovernanceItem({ protocol: "uniswap" })),
      { notificationStatusForNew: "pending" }
    );
    const inserted = await governanceRepository.upsertDecision(
      createGovernanceObservation(),
      { notificationStatusForNewEvents: "pending" }
    );
    await governanceRepository.updateNotificationState(
      inserted.lifecycleEventsCreated[0].id,
      () => ({
        notificationStatus: "failed",
        notificationError: "One recipient failed",
        notificationDeliveries: {
          opaque: {
            recipientKey: "opaque",
            recipientMaskedId: "******3073",
            status: "failed",
            attemptCount: 2,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:30:00.000Z",
            nextRetryAt: "2026-09-01T01:30:00.000Z",
            lastError: "Telegram returned 403"
          }
        }
      })
    );

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("Pending notifications: 1");
    expect(result.message).toContain("Failed notifications: 1");
    expect(result.message).toContain("Failed on-chain lifecycle notifications:");
    expect(result.message).toContain("recipients ******3073 (Telegram returned 403)");
    expect(result.message).not.toContain("1549323073");
  });

  it("falls back to the lifecycle error when recipient details are unavailable", async () => {
    const forum = await createHealthyForumRepositories();
    const governanceRepository = new MemoryGovernanceRepository();
    const registry = registries();
    await governanceRepository.initializeSourceState(createGovernanceSourceState());
    await governanceRepository.upsertScanRun(createGovernanceScanRun());
    const inserted = await governanceRepository.upsertDecision(
      createGovernanceObservation(),
      { notificationStatusForNewEvents: "pending" }
    );
    await governanceRepository.updateNotificationState(
      inserted.lifecycleEventsCreated[0].id,
      () => ({
        notificationStatus: "failed",
        notificationError: "Telegram delivery metadata was unavailable"
      })
    );

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.message).toContain(
      "recipients Telegram delivery metadata was unavailable"
    );
  });

  it("still sends a useful attention report when all on-chain Firestore reads fail", async () => {
    const forum = await createHealthyForumRepositories();
    const registry = registries();
    const failure = async () => {
      throw new Error("Firestore governance collection unavailable");
    };
    const governanceRepository = {
      findAllSourceStates: failure,
      countByNotificationStatus: failure,
      findByNotificationStatus: failure,
      findLatestScanRunBySource: failure
    } as never;

    const result = await buildAdminStatusReport({
      env: onchainEnv(),
      ...registry,
      ...forum,
      governanceRepository
    });

    expect(result.healthy).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Unable to read on-chain governance source states"),
        expect.stringContaining("pending on-chain governance notification count"),
        expect.stringContaining("failed on-chain governance notification count"),
        expect.stringContaining("failed on-chain governance notification details"),
        expect.stringContaining(`latest ${TEST_SOURCE_KEY} on-chain governance scan`),
        "No on-chain governance source state has been recorded for uniswap.",
        "No on-chain governance scan has been recorded for uniswap."
      ])
    );
    expect(result.message).toContain("Pending notifications: unknown");
    expect(result.message).toContain("Failed notifications: unknown");
    expect(result.message).toContain("no source state recorded");
  });
});
