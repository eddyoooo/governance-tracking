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
import { TelegramNotificationService } from "../../src/notifications/index.js";
import { ProtocolRegistry } from "../../src/protocols/registry.js";
import { createApp } from "../../src/server.js";
import { MemoryFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemoryProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import { createLogger } from "../../src/utils/logger.js";
import {
  createFakeProtocolAdapter,
  createRawGovernanceItem,
  createSilentLogger,
  createTelegramApiSuccessResponse,
  testEnv
} from "../helpers/builders.js";

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];

  getRecipients() {
    return [{ key: "recipient-1", maskedId: "*****1111" }];
  }

  async send(
    message: NotificationMessage,
    _recipientKeys?: readonly string[]
  ): Promise<void> {
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
        "POST /api/admin/fetch-onchain/:protocol",
        "POST /api/admin/status/send",
        "GET /api/admin/fetch-runs",
        "GET /api/admin/source-activity",
        "GET /api/admin/governance-votes",
        "GET /api/admin/onchain-source-status",
        "GET /api/admin/onchain-scan-runs"
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
      schedulerEnabled: false,
      forumGovernance: {
        enabledProtocols: ["lido", "aave", "uniswap", "cow"],
        schedule: "0 8 * * *"
      }
    });
  });

  it("reports explicitly disabled forum adapters accurately", async () => {
    const { app } = createApp({
      env: testEnv({ COW_ENABLED: "false", AAVE_ENABLED: "false" })
    });

    const response = await request(app).get("/health").expect(200);

    expect(response.body.forumGovernance).toEqual({
      enabledProtocols: ["lido", "uniswap"],
      schedule: "0 8 * * *"
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
    const cow = await request(app).post("/api/admin/fetch/cow").expect(200);

    expect(fetchJob.run).toHaveBeenNthCalledWith(1, "lido");
    expect(fetchJob.run).toHaveBeenNthCalledWith(2, "aave");
    expect(fetchJob.run).toHaveBeenNthCalledWith(3, "uniswap");
    expect(fetchJob.run).toHaveBeenNthCalledWith(4, "cow");
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
    expect(cow.body).toMatchObject({
      protocol: "cow",
      fetchedCount: 2,
      storedNewCount: 1,
      skippedCount: 1
    });
  });

  it("runs the real CoW fixture pipeline through the API without duplicates", async () => {
    const notificationService = new RecordingNotificationService();
    const { app, context } = createApp({
      env: testEnv({
        COW_ENABLED: "true",
        SOURCE_ACTIVITY_WARNING_DAYS: "3650",
        SOURCE_ACTIVITY_CRITICAL_DAYS: "7300",
        COW_ALLOWED_PUBLISHERS: JSON.stringify([
          "notsoformal",
          "Kowrigan",
          "harisang",
          "felixhenneke",
          "KPK"
        ])
      }),
      notificationService
    });
    await context.protocolStateRepository.initializeBaseline("cow", true);

    const first = await request(app).post("/api/admin/fetch/cow").expect(200);
    const second = await request(app).post("/api/admin/fetch/cow").expect(200);

    expect(first.body).toMatchObject({
      protocol: "cow",
      fetchedCount: 4,
      allowlistedCount: 2,
      storedNewCount: 2,
      unchangedExistingCount: 0,
      skippedCount: 2,
      notificationSentCount: 2,
      notificationFailedCount: 0,
      errors: []
    });
    expect(second.body).toMatchObject({
      protocol: "cow",
      fetchedCount: 4,
      allowlistedCount: 2,
      storedNewCount: 0,
      unchangedExistingCount: 2,
      skippedCount: 2,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    });
    expect(notificationService.messages).toHaveLength(2);
    expect(notificationService.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "cow",
          publisherName: "felixhenneke"
        }),
        expect.objectContaining({ protocol: "cow", publisherName: "KPK" })
      ])
    );
    await expect(
      context.proposalRepository.findBySourceIdentity("cow", "forum", "3527")
    ).resolves.toBeNull();
    await expect(
      context.proposalRepository.findBySourceIdentity("cow", "forum", "3494")
    ).resolves.toMatchObject({ publisherName: "KPK" });
    await expect(context.proposalRepository.findAll()).resolves.toHaveLength(2);
  });

  it("silently establishes the real CoW fixture baseline before allowing future alerts", async () => {
    const notificationService = new RecordingNotificationService();
    const { app, context } = createApp({
      env: testEnv({
        COW_ENABLED: "true",
        SOURCE_ACTIVITY_WARNING_DAYS: "3650",
        SOURCE_ACTIVITY_CRITICAL_DAYS: "7300",
        COW_ALLOWED_PUBLISHERS: JSON.stringify([
          "notsoformal",
          "Kowrigan",
          "harisang",
          "felixhenneke",
          "KPK"
        ])
      }),
      notificationService
    });

    const baseline = await request(app).post("/api/admin/fetch/cow").expect(200);
    const repeated = await request(app).post("/api/admin/fetch/cow").expect(200);
    const proposals = await context.proposalRepository.findAll();

    expect(baseline.body).toMatchObject({
      protocol: "cow",
      fetchedCount: 4,
      allowlistedCount: 2,
      storedNewCount: 2,
      baselineSeededCount: 2,
      unchangedExistingCount: 0,
      skippedCount: 2,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    });
    expect(repeated.body).toMatchObject({
      protocol: "cow",
      fetchedCount: 4,
      allowlistedCount: 2,
      storedNewCount: 0,
      baselineSeededCount: 0,
      unchangedExistingCount: 2,
      skippedCount: 2,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    });
    expect(notificationService.messages).toEqual([]);
    expect(proposals).toHaveLength(2);
    expect(proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "cow",
          publisherName: "felixhenneke",
          notificationStatus: "skipped"
        }),
        expect.objectContaining({
          protocol: "cow",
          publisherName: "KPK",
          notificationStatus: "skipped"
        })
      ])
    );
    await expect(
      context.protocolStateRepository.findByProtocol("cow")
    ).resolves.toMatchObject({ baselineStatus: "complete" });
    await expect(
      context.sourceActivityRepository.findByProtocol("cow")
    ).resolves.toMatchObject({
      protocol: "cow",
      latestRawSourceId: "3527",
      lastFetchedCount: 4,
      status: "healthy"
    });
  });

  it("keeps CoW notifications failed until Telegram returns a real success acknowledgement", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      async () =>
        new Response("<html>proxy accepted the request</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
    );
    const notificationService = new TelegramNotificationService({
      botToken: "test-token",
      allowedUserIds: ["111111111"],
      fetchImpl,
      logger: createSilentLogger()
    });
    const { app, context } = createApp({
      env: testEnv({
        COW_ENABLED: "true",
        SOURCE_ACTIVITY_WARNING_DAYS: "3650",
        SOURCE_ACTIVITY_CRITICAL_DAYS: "7300",
        COW_ALLOWED_PUBLISHERS: JSON.stringify([
          "notsoformal",
          "Kowrigan",
          "harisang",
          "felixhenneke",
          "KPK"
        ])
      }),
      notificationService
    });
    await context.protocolStateRepository.initializeBaseline("cow", true);

    const failedFetch = await request(app)
      .post("/api/admin/fetch/cow")
      .expect(200);
    const failedProposals = await context.proposalRepository.findAll();

    expect(failedFetch.body).toMatchObject({
      protocol: "cow",
      storedNewCount: 2,
      notificationSentCount: 0,
      notificationFailedCount: 2
    });
    expect(failedFetch.body.errors).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(failedProposals).toHaveLength(2);
    expect(
      failedProposals.every(
        (proposal) =>
          proposal.notificationStatus === "failed" &&
          Object.values(proposal.notificationDeliveries ?? {}).every(
            (delivery) =>
              delivery.status === "failed" && Boolean(delivery.nextRetryAt)
          )
      )
    ).toBe(true);

    fetchImpl.mockImplementation(async () => createTelegramApiSuccessResponse());
    const latestRetryAt = failedProposals
      .flatMap((proposal) =>
        Object.values(proposal.notificationDeliveries ?? {}).map(
          (delivery) => delivery.nextRetryAt ?? ""
        )
      )
      .sort()
      .at(-1);
    const recovery = await context.notificationDispatcher.recoverOutstanding(
      latestRetryAt ?? new Date().toISOString()
    );

    expect(recovery).toMatchObject({
      candidateCount: 2,
      attemptedProposalCount: 2,
      attemptedRecipientCount: 2,
      recoveredCount: 2,
      stillFailedCount: 0,
      errors: []
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(
      (await context.proposalRepository.findAll()).every(
        (proposal) => proposal.notificationStatus === "sent"
      )
    ).toBe(true);
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
        sourceActivityRepository: new MemorySourceActivityRepository(),
        protocolStateRepository: new MemoryProtocolStateRepository()
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
        sourceActivityRepository,
        protocolStateRepository: new MemoryProtocolStateRepository()
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

  it("sends the daily admin status report through the manual admin endpoint", async () => {
    const adminStatusReporter = {
      enabled: true,
      sendDailyStatusReport: jest.fn(async () => ({
        healthy: true,
        message: "<b>GOVERNANCE MONITOR DAILY STATUS</b>\nStatus: OK",
        problems: []
      }))
    };
    const { app } = createApp({
      env: testEnv(),
      adminStatusReporter: adminStatusReporter as never
    });

    const response = await request(app).post("/api/admin/status/send").expect(200);

    expect(adminStatusReporter.sendDailyStatusReport).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({
      sent: true,
      healthy: true,
      problems: []
    });
  });

  it("returns a clear conflict when manually sending disabled admin status reports", async () => {
    const adminStatusReporter = {
      enabled: false,
      sendDailyStatusReport: jest.fn()
    };
    const { app } = createApp({
      env: testEnv(),
      adminStatusReporter: adminStatusReporter as never
    });

    const response = await request(app)
      .post("/api/admin/status/send")
      .expect(409);

    expect(response.body.error).toBe("Admin status reports are disabled.");
    expect(adminStatusReporter.sendDailyStatusReport).not.toHaveBeenCalled();
  });

  it("surfaces operational repository and admin-delivery failures as 500 responses", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    jest
      .spyOn(fetchRunRepository, "findAll")
      .mockRejectedValue(new Error("Fetch-run storage unavailable"));
    const fetchRunApp = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository: new MemoryProposalRepository(),
        fetchRunRepository,
        sourceActivityRepository: new MemorySourceActivityRepository(),
        protocolStateRepository: new MemoryProtocolStateRepository()
      }
    }).app;
    const sourceActivityRepository = new MemorySourceActivityRepository();
    jest
      .spyOn(sourceActivityRepository, "findAll")
      .mockRejectedValue(new Error("Source-activity storage unavailable"));
    const sourceActivityApp = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository: new MemoryProposalRepository(),
        fetchRunRepository: new MemoryFetchRunRepository(),
        sourceActivityRepository,
        protocolStateRepository: new MemoryProtocolStateRepository()
      }
    }).app;
    const adminStatusApp = createApp({
      env: testEnv(),
      adminStatusReporter: {
        enabled: true,
        sendDailyStatusReport: jest.fn(async () => {
          throw new Error("Telegram admin delivery unavailable");
        })
      } as never
    }).app;

    await request(fetchRunApp)
      .get("/api/admin/fetch-runs")
      .expect(500)
      .expect(({ body }) => {
        expect(body.error).toBe("Fetch-run storage unavailable");
      });
    await request(sourceActivityApp)
      .get("/api/admin/source-activity")
      .expect(500)
      .expect(({ body }) => {
        expect(body.error).toBe("Source-activity storage unavailable");
      });
    await request(adminStatusApp)
      .post("/api/admin/status/send")
      .expect(500)
      .expect(({ body }) => {
        expect(body.error).toBe("Telegram admin delivery unavailable");
      });
  });

  it("does not expose unexpected internal error details in production responses", async () => {
    const sensitiveMessage =
      "Firestore request failed with credential private-key-fragment";
    const fetchJob = {
      run: jest.fn(async () => {
        throw new Error(sensitiveMessage);
      })
    };
    const { app } = createApp({
      env: testEnv({
        NODE_ENV: "production"
      }),
      fetchJob: fetchJob as never
    });

    const response = await request(app)
      .post("/api/admin/fetch/lido")
      .expect(500);

    expect(response.body).toEqual({ error: "Internal server error." });
    expect(response.text).not.toContain(sensitiveMessage);
    expect(response.text).not.toContain("private-key-fragment");
  });

  it("returns a clear 400 for malformed JSON request bodies", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app)
      .post("/api/admin/status/send")
      .set("content-type", "application/json")
      .send("{not-json")
      .expect(400);

    expect(response.body.error).toBe("Malformed JSON request body.");
  });

  it("checks API auth before parsing request bodies when auth is enabled", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "  test-token  "
      })
    });

    const response = await request(app)
      .post("/api/admin/status/send")
      .set("content-type", "application/json")
      .send("{not-json")
      .expect(401);

    expect(response.body.error).toBe("Missing API auth token.");
  });

  it("does not expose removed manual notification recovery endpoints", async () => {
    const { app } = createApp({ env: testEnv() });

    await request(app).post("/api/admin/notify-pending").expect(404);
    await request(app)
      .post("/api/admin/notifications/failed/proposal-id/acknowledge")
      .expect(404);
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
    await request(app).post("/api/admin/status/send").expect(401);
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
      // Keep the middleware defensive even if a caller bypasses loadEnv's
      // startup validation with programmatic configuration.
      env: {
        ...testEnv(),
        apiAuthEnabled: true,
        apiAuthToken: ""
      }
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
    const protocolStateRepository = new MemoryProtocolStateRepository();
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
    await protocolStateRepository.initializeBaseline(
      "lido",
      true,
      "2026-06-01T00:00:00.000Z"
    );

    const fetchJob = new FetchProtocolGovernanceJob(
      registry,
      proposalRepository,
      fetchRunRepository,
      sourceActivityRepository,
      createSilentLogger(),
      {
        notificationService,
        protocolStateRepository
      }
    );
    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository,
        fetchRunRepository,
        sourceActivityRepository,
        protocolStateRepository
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
