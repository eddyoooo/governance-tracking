import { loadEnv } from "./config/env.js";
import {
  readBooleanFlag,
  shouldEnableAdminStatusDemo,
  telegramAllowedUserIdsForDemo
} from "./demoConfig.js";
import {
  nonAllowlistedDemoFixture,
  ScriptedLidoDemoAdapter
} from "./demoFixtures/scriptedLidoDemo.adapter.js";
import {
  ScriptedUniswapOnchainDemoAdapter,
  UNISWAP_PROPOSAL_100_CAPTURED_ACTION_COUNT
} from "./demoFixtures/scriptedUniswapOnchainDemo.adapter.js";
import type { FetchProtocolResult } from "./jobs/fetchProtocolGovernance.job.js";
import { AaveAdapter } from "./protocols/aave/aave.adapter.js";
import { createAaveDemoClient } from "./protocols/aave/aave.demoClient.js";
import { CowAdapter } from "./protocols/cow/cow.adapter.js";
import { createCowDemoClient } from "./protocols/cow/cow.demoClient.js";
import { ProtocolRegistry } from "./protocols/registry.js";
import { EvmGovernanceRegistry } from "./onchain/registry.js";
import type {
  GovernanceScanResult,
  GovernanceSourceState,
  StoredGovernanceDecision
} from "./onchain/types.js";
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
  "UniswapFoundation",
  "UniswapLabs"
];
const DEMO_COW_ALLOWED_PUBLISHERS = [
  "notsoformal",
  "Kowrigan",
  "harisang",
  "felixhenneke",
  "KPK"
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
    baselineSeededCount: result.baselineSeededCount,
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
    notificationRecipients: Object.values(
      proposal.notificationDeliveries ?? {}
    ).map((delivery) => ({
      recipient: delivery.recipientMaskedId,
      status: delivery.status,
      attempts: delivery.attemptCount,
      nextRetryAt: delivery.nextRetryAt
    })),
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
    baselineSeededCount: run.baselineSeededCount ?? 0,
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

function summarizeOnchainScan(result: GovernanceScanResult) {
  return {
    protocol: result.protocol,
    status: result.status,
    baselineSeeding: result.baselineSeeding,
    cursorBefore: result.cursorBefore,
    cursorAfter: result.cursorAfter,
    contractEventsRead: result.contractEventsRead,
    decisionsCreated: result.decisionsCreated,
    decisionsUpdated: result.decisionsUpdated,
    decisionsUnchanged: result.decisionsUnchanged,
    lifecycleEventsCreated: result.lifecycleEventsCreated,
    notificationSentCount: result.notificationSentCount,
    notificationFailedCount: result.notificationFailedCount,
    errors: result.errors
  };
}

function summarizeGovernanceDecision(decision: StoredGovernanceDecision) {
  return {
    id: decision.id,
    proposalId: decision.proposalId,
    title: decision.title,
    proposer: decision.proposer,
    status: decision.status,
    voteOutcome: decision.voteOutcome,
    executionOutcome: decision.executionOutcome,
    votingEndedAt: decision.votingEndedAt,
    forVotes: decision.forVotes,
    againstVotes: decision.againstVotes,
    abstainVotes: decision.abstainVotes,
    capturedActionCount: UNISWAP_PROPOSAL_100_CAPTURED_ACTION_COUNT,
    includedActionSampleCount: decision.actions.length,
    canonicalLifecycle: {
      createdBlockNumber: decision.createdBlockNumber,
      createdTransactionHash: decision.createdTransactionHash,
      queuedBlockNumber: decision.queuedBlockNumber,
      queuedTransactionHash: decision.queuedTransactionHash,
      executedBlockNumber: decision.executedBlockNumber,
      executedTransactionHash: decision.executedTransactionHash
    },
    sourceUrl: decision.sourceUrl
  };
}

function assertOnchainDemoIntegrity(options: {
  baseline: ReturnType<typeof summarizeOnchainScan>;
  creation: ReturnType<typeof summarizeOnchainScan>;
  execution: ReturnType<typeof summarizeOnchainScan>;
  duplicate: ReturnType<typeof summarizeOnchainScan>;
  decisions: StoredGovernanceDecision[];
  sourceState: GovernanceSourceState | null;
  notificationStatusCounts: {
    pending: number;
    sent: number;
    skipped: number;
    failed: number;
  };
  notificationsEnabled: boolean;
}): void {
  if (
    options.baseline.status !== "success" ||
    !options.baseline.baselineSeeding ||
    options.baseline.notificationSentCount !== 0
  ) {
    throw new Error("Demo on-chain baseline was not completed silently.");
  }
  if (
    options.creation.status !== "success" ||
    options.creation.decisionsCreated !== 1 ||
    options.creation.lifecycleEventsCreated !== 1
  ) {
    throw new Error("Demo did not discover proposal #100 exactly once.");
  }
  if (
    options.execution.status !== "success" ||
    options.execution.decisionsUpdated !== 1 ||
    options.execution.lifecycleEventsCreated !== 3
  ) {
    throw new Error("Demo did not capture the complete proposal #100 result lifecycle.");
  }
  if (
    options.duplicate.status !== "success" ||
    options.duplicate.decisionsCreated !== 0 ||
    options.duplicate.decisionsUpdated !== 0 ||
    options.duplicate.lifecycleEventsCreated !== 0 ||
    options.duplicate.notificationSentCount !== 0
  ) {
    throw new Error("Demo duplicate scan was not idempotent.");
  }

  const decision = options.decisions[0];
  if (
    options.decisions.length !== 1 ||
    !decision ||
    decision.proposalId !== "100" ||
    decision.status !== "executed" ||
    !decision.votingEndedAt ||
    !decision.createdTransactionHash ||
    !decision.queuedTransactionHash ||
    !decision.executedTransactionHash
  ) {
    throw new Error(
      "Demo stored decision is missing its final state or canonical lifecycle references."
    );
  }
  if (
    !options.sourceState ||
    options.sourceState.baselineStatus !== "complete" ||
    options.sourceState.healthStatus !== "healthy" ||
    options.sourceState.cursorBlockNumber !==
      options.sourceState.latestFinalizedBlockNumber
  ) {
    throw new Error("Demo on-chain source checkpoint is incomplete or unhealthy.");
  }

  const expectedSent = options.notificationsEnabled ? 4 : 0;
  const expectedSkipped = options.notificationsEnabled ? 0 : 4;
  if (
    options.notificationStatusCounts.pending !== 0 ||
    options.notificationStatusCounts.failed !== 0 ||
    options.notificationStatusCounts.sent !== expectedSent ||
    options.notificationStatusCounts.skipped !== expectedSkipped
  ) {
    throw new Error(
      "Demo on-chain lifecycle notification states are incomplete or inconsistent."
    );
  }
}

function createDemoRegistry(
  lidoAdapter: ScriptedLidoDemoAdapter,
  aaveAdapter: AaveAdapter,
  uniswapAdapter: UniswapAdapter,
  cowAdapter: CowAdapter
): ProtocolRegistry {
  const registry = new ProtocolRegistry();
  registry.register(lidoAdapter);
  registry.register(aaveAdapter);
  registry.register(uniswapAdapter);
  registry.register(cowAdapter);

  return registry;
}

async function main(): Promise<void> {
  const stepDelayMs = readStepDelayMs();
  const adminDemoEnabled = shouldEnableAdminStatusDemo();
  const telegramDemoEnabled = readBooleanFlag(
    "ENABLE_TELEGRAM_NOTIFICATIONS"
  );
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
    COW_ENABLED: "true",
    COW_ALLOWED_PUBLISHERS: JSON.stringify(DEMO_COW_ALLOWED_PUBLISHERS),
    COW_FETCH_MAX_PAGES: "10",
    COW_CATEGORY_FETCH_MAX_PAGES: "2",
    ETHEREUM_RPC_URL: "https://demo.invalid/rpc",
    UNISWAP_ONCHAIN_ENABLED: "true",
    UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: telegramDemoEnabled
      ? "true"
      : "false",
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
  const cowAdapter = new CowAdapter({
    enabled: env.cowEnabled,
    forumBaseUrl: env.cowForumBaseUrl,
    forumApiBaseUrl: env.cowForumApiBaseUrl,
    allowedPublishers: env.cowAllowedPublishers,
    maxPages: env.cowFetchMaxPages,
    categoryMaxPages: env.cowCategoryFetchMaxPages,
    client: createCowDemoClient({
      forumBaseUrl: env.cowForumBaseUrl,
      forumApiBaseUrl: env.cowForumApiBaseUrl
    })
  });
  const uniswapOnchainAdapter = new ScriptedUniswapOnchainDemoAdapter(
    env.uniswapOnchainNotificationsEnabled
  );
  const { context } = createApp({
    env,
    protocolRegistry: createDemoRegistry(
      lidoAdapter,
      aaveAdapter,
      uniswapAdapter,
      cowAdapter
    ),
    evmGovernanceRegistry: new EvmGovernanceRegistry([
      uniswapOnchainAdapter
    ])
  });
  await Promise.all(
    context.protocolRegistry
      .list()
      .map((adapter) =>
        context.protocolStateRepository.initializeBaseline(
          adapter.protocol,
          true
        )
      )
  );

  console.log("Governance monitor demo");
  console.log(
    "Using memory storage plus locally saved forum samples and a real Uniswap Governor Bravo proposal snapshot."
  );
  console.log(
    "The scripted records exercise live discovery, historical backfill, and duplicate suppression after an established baseline."
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
      uniswapOnchainEnabled: env.uniswapOnchainEnabled,
      uniswapOnchainNotificationsEnabled:
        env.uniswapOnchainNotificationsEnabled,
      lidoAllowedPublishers: env.lidoAllowedPublishers,
      aaveAllowedPublishers: env.aaveAllowedPublishers,
      uniswapAllowedPublishers: env.uniswapAllowedPublishers,
      cowAllowedPublishers: env.cowAllowedPublishers,
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

  const onchainBaseline = await runStep(
    "Uniswap on-chain baseline: establish history without notifications",
    async () => summarizeOnchainScan(await context.onchainGovernanceJob.run("uniswap")),
    stepDelayMs
  );

  uniswapOnchainAdapter.revealCreation();
  const onchainCreation = await runStep(
    "Uniswap on-chain discovery: detect real proposal #100 creation",
    async () => summarizeOnchainScan(await context.onchainGovernanceJob.run("uniswap")),
    stepDelayMs
  );

  if (env.uniswapOnchainNotificationsEnabled && env.telegramTestSendDelayMs > 0) {
    await sleep(env.telegramTestSendDelayMs);
  }

  uniswapOnchainAdapter.revealExecution();
  const onchainExecution = await runStep(
    "Uniswap on-chain lifecycle: detect vote result, queue, and execution",
    async () => summarizeOnchainScan(await context.onchainGovernanceJob.run("uniswap")),
    stepDelayMs
  );
  const onchainDuplicate = await runStep(
    "Uniswap on-chain duplicate scan: prove no duplicate records or alerts",
    async () => summarizeOnchainScan(await context.onchainGovernanceJob.run("uniswap")),
    stepDelayMs
  );
  const governanceDecisions = await context.governanceRepository.findDecisionsBySource(
    uniswapOnchainAdapter.sourceKey
  );
  const onchainSourceState = await context.governanceRepository.findSourceState(
    uniswapOnchainAdapter.sourceKey
  );
  const [pending, sent, skipped, failed] = await Promise.all([
    context.governanceRepository.countByNotificationStatus("pending"),
    context.governanceRepository.countByNotificationStatus("sent"),
    context.governanceRepository.countByNotificationStatus("skipped"),
    context.governanceRepository.countByNotificationStatus("failed")
  ]);
  const onchainNotificationStatusCounts = {
    pending,
    sent,
    skipped,
    failed
  };
  assertOnchainDemoIntegrity({
    baseline: onchainBaseline,
    creation: onchainCreation,
    execution: onchainExecution,
    duplicate: onchainDuplicate,
    decisions: governanceDecisions,
    sourceState: onchainSourceState,
    notificationStatusCounts: onchainNotificationStatusCounts,
    notificationsEnabled: env.uniswapOnchainNotificationsEnabled
  });

  await runStep(
    "Stored on-chain governance snapshot",
    async () => ({
      count: governanceDecisions.length,
      decisions: governanceDecisions.map(summarizeGovernanceDecision),
      sourceState: onchainSourceState,
      notificationStatusCounts: onchainNotificationStatusCounts,
      integrityChecks: "passed",
      scanRunCount: (await context.governanceRepository.findScanRuns()).length
    }),
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
      index === 0
        ? "Lido fetch 1: discover and notify one new allowlisted proposal"
        : `Lido fetch ${index + 1}: store an older allowlisted proposal without a historical alert`,
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

  const cowFirstFetch = await runStep(
    "CoW fetch: scan global latest plus all public category feeds",
    async () => summarizeFetch(await context.fetchJob.run("cow")),
    stepDelayMs
  );

  const cowDuplicateFetch = await runStep(
    "CoW duplicate fetch: prove existing proposals are not duplicated or rewritten",
    async () => summarizeFetch(await context.fetchJob.run("cow")),
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
    cow: {
      firstFetch: cowFirstFetch,
      duplicateFetch: cowDuplicateFetch
    },
    lidoDuplicateFetch,
    storedProposalCount: storedProposals.length,
    fetchRunCount: fetchRuns.length,
    sourceActivityCount: sourceActivity.length,
    uniswapOnchain: {
      baseline: onchainBaseline,
      creation: onchainCreation,
      execution: onchainExecution,
      duplicate: onchainDuplicate,
      storedDecisionCount: governanceDecisions.length
    },
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
