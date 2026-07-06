import { loadEnv } from "./config/env.js";
import {
  shouldEnableAdminStatusDemo,
  telegramAllowedUserIdsForDemo
} from "./demoConfig.js";
import {
  nonAllowlistedDemoFixture,
  ScriptedLidoDemoAdapter
} from "./demoFixtures/scriptedLidoDemo.adapter.js";
import type { FetchProtocolResult } from "./jobs/fetchProtocolGovernance.job.js";
import { notifyPendingProposals } from "./notifications/proposalNotifications.js";
import { AaveAdapter } from "./protocols/aave/aave.adapter.js";
import { createAaveDemoClient } from "./protocols/aave/aave.demoClient.js";
import { ProtocolRegistry } from "./protocols/registry.js";
import type { StoredProposal } from "./protocols/types.js";
import { UniswapAdapter } from "./protocols/uniswap/uniswap.adapter.js";
import { createUniswapDemoClient } from "./protocols/uniswap/uniswap.demoClient.js";
import { createApp } from "./server.js";
import type { FetchRun } from "./storage/fetchRun.repository.js";
import type { SourceActivityRecord } from "./storage/sourceActivity.repository.js";

const DEMO_ALLOWED_PUBLISHERS = [
  "Lido Labs Foundation - Operations Team",
  "Lido | Finance Team",
  "Lido Ecosystem Foundation - Operations Team"
];
const DEMO_AAVE_ALLOWED_PUBLISHERS = [
  "LlamaRisk",
  "TokenLogic",
  "Certora",
  "kpk",
  "karpatkey_TokenLogic",
  "AaveLabs",
  "stani"
];
const DEMO_UNISWAP_ALLOWED_PUBLISHERS = [
  "haydenadams",
  "eek637",
  "devinwalsh",
  "kenneth",
  "nataliara",
  "GFXlabs",
  "UniswapFoundation"
];

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

function summarizeProposal(proposal: StoredProposal | null) {
  if (!proposal) {
    return null;
  }

  return {
    id: proposal.id,
    sourceIdentity: `${proposal.protocol}/${proposal.sourceType}/${proposal.sourceId}`,
    title: proposal.title,
    publisherName: proposal.publisherName,
    notificationStatus: proposal.notificationStatus,
    notificationError: proposal.notificationError,
    firstSeenAt: proposal.firstSeenAt,
    lastSeenAt: proposal.lastSeenAt,
    updatedAt: proposal.updatedAt,
    sourceUrl: proposal.sourceUrl
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
    notificationFailedCount: run.notificationFailedCount,
    errors: run.errors
  }));
}

function summarizeSourceActivity(records: SourceActivityRecord[]) {
  return records.map((record) => ({
    protocol: record.protocol,
    sourceType: record.sourceType,
    status: record.status,
    statusReason: record.statusReason,
    latestRawSourceId: record.latestRawSourceId,
    latestRawPublishedAt: record.latestRawPublishedAt,
    lastFetchedAt: record.lastFetchedAt,
    lastFetchedCount: record.lastFetchedCount,
    consecutiveStaleRuns: record.consecutiveStaleRuns
  }));
}

function createDemoRegistry(
  lidoAdapter: ScriptedLidoDemoAdapter,
  aaveAdapter: AaveAdapter,
  uniswapAdapter: UniswapAdapter
): ProtocolRegistry {
  const registry = new ProtocolRegistry();
  registry.register(lidoAdapter);
  registry.register(aaveAdapter);
  registry.register(uniswapAdapter);

  return registry;
}

async function main(): Promise<void> {
  const stepDelayMs = readStepDelayMs();
  const adminDemoEnabled = shouldEnableAdminStatusDemo();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "development",
    STORAGE_MODE: "memory",
    DEMO_MODE: "true",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: "",
    ENABLE_SCHEDULER: "false",
    SOURCE_ACTIVITY_WARNING_DAYS: "365",
    SOURCE_ACTIVITY_CRITICAL_DAYS: "730",
    LIDO_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_ALLOWED_PUBLISHERS),
    LIDO_FETCH_MAX_PAGES: "5",
    AAVE_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_AAVE_ALLOWED_PUBLISHERS),
    AAVE_FETCH_MAX_PAGES: "10",
    AAVE_CATEGORY_FETCH_MAX_PAGES: "2",
    UNISWAP_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_UNISWAP_ALLOWED_PUBLISHERS),
    UNISWAP_FETCH_MAX_PAGES: "10",
    UNISWAP_CATEGORY_FETCH_MAX_PAGES: "2",
    TELEGRAM_ALLOWED_USER_IDS: telegramAllowedUserIdsForDemo(process.env),
    API_AUTH_ENABLED: "false",
    ENABLE_ADMIN_STATUS_REPORTS: adminDemoEnabled ? "true" : "false",
    LOG_LEVEL: "silent"
  });
  const lidoAdapter = new ScriptedLidoDemoAdapter({
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
  const uniswapAdapter = new UniswapAdapter({
    enabled: env.uniswapEnabled,
    forumBaseUrl: env.uniswapForumBaseUrl,
    forumApiBaseUrl: env.uniswapForumApiBaseUrl,
    allowedPublishers: env.uniswapAllowedPublishers,
    maxPages: env.uniswapFetchMaxPages,
    categoryMaxPages: env.uniswapCategoryFetchMaxPages,
    client: createUniswapDemoClient({
      forumBaseUrl: env.uniswapForumBaseUrl,
      forumApiBaseUrl: env.uniswapForumApiBaseUrl
    })
  });
  const { context } = createApp({
    env,
    protocolRegistry: createDemoRegistry(lidoAdapter, aaveAdapter, uniswapAdapter)
  });

  console.log("Governance monitor demo");
  console.log(
    "Using memory storage plus locally saved Lido, Aave, and Uniswap forum samples."
  );
  console.log(
    env.enableTelegramNotifications
      ? "Telegram demo notifications are enabled for the configured admin user only."
      : "Telegram is disabled; notifications will be marked skipped."
  );
  console.log(
    env.enableAdminStatusReports
      ? "Admin status demo is enabled for the configured Telegram admin."
      : "Admin status demo is disabled; run npm run demo:admin to send it."
  );

  await runStep(
    "Runtime configuration",
    async () => ({
      storageMode: env.storageMode,
      demoMode: env.demoMode,
      schedulerEnabled: env.enableScheduler,
      telegramEnabled: env.enableTelegramNotifications,
      telegramDemoRecipient: env.enableTelegramNotifications
        ? "configured admin user only"
        : "not used",
      adminStatusReportsEnabled: env.enableAdminStatusReports,
      lidoAllowedPublishers: env.lidoAllowedPublishers,
      aaveAllowedPublishers: env.aaveAllowedPublishers,
      uniswapAllowedPublishers: env.uniswapAllowedPublishers,
      nonAllowlistedPublisherSample: {
        sourceId: nonAllowlistedDemoFixture.sourceId,
        publisherName: nonAllowlistedDemoFixture.publisherName,
        title: nonAllowlistedDemoFixture.title
      }
    }),
    stepDelayMs
  );

  await runStep(
    "Registered protocol adapters",
    async () =>
      context.protocolRegistry.list().map((adapter) => ({
        protocol: adapter.protocol,
        enabled: adapter.enabled,
        source: adapter.source,
        allowedPublisherCount: adapter.publisherAllowlist.length
      })),
    stepDelayMs
  );

  const discoverySummaries: Array<{
    discovered: string | undefined;
    fetch: ReturnType<typeof summarizeFetch>;
    storedProposal: ReturnType<typeof summarizeProposal>;
  }> = [];

  for (let index = 0; index < lidoAdapter.totalAllowlistedFixtures; index += 1) {
    const fixture = lidoAdapter.revealNext();
    const summary = await runStep(
      `Lido fetch ${index + 1}: discover one new allowlisted proposal`,
      async () => {
        const fetchResult = await context.fetchJob.run("lido");
        const storedProposal = fixture
          ? await context.proposalRepository.findBySourceIdentity(
              fixture.protocol,
              fixture.sourceType,
              fixture.sourceId
            )
          : null;

        return {
          discovered: fixture
            ? {
                sourceId: fixture.sourceId,
                publisherName: fixture.publisherName,
                title: fixture.title
              }
            : null,
          fetch: summarizeFetch(fetchResult),
          storedProposal: summarizeProposal(storedProposal)
        };
      },
      stepDelayMs
    );

    discoverySummaries.push({
      discovered: summary.discovered?.title,
      fetch: summary.fetch,
      storedProposal: summary.storedProposal
    });

    if (
      env.enableTelegramNotifications &&
      env.telegramTestSendDelayMs > 0 &&
      index < lidoAdapter.totalAllowlistedFixtures - 1
    ) {
      await sleep(env.telegramTestSendDelayMs);
    }
  }

  const aaveFirstFetch = await runStep(
    "Aave fetch: scan global latest plus public category/subcategory feeds",
    async () => summarizeFetch(await context.fetchJob.run("aave")),
    stepDelayMs
  );

  const aaveDuplicateFetch = await runStep(
    "Aave duplicate fetch: prove existing proposals are not duplicated or rewritten",
    async () => summarizeFetch(await context.fetchJob.run("aave")),
    stepDelayMs
  );

  const uniswapFirstFetch = await runStep(
    "Uniswap fetch: scan global latest plus all public category feeds",
    async () => summarizeFetch(await context.fetchJob.run("uniswap")),
    stepDelayMs
  );

  const uniswapDuplicateFetch = await runStep(
    "Uniswap duplicate fetch: prove existing proposals are not duplicated or rewritten",
    async () => summarizeFetch(await context.fetchJob.run("uniswap")),
    stepDelayMs
  );

  const lidoDuplicateFetch = await runStep(
    "Lido duplicate fetch: prove repeat sightings are unchanged",
    async () => summarizeFetch(await context.fetchJob.run("lido")),
    stepDelayMs
  );

  const storedProposals = await context.proposalRepository.findAll();

  await runStep(
    "Stored proposal snapshot",
    async () => ({
      count: storedProposals.length,
      proposals: storedProposals.map(summarizeProposal)
    }),
    stepDelayMs
  );

  await runStep(
    "Notify pending retry",
    async () =>
      notifyPendingProposals(
        context.proposalRepository,
        context.notificationService,
        context.logger
      ),
    stepDelayMs
  );

  const fetchRuns = await context.fetchRunRepository.findAll(20);

  await runStep(
    "Fetch-run audit trail",
    async () => ({
      count: fetchRuns.length,
      fetchRuns: summarizeFetchRuns(fetchRuns)
    }),
    stepDelayMs
  );

  const sourceActivity = await context.sourceActivityRepository.findAll(20);

  await runStep(
    "Source-activity watchdog snapshot",
    async () => ({
      count: sourceActivity.length,
      sourceActivity: summarizeSourceActivity(sourceActivity)
    }),
    stepDelayMs
  );

  let adminStatusReport:
    | {
        sent: boolean;
        healthy: boolean;
        problemCount: number;
        problems: string[];
        messagePreview: string[];
      }
    | undefined;

  if (context.adminStatusReporter.enabled) {
    adminStatusReport = await runStep(
      "Admin status report: send operator health check",
      async () => {
        const report = await context.adminStatusReporter.sendDailyStatusReport();

        return {
          sent: true,
          healthy: report.healthy,
          problemCount: report.problems.length,
          problems: report.problems,
          messagePreview: report.message.split("\n").slice(0, 12)
        };
      },
      stepDelayMs
    );
  }

  console.log("\nSummary");
  printJson({
    lidoDiscoveries: discoverySummaries,
    aave: {
      firstFetch: aaveFirstFetch,
      duplicateFetch: aaveDuplicateFetch
    },
    uniswap: {
      firstFetch: uniswapFirstFetch,
      duplicateFetch: uniswapDuplicateFetch
    },
    lidoDuplicateFetch,
    storedProposalCount: storedProposals.length,
    fetchRunCount: fetchRuns.length,
    sourceActivityCount: sourceActivity.length,
    telegram:
      env.enableTelegramNotifications
        ? "notifications sent during new proposal fetches"
        : "disabled for this run",
    adminStatusReport:
      adminStatusReport ??
      "disabled for this run; use npm run demo:admin to send the operator status report",
    completeDemoCommand: "npm run demo",
    adminDemoCommand: "npm run demo:admin",
    telegramOnlyCommand: "npm run telegram:test-send"
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
