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

describe("API", () => {
  it("returns root service information", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/").expect(200);

    expect(response.body).toMatchObject({
      name: "governance-tracking",
      routes: expect.arrayContaining([
        "GET /health",
        "GET /api/proposals",
        "POST /api/admin/fetch/:protocol",
        "POST /api/admin/notify-pending",
        "GET /api/admin/fetch-runs"
      ])
    });
  });

  it("pretty prints JSON responses outside production", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/").expect(200);

    expect(response.text).toContain('\n  "name": "governance-tracking"');
  });

  it("keeps production JSON responses compact", async () => {
    const { app } = createApp({
      env: testEnv({
        NODE_ENV: "production"
      })
    });

    const response = await request(app).get("/").expect(200);

    expect(response.text).not.toContain('\n  "name": "governance-tracking"');
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

  it("lists registered protocols", async () => {
    const { app } = createApp({
      env: testEnv({
        LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher", "DAO Ops"])
      })
    });

    const response = await request(app).get("/api/protocols").expect(200);

    expect(response.body.protocols).toHaveLength(1);
    expect(response.body.protocols[0]).toMatchObject({
      protocol: "lido",
      enabled: true,
      allowedPublisherCount: 2,
      source: {
        protocol: "lido",
        type: "forum",
        name: "Lido Research Forum",
        baseUrl: "https://research.lido.fi"
      }
    });
  });

  it("lists, filters, limits, and reads stored proposals", async () => {
    const proposalRepository = new MemoryProposalRepository();
    const lidoOlder = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1001",
        publishedAt: "2026-05-01T10:00:00.000Z"
      })
    );
    const lidoNewer = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "lido",
        sourceId: "1002",
        publishedAt: "2026-05-03T10:00:00.000Z"
      })
    );
    const aave = normalizeLidoForumItem(
      createRawGovernanceItem({
        protocol: "aave",
        sourceId: "1003",
        publishedAt: "2026-05-02T10:00:00.000Z"
      })
    );

    await proposalRepository.upsertMany([lidoOlder, lidoNewer, aave]);
    await proposalRepository.updateNotificationStatus(lidoNewer.id, "sent");

    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository,
        fetchRunRepository: new MemoryFetchRunRepository()
      }
    });

    const list = await request(app)
      .get("/api/proposals?protocol=lido&sourceType=forum&limit=1")
      .expect(200);
    expect(list.body.proposals).toHaveLength(1);
    expect(list.body.proposals[0]).toMatchObject({
      id: lidoNewer.id,
      protocol: "lido",
      sourceId: "1002"
    });

    const detail = await request(app).get(`/api/proposals/${lidoNewer.id}`).expect(200);
    expect(detail.body.proposal).toMatchObject({
      id: lidoNewer.id,
      title: lidoNewer.title
    });

    const sourceDetail = await request(app)
      .get(`/api/proposals/source/lido/forum/${lidoNewer.sourceId}`)
      .expect(200);
    expect(sourceDetail.body.proposal).toMatchObject({
      id: lidoNewer.id,
      sourceId: lidoNewer.sourceId
    });

    const filtered = await request(app)
      .get(
        "/api/proposals?publisherName=Allowed%20Publisher&notificationStatus=sent&sort=publishedAt_asc&offset=0&limit=10"
      )
      .expect(200);
    expect(filtered.body.proposals).toHaveLength(1);
    expect(filtered.body.proposals[0]).toMatchObject({
      id: lidoNewer.id,
      notificationStatus: "sent"
    });
  });

  it("rejects invalid proposal list query parameters", async () => {
    const { app } = createApp({ env: testEnv() });

    await request(app)
      .get("/api/proposals?limit=abc")
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe(
          "Query parameter limit must be an integer between 1 and 100."
        );
      });

    await request(app).get("/api/proposals?limit=0").expect(400);
    await request(app).get("/api/proposals?limit=101").expect(400);
    await request(app).get("/api/proposals?offset=-1").expect(400);
    await request(app).get("/api/proposals?sourceType=discord").expect(400);
    await request(app)
      .get("/api/proposals?notificationStatus=queued")
      .expect(400);
    await request(app).get("/api/proposals?sort=createdAt_desc").expect(400);
    await request(app).get("/api/proposals?protocol=lido&protocol=aave").expect(400);
  });

  it("returns 404 for missing proposals", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/api/proposals/missing").expect(404);

    expect(response.body.error).toBe("Proposal not found.");
  });

  it("returns 404 when source identity lookup does not find a stored proposal", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app)
      .get("/api/proposals/source/lido/forum/missing")
      .expect(404);

    expect(response.body.error).toBe("Proposal not found.");
  });

  it("rejects invalid source identity source types", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app)
      .get("/api/proposals/source/lido/discord/1001")
      .expect(400);

    expect(response.body.error).toBe(
      "sourceType must be one of: forum, snapshot, onchain."
    );
  });

  it("keeps debug endpoints disabled by default", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/api/debug/config-safe").expect(404);

    expect(response.body.error).toBe("Debug endpoints are disabled.");
  });

  it("returns safe debug config without exposing secrets", async () => {
    const { app } = createApp({
      env: testEnv({
        ENABLE_DEBUG_ENDPOINTS: "true",
        API_AUTH_TOKEN: "secret-token",
        FIREBASE_PRIVATE_KEY: "private-key"
      })
    });

    const response = await request(app).get("/api/debug/config-safe").expect(200);
    const serialized = JSON.stringify(response.body);

    expect(response.body).toMatchObject({
      fetchIntervalCron: "0 */6 * * *",
      firebase: {
        hasPrivateKey: true
      },
      apiAuth: {
        hasToken: true
      }
    });
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("private-key");
  });

  it("fetches debug Lido recent items through the registered adapter", async () => {
    const registry = new ProtocolRegistry();
    registry.register(
      createFakeProtocolAdapter({
        items: [createRawGovernanceItem({ sourceId: "1001" })]
      })
    );
    const { app } = createApp({
      env: testEnv({
        ENABLE_DEBUG_ENDPOINTS: "true"
      }),
      protocolRegistry: registry
    });

    const response = await request(app).get("/api/debug/lido/recent").expect(200);

    expect(response.body).toMatchObject({
      count: 1,
      items: [
        {
          protocol: "lido",
          sourceId: "1001"
        }
      ]
    });
  });

  it("returns 404 from debug Lido recent when the adapter is missing", async () => {
    const { app } = createApp({
      env: testEnv({
        ENABLE_DEBUG_ENDPOINTS: "true"
      }),
      protocolRegistry: new ProtocolRegistry()
    });

    const response = await request(app).get("/api/debug/lido/recent").expect(404);

    expect(response.body.error).toBe("Lido adapter not found.");
  });

  it("runs the debug fetch-once endpoint", async () => {
    const fetchJob = {
      run: jest.fn(async () => ({
        run: {
          id: "fetchRun_lido_test",
          protocol: "lido",
          startedAt: "2026-06-05T00:00:00.000Z",
          status: "success",
          fetchedCount: 1,
          allowlistedCount: 1,
          storedNewCount: 1,
          updatedExistingCount: 0,
          skippedCount: 0,
          notificationPendingCount: 0,
          notificationSentCount: 0,
          notificationFailedCount: 0,
          errors: []
        },
        fetchedCount: 1,
        allowlistedCount: 1,
        storedNewCount: 1,
        updatedExistingCount: 0,
        skippedCount: 0,
        notificationPendingCount: 0,
        notificationSentCount: 0,
        notificationFailedCount: 0,
        errors: []
      }))
    };
    const { app } = createApp({
      env: testEnv({
        ENABLE_DEBUG_ENDPOINTS: "true"
      }),
      fetchJob: fetchJob as never
    });

    const response = await request(app).post("/api/debug/lido/fetch-once").expect(200);

    expect(fetchJob.run).toHaveBeenCalledWith("lido");
    expect(response.body).toMatchObject({
      fetchedCount: 1,
      storedNewCount: 1,
      skippedCount: 0
    });
  });

  it("returns demo fixtures and resets demo state only in memory mode", async () => {
    const proposalRepository = new MemoryProposalRepository();
    const proposal = normalizeLidoForumItem(createRawGovernanceItem());

    await proposalRepository.upsert(proposal);

    const { app } = createApp({
      env: testEnv({
        ENABLE_DEBUG_ENDPOINTS: "true"
      }),
      repositories: {
        proposalRepository,
        fetchRunRepository: new MemoryFetchRunRepository()
      }
    });

    const fixtures = await request(app).get("/api/debug/demo-fixtures").expect(200);
    expect(fixtures.body.lidoRecentTopics.topic_list.topics).toHaveLength(2);

    await request(app)
      .post("/api/debug/reset-demo-state")
      .expect(200)
      .expect((response) => {
        expect(response.body.reset).toBe(true);
      });
    await expect(proposalRepository.findAll()).resolves.toEqual([]);

    const firestoreLike = createApp({
      env: testEnv({
        STORAGE_MODE: "firestore",
        DEMO_MODE: "false",
        ENABLE_DEBUG_ENDPOINTS: "true"
      }),
      repositories: {
        proposalRepository: new MemoryProposalRepository(),
        fetchRunRepository: new MemoryFetchRunRepository()
      }
    });

    await request(firestoreLike.app)
      .post("/api/debug/reset-demo-state")
      .expect(403);
  });

  it("runs the admin Lido fetch endpoint", async () => {
    const fetchJob = {
      run: jest.fn(async () => ({
        run: {
          id: "fetchRun_lido_test",
          protocol: "lido",
          startedAt: "2026-06-05T00:00:00.000Z",
          status: "success",
          fetchedCount: 2,
          allowlistedCount: 1,
          storedNewCount: 1,
          updatedExistingCount: 0,
          skippedCount: 1,
          notificationPendingCount: 0,
          notificationSentCount: 0,
          notificationFailedCount: 0,
          errors: []
        },
        fetchedCount: 2,
        allowlistedCount: 1,
        storedNewCount: 1,
        updatedExistingCount: 0,
        skippedCount: 1,
        notificationPendingCount: 0,
        notificationSentCount: 0,
        notificationFailedCount: 0,
        errors: []
      }))
    };
    const { app } = createApp({
      env: testEnv(),
      fetchJob: fetchJob as never
    });

    const response = await request(app).post("/api/admin/fetch/lido").expect(200);

    expect(fetchJob.run).toHaveBeenCalledWith("lido");
    expect(response.body).toMatchObject({
      fetchedCount: 2,
      storedNewCount: 1,
      skippedCount: 1
    });
  });

  it("returns 404 for unknown protocol admin fetches", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).post("/api/admin/fetch/missing").expect(404);

    expect(response.body.error).toBe("Unknown protocol adapter: missing");
  });

  it("returns 409 when an admin fetch is already running", async () => {
    const fetchJob = {
      run: jest.fn(async () => {
        throw new FetchAlreadyRunningError("lido");
      })
    };
    const { app } = createApp({
      env: testEnv(),
      fetchJob: fetchJob as never
    });

    const response = await request(app).post("/api/admin/fetch/lido").expect(409);

    expect(response.body.error).toBe("Fetch already running for protocol: lido");
  });

  it("lists fetch runs from the admin endpoint", async () => {
    const fetchRunRepository = new MemoryFetchRunRepository();
    await fetchRunRepository.upsert({
      id: "fetchRun_lido_test",
      protocol: "lido",
      startedAt: "2026-06-05T00:00:00.000Z",
      finishedAt: "2026-06-05T00:01:00.000Z",
      status: "success",
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      updatedExistingCount: 0,
      skippedCount: 1,
      notificationPendingCount: 0,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    });

    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository: new MemoryProposalRepository(),
        fetchRunRepository
      }
    });

    const response = await request(app).get("/api/admin/fetch-runs").expect(200);

    expect(response.body.fetchRuns).toHaveLength(1);
    expect(response.body.fetchRuns[0]).toMatchObject({
      id: "fetchRun_lido_test",
      storedNewCount: 1
    });

    await request(app).get("/api/admin/fetch-runs?limit=bad").expect(400);
    await request(app).get("/api/admin/fetch-runs?sort=finishedAt_desc").expect(400);
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
        fetchRunRepository: new MemoryFetchRunRepository()
      },
      notificationService
    });

    const response = await request(app).post("/api/admin/notify-pending").expect(200);

    expect(response.body).toMatchObject({
      pendingCount: 1,
      sentCount: 1,
      failedCount: 0,
      skippedCount: 0,
      errors: []
    });
    expect(notificationService.messages).toHaveLength(1);
    await expect(proposalRepository.findById(proposal.id)).resolves.toMatchObject({
      notificationStatus: "sent"
    });
  });

  it("returns server errors from failed admin fetches", async () => {
    const fetchJob = {
      run: jest.fn(async () => {
        throw new Error("Fetch failed");
      })
    };
    const { app } = createApp({
      env: testEnv(),
      fetchJob: fetchJob as never
    });

    const response = await request(app).post("/api/admin/fetch/lido").expect(500);

    expect(response.body.error).toBe("Fetch failed");
  });

  it("protects all routes when API auth is enabled", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "test-token",
        ENABLE_DEBUG_ENDPOINTS: "true"
      })
    });

    await request(app).get("/").expect(401);
    await request(app).get("/health").expect(401);
    await request(app).get("/api/proposals").expect(401);
    await request(app).get("/api/protocols").expect(401);
    await request(app).get("/api/debug/config-safe").expect(401);
    await request(app).post("/api/admin/fetch/lido").expect(401);
    await request(app).post("/api/admin/notify-pending").expect(401);
    await request(app).get("/api/admin/fetch-runs").expect(401);
  });

  it("rejects invalid auth tokens and accepts bearer tokens", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "test-token"
      })
    });

    await request(app)
      .get("/health")
      .set("Authorization", "Bearer wrong-token")
      .expect(403);

    await request(app)
      .get("/health")
      .set("Authorization", "Bearer test-tokeN")
      .expect(403);

    const response = await request(app)
      .get("/health")
      .set("Authorization", "Bearer test-token")
      .expect(200);

    expect(response.body.ok).toBe(true);
  });

  it("accepts x-api-token auth headers", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "test-token"
      })
    });

    const response = await request(app)
      .get("/health")
      .set("x-api-token", "test-token")
      .expect(200);

    expect(response.body.ok).toBe(true);
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

  it("applies debug disabled behavior after successful auth", async () => {
    const { app } = createApp({
      env: testEnv({
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "test-token",
        ENABLE_DEBUG_ENDPOINTS: "false"
      })
    });

    const response = await request(app)
      .get("/api/debug/config-safe")
      .set("Authorization", "Bearer test-token")
      .expect(404);

    expect(response.body.error).toBe("Debug endpoints are disabled.");
  });

  it("can execute the real fetch job through the admin route with a fake adapter", async () => {
    const proposalRepository = new MemoryProposalRepository();
    const fetchRunRepository = new MemoryFetchRunRepository();
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
      createSilentLogger()
    );
    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository,
        fetchRunRepository
      },
      protocolRegistry: registry,
      fetchJob
    });

    await request(app)
      .post("/api/admin/fetch/lido")
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          fetchedCount: 2,
          allowlistedCount: 1,
          storedNewCount: 1,
          updatedExistingCount: 0,
          skippedCount: 1
        });
      });

    const proposals = await request(app).get("/api/proposals").expect(200);
    expect(proposals.body.proposals).toHaveLength(1);
    expect(proposals.body.proposals[0]).toMatchObject({
      sourceId: "1001",
      publisherName: "Allowed Publisher"
    });
  });
});
