import { describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../../src/server.js";
import { ScriptedAaveOnchainDemoAdapter } from "../../src/demoFixtures/scriptedAaveOnchainDemo.adapter.js";
import { AaveOnchainGovernanceAdapter } from "../../src/onchain/aave/aaveOnchain.adapter.js";
import { EvmGovernanceRegistry } from "../../src/onchain/registry.js";
import { buildAdminStatusReport } from "../../src/adminStatus/adminStatus.service.js";
import { formatTelegramGovernanceMessage } from "../../src/notifications/telegramNotification.service.js";
import type { NotificationMessage, NotificationService } from "../../src/notifications/notification.service.js";
import { testEnv } from "../helpers/builders.js";
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
  it("preserves the checkpoint when settlement evidence changes mid-scan and alerts only after repair", async () => {
    const env = aaveEnv();
    const { rpc, client, block, setProposal } = aaveRpcFixture();
    const adapter = new AaveOnchainGovernanceAdapter(env, client);
    const service = new RecordingService();
    const { context } = createApp({ env, notificationService: service,
      evmGovernanceRegistry: new EvmGovernanceRegistry([adapter]) });
    rpc.getLogs.mockResolvedValue([aaveLog()]);
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", baselineSeeding: true, notificationSentCount: 0
    });
    const before = await context.governanceRepository.findDecisionsBySource(adapter.sourceKey);

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
      status: "success", cursorAfter: finalizedBlock, lifecycleEventsCreated: 2, notificationSentCount: 2
    });
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", lifecycleEventsCreated: 0, notificationSentCount: 0
    });
    expect(service.messages).toHaveLength(2);
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
    expect(service.messages).toHaveLength(1);
    await expect(context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ candidateCount: 0, attemptedRecipientCount: 0 });
    spy.mockRestore();
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", notificationSentCount: 3
    });
    expect(service.messages).toHaveLength(4);
  });
  it("silently seeds, discovers zero, settles, forwards, and never duplicates records or messages", async () => {
    const { context, adapter, service } = runtime();
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", baselineSeeding: true, decisionsCreated: 0, notificationSentCount: 0
    });
    adapter.setPhase("created");
    await expect(context.onchainGovernanceJob.run(" AAVE ")).resolves.toMatchObject({
      status: "success", decisionsCreated: 1, lifecycleEventsCreated: 1, notificationSentCount: 1
    });
    adapter.setPhase("executed");
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({
      status: "success", decisionsUpdated: 2, lifecycleEventsCreated: 3, notificationSentCount: 3
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
    expect(service.messages).toHaveLength(4);
    const result = service.messages.find((message) => message.kind === "lifecycle" && message.heading === "ON-CHAIN GOVERNANCE VOTE RESULT")!;
    const text = formatTelegramGovernanceMessage(result);
    expect(text).toContain("Protocol: <b>AAVE</b>");
    expect(text).toContain("For: 425,306.28 AAVE (100.00%)");
    expect(text).toContain("Against: 0 AAVE (0.00%)");
    expect(text).toContain("Result settled: 2024-01-09 21:41 UTC");
    expect(text).not.toMatch(/UNI|Abstain|Voting ended/);
    expect(formatTelegramGovernanceMessage(service.messages[3])).toContain("GOVERNANCE PROPOSAL FORWARDED");
    await expect(context.governanceRepository.countByNotificationStatus("sent")).resolves.toBe(4);
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
    adapter.setPhase("created");
    await expect(context.onchainGovernanceJob.run("aave")).resolves.toMatchObject({ notificationFailedCount: 1 });
    service.fail = false;
    await expect(context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ recoveredCount: 1, stillFailedCount: 0 });
    await context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z");
    expect(service.messages).toHaveLength(1);
  });
  it("exposes Aave through the existing authenticated operator API", async () => {
    const { app, adapter } = runtime();
    await request(app).post("/api/admin/fetch-onchain/aave").expect(401);
    adapter.setPhase("executed");
    await request(app).post("/api/admin/fetch-onchain/aave")
      .set("Authorization", "Bearer test-token").expect(200);
    const response = await request(app).get("/api/admin/governance-votes?protocol=aave")
      .set("Authorization", "Bearer test-token").expect(200);
    expect(response.body.governanceVotes).toHaveLength(1);
    expect(response.body.governanceVotes[0].proposalId).toBe("0");
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
