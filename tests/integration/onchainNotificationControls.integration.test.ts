import { describe, expect, it } from "@jest/globals";
import { createGovernanceLifecycleEventId } from "../../src/onchain/governanceDecision.js";
import type { GovernanceLifecycleEvent } from "../../src/onchain/types.js";
import { createApp } from "../../src/server.js";
import { createRepositories } from "../../src/storage/index.js";
import { ScriptedAaveOnchainDemoAdapter } from "../../src/demoFixtures/scriptedAaveOnchainDemo.adapter.js";
import { aaveOnchainEventFixtures } from "../../src/demoFixtures/aaveOnchain.fixture.js";
import { createGovernanceObservation } from "../helpers/onchainBuilders.js";
import { createSilentLogger, testEnv } from "../helpers/builders.js";
import type { NotificationMessage, NotificationService } from "../../src/notifications/notification.service.js";

class RecordingService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly attempts: string[] = [];
  readonly protocols: string[] = [];
  failSecond = false;
  getRecipients() { return [{ key: "first", maskedId: "***1111" }, { key: "second", maskedId: "***2222" }]; }
  async send(message: NotificationMessage, keys: readonly string[] = []) {
    this.attempts.push(...keys);
    this.protocols.push(message.protocol);
    if (this.failSecond && keys.includes("second")) throw new Error("Simulated delivery outage");
  }
}

function sourceEnv(protocol: string, enabled = true, notifications = true) {
  return testEnv({ ETHEREUM_RPC_URL: "https://rpc.example.invalid", ENABLE_TELEGRAM_NOTIFICATIONS: "true",
    [`${protocol.toUpperCase()}_ONCHAIN_ENABLED`]: String(enabled),
    [`${protocol.toUpperCase()}_ONCHAIN_NOTIFICATIONS_ENABLED`]: String(enabled && notifications) });
}

async function observationFor(protocol: string) {
  if (protocol === "uniswap") return createGovernanceObservation();
  const adapter = new ScriptedAaveOnchainDemoAdapter(testEnv());
  adapter.setPhase("executed");
  return adapter.getDecision("0", aaveOnchainEventFixtures, null,
    aaveOnchainEventFixtures[3].blockNumber);
}

function deliverableEvent(events: GovernanceLifecycleEvent[]) {
  return events.find((event) => event.notificationStatus === "pending")!;
}

describe("production on-chain notification controls", () => {
  it("keeps active Aave recovery running while Uniswap notifications are paused", async () => {
    const env = testEnv({ ETHEREUM_RPC_URL: "https://rpc.example.invalid", ENABLE_TELEGRAM_NOTIFICATIONS: "true",
      UNISWAP_ONCHAIN_ENABLED: "true", UNISWAP_ONCHAIN_NOTIFICATIONS_ENABLED: "false",
      AAVE_ONCHAIN_ENABLED: "true", AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "true" });
    const repositories = createRepositories(env, createSilentLogger());
    const service = new RecordingService();
    const uniswap = await repositories.governanceRepository.upsertDecision(await observationFor("uniswap"),
      { notificationStatusForNewEvents: "pending" });
    await repositories.governanceRepository.upsertDecision(await observationFor("aave"),
      { notificationStatusForNewEvents: "pending" });
    const { context } = createApp({ env, repositories, notificationService: service });
    await expect(context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ candidateCount: 1, recoveredCount: 1 });
    expect(service.protocols).toEqual(["aave", "aave"]);
    await expect(repositories.governanceRepository.findById(uniswap.lifecycleEventsCreated[0].id))
      .resolves.toMatchObject({ notificationStatus: "pending" });
  });

  it("does not let a malformed stored source identity block healthy queued events", async () => {
    const env = sourceEnv("uniswap");
    const repositories = createRepositories(env, createSilentLogger());
    const service = new RecordingService();
    await repositories.governanceRepository.upsertDecision(
      createGovernanceObservation({ protocol: 123 as unknown as string }), { notificationStatusForNewEvents: "pending" });
    await repositories.governanceRepository.upsertDecision(
      createGovernanceObservation({ proposalId: "2" }), { notificationStatusForNewEvents: "pending" });
    const { context } = createApp({ env, repositories, notificationService: service });
    await expect(context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ recoveredCount: 1 });
    expect(service.protocols).toEqual(["uniswap", "uniswap"]);
  });
  it.each([
    ["uniswap", "source"], ["uniswap", "notifications"],
    ["aave", "source"], ["aave", "notifications"]
  ])("pauses pending %s deliveries when %s is disabled and resumes exactly once", async (protocol, control) => {
    const env = sourceEnv(protocol);
    const repositories = createRepositories(env, createSilentLogger());
    const service = new RecordingService();
    const inserted = await repositories.governanceRepository.upsertDecision(await observationFor(protocol),
      { notificationStatusForNewEvents: "pending" });
    const event = deliverableEvent(inserted.lifecycleEventsCreated);
    const paused = createApp({ env: sourceEnv(protocol, control !== "source", false), repositories,
      notificationService: service }).context;

    await expect(paused.governanceNotificationDispatcher.notifyNewProposal(event)).resolves.toEqual({ status: "pending" });
    await expect(paused.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ candidateCount: 0, attemptedRecipientCount: 0 });
    expect(service.attempts).toEqual([]);
    await expect(repositories.governanceRepository.findById(event.id)).resolves.toEqual(event);

    const resumed = createApp({ env, repositories, notificationService: service }).context;
    await expect(resumed.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z"))
      .resolves.toMatchObject({ recoveredCount: 1, stillFailedCount: 0 });
    await resumed.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z");
    expect(service.attempts).toEqual(["first", "second"]);
  });

  it.each(["uniswap", "aave"])("resumes only unresolved %s recipients after a pause", async (protocol) => {
    const env = sourceEnv(protocol);
    const repositories = createRepositories(env, createSilentLogger());
    const service = new RecordingService();
    service.failSecond = true;
    const inserted = await repositories.governanceRepository.upsertDecision(await observationFor(protocol),
      { notificationStatusForNewEvents: "pending" });
    const event = deliverableEvent(inserted.lifecycleEventsCreated);
    const active = createApp({ env, repositories, notificationService: service }).context;
    await expect(active.governanceNotificationDispatcher.notifyNewProposal(event)).resolves.toMatchObject({ status: "failed" });
    const failed = await repositories.governanceRepository.findById(event.id);
    const paused = createApp({ env: sourceEnv(protocol, true, false), repositories, notificationService: service }).context;
    await paused.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z");
    expect(service.attempts).toEqual(["first", "second"]);
    await expect(repositories.governanceRepository.findById(event.id)).resolves.toEqual(failed);
    service.failSecond = false;
    await active.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z");
    expect(service.attempts).toEqual(["first", "second", "second"]);
    await expect(repositories.governanceRepository.findById(event.id)).resolves.toMatchObject({ notificationStatus: "sent" });
  });

  it("closes pending and failed legacy Aave non-results, preserving sent recipients and delivering the result", async () => {
    const env = sourceEnv("aave");
    const repositories = createRepositories(env, createSilentLogger());
    const repository = repositories.governanceRepository;
    const { decision } = await repository.upsertDecision(await observationFor("aave"),
      { notificationStatusForNewEvents: "pending" });
    const eventId = (transition: "created" | "queued" | "executed" | "succeeded") =>
      createGovernanceLifecycleEventId(decision.id, transition);
    const now = "2026-11-13T10:00:00.000Z";
    const first = { recipientKey: "first", recipientMaskedId: "***1111", status: "sent" as const,
      attemptCount: 1, createdAt: now, updatedAt: now, sentAt: now };
    await repository.updateNotificationState(eventId("created"), () => ({ notificationStatus: "pending" }));
    await repository.updateNotificationState(eventId("queued"), () => ({
      notificationStatus: "failed", notificationError: "Legacy failure", notificationDeliveries: {
        first, second: { recipientKey: "second", recipientMaskedId: "***2222", status: "failed",
          attemptCount: 1, createdAt: now, updatedAt: now,
          nextRetryAt: "2099-01-01T00:00:00.000Z", lastError: "Legacy failure" }
      }
    }));
    const sent = await repository.updateNotificationState(eventId("executed"), () => ({
      notificationStatus: "sent", notificationDeliveries: { first }
    }));
    const service = new RecordingService();
    const { context } = createApp({ env, repositories, notificationService: service });
    await expect(context.governanceNotificationDispatcher.recoverOutstanding(now)).resolves.toMatchObject({
      candidateCount: 3, attemptedRecipientCount: 2, recoveredCount: 1, skippedCount: 2, stillFailedCount: 0
    });
    expect(service.attempts).toEqual(["first", "second"]);
    expect(service.protocols).toEqual(["aave", "aave"]);
    const queued = await repository.findById(eventId("queued"));
    expect(queued).toMatchObject({ notificationStatus: "skipped", notificationSkipReason: "aave_onchain_result_only",
      notificationDeliveries: { first, second: { status: "skipped", attemptCount: 1 } } });
    expect(queued?.notificationError).toBeUndefined();
    expect(queued?.notificationDeliveries?.second.nextRetryAt).toBeUndefined();
    await expect(repository.findById(eventId("created"))).resolves.toMatchObject({
      notificationStatus: "skipped", notificationSkipReason: "aave_onchain_result_only"
    });
    await expect(repository.findById(eventId("executed"))).resolves.toEqual(sent);
    await expect(repository.findById(eventId("succeeded"))).resolves.toMatchObject({ notificationStatus: "sent" });
    await expect(context.governanceNotificationDispatcher.recoverOutstanding(now)).resolves.toMatchObject({
      candidateCount: 0, attemptedRecipientCount: 0
    });
  });

  it("closes a legacy queued non-result even while canonical evidence is still missing", async () => {
    const env = sourceEnv("aave");
    const repositories = createRepositories(env, createSilentLogger());
    const adapter = new ScriptedAaveOnchainDemoAdapter(env);
    adapter.setPhase("executed");
    const observation = await adapter.getDecision("0", [], null, aaveOnchainEventFixtures[3].blockNumber);
    const { lifecycleEventsCreated } = await repositories.governanceRepository.upsertDecision(observation,
      { notificationStatusForNewEvents: "pending" });
    const queued = lifecycleEventsCreated.find((event) => event.transition === "queued")!;
    expect(queued.notificationReady).toBe(false);
    await repositories.governanceRepository.updateNotificationState(queued.id, () => ({ notificationStatus: "pending" }));
    const service = new RecordingService();
    const { context } = createApp({ env, repositories, notificationService: service });
    await expect(context.governanceNotificationDispatcher.recoverOutstanding()).resolves.toMatchObject({
      candidateCount: 1, skippedCount: 1, attemptedRecipientCount: 0
    });
    await expect(repositories.governanceRepository.findById(queued.id)).resolves.toMatchObject({
      notificationStatus: "skipped", notificationReady: false
    });
    await expect(repositories.governanceRepository.findById(deliverableEvent(lifecycleEventsCreated).id))
      .resolves.toMatchObject({ notificationStatus: "pending", notificationReady: false });
    expect(service.attempts).toEqual([]);
  });

  it("does not dispatch a legacy non-result through the immediate send path either", async () => {
    const env = sourceEnv("aave");
    const repositories = createRepositories(env, createSilentLogger());
    const repository = repositories.governanceRepository;
    const { lifecycleEventsCreated } = await repository.upsertDecision(await observationFor("aave"),
      { notificationStatusForNewEvents: "pending" });
    const forwarded = lifecycleEventsCreated.find((event) => event.transition === "executed")!;
    const legacy = await repository.updateNotificationState(forwarded.id, () => ({ notificationStatus: "pending" }));
    const service = new RecordingService();
    const { context } = createApp({ env, repositories, notificationService: service });
    await expect(context.governanceNotificationDispatcher.notifyNewProposal(legacy!))
      .resolves.toEqual({ status: "skipped" });
    await expect(repository.findById(forwarded.id)).resolves.toMatchObject({
      notificationStatus: "skipped", notificationSkipReason: "aave_onchain_result_only"
    });
    expect(service.attempts).toEqual([]);
  });

  it("does not send legacy queued events for a source that is no longer registered", async () => {
    const env = sourceEnv("uniswap");
    const repositories = createRepositories(env, createSilentLogger());
    const service = new RecordingService();
    const inserted = await repositories.governanceRepository.upsertDecision(
      createGovernanceObservation({ sourceKey: "retired-source" }), { notificationStatusForNewEvents: "pending" });
    const { context } = createApp({ env, repositories, notificationService: service });
    await context.governanceNotificationDispatcher.recoverOutstanding("2099-01-01T00:00:00.000Z");
    expect(service.attempts).toEqual([]);
    await expect(repositories.governanceRepository.findById(inserted.lifecycleEventsCreated[0].id))
      .resolves.toMatchObject({ notificationStatus: "pending" });
  });
});
