import request from "supertest";
import { describe, expect, it, jest } from "@jest/globals";
import {
  OnchainScanAlreadyRunningError,
  UnknownOnchainGovernanceSourceError
} from "../../src/onchain/onchainGovernance.job.js";
import { EvmGovernanceRegistry } from "../../src/onchain/registry.js";
import { createApp } from "../../src/server.js";
import { MemoryFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { MemoryGovernanceRepository } from "../../src/storage/governance.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemoryProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import { testEnv } from "../helpers/builders.js";
import {
  createFakeEvmGovernanceAdapter,
  createGovernanceObservation,
  createGovernanceScanRun,
  createGovernanceSourceState
} from "../helpers/onchainBuilders.js";

function repositories(governanceRepository = new MemoryGovernanceRepository()) {
  return {
    proposalRepository: new MemoryProposalRepository(),
    fetchRunRepository: new MemoryFetchRunRepository(),
    sourceActivityRepository: new MemorySourceActivityRepository(),
    protocolStateRepository: new MemoryProtocolStateRepository(),
    governanceRepository
  };
}

describe("on-chain governance operational API", () => {
  it("reports disabled on-chain tracking without requiring RPC credentials", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/health").expect(200);

    expect(response.body.onchainGovernance).toEqual({
      enabledProtocols: [],
      schedule: "0 */6 * * *"
    });
  });

  it("runs the generic on-chain fetch route with a normalized protocol", async () => {
    const onchainGovernanceJob = {
      run: jest.fn(async (protocol: string) => ({
        id: "scan",
        protocol,
        status: "success",
        baselineSeeding: false,
        decisionsCreated: 1,
        notificationSentCount: 1
      }))
    };
    const { app } = createApp({
      env: testEnv(),
      onchainGovernanceJob: onchainGovernanceJob as never
    });

    const response = await request(app)
      .post("/api/admin/fetch-onchain/UNISWAP")
      .expect(200);

    expect(onchainGovernanceJob.run).toHaveBeenCalledWith("uniswap");
    expect(response.body).toEqual({
      id: "scan",
      protocol: "uniswap",
      status: "success",
      baselineSeeding: false,
      decisionsCreated: 1,
      notificationSentCount: 1
    });
  });

  it("maps unknown, overlapping, and unexpected scanner errors safely", async () => {
    const unknown = createApp({
      env: testEnv(),
      onchainGovernanceJob: {
        run: jest.fn(async () => {
          throw new UnknownOnchainGovernanceSourceError("aave");
        })
      } as never
    }).app;
    const overlapping = createApp({
      env: testEnv(),
      onchainGovernanceJob: {
        run: jest.fn(async () => {
          throw new OnchainScanAlreadyRunningError("uniswap");
        })
      } as never
    }).app;
    const unexpected = createApp({
      env: testEnv({ NODE_ENV: "production" }),
      onchainGovernanceJob: {
        run: jest.fn(async () => {
          throw new Error("RPC URL with secret details");
        })
      } as never
    }).app;

    await request(unknown)
      .post("/api/admin/fetch-onchain/aave")
      .expect(404, {
        error: "On-chain governance source is not enabled for protocol: aave"
      });
    await request(overlapping)
      .post("/api/admin/fetch-onchain/uniswap")
      .expect(409, {
        error: "On-chain governance scan already running for protocol: uniswap"
      });
    await request(unexpected)
      .post("/api/admin/fetch-onchain/uniswap")
      .expect(500, { error: "Internal server error." });
  });

  it("lists persisted decisions, source state, and scan runs", async () => {
    const governanceRepository = new MemoryGovernanceRepository();
    const control = createFakeEvmGovernanceAdapter();
    const registry = new EvmGovernanceRegistry([control.adapter]);

    await governanceRepository.upsertDecision(
      createGovernanceObservation({ proposalId: "1" }),
      {
        notificationStatusForNewEvents: "skipped",
        now: "2026-09-01T00:00:00.000Z"
      }
    );
    await governanceRepository.upsertDecision(
      createGovernanceObservation({
        proposalId: "2",
        status: "succeeded",
        votingEndedAt: "2026-07-25T07:29:47.000Z",
        forVotes: "46604582791345472235524184",
        againstVotes: "1274746482273310161174620",
        abstainVotes: "1813590659889870399210"
      }),
      {
        notificationStatusForNewEvents: "skipped",
        now: "2026-09-02T00:00:00.000Z"
      }
    );
    await governanceRepository.initializeSourceState(createGovernanceSourceState());
    await governanceRepository.upsertScanRun(createGovernanceScanRun());
    const { app } = createApp({
      env: testEnv(),
      repositories: repositories(governanceRepository),
      evmGovernanceRegistry: registry
    });

    const votes = await request(app)
      .get("/api/admin/governance-votes?protocol=UNISWAP&limit=1")
      .expect(200);
    const sources = await request(app)
      .get("/api/admin/onchain-source-status")
      .expect(200);
    const runs = await request(app)
      .get("/api/admin/onchain-scan-runs?limit=1")
      .expect(200);

    expect(votes.body.governanceVotes).toEqual([
      expect.objectContaining({
        proposalId: "2",
        sourceType: "onchain",
        votingEndedAt: "2026-07-25T07:29:47.000Z",
        forVotes: "46604582791345472235524184",
        againstVotes: "1274746482273310161174620",
        abstainVotes: "1813590659889870399210"
      })
    ]);
    expect(sources.body.onchainSources).toEqual([
      expect.objectContaining({ protocol: "uniswap", cursorBlockNumber: 110 })
    ]);
    expect(runs.body.onchainScanRuns).toEqual([
      expect.objectContaining({ protocol: "uniswap", status: "success" })
    ]);
  });

  it("returns an empty list for a valid protocol without a registered on-chain source", async () => {
    const { app } = createApp({ env: testEnv() });

    await request(app)
      .get("/api/admin/governance-votes?protocol=aave")
      .expect(200, { governanceVotes: [] });
  });

  it.each([
    "/api/admin/governance-votes?limit=0",
    "/api/admin/governance-votes?limit=501",
    "/api/admin/governance-votes?limit=1.5",
    "/api/admin/governance-votes?protocol=%20",
    "/api/admin/governance-votes?protocol=uni%2Fswap",
    "/api/admin/onchain-scan-runs?limit=-1"
  ])("rejects invalid operational query %s", async (path) => {
    const { app } = createApp({ env: testEnv() });

    await request(app).get(path).expect(400);
  });

  it("protects every new read and write route with the existing global API token", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "onchain-secret"
      })
    });
    const routes = [
      ["post", "/api/admin/fetch-onchain/uniswap"],
      ["get", "/api/admin/governance-votes"],
      ["get", "/api/admin/onchain-source-status"],
      ["get", "/api/admin/onchain-scan-runs"]
    ] as const;

    for (const [method, path] of routes) {
      await request(app)[method](path).expect(401);
      const authenticated = request(app)[method](path).set(
        "authorization",
        "Bearer onchain-secret"
      );

      if (method === "post") {
        await authenticated.expect(404);
      } else {
        await authenticated.expect(200);
      }
    }
  });
});
