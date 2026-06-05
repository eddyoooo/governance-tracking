import request from "supertest";
import { describe, expect, it, jest } from "@jest/globals";
import { FetchProtocolGovernanceJob } from "../../src/jobs/fetchProtocolGovernance.job.js";
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

describe("API", () => {
  it("returns root service information", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/").expect(200);

    expect(response.body).toMatchObject({
      name: "governance-tracking",
      routes: expect.arrayContaining([
        "GET /health",
        "GET /api/proposals",
        "POST /api/admin/fetch/lido"
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

    const { app } = createApp({
      env: testEnv(),
      repositories: {
        proposalRepository,
        fetchRunRepository: new MemoryFetchRunRepository()
      }
    });

    const list = await request(app)
      .get("/api/proposals?protocol=lido&limit=1")
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
  });

  it("returns 404 for missing proposals", async () => {
    const { app } = createApp({ env: testEnv() });

    const response = await request(app).get("/api/proposals/missing").expect(404);

    expect(response.body.error).toBe("Proposal not found.");
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
          storedCount: 1,
          skippedCount: 0
        },
        fetchedCount: 1,
        storedCount: 1,
        skippedCount: 0
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
      storedCount: 1,
      skippedCount: 0
    });
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
          storedCount: 1,
          skippedCount: 1
        },
        fetchedCount: 2,
        storedCount: 1,
        skippedCount: 1
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
      storedCount: 1,
      skippedCount: 1
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
          storedCount: 1,
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
