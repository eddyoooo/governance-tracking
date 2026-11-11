import { describe, expect, it, jest } from "@jest/globals";
import { createApp } from "../../src/server.js";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/index.js";
import {
  AAVE_ROUTINE_CAP_AND_IRM_NOTIFICATION_SKIP_REASON,
  AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON
} from "../../src/protocols/aave/aaveNotificationPolicy.js";
import { createRawGovernanceItem, testEnv } from "../helpers/builders.js";

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];

  getRecipients() {
    return [{ key: "recipient-1", maskedId: "*****1111" }];
  }

  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(message);
  }
}

describe("Aave notification policy runtime integration", () => {
  it.each([
    "Cap and Oracle and IRM Changes",
    "Cap Reductions and Slope2 and IRM Changes",
    "Cap and Emergency IRM Changes"
  ])("stores and notifies non-routine combined changes exactly once: %s", async (operation) => {
    const notificationService = new RecordingNotificationService();
    const { context } = createApp({
      env: testEnv({
        AAVE_ALLOWED_PUBLISHERS: '["LlamaRisk"]',
        AAVE_SUPPRESS_ROUTINE_CAP_NOTIFICATIONS: "true"
      }),
      notificationService
    });
    const item = createRawGovernanceItem({
      protocol: "aave",
      title: `Risk Stewards: ${operation} on Aave V4 / 2026.11.06`,
      publisherName: "LlamaRisk",
      sourceUrl: "https://governance.aave.com/t/test-combined-changes/1001"
    });
    jest.spyOn(context.protocolRegistry.get("aave")!, "fetchRecentWithDiagnostics")
      .mockResolvedValue({ items: [item], warnings: [] });
    await context.protocolStateRepository.initializeBaseline(
      "aave", true, "2026-11-04T08:00:00.000Z"
    );

    const first = await context.fetchJob.run("aave");
    const repeated = await context.fetchJob.run("aave");
    const stored = await context.proposalRepository.findBySourceIdentity(
      "aave", "forum", item.sourceId
    );

    expect(first).toMatchObject({
      storedNewCount: 1,
      notificationSuppressedCount: 0,
      notificationSentCount: 1,
      notificationFailedCount: 0
    });
    expect(repeated).toMatchObject({
      storedNewCount: 0,
      unchangedExistingCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 0
    });
    expect(stored?.notificationStatus).toBe("sent");
    expect(stored?.notificationSkipReason).toBeUndefined();
    expect(notificationService.messages).toEqual([{
      protocol: "aave",
      sourceType: "forum",
      publisherName: "LlamaRisk",
      title: item.title,
      sourceUrl: item.sourceUrl
    }]);
  });

  it("stores the real cap-only and cap-plus-IRM fixtures but notifies every other allowlisted fixture", async () => {
    const notificationService = new RecordingNotificationService();
    const { context } = createApp({
      env: testEnv({
        AAVE_ALLOWED_PUBLISHERS: JSON.stringify([
          "AaveLabs",
          "LlamaRisk",
          "TokenLogic",
          "Certora",
          "kpk"
        ]),
        AAVE_SUPPRESS_ROUTINE_CAP_NOTIFICATIONS: "true"
      }),
      notificationService
    });
    await context.protocolStateRepository.initializeBaseline(
      "aave",
      true,
      "2026-11-04T08:00:00.000Z"
    );

    const result = await context.fetchJob.run("aave");
    const stored = await context.proposalRepository.findAll();
    const capProposal = stored.find((proposal) => proposal.sourceId === "25168");
    const capAndIrmProposal = stored.find(
      (proposal) => proposal.sourceId === "26073"
    );

    expect(result).toMatchObject({
      fetchedCount: 7,
      allowlistedCount: 6,
      storedNewCount: 6,
      skippedCount: 1,
      notificationSuppressedCount: 2,
      notificationSentCount: 4,
      notificationFailedCount: 0
    });
    expect(capProposal).toMatchObject({
      protocol: "aave",
      publisherName: "LlamaRisk",
      notificationStatus: "skipped",
      notificationSkipReason: AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON
    });
    expect(capAndIrmProposal).toMatchObject({
      protocol: "aave",
      publisherName: "LlamaRisk",
      notificationStatus: "skipped",
      notificationSkipReason:
        AAVE_ROUTINE_CAP_AND_IRM_NOTIFICATION_SKIP_REASON
    });
    expect(notificationService.messages).toHaveLength(4);
    expect(notificationService.messages.map((message) => message.title)).not.toContain(
      capProposal?.title
    );
    expect(notificationService.messages.map((message) => message.title)).not.toContain(
      capAndIrmProposal?.title
    );
    expect(notificationService.messages.map((message) => message.publisherName)).toEqual(
      expect.arrayContaining(["AaveLabs", "TokenLogic", "Certora", "kpk"])
    );
  });
});
