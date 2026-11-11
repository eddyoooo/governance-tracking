import { describe, expect, it, jest } from "@jest/globals";
import { ProposalNotificationDispatcher } from "../../src/notifications/proposalNotifications.js";
import type { NotificationMessage, NotificationService } from "../../src/notifications/notification.service.js";
import { normalizeLidoForumItem } from "../../src/protocols/lido/lido.normalizer.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { createRawGovernanceItem, createSilentLogger } from "../helpers/builders.js";

class RecordingService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];
  getRecipients() { return [{ key: "recipient", maskedId: "***1111" }]; }
  async send(message: NotificationMessage) { this.messages.push(message); }
}

describe("notification recovery fairness and failure isolation", () => {
  it("limits each run to 100 records and drains the remaining batch without duplicates", async () => {
    const repository = new MemoryProposalRepository();
    const service = new RecordingService();
    for (let index = 0; index < 101; index++) {
      await repository.upsert(normalizeLidoForumItem(createRawGovernanceItem({ sourceId: String(index) })),
        { notificationStatusForNew: "pending" });
    }
    const dispatcher = new ProposalNotificationDispatcher(repository, service, createSilentLogger());
    await expect(dispatcher.recoverOutstanding()).resolves.toMatchObject({ candidateCount: 100, recoveredCount: 100 });
    await expect(dispatcher.recoverOutstanding()).resolves.toMatchObject({ candidateCount: 1, recoveredCount: 1 });
    await expect(dispatcher.recoverOutstanding()).resolves.toMatchObject({ candidateCount: 0 });
    expect(service.messages).toHaveLength(101);
  });

  it("rotates bounded batches so 100 persistently unreadable records cannot starve the next alert", async () => {
    const repository = new MemoryProposalRepository();
    const service = new RecordingService();
    const blocked = new Set<string>();
    for (let index = 0; index < 101; index++) {
      const stored = await repository.upsert(normalizeLidoForumItem(createRawGovernanceItem({ sourceId: String(index) })),
        { notificationStatusForNew: "pending" });
      if (index < 100) blocked.add(stored.proposal.id);
    }
    const original = repository.findById.bind(repository);
    jest.spyOn(repository, "findById").mockImplementation(async (id) => {
      if (blocked.has(id)) throw new Error("Persistently unreadable record");
      return original(id);
    });
    const dispatcher = new ProposalNotificationDispatcher(repository, service, createSilentLogger());
    await expect(dispatcher.recoverOutstanding()).resolves.toMatchObject({ candidateCount: 100, recoveredCount: 0 });
    await expect(dispatcher.recoverOutstanding()).resolves.toMatchObject({ candidateCount: 100, recoveredCount: 1 });
    expect(service.messages).toHaveLength(1);
  });
  it("finds active alerts behind more than 1,000 paused records", async () => {
    const repository = new MemoryProposalRepository();
    const service = new RecordingService();
    for (let index = 0; index < 1_001; index++) {
      await repository.upsert(normalizeLidoForumItem(createRawGovernanceItem({
        sourceId: String(index), publisherName: "Paused"
      })), { notificationStatusForNew: "pending" });
    }
    const active = await repository.upsert(normalizeLidoForumItem(createRawGovernanceItem({
      sourceId: "active", publisherName: "Active", title: "Still deliver this alert"
    })), { notificationStatusForNew: "pending" });
    const dispatcher = new ProposalNotificationDispatcher(repository, service, createSilentLogger(),
      undefined, undefined, (record) => record.publisherName === "Active");
    await expect(dispatcher.recoverOutstanding()).resolves.toMatchObject({ recoveredCount: 1 });
    expect(service.messages).toHaveLength(1);
    await expect(repository.findById(active.proposal.id)).resolves.toMatchObject({ notificationStatus: "sent" });
    await expect(repository.countByNotificationStatus("pending")).resolves.toBe(1_001);
  });

  it("finds due failures behind more than 1,000 failures whose backoff has not expired", async () => {
    const repository = new MemoryProposalRepository();
    const service = new RecordingService();
    for (let index = 0; index < 1_002; index++) {
      const stored = await repository.upsert(normalizeLidoForumItem(createRawGovernanceItem({ sourceId: String(index) })));
      await repository.updateNotificationState(stored.proposal.id, () => ({
        notificationStatus: "failed",
        notificationDeliveries: { recipient: {
          recipientKey: "recipient", recipientMaskedId: "***1111", status: "failed", attemptCount: 1,
          nextRetryAt: index === 1_001 ? "2026-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z",
          createdAt: stored.proposal.createdAt, updatedAt: stored.proposal.updatedAt
        } }
      }));
    }
    const dispatcher = new ProposalNotificationDispatcher(repository, service, createSilentLogger());
    await expect(dispatcher.recoverOutstanding("2026-11-10T00:00:00.000Z"))
      .resolves.toMatchObject({ recoveredCount: 1, attemptedRecipientCount: 1 });
    expect(service.messages).toHaveLength(1);
  });

  it("continues other records after one notification record cannot be read", async () => {
    const repository = new MemoryProposalRepository();
    const service = new RecordingService();
    const first = await repository.upsert(normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "first" })),
      { notificationStatusForNew: "pending" });
    const second = await repository.upsert(normalizeLidoForumItem(createRawGovernanceItem({ sourceId: "second" })),
      { notificationStatusForNew: "pending" });
    const originalRead = repository.findById.bind(repository);
    jest.spyOn(repository, "findById").mockImplementation(async (id) => {
      if (id === first.proposal.id) throw new Error("One record read failed at https://rpc.invalid/secret");
      return originalRead(id);
    });
    const dispatcher = new ProposalNotificationDispatcher(repository, service, createSilentLogger());
    const result = await dispatcher.recoverOutstanding();
    expect(result).toMatchObject({ candidateCount: 2, recoveredCount: 1 });
    expect(result.errors).toEqual([expect.stringContaining("One record read failed at [redacted-url]")]);
    expect(service.messages).toHaveLength(1);
    await expect(originalRead(second.proposal.id)).resolves.toMatchObject({ notificationStatus: "sent" });
    await expect(originalRead(first.proposal.id)).resolves.toMatchObject({ notificationStatus: "pending" });
  });
});
