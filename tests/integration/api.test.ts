import request from "supertest";
import { describe, expect, it, jest } from "@jest/globals";
import {
  FetchAlreadyRunningError,
  FetchProtocolGovernanceJob
} from "../../src/jobs/fetchProtocolGovernance.job.js";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/index.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import { ProtocolRegistry } from "../../src/protocols/registry.js";
import { createApp } from "../../src/server.js";
import { MemoryFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import { createLogger } from "../../src/utils/logger.js";
import {
  createFakeProtocolAdapter,
  createRawGovernanceItem,
  createSilentLogger,
  testEnv
} from "../helpers/builders.js";

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(message);
  }
}

function createLogCapture() {
  const lines: string[] = [];

  return {
    lines,
    stream: {
      write(line: string) {
        lines.push(line);
      }
    }
  };
}

describe("monitor API", () => {
  it("returns root service information for the monitor surface", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/").expect(200);

    expect(response.body).toMatchObject({
      name: "governance-tracking",
      mode: "monitor",
      routes: [
        "GET /health",
        "POST /api/admin/fetch/:protocol",
        "POST /api/admin/notify-pending",
        "GET /api/admin/fetch-runs",
        "GET /api/admin/source-activity"
      ]
    });
  });

  it("pretty prints JSON responses outside production and keeps production compact", async () => {
    const dev = createApp({ env: testEnv() }).app;
    const production = createApp({
      env: testEnv({
        NODE_ENV: "production"
      })
    }).app;

    const devResponse = await request(dev).get("/").expect(200);
    const productionResponse = await request(production).get("/").expect(200);

    expect(devResponse.text).toContain('\n  "name": "governance-tracking"');
    expect(productionResponse.text).not.toContain('\n  "name": "governance-tracking"');
  });

  it("returns health status", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/health").expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      storageMode: "memory",
      schedulerEnabled: false
    });
  });

  it("does not expose the Express x-powered-by header", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/health").expect(200);

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("does not expose removed dashboard/debug routes", async () => {
    const { app } = createApp({ env: testEnv() });

    await request(app).get("/api/proposals").expect(404);
    await request(app).get("/api/protocols").expect(404);
    await request(app).get("/api/debug/config-safe").expect(404);
  });

  it("runs protocol admin fetch endpoints", async () => {
    const fetchJob = {
      run: jest.fn(async (protocol: string) => ({
        run: {
          id: `fetchRun_${protocol}_test`,
          protocol,
          startedAt: "2026-06-05T00:00:00.000Z",
          status: "success",
          fetchedCount: 2,
          allowlistedCount: 1,
          storedNewCount: 1,
          updatedExistingCount: 0,
          unchangedExistingCount: 0,
          skippedCount: 1,
          notificationSentCount: 0,
          notificationFailedCount: 0,
          errors: []
        },
        protocol,
        fetchedCount: 2,
        allowlistedCount: 1,
        storedNewCount: 1,
        updatedExistingCount: 0,
        unchangedExistingCount: 0,
        skippedCount: 1,
        notificationSentCount: 0,
        notificationFailedCount: 0,
        startedAt: "2026-06-05T00:00:00.000Z",
        finishedAt: "2026-06-05T00:01:00.000Z",
        errors: []
      }))
    };
    const { app } = createApp({
      env: testEnv(),
      fetchJob: fetchJob as never
    });

    const lido = await request(app).post("/api/admin/fetch/LIDO").expect(200);
    const aave = await request(app).post("/api/admin/fetch/aave").expect(200);
    const uniswap = await request(app).post("/api/admin/fetch/uniswap").expect(200);

    expect(fetchJob.run).toHaveBeenNthCalledWith(1, "lido");
    expect(fetchJob.run).toHaveBeenNthCalledWith(2, "aave");
    expect(fetchJob.run).toHaveBeenNthCalledWith(3, "uniswap");
    expect(lido.body).toMatchObject({
      protocol: "lido",
      fetchedCount: 2,
      storedNewCount: 1,
      skippedCount: 1
    });
    expect(aave.body).toMatchObject({
      protocol: "aave",
      fetchedCount: 2,
      storedNewCount: 1,
      skippedCount: 1
    });
    expect(uniswap.body).toMatchObject({
      protocol: "uniswap",
      fetchedCount: 2,
      storedNewCount: 1,
      skippedCount: 1
    });
  });

  it("maps admin fetch errors to stable HTTP statuses", async () => {
    const { app } = createApp({ env: testEnv() });
    const runningFetchJob = {
      run: jest.fn(async () => {
        throw new FetchAlreadyRunningError("lido");
      })
    };
    const failedFetchJob = {
      run: jest.fn(async () => {
        throw new Error("Fetch failed");
      })
    };
    const runningApp = createApp({
      env: testEnv(),
      fetchJob: runningFetchJob as never
    }).app;
    const failedApp = createApp({
      env: testEnv(),
      fetchJob: failedFetchJob as never
    }).app;

    await request(app).post("/api/admin/fetch/missing").expect(404).expect((response) => {
      expect(response.body.error).toBe("Unknown protocol adapter: missing");
    });
    await request(runningApp).post("/api/admin/fetch/lido").expect(409).expect((response) => {
      expect(response.body.error).toBe("Fetch already running for protocol: lido");
    });
    await request(failedApp).post("/api/admin/fetch/lido").expect(500).expect((response) => {
      expect(response.body.error).toBe("Fetch failed");
    });
  });

  it("lists fetch-run audit records from the admin endpoint", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    await fetchRunRepository.upsert({
      id: "fetchRun_lido_older",
      protocol: "lido",
      startedAt: "2026-06-05T00:00:00.000Z",
      finishedAt: "2026-06-05T00:01:00.000Z",
      status: "success",
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    });
    await fetchRunRepository.upsert({
      id: "fetchRun_aave_newer",
      protocol: "aave",
      startedAt: "2026-06-06T00:00:00.000Z",
      finishedAt: "2026-06-06T00:01:00.000Z",
      status: "success",
      fetchedCount: 3,
      allowlistedCount: 2,
      storedNewCount: 2,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 1,
      notificationSentCount: 2,
      notificationFailedCount: 0,
      errors: []
    });

    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository: new MemoryProposalRepository(),
        fetchRunRepository,
        sourceActivityRepository: new MemorySourceActivityRepository()
      }
    });

    const response = await request(app).get("/api/admin/fetch-runs").expect(200);

    expect(response.body.fetchRuns).toHaveLength(2);
    expect(response.body.fetchRuns).toMatchObject([
      {
        id: "fetchRun_aave_newer",
        protocol: "aave",
        storedNewCount: 2
      },
      {
        id: "fetchRun_lido_older",
        protocol: "lido",
        storedNewCount: 1
      }
    ]);
  });

  it("lists source activity watchdog records from the admin endpoint", async () => {
    const sourceActivityRepository = new MemorySourceActivityRepository();

    await sourceActivityRepository.upsert({
      protocol: "aave",
      sourceType: "forum",
      latestRawSourceId: "25170",
      latestRawPublishedAt: "2026-07-01T00:00:00.000Z",
      lastFetchedAt: "2026-07-02T00:00:00.000Z",
      lastFetchedCount: 120,
      consecutiveStaleRuns: 0,
      status: "healthy",
      warningThresholdDays: 14,
      criticalThresholdDays: 30,
      minFetchedCount: 1,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z"
    });

    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository: new MemoryProposalRepository(),
        fetchRunRepository: new MemoryFetchRunRepository(),
        sourceActivityRepository
      }
    });

    const response = await request(app)
      .get("/api/admin/source-activity")
      .expect(200);

    expect(response.body.sourceActivity).toEqual([
      expect.objectContaining({
        protocol: "aave",
        latestRawSourceId: "25170",
        status: "healthy"
      })
    ]);
  });

  it("returns a clear 400 for malformed JSON request bodies", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app)
      .post("/api/admin/notify-pending")
      .set("content-type", "application/json")
      .send("{not-json")
      .expect(400);

    expect(response.body.error).toBe("Malformed JSON request body.");
  });

  it("checks API auth before parsing request bodies when auth is enabled", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "test-token"
      })
    });

    const response = await request(app)
      .post("/api/admin/notify-pending")
      .set("content-type", "application/json")
      .send("{not-json")
      .expect(401);

    expect(response.body.error).toBe("Missing API auth token.");
  });

  it("notifies pending proposals through the admin endpoint", async () => {
    const proposalRepository = new MemoryProposalRepository();
    const notificationService = new RecordingNotificationService();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    await proposalRepository.upsert(proposal, {
      notificationStatusForNew: "pending"
    });

    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository,
        fetchRunRepository: new MemoryFetchRunRepository(),
        sourceActivityRepository: new MemorySourceActivityRepository()
      },
      notificationService
    });

    const response = await request(app).post("/api/admin/notify-pending").expect(200);

    expect(response.body).toMatchObject({
      pendingCount: 1,
      sentCount: 1,
      failedCount: 0
    });
    expect(notificationService.messages).toHaveLength(1);
    await expect(proposalRepository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "sent"
    });
  });

  it("protects all monitor routes when API auth is enabled", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "test-token"
      })
    });

    await request(app).get("/").expect(401);
    await request(app).get("/health").expect(401);
    await request(app).post("/api/admin/fetch/lido").expect(401);
    await request(app).post("/api/admin/notify-pending").expect(401);
    await request(app).get("/api/admin/fetch-runs").expect(401);
    await request(app).get("/api/admin/source-activity").expect(401);
  });

  it("accepts bearer, raw Authorization, and x-api-token auth headers", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "test-token"
      })
    });

    await request(app)
      .get("/health")
      .set("Authorization", "Bearer test-token")
      .expect(200);
    await request(app)
      .get("/health")
      .set("Authorization", "bearer   test-token  ")
      .expect(200);
    await request(app)
      .get("/health")
      .set("Authorization", "BEARER test-token")
      .expect(200);
    await request(app).get("/health").set("Authorization", "test-token").expect(200);
    await request(app).get("/health").set("x-api-token", "test-token").expect(200);
    await request(app)
      .get("/health")
      .set("Authorization", "wrong")
      .set("x-api-token", "test-token")
      .expect(403);
    await request(app).get("/health").set("Authorization", "x").expect(403);
    await request(app)
      .get("/health")
      .set("Authorization", "wrong-token-with-a-different-length")
      .expect(403);
  });

  it("redacts API auth headers from request logs", async () => {
    const capture = createLogCapture();
    const logger = createLogger(
      {
        logLevel: "info",
        nodeEnv: "test"
      },
      capture.stream
    );
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "super-secret-api-value"
      }),
      logger
    });

    await request(app)
      .get("/health")
      .set("Authorization", "Bearer super-secret-api-value")
      .set("x-api-token", "super-secret-api-value")
      .expect(200);

    const serializedLogs = capture.lines.join("");

    expect(serializedLogs).not.toContain("super-secret-api-value");
    expect(serializedLogs).toContain("[redacted]");
  });

  it("fails closed when API auth is enabled without a configured token", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: ""
      })
    });

    const response = await request(app).get("/health").expect(500);

    expect(response.body.error).toBe(
      "API auth is enabled but API_AUTH_TOKEN is not set."
    );
  });

  it("can execute the real fetch job through the admin route with a fake adapter", async () => {
    const proposalRepository = new MemoryProposalRepository();
    const fetchRunRepository = new MemoryFetchRunRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const notificationService = new RecordingNotificationService();
    const registry = new ProtocolRegistry();

    registry.register(
      createFakeProtocolAdapter({
        items: [
          createRawGovernanceItem({
            sourceId: "1001",
            publisherName: "Allowed Publisher"
          }),
          createRawGovernanceItem({
            sourceId: "1002",
            publisherName: "Random Person"
          })
        ],
        publisherAllowlist: ["Allowed Publisher"]
      })
    );

    const fetchJob = new FetchProtocolGovernanceJob(
      registry,
      proposalRepository,
      fetchRunRepository,
      sourceActivityRepository,
      createSilentLogger(),
      {
        notificationService
      }
    );
    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository,
        fetchRunRepository,
        sourceActivityRepository
      },
      protocolRegistry: registry,
      notificationService,
      fetchJob
    });

    const response = await request(app).post("/api/admin/fetch/lido").expect(200);

    expect(response.body).toMatchObject({
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      skippedCount: 1,
      notificationSentCount: 1
    });
    await expect(
      proposalRepository.findBySourceIdentity("lido", "forum", "1001")
    ).resolves.toMatchObject({
      sourceId: "1001",
      notificationStatus: "sent"
    });
    await expect(
      proposalRepository.findBySourceIdentity("lido", "forum", "1002")
    ).resolves.toBeNull();
    await expect(fetchRunRepository.findAll()).resolves.toHaveLength(1);
  });
});
