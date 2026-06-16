import request, { type Test } from "supertest";
import { loadEnv } from "./config/env.js";
import type { FetchProtocolResult } from "./jobs/fetchProtocolGovernance.job.js";
import type { NotifyPendingResult } from "./notifications/proposalNotifications.js";
import { filterByPublisherAllowlist } from "./protocols/allowlist.js";
import { LidoAdapter } from "./protocols/lido/lido.adapter.js";
import { ProtocolRegistry } from "./protocols/registry.js";
import type { RawGovernanceItem, StoredProposal } from "./protocols/types.js";
import { createApp } from "./server.js";
import type { FetchRun } from "./storage/fetchRun.repository.js";

interface DemoApi {
  get(path: string): Test;
  post(path: string): Test;
}

interface HealthResponse {
  ok: boolean;
  storageMode: string;
  schedulerEnabled: boolean;
}

interface ProtocolsResponse {
  protocols: Array<{
    protocol: string;
    enabled: boolean;
    source: {
      type: string;
      name: string;
      baseUrl: string;
    };
    allowedPublisherCount: number;
  }>;
}

interface DebugRecentResponse {
  count: number;
  items: RawGovernanceItem[];
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

const DEFAULT_LIVE_PUBLISHERS = [
  "Lido Labs Foundation - Operations Team",
  "Lido | Finance Team",
  "Lido Ecosystem Foundation - Operations Team"
];

function readStepDelayMs(): number {
  const raw = process.env.DEMO_STEP_DELAY_MS;

  if (!raw) {
    return 750;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 750;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printSection(title: string): void {
  console.log("\n============================================================");
  console.log(title);
  console.log("============================================================");
}

function summarizeProposal(proposal: StoredProposal) {
  return {
    id: proposal.id,
    sourceIdentity: `${proposal.protocol}/${proposal.sourceType}/${proposal.sourceId}`,
    title: proposal.title,
    publisherName: proposal.publisherName,
    notificationStatus: proposal.notificationStatus,
    firstSeenAt: proposal.firstSeenAt,
    updatedAt: proposal.updatedAt,
    sourceUrl: proposal.sourceUrl
  };
}

function summarizeFetch(result: FetchProtocolResult) {
  return {
    protocol: result.protocol,
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

function createLiveLidoRegistry(env: ReturnType<typeof loadEnv>): ProtocolRegistry {
  const registry = new ProtocolRegistry();

  registry.register(
    new LidoAdapter({
      enabled: env.lidoEnabled,
      forumBaseUrl: env.lidoForumBaseUrl,
      forumApiBaseUrl: env.lidoForumApiBaseUrl,
      allowedPublishers: env.lidoAllowedPublishers,
      maxPages: env.lidoFetchMaxPages
    })
  );

  return registry;
}

async function chooseLiveDemoAllowlist(
  env: ReturnType<typeof loadEnv>
): Promise<{
  allowlist: string[];
  reason: string;
  previewItems: RawGovernanceItem[];
}> {
  const previewAdapter = new LidoAdapter({
    enabled: env.lidoEnabled,
    forumBaseUrl: env.lidoForumBaseUrl,
    forumApiBaseUrl: env.lidoForumApiBaseUrl,
    allowedPublishers: [],
    maxPages: env.lidoFetchMaxPages
  });
  const previewItems = await previewAdapter.fetchRecent();

  if (previewItems.length === 0) {
    throw new Error("Live Lido demo could not find any recent proposal topics.");
  }

  const configuredAllowlist =
    env.lidoAllowedPublishers.length > 0
      ? env.lidoAllowedPublishers
      : DEFAULT_LIVE_PUBLISHERS;
  const configuredMatches = filterByPublisherAllowlist(
    previewItems,
    configuredAllowlist
  ).allowed;

  if (configuredMatches.length > 0) {
    return {
      allowlist: configuredAllowlist,
      reason: "configured publishers matched current live Lido data",
      previewItems
    };
  }

  return {
    allowlist: [previewItems[0].publisherName],
    reason:
      "configured publishers did not match the current live page, so the demo selected the first live publisher",
    previewItems
  };
}

async function runStep<T>(
  title: string,
  action: () => Promise<T>,
  delayMs: number
): Promise<T> {
  console.log(`\nRunning ${title}...`);
  await sleep(delayMs);

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

async function main(): Promise<void> {
  const delayMs = readStepDelayMs();
  const baseEnv = loadEnv({
    ...process.env,
    NODE_ENV: "development",
    STORAGE_MODE: "memory",
    DEMO_MODE: "false",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: "",
    ENABLE_SCHEDULER: "false",
    ENABLE_DEBUG_ENDPOINTS: "true",
    LIDO_ALLOWED_PUBLISHERS: JSON.stringify(DEFAULT_LIVE_PUBLISHERS),
    ENABLE_TELEGRAM_NOTIFICATIONS: "false",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_CHAT_ID: "",
    API_AUTH_TOKEN: "",
    LOG_LEVEL: "silent"
  });
  const demoAllowlist = await chooseLiveDemoAllowlist(baseEnv);
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "development",
    STORAGE_MODE: "memory",
    DEMO_MODE: "false",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: "",
    ENABLE_SCHEDULER: "false",
    ENABLE_DEBUG_ENDPOINTS: "true",
    LIDO_ALLOWED_PUBLISHERS: JSON.stringify(demoAllowlist.allowlist),
    LIDO_FETCH_MAX_PAGES: String(baseEnv.lidoFetchMaxPages),
    ENABLE_TELEGRAM_NOTIFICATIONS: "false",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_CHAT_ID: "",
    API_AUTH_TOKEN: "",
    LOG_LEVEL: "silent"
  });
  const { app, context } = createApp({
    env,
    protocolRegistry: createLiveLidoRegistry(env)
  });
  const api = request(app);

  printSection("Governance Tracking MVP Demo");

  await runStep(
    "live Lido data setup",
    async () => ({
      source: `${env.lidoForumApiBaseUrl}/c/proposals/9/l/latest.json`,
      fetchedPreviewCount: demoAllowlist.previewItems.length,
      selectedAllowlist: demoAllowlist.allowlist,
      selectionReason: demoAllowlist.reason
    }),
    delayMs
  );

  await runStep(
    "health check (GET /health)",
    async () => getJson<HealthResponse>(api, "/health"),
    delayMs
  );

  await runStep(
    "registered protocols (GET /api/protocols)",
    async () => getJson<ProtocolsResponse>(api, "/api/protocols"),
    delayMs
  );

  await runStep(
    "safe runtime config (GET /api/debug/config-safe)",
    async () => {
      const safeConfig = await getJson<{
        nodeEnv: string;
        storageMode: string;
        demoMode: boolean;
        enableScheduler: boolean;
        enableDebugEndpoints: boolean;
        lido: unknown;
        notifications: unknown;
        apiAuth: unknown;
      }>(api, "/api/debug/config-safe");

      return {
        nodeEnv: safeConfig.nodeEnv,
        storageMode: safeConfig.storageMode,
        demoMode: safeConfig.demoMode,
        schedulerEnabled: safeConfig.enableScheduler,
        debugEndpointsEnabled: safeConfig.enableDebugEndpoints,
        lido: safeConfig.lido,
        notifications: safeConfig.notifications,
        apiAuth: safeConfig.apiAuth
      };
    },
    delayMs
  );

  await runStep(
    "live Lido recent-topic preview before storage (GET /api/debug/lido/recent)",
    async () => {
      const recent = await getJson<DebugRecentResponse>(api, "/api/debug/lido/recent");

      return {
        count: recent.count,
        items: recent.items.slice(0, 8).map((item) => ({
          sourceId: item.sourceId,
          title: item.title,
          publisherName: item.publisherName,
          sourceUrl: item.sourceUrl
        }))
      };
    },
    delayMs
  );

  const firstFetchSummary = await runStep(
    "manual Lido fetch, allowlist filter, dedupe, and storage (POST /api/admin/fetch/lido)",
    async () => {
      const result = await postJson<FetchProtocolResult>(api, "/api/admin/fetch/lido");

      return summarizeFetch(result);
    },
    delayMs
  );

  await runStep(
    "stored proposal list (GET /api/proposals?protocol=lido&limit=5)",
    async () => {
      const response = await getJson<ProposalsResponse>(
        api,
        "/api/proposals?protocol=lido&limit=5"
      );

      return {
        proposalCount: response.proposals.length,
        proposals: response.proposals.map(summarizeProposal)
      };
    },
    delayMs
  );

  const storedProposals = await getJson<ProposalsResponse>(api, "/api/proposals");
  const [firstProposal] = storedProposals.proposals;

  if (!firstProposal) {
    throw new Error("Demo expected one stored proposal after the first fetch.");
  }

  await runStep(
    "read by internal proposal id (GET /api/proposals/:id)",
    async () => {
      const response = await getJson<ProposalResponse>(
        api,
        `/api/proposals/${firstProposal.id}`
      );

      return summarizeProposal(response.proposal);
    },
    delayMs
  );

  await runStep(
    "read by source identity (GET /api/proposals/source/lido/forum/<topic-id>)",
    async () => {
      const response = await getJson<ProposalResponse>(
        api,
        `/api/proposals/source/lido/forum/${firstProposal.sourceId}`
      );

      return summarizeProposal(response.proposal);
    },
    delayMs
  );

  await runStep(
    "dashboard-style proposal filters",
    async () => {
      const byPublisher = await getJson<ProposalsResponse>(
        api,
        `/api/proposals?publisherName=${encodeURIComponent(firstProposal.publisherName)}`
      );
      const byNotification = await getJson<ProposalsResponse>(
        api,
        "/api/proposals?notificationStatus=skipped"
      );
      const sorted = await getJson<ProposalsResponse>(
        api,
        "/api/proposals?sort=firstSeenAt_desc&limit=10&offset=0"
      );

      return {
        byPublisherCount: byPublisher.proposals.length,
        byNotificationStatusCount: byNotification.proposals.length,
        sortedNewestFirst: sorted.proposals.map((proposal) => ({
          id: proposal.id,
          firstSeenAt: proposal.firstSeenAt
        }))
      };
    },
    delayMs
  );

  await runStep(
    "fetch-run audit trail (GET /api/admin/fetch-runs)",
    async () => {
      const response = await getJson<FetchRunsResponse>(
        api,
        "/api/admin/fetch-runs?limit=5&offset=0&sort=startedAt_desc"
      );

      return {
        fetchRunCount: response.fetchRuns.length,
        fetchRuns: summarizeFetchRuns(response.fetchRuns)
      };
    },
    delayMs
  );

  await runStep(
    "notification retry endpoint with a seeded pending proposal (POST /api/admin/notify-pending)",
    async () => {
      await context.proposalRepository.updateNotificationStatus(
        firstProposal.id,
        "pending"
      );

      const before = await context.proposalRepository.findById(firstProposal.id);
      const result = await postJson<NotifyPendingResult>(
        api,
        "/api/admin/notify-pending"
      );
      const after = await context.proposalRepository.findById(firstProposal.id);

      return {
        note:
          "Telegram is disabled in demo mode, so pending notifications are marked skipped.",
        beforeStatus: before?.notificationStatus,
        result,
        afterStatus: after?.notificationStatus
      };
    },
    delayMs
  );

  await runStep(
    "duplicate fetch/no-rewrite behavior (POST /api/admin/fetch/lido again)",
    async () => {
      const result = await postJson<FetchProtocolResult>(api, "/api/admin/fetch/lido");

      return {
        firstFetch: firstFetchSummary,
        secondFetch: summarizeFetch(result),
        takeaway:
          "The proposal is recognized as unchanged: no duplicate and no rewrite-only timestamp churn."
      };
    },
    delayMs
  );

  await runStep(
    "API auth protection using a separate in-memory app",
    async () => {
      const authEnv = loadEnv({
        ...process.env,
        NODE_ENV: "development",
        STORAGE_MODE: "memory",
        DEMO_MODE: "true",
        ENABLE_SCHEDULER: "false",
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
        withoutToken: {
          status: unauthorized.status,
          body: unauthorized.body
        },
        withBearerToken: {
          status: authorized.status,
          body: authorized.body
        }
      };
    },
    delayMs
  );

  await runStep(
    "demo reset endpoint (POST /api/debug/reset-demo-state)",
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
    delayMs
  );

  printSection("Demo Complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
