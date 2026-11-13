import { describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../../src/server.js";
import { ScriptedAaveOnchainDemoAdapter } from "../../src/demoFixtures/scriptedAaveOnchainDemo.adapter.js";
import { AaveOnchainGovernanceAdapter } from "../../src/onchain/aave/aaveOnchain.adapter.js";
import { EvmGovernanceRegistry } from "../../src/onchain/registry.js";
import { buildAdminStatusReport } from "../../src/adminStatus/adminStatus.service.js";
import { formatTelegramGovernanceMessage, TelegramNotificationService } from "../../src/notifications/telegramNotification.service.js";
import type { NotificationMessage, NotificationService } from "../../src/notifications/notification.service.js";
import { createTelegramApiSuccessResponse, testEnv } from "../helpers/builders.js";
import { aaveLog, aaveRawProposal, aaveRpcFixture } from "../helpers/aaveBuilders.js";
import { testBlockHash } from "../helpers/onchainBuilders.js";
import { aaveOnchainEventFixtures } from "../../src/demoFixtures/aaveOnchain.fixture.js";

class RecordingService implements NotificationService {
  readonly enabled = true;
  readonly name = "mock-telegram";
  readonly messages: NotificationMessage[] = [];
  fail = false;
  getRecipients() { return [{ key: "admin-only-test-recipient", maskedId: "******3073" }]; }
  async send(message: NotificationMessage) {
    if (this.fail) throw new Error("Mock Telegram unavailable");
    this.messages.push(message);
  }
}
function aaveEnv() {
  return testEnv({ ETHEREUM_RPC_URL: "https://example.invalid/rpc",
    AAVE_ONCHAIN_ENABLED: "true", AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "true",
    ENABLE_TELEGRAM_NOTIFICATIONS: "true", API_AUTH_ENABLED: "true", API_AUTH_TOKEN: "test-token" });
}

function runtime() {
  const env = aaveEnv();
  const adapter = new ScriptedAaveOnchainDemoAdapter(env);
  const service = new RecordingService();
  const result = createApp({ env, notificationService: service,
    evmGovernanceRegistry: new EvmGovernanceRegistry([adapter]) });
  return { ...result, adapter, service };
}

describe("Aave on-chain live-scan recovery with the production RPC client", () => {
  it.each([false, true])("separates historical and live settlement on resume (legacy advanced record: %s)", async (legacy) => {
    const env = aaveEnv();
    const { rpc, client, block, setProposal } = aaveRpcFixture();
    const adapter = new AaveOnchainGovernanceAdapter(env, client);
    const service = new RecordingService();
    const { context } = createApp({ env, notificationService: service,
      evmGovernanceRegistry: new EvmGovernanceRegistry([adapter]) });
    const created = aaveLog();
    const resultBlock = block + 10;
    const head = block + 20;
    const queued = aaveLog("ProposalQueued", { blockNumber: BigInt(resultBlock),
      blockHash: testBlockHash(resultBlock), transactionHash: testBlockHash(16) });
    rpc.getLogs.mockRejectedValueOnce(new Error("interrupted before reading baseline logs"));
    await expect(context.onchainGovernanceJob.run("aave")).rejects.toThrow("interrupted");

    const settled = aaveRawProposal({ state: 3, votingActivationTime: 1704575039,
      votingDuration: 259200, queuingTime: 1704836471 });
    setProposal(settled);
    if (legacy) {
      rpc.getLogs.mockResolvedValueOnce([created]);
      const [creation] = await client.getEvents(block - 100, block);
      const observation = await client.getDecision("0", [creation], null, head, { historical: true });
      await context.governanceRepository.upsertDecision(observation, { notificationStatusForNewEvents: "skipped" });
    }
    rpc.getBlock.mockImplementation(async ({ blockNumber }) => {
      const number = blockNumber ?? BigInt(head);
      return { number, hash: testBlockHash(Number(number)), timestamp: 1704836471n };
    });
    const readContract = rpc.readContract.getMockImplementation()!;
    rpc.readContract.mockImplementation((input: { functionName: string; blockNumber?: bigint }) =>
      input.functionName === "getProposal" && input.blockNumber === BigInt(block)
        ? Promise.resolve(aaveRawProposal()) : readContract(input));
    rpc.getLogs.mockImplementation(async ({ fromBlock, toBlock }) =>
      [created, queued].filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock));

    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", baselineSeeding: true, cursorAfter: head, notificationSentCount: legacy ? 0 : 1
    });
    await expect(context.governanceRepository.findDecisionsBySource(adapter.sourceKey)).resolves.toMatchObject([{
      status: "queued", lastObservedBlockNumber: head, queuedBlockNumber: resultBlock,
      aave: { resultBlockNumber: resultBlock }
    }]);
    expect(service.messages).toHaveLength(legacy ? 0 : 1);
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({ lifecycleEventsCreated: 0, notificationSentCount: 0 });
  });

  it("preserves the checkpoint when settlement evidence changes mid-scan and alerts only after repair", async () => {
    const env = aaveEnv();
    const { rpc, client, block, setProposal } = aaveRpcFixture();
    const adapter = new AaveOnchainGovernanceAdapter(env, client);
    const service = new RecordingService();
    const { context } = createApp({ env, notificationService: service,
      evmGovernanceRegistry: new EvmGovernanceRegistry([adapter]) });
    const getDecision = adapter.getDecision.bind(adapter);
    const legacyUrl = "https://vote.onaave.com/proposal/?proposalId=0";
    const legacyClient = jest.spyOn(adapter, "getDecision").mockImplementation(async (...args) => ({
      ...await getDecision(...args), sourceUrl: legacyUrl
    }));
    rpc.getLogs.mockResolvedValue([aaveLog()]);
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", baselineSeeding: true, notificationSentCount: 0
    });
    legacyClient.mockRestore();
    const before = await context.governanceRepository.findDecisionsBySource(adapter.sourceKey);
    expect(before).toMatchObject([{ sourceUrl: legacyUrl }]);

    const resultBlock = block + 10;
    const finalizedBlock = block + 20;
    let settlementReads = 0;
    let inconsistent = true;
    rpc.getBlock.mockImplementation(async ({ blockNumber }) => {
      const number = blockNumber ?? BigInt(finalizedBlock);
      const wrongHash = Number(number) === resultBlock && ++settlementReads === 2 && inconsistent;
      return { number, hash: testBlockHash(wrongHash ? resultBlock + 1 : Number(number)),
        timestamp: 1704836471n };
    });
    rpc.getLogs.mockResolvedValue([aaveLog("ProposalQueued", {
      blockNumber: BigInt(resultBlock), blockHash: testBlockHash(resultBlock),
      transactionHash: testBlockHash(16)
    })]);
    setProposal(aaveRawProposal({ state: 3, votingActivationTime: 1704575039,
      votingDuration: 259200, queuingTime: 1704836471 }));

    await expect(context.onchainGovernanceJob.run("aave")).rejects.toThrow("result block hash");
    await expect(context.governanceRepository.findDecisionsBySource(adapter.sourceKey)).resolves.toEqual(before);
    await expect(context.governanceRepository.findSourceState(adapter.sourceKey)).resolves.toMatchObject({
      cursorBlockNumber: block, healthStatus: "failed"
    });
    expect(service.messages).toEqual([]);
    expect((await buildAdminStatusReport(context)).message).toContain("result block hash");

    inconsistent = false;
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", cursorAfter: finalizedBlock, lifecycleEventsCreated: 2, notificationSentCount: 1
    });
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", lifecycleEventsCreated: 0, notificationSentCount: 0
    });
    expect(service.messages).toMatchObject([{
      heading: "ON-CHAIN GOVERNANCE VOTE RESULT",
      sourceUrl: "https://app.aave.com/governance/v3/proposal/?proposalId=0"
    }]);
  });

  it("sends a defeated result once from the canonical ProposalFailed log", async () => {
    const env = aaveEnv();
    const { rpc, client, block, setProposal } = aaveRpcFixture();
    const service = new RecordingService();
    const { context } = createApp({ env, notificationService: service,
      evmGovernanceRegistry: new EvmGovernanceRegistry([new AaveOnchainGovernanceAdapter(env, client)]) });
    rpc.getLogs.mockResolvedValue([aaveLog()]);
    await context.onchainGovernanceJob.run("aave");

    const resultBlock = block + 10;
    rpc.getBlock.mockImplementation(async ({ blockNumber }) => {
      const number = blockNumber ?? BigInt(resultBlock);
      return { number, hash: testBlockHash(Number(number)), timestamp: 1704836471n };
    });
    const againstVotes = 12n * 10n ** 18n;
    const failedLog = aaveLog("ProposalFailed", {
      blockNumber: BigInt(resultBlock), blockHash: testBlockHash(resultBlock),
      transactionHash: testBlockHash(16), args: { proposalId: 0n, votesFor: 0n, votesAgainst: againstVotes }
    });
    rpc.getLogs.mockResolvedValue([failedLog]);
    setProposal(aaveRawProposal({ state: 5, votingActivationTime: 1704575039,
      votingDuration: 259200, againstVotes }));

    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", lifecycleEventsCreated: 1, notificationSentCount: 1
    });
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", lifecycleEventsCreated: 0, notificationSentCount: 0
    });
    expect(service.messages).toHaveLength(1);
    expect(formatTelegramGovernanceMessage(service.messages[0])).toContain("Status: Defeated");
    expect(formatTelegramGovernanceMessage(service.messages[0])).toContain("Against: 12 AAVE (100.00%)");
  });

  it.each([
    [6, "canceled", "canceled"],
    [7, "expired", "pending"]
  ] as const)("records native state %s as %s without sending a vote result", async (state, transition, voteOutcome) => {
    const env = aaveEnv();
    const { rpc, client, block, setProposal } = aaveRpcFixture();
    const adapter = new AaveOnchainGovernanceAdapter(env, client);
    const service = new RecordingService();
    const { context } = createApp({ env, notificationService: service,
      evmGovernanceRegistry: new EvmGovernanceRegistry([adapter]) });
    rpc.getLogs.mockResolvedValue([aaveLog()]);
    await context.onchainGovernanceJob.run("aave");

    const nextBlock = block + 10;
    rpc.getBlock.mockImplementation(async ({ blockNumber }) => {
      const number = blockNumber ?? BigInt(nextBlock);
      return { number, hash: testBlockHash(Number(number)), timestamp: 1704836471n };
    });
    rpc.getLogs.mockResolvedValue(state === 6 ? [aaveLog("ProposalCanceled", {
      blockNumber: BigInt(nextBlock), blockHash: testBlockHash(nextBlock),
      transactionHash: testBlockHash(16), args: { proposalId: 0n }
    })] : []);
    setProposal(aaveRawProposal({ state, cancelTimestamp: state === 6 ? 1704836471 : 0 }));

    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", lifecycleEventsCreated: 1, notificationSentCount: 0
    });
    await expect(context.governanceRepository.findDecisionsBySource(adapter.sourceKey)).resolves.toMatchObject([
      { status: transition, voteOutcome }
    ]);
    await expect(context.governanceRepository.findByNotificationStatus("skipped")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ transition, notificationSkipReason: "aave_onchain_result_only" })])
    );
    await expect(context.governanceRepository.countByNotificationStatus("pending")).resolves.toBe(0);
    expect(service.messages).toEqual([]);
  });
});

describe("Aave on-chain production wiring with real saved proposal zero", () => {
  it("rejects non-canonical Aave logs without advancing its safe checkpoint or contacting recipients", async () => {
    const { context, adapter, service } = runtime();
    await context.onchainGovernanceJob.run("aave");
    const checkpoint = await context.governanceRepository.findSourceState(adapter.sourceKey);
    adapter.setPhase("created");
    const original = adapter.getEvents.bind(adapter);
    jest.spyOn(adapter, "getEvents").mockImplementation(async (from, to) =>
      (await original(from, to)).map((event) => ({ ...event, blockHash: `0x${"11".repeat(32)}` })));

    await expect(context.onchainGovernanceJob.run("aave")).rejects.toThrow("canonical block hash");
    expect(service.messages).toEqual([]);
    await expect(context.governanceRepository.findDecisionsBySource(adapter.sourceKey)).resolves.toEqual([]);
    await expect(context.governanceRepository.findSourceState(adapter.sourceKey)).resolves.toMatchObject({
      cursorBlockNumber: checkpoint!.cursorBlockNumber, healthStatus: "failed"
    });
    const report = await buildAdminStatusReport(context);
    expect(report.healthy).toBe(false);
    expect(report.message).toContain("canonical block hash");
  });
  it("does not recover incomplete results early and delivers them after a canonical live replay repairs the gap", async () => {
    const { context, adapter, service } = runtime();
    await context.onchainGovernanceJob.run("aave");
    adapter.setPhase("executed");
    const spy = jest.spyOn(adapter, "getEvents").mockImplementation(async (from, to) =>
      aaveOnchainEventFixtures.filter((event) => event.blockNumber >= from && event.blockNumber <= to &&
        event.type !== "queued" && event.type !== "executed"));
    await expect(context.onchainGovernanceJob.run("aave")).rejects.toThrow("lifecycle coverage gap");
    expect(service.messages).toEqual([]);
    await expect(context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ candidateCount: 0, attemptedRecipientCount: 0 });
    spy.mockRestore();
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", notificationSentCount: 1
    });
    expect(service.messages).toHaveLength(1);
  });
  it("silently seeds, discovers zero, settles, forwards, and never duplicates records or messages", async () => {
    const { context, adapter, service } = runtime();
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", baselineSeeding: true, decisionsCreated: 0, notificationSentCount: 0
    });
    adapter.setPhase("created");
    await expect(context.onchainGovernanceJob.run(" AAVE ")).resolves.toMatchObject({
      status: "success", decisionsCreated: 1, lifecycleEventsCreated: 1, notificationSentCount: 0
    });
    adapter.setPhase("executed");
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", decisionsUpdated: 2, lifecycleEventsCreated: 3, notificationSentCount: 1
    });
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      decisionsCreated: 0, lifecycleEventsCreated: 0, notificationSentCount: 0
    });
    const decisions = await context.governanceRepository.findDecisionsBySource(adapter.sourceKey);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ proposalId: "0", status: "executed",
      forVotes: "425306287773343762214587", againstVotes: "0",
      aave: { executionScope: "governance-core", resultReceivedAt: "2024-01-09T21:41:11.000Z" } });
    expect(decisions[0].aave?.payloads).toHaveLength(7);
    expect(service.messages).toHaveLength(1);
    const text = formatTelegramGovernanceMessage(service.messages[0]);
    expect(text).toContain("ON-CHAIN GOVERNANCE VOTE RESULT");
    expect(text).toContain("Status: Succeeded");
    expect(text).toContain("Protocol: <b>AAVE</b>");
    expect(text).toContain("For: 425,306.28 AAVE (100.00%)");
    expect(text).toContain("Against: 0 AAVE (0.00%)");
    expect(text).toContain("Result settled: 2024-01-09 21:41 UTC");
    expect(text).not.toMatch(/UNI|Abstain|Voting ended/);
    expect(text).toContain("Link: https://app.aave.com/governance/v3/proposal/?proposalId=0");
    await expect(context.governanceRepository.countByNotificationStatus("sent")).resolves.toBe(1);
    const skipped = await context.governanceRepository.findByNotificationStatus("skipped");
    expect(skipped.map((event) => event.transition).sort()).toEqual(["created", "executed", "queued"]);
    for (const event of skipped) {
      expect(event).toMatchObject({ notificationSkipReason: "aave_onchain_result_only", notificationReady: true,
        transactionHash: expect.stringMatching(/^0x[0-9a-f]{64}$/i) });
    }
  });
  it("closes an existing real historical lifecycle silently on the first scan", async () => {
    const { context, adapter, service } = runtime();
    adapter.setPhase("executed");
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", baselineSeeding: true, decisionsCreated: 1,
      lifecycleEventsCreated: 4, notificationSentCount: 0
    });
    expect(service.messages).toEqual([]);
    await expect(context.governanceRepository.countByNotificationStatus("skipped")).resolves.toBe(4);
  });
  it("automatically recovers failed deliveries without rediscovering or renotifying sent records", async () => {
    const { context, adapter, service } = runtime();
    await context.onchainGovernanceJob.run("aave");
    service.fail = true;
    adapter.setPhase("executed");
    const getDecision = adapter.getDecision.bind(adapter);
    const legacyUrl = "https://vote.onaave.com/proposal/?proposalId=0";
    const spy = jest.spyOn(adapter, "getDecision").mockImplementation(async (...args) => ({
      ...await getDecision(...args), sourceUrl: legacyUrl
    }));
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({ notificationFailedCount: 1 });
    spy.mockRestore();
    // Retry before another scan can update the persisted lifecycle message.
    await expect(context.governanceRepository.findByNotificationStatus("failed"))
      .resolves.toMatchObject([{ transition: "succeeded", message: { sourceUrl: legacyUrl } }]);
    service.fail = false;
    await expect(context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ recoveredCount: 1, stillFailedCount: 0 });
    await context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z");
    expect(service.messages).toHaveLength(1);
    expect(service.messages[0].sourceUrl).toBe("https://app.aave.com/governance/v3/proposal/?proposalId=0");
  });
  it("sends the new link in the Telegram payload and retries only the recipient who missed it", async () => {
    const env = aaveEnv();
    const adapter = new ScriptedAaveOnchainDemoAdapter(env);
    const getDecision = adapter.getDecision.bind(adapter);
    const legacyUrl = "https://vote.onaave.com/proposal/?proposalId=0";
    jest.spyOn(adapter, "getDecision").mockImplementation(async (...args) => ({
      ...await getDecision(...args), sourceUrl: legacyUrl
    }));
    const payloads: Array<{ chat_id: string; text: string; parse_mode: string }> = [];
    const fetchImpl: typeof fetch = async (_url, options) => {
      const payload = JSON.parse(String(options?.body));
      payloads.push(payload);
      return payloads.length === 2
        ? new Response('{"ok":false,"description":"temporary failure"}', { status: 503 })
        : createTelegramApiSuccessResponse();
    };
    const { context } = createApp({ env,
      evmGovernanceRegistry: new EvmGovernanceRegistry([adapter]),
      notificationService: new TelegramNotificationService({
        botToken: "mock-bot-token", allowedUserIds: ["111", "222"], fetchImpl
      })
    });
    await context.onchainGovernanceJob.run("aave");
    expect(payloads).toEqual([]);
    adapter.setPhase("executed");
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({ notificationFailedCount: 1 });
    await expect(context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ recoveredCount: 1, attemptedRecipientCount: 1 });
    await context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z");

    expect(payloads.map(({ chat_id }) => chat_id)).toEqual(["111", "222", "222"]);
    for (const payload of payloads) {
      expect(payload.parse_mode).toBe("HTML");
      expect(payload.text).toContain("Status: Succeeded");
      expect(payload.text.split("\n").at(-1))
        .toBe("Link: https://app.aave.com/governance/v3/proposal/?proposalId=0");
    }
    await expect(context.governanceRepository.countByNotificationStatus("sent")).resolves.toBe(1);
  });
  it("returns a current link for a finalized legacy record without rewriting it or sending alerts", async () => {
    const { app, adapter, context, service } = runtime();
    await request(app).post("/api/admin/fetch-onchain/aave").expect(401);
    adapter.setPhase("executed");
    const getDecision = adapter.getDecision.bind(adapter);
    const legacyUrl = "https://vote.onaave.com/proposal/?proposalId=0";
    const spy = jest.spyOn(adapter, "getDecision").mockImplementation(async (...args) => ({
      ...await getDecision(...args), sourceUrl: legacyUrl
    }));
    await request(app).post("/api/admin/fetch-onchain/aave")
      .set("Authorization", "Bearer test-token").expect(200);
    spy.mockRestore();
    await request(app).get("/api/admin/governance-votes?protocol=aave").expect(401);
    const response = await request(app).get("/api/admin/governance-votes?protocol=aave")
      .set("Authorization", "Bearer test-token").expect(200);
    expect(response.body.governanceVotes).toMatchObject([{
      proposalId: "0", status: "executed", sourceUrl: "https://app.aave.com/governance/v3/proposal/?proposalId=0"
    }]);
    await expect(context.governanceRepository.findDecisionsBySource(adapter.sourceKey))
      .resolves.toMatchObject([{ sourceUrl: legacyUrl }]);
    expect(service.messages).toEqual([]);
  });
  it("shows Aave source/baseline failures in the existing daily admin report", async () => {
    const { context, adapter } = runtime();
    const before = await buildAdminStatusReport(context);
    expect(before.problems).toContain("No on-chain governance source state has been recorded for aave.");
    await context.onchainGovernanceJob.run("aave");
    await context.governanceRepository.updateSourceState(adapter.sourceKey,
      (state) => ({ ...state, healthStatus: "failed", lastError: "RPC unavailable" }));
    const after = await buildAdminStatusReport(context);
    expect(after.healthy).toBe(false);
    expect(after.message).toContain("RPC unavailable");
    expect(after.message).toContain(adapter.sourceKey);
  });
});
