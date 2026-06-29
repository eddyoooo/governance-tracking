import { loadEnv } from "./config/env.js";
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
import { createApp } from "./server.js";
import type { FetchRun } from "./storage/fetchRun.repository.js";

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
    LIDO_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_ALLOWED_PUBLISHERS),
    LIDO_FETCH_MAX_PAGES: "5",
    AAVE_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_AAVE_ALLOWED_PUBLISHERS),
    AAVE_FETCH_MAX_PAGES: "10",
    AAVE_CATEGORY_FETCH_MAX_PAGES: "2",
    API_AUTH_ENABLED: "false",
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
  const { context } = createApp({
    env,
    protocolRegistry: createDemoRegistry(lidoAdapter, aaveAdapter)
  });

  console.log("Governance monitor demo");
  console.log("Using memory storage plus locally saved Lido and Aave forum samples.");
  console.log(
    env.enableTelegramNotifications
      ? `Telegram is enabled for ${env.telegramAllowedUserIds.length} allowed user(s).`
      : "Telegram is disabled; notifications will be marked skipped."
  );

  await runStep(
    "Runtime configuration",
    async () => ({
      storageMode: env.storageMode,
      demoMode: env.demoMode,
      schedulerEnabled: env.enableScheduler,
      telegramEnabled: env.enableTelegramNotifications,
      lidoAllowedPublishers: env.lidoAllowedPublishers,
      aaveAllowedPublishers: env.aaveAllowedPublishers,
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

  console.log("\nSummary");
  printJson({
    lidoDiscoveries: discoverySummaries,
    aave: {
      firstFetch: aaveFirstFetch,
      duplicateFetch: aaveDuplicateFetch
    },
    lidoDuplicateFetch,
    storedProposalCount: storedProposals.length,
    fetchRunCount: fetchRuns.length,
    telegram:
      env.enableTelegramNotifications
        ? "notifications sent during new proposal fetches"
        : "disabled for this run",
    completeDemoCommand: "npm run demo",
    telegramOnlyCommand: "npm run telegram:test-send"
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
