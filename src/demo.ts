import request, { type Test } from "supertest";
import { loadEnv } from "./config/env.js";
import {
  nonAllowlistedDemoFixture,
  ScriptedLidoDemoAdapter
} from "./demoFixtures/scriptedLidoDemo.adapter.js";
import type { FetchProtocolResult } from "./jobs/fetchProtocolGovernance.job.js";
import type { NotifyPendingResult } from "./notifications/proposalNotifications.js";
import { AaveAdapter } from "./protocols/aave/aave.adapter.js";
import { createAaveDemoClient } from "./protocols/aave/aave.demoClient.js";
import { ProtocolRegistry } from "./protocols/registry.js";
import type { RawGovernanceItem, StoredProposal } from "./protocols/types.js";
import { createApp } from "./server.js";
import type { FetchRun } from "./storage/fetchRun.repository.js";

interface DemoApi {
  get(path: string): Test;
  post(path: string): Test;
}

interface ProposalsResponse {
  proposals: StoredProposal[];
}

interface ProposalResponse {
  proposal: StoredProposal;
}

interface FetchRunsResponse {
  fetchRuns: FetchRun[];
}

interface DebugRecentResponse {
  count: number;
  items: RawGovernanceItem[];
}

const DEMO_ALLOWED_PUBLISHERS = [
  "Lido Labs Foundation - Operations Team",
  "Lido | Finance Team",
  "Lido Ecosystem Foundation - Operations Team"
];
const DEMO_AAVE_ALLOWED_PUBLISHERS = ["AaveLabs", "TokenLogic", "LlamaRisk"];

function readStepDelayMs(): number {
  const raw = process.env.DEMO_STEP_DELAY_MS;

  if (!raw) {
    return 500;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function runStep<T>(
  label: string,
  action: () => Promise<T>,
  delayMs: number
): Promise<T> {
  console.log(`\n${label}`);
  const result = await action();
  printJson(result);
  await sleep(delayMs);

  return result;
}

async function getJson<T>(api: DemoApi, path: string): Promise<T> {
  const response = await api.get(path).expect(200);

  return response.body as T;
}

async function postJson<T>(api: DemoApi, path: string): Promise<T> {
  const response = await api.post(path).expect(200);

  return response.body as T;
}

function summarizeProposal(proposal: StoredProposal) {
  return {
    id: proposal.id,
    sourceIdentity: `${proposal.protocol}/${proposal.sourceType}/${proposal.sourceId}`,
    title: proposal.title,
    publisherName: proposal.publisherName,
    notificationStatus: proposal.notificationStatus,
    firstSeenAt: proposal.firstSeenAt,
    lastSeenAt: proposal.lastSeenAt,
    updatedAt: proposal.updatedAt,
    sourceUrl: proposal.sourceUrl
  };
}

function summarizeFetch(result: FetchProtocolResult) {
  return {
    fetchedCount: result.fetchedCount,
    allowlistedCount: result.allowlistedCount,
    storedNewCount: result.storedNewCount,
    updatedExistingCount: result.updatedExistingCount,
    unchangedExistingCount: result.unchangedExistingCount,
    skippedCount: result.skippedCount,
    notificationSentCount: result.notificationSentCount,
    notificationFailedCount: result.notificationFailedCount,
    errors: result.errors
  };
}

function summarizeFetchRuns(fetchRuns: FetchRun[]) {
  return fetchRuns.map((run) => ({
    id: run.id,
    protocol: run.protocol,
    status: run.status,
    fetchedCount: run.fetchedCount,
    allowlistedCount: run.allowlistedCount,
    storedNewCount: run.storedNewCount,
    updatedExistingCount: run.updatedExistingCount,
    unchangedExistingCount: run.unchangedExistingCount,
    skippedCount: run.skippedCount,
    notificationSentCount: run.notificationSentCount,
    notificationFailedCount: run.notificationFailedCount
  }));
}

function createDemoRegistry(
  lidoAdapter: ScriptedLidoDemoAdapter,
  aaveAdapter: AaveAdapter
): ProtocolRegistry {
  const registry = new ProtocolRegistry();
  registry.register(lidoAdapter);
  registry.register(aaveAdapter);

  return registry;
}

async function main(): Promise<void> {
  const stepDelayMs = readStepDelayMs();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "development",
    STORAGE_MODE: "memory",
    DEMO_MODE: "true",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: "",
    ENABLE_SCHEDULER: "false",
    ENABLE_DEBUG_ENDPOINTS: "true",
    LIDO_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_ALLOWED_PUBLISHERS),
    LIDO_FETCH_MAX_PAGES: "5",
    AAVE_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_AAVE_ALLOWED_PUBLISHERS),
    AAVE_FETCH_MAX_PAGES: "10",
    AAVE_CATEGORY_FETCH_MAX_PAGES: "2",
    API_AUTH_ENABLED: "false",
    LOG_LEVEL: "silent"
  });
  const adapter = new ScriptedLidoDemoAdapter({
    allowedPublishers: env.lidoAllowedPublishers,
    forumBaseUrl: env.lidoForumBaseUrl
  });
  const aaveAdapter = new AaveAdapter({
    enabled: env.aaveEnabled,
    forumBaseUrl: env.aaveForumBaseUrl,
    forumApiBaseUrl: env.aaveForumApiBaseUrl,
    allowedPublishers: env.aaveAllowedPublishers,
    maxPages: env.aaveFetchMaxPages,
    categoryMaxPages: env.aaveCategoryFetchMaxPages,
    client: createAaveDemoClient({
      forumBaseUrl: env.aaveForumBaseUrl,
      forumApiBaseUrl: env.aaveForumApiBaseUrl
    })
  });
  const { app } = createApp({
    env,
    protocolRegistry: createDemoRegistry(adapter, aaveAdapter)
  });
  const api = request(app);

  console.log("Governance tracker demo");
  console.log("Using memory storage, scripted Lido fixtures, and Aave forum fixtures.");
  console.log(
    env.enableTelegramNotifications
      ? `Telegram is enabled for ${env.telegramAllowedUserIds.length} allowed user(s).`
      : "Telegram is disabled; notifications will be marked skipped."
  );

  await runStep("GET /", async () => getJson(api, "/"), stepDelayMs);
  await runStep("GET /health", async () => getJson(api, "/health"), stepDelayMs);
  await runStep(
    "GET /api/protocols",
    async () => getJson(api, "/api/protocols"),
    stepDelayMs
  );
  await runStep(
    "GET /api/debug/config-safe",
    async () => {
      const config = await getJson<{
        storageMode: string;
        demoMode: boolean;
        notifications: unknown;
        lido: unknown;
        aave: unknown;
        apiAuth: unknown;
      }>(api, "/api/debug/config-safe");

      return {
        storageMode: config.storageMode,
        demoMode: config.demoMode,
        notifications: config.notifications,
        lido: config.lido,
        aave: config.aave,
        apiAuth: config.apiAuth
      };
    },
    stepDelayMs
  );
  await runStep(
    "GET /api/debug/demo-fixtures",
    async () => {
      const fixtures = await getJson<{
        lidoRecentTopics: unknown;
        aaveRecentTopics?: { topic_list?: { topics?: unknown[] } };
        aaveSite?: {
          categories?: Array<{
            id: number;
            slug: string;
            parent_category_id?: number;
            read_restricted?: boolean;
          }>;
        };
        telegramTestNotifications?: Array<{
          protocol: string;
          sourceId: string;
          publisherName: string;
          title: string;
        }>;
      }>(api, "/api/debug/demo-fixtures");

      return {
        aaveFixtureSummary: {
          recentTopicCount: fixtures.aaveRecentTopics?.topic_list?.topics?.length ?? 0,
          publicCategoryCount: fixtures.aaveSite?.categories?.filter(
            (category) => !category.read_restricted
          ).length ?? 0,
          sampleSubcategories: fixtures.aaveSite?.categories
            ?.filter((category) => category.parent_category_id)
            .slice(0, 4)
            .map((category) => ({
              id: category.id,
              slug: category.slug,
              parentCategoryId: category.parent_category_id
            }))
        },
        telegramFixtures: fixtures.telegramTestNotifications?.map((fixture) => ({
          protocol: fixture.protocol,
          sourceId: fixture.sourceId,
          publisherName: fixture.publisherName,
          title: fixture.title
        })),
        skippedPublisherFixture: {
          sourceId: nonAllowlistedDemoFixture.sourceId,
          publisherName: nonAllowlistedDemoFixture.publisherName,
          title: nonAllowlistedDemoFixture.title
        }
      };
    },
    stepDelayMs
  );

  const discoverySummaries: Array<{
    discovered: string | undefined;
    result: ReturnType<typeof summarizeFetch>;
  }> = [];

  for (let index = 0; index < adapter.totalAllowlistedFixtures; index += 1) {
    const fixture = adapter.revealNext();
    const result = await runStep(
      `POST /api/admin/fetch/lido - discover proposal ${index + 1}`,
      async () => {
        const fetchResult = await postJson<FetchProtocolResult>(
          api,
          "/api/admin/fetch/lido"
        );

        return {
          discovered: fixture
            ? {
                sourceId: fixture.sourceId,
                publisherName: fixture.publisherName,
                title: fixture.title
              }
            : null,
          fetch: summarizeFetch(fetchResult)
        };
      },
      stepDelayMs
    );

    discoverySummaries.push({
      discovered: result.discovered?.title,
      result: result.fetch
    });

    if (
      env.enableTelegramNotifications &&
      env.telegramTestSendDelayMs > 0 &&
      index < adapter.totalAllowlistedFixtures - 1
    ) {
      await sleep(env.telegramTestSendDelayMs);
    }
  }

  await runStep(
    "GET /api/debug/lido/recent",
    async () => {
      const recent = await getJson<DebugRecentResponse>(api, "/api/debug/lido/recent");

      return {
        count: recent.count,
        items: recent.items.map((item) => ({
          sourceId: item.sourceId,
          publisherName: item.publisherName,
          title: item.title
        }))
      };
    },
    stepDelayMs
  );

  await runStep(
    "GET /api/proposals?protocol=lido&limit=10",
    async () => {
      const response = await getJson<ProposalsResponse>(
        api,
        "/api/proposals?protocol=lido&limit=10"
      );

      return {
        count: response.proposals.length,
        proposals: response.proposals.map(summarizeProposal)
      };
    },
    stepDelayMs
  );

  await runStep(
    "GET /api/debug/aave/recent",
    async () => {
      const recent = await getJson<DebugRecentResponse>(api, "/api/debug/aave/recent");
      const categoryIds = [
        ...new Set(
          recent.items
            .map((item) => {
              const raw = item.raw as { topic?: { category_id?: number } };
              return raw.topic?.category_id;
            })
            .filter((categoryId): categoryId is number => Boolean(categoryId))
        )
      ];

      return {
        count: recent.count,
        uniqueSourceIds: new Set(recent.items.map((item) => item.sourceId)).size,
        allowlistedCount: recent.items.filter((item) =>
          DEMO_AAVE_ALLOWED_PUBLISHERS.includes(item.publisherName)
        ).length,
        categoryIds: categoryIds.slice(0, 12),
        items: recent.items.slice(0, 5).map((item) => ({
          sourceId: item.sourceId,
          publisherName: item.publisherName,
          title: item.title
        }))
      };
    },
    stepDelayMs
  );

  const aaveFirstFetch = await runStep(
    "POST /api/admin/fetch/aave",
    async () => {
      const result = await postJson<FetchProtocolResult>(api, "/api/admin/fetch/aave");

      return summarizeFetch(result);
    },
    stepDelayMs
  );

  await runStep(
    "GET /api/proposals?protocol=aave&limit=10",
    async () => {
      const response = await getJson<ProposalsResponse>(
        api,
        "/api/proposals?protocol=aave&limit=10"
      );

      return {
        count: response.proposals.length,
        proposals: response.proposals.map(summarizeProposal)
      };
    },
    stepDelayMs
  );

  const aaveDuplicateFetch = await runStep(
    "POST /api/debug/aave/fetch-once",
    async () => {
      const result = await postJson<FetchProtocolResult>(
        api,
        "/api/debug/aave/fetch-once"
      );

      return summarizeFetch(result);
    },
    stepDelayMs
  );

  const stored = await getJson<ProposalsResponse>(api, "/api/proposals?limit=10");
  const firstLidoProposal = stored.proposals.find(
    (proposal) => proposal.protocol === "lido"
  );
  const firstAaveProposal = stored.proposals.find(
    (proposal) => proposal.protocol === "aave"
  );

  if (!firstLidoProposal || !firstAaveProposal) {
    throw new Error("Expected at least one stored Lido and Aave proposal in the demo.");
  }

  await runStep(
    "GET /api/proposals/:id",
    async () => {
      const response = await getJson<ProposalResponse>(
        api,
        `/api/proposals/${firstLidoProposal.id}`
      );

      return summarizeProposal(response.proposal);
    },
    stepDelayMs
  );
  await runStep(
    "GET /api/proposals/source/lido/forum/:sourceId",
    async () => {
      const response = await getJson<ProposalResponse>(
        api,
        `/api/proposals/source/lido/forum/${firstLidoProposal.sourceId}`
      );

      return summarizeProposal(response.proposal);
    },
    stepDelayMs
  );
  await runStep(
    "GET /api/proposals/source/aave/forum/:sourceId",
    async () => {
      const response = await getJson<ProposalResponse>(
        api,
        `/api/proposals/source/aave/forum/${firstAaveProposal.sourceId}`
      );

      return summarizeProposal(response.proposal);
    },
    stepDelayMs
  );
  await runStep(
    "GET /api/proposals with filters",
    async () => {
      const byPublisher = await getJson<ProposalsResponse>(
        api,
        `/api/proposals?publisherName=${encodeURIComponent(firstLidoProposal.publisherName)}`
      );
      const byNotification = await getJson<ProposalsResponse>(
        api,
        `/api/proposals?notificationStatus=${firstLidoProposal.notificationStatus}`
      );
      const sorted = await getJson<ProposalsResponse>(
        api,
        "/api/proposals?sort=firstSeenAt_desc&limit=10&offset=0"
      );
      const sortedByLastSeen = await getJson<ProposalsResponse>(
        api,
        "/api/proposals?sort=lastSeenAt_desc&limit=10&offset=0"
      );

      return {
        byPublisher: byPublisher.proposals.length,
        byNotificationStatus: byNotification.proposals.length,
        sortedNewestFirst: sorted.proposals.map((proposal) => ({
          id: proposal.id,
          firstSeenAt: proposal.firstSeenAt
        })),
        sortedLastSeenFirst: sortedByLastSeen.proposals.map((proposal) => ({
          id: proposal.id,
          lastSeenAt: proposal.lastSeenAt
        }))
      };
    },
    stepDelayMs
  );
  await runStep(
    "GET /api/admin/fetch-runs",
    async () => {
      const response = await getJson<FetchRunsResponse>(
        api,
        "/api/admin/fetch-runs?limit=10&offset=0&sort=startedAt_desc"
      );

      return {
        count: response.fetchRuns.length,
        fetchRuns: summarizeFetchRuns(response.fetchRuns)
      };
    },
    stepDelayMs
  );
  await runStep(
    "POST /api/admin/notify-pending",
    async () => postJson<NotifyPendingResult>(api, "/api/admin/notify-pending"),
    stepDelayMs
  );
  await runStep(
    "POST /api/debug/lido/fetch-once",
    async () => {
      const result = await postJson<FetchProtocolResult>(
        api,
        "/api/debug/lido/fetch-once"
      );

      return summarizeFetch(result);
    },
    stepDelayMs
  );
  await runStep(
    "GET /api/admin/fetch-runs after duplicate check",
    async () => {
      const response = await getJson<FetchRunsResponse>(
        api,
        "/api/admin/fetch-runs?limit=10&offset=0&sort=startedAt_desc"
      );

      return summarizeFetchRuns(response.fetchRuns);
    },
    stepDelayMs
  );
  await runStep(
    "API auth check with a separate app",
    async () => {
      const authEnv = loadEnv({
        ...process.env,
        NODE_ENV: "development",
        STORAGE_MODE: "memory",
        DEMO_MODE: "true",
        ENABLE_SCHEDULER: "false",
        ENABLE_TELEGRAM_NOTIFICATIONS: "false",
        API_AUTH_ENABLED: "true",
        API_AUTH_TOKEN: "demo-admin-token",
        LOG_LEVEL: "silent"
      });
      const authApi = request(createApp({ env: authEnv }).app);
      const unauthorized = await authApi.get("/health").expect(401);
      const authorized = await authApi
        .get("/health")
        .set("Authorization", "Bearer demo-admin-token")
        .expect(200);

      return {
        withoutToken: unauthorized.status,
        withToken: {
          status: authorized.status,
          body: authorized.body
        }
      };
    },
    stepDelayMs
  );
  await runStep(
    "POST /api/debug/reset-demo-state",
    async () => {
      const reset = await postJson<{ reset: boolean; storageMode: string }>(
        api,
        "/api/debug/reset-demo-state"
      );
      const proposalsAfterReset = await getJson<ProposalsResponse>(
        api,
        "/api/proposals"
      );
      const fetchRunsAfterReset = await getJson<FetchRunsResponse>(
        api,
        "/api/admin/fetch-runs"
      );

      return {
        reset,
        proposalCountAfterReset: proposalsAfterReset.proposals.length,
        fetchRunCountAfterReset: fetchRunsAfterReset.fetchRuns.length
      };
    },
    stepDelayMs
  );

  console.log("\nSummary");
  printJson({
    discoveredProposals: discoverySummaries,
    aave: {
      firstFetch: aaveFirstFetch,
      duplicateFetch: aaveDuplicateFetch
    },
    telegram:
      env.enableTelegramNotifications
        ? "notifications sent during each new proposal fetch"
        : "disabled for this run",
    completeDemoCommand: "npm run demo",
    telegramOnlyCommand: "npm run telegram:test-send"
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
