import { describe, expect, it } from "@jest/globals";
import { createApp } from "../../src/server.js";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/index.js";
import { AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON } from "../../src/protocols/aave/aaveNotificationPolicy.js";
import { testEnv } from "../helpers/builders.js";

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
  it("stores the real routine-cap fixture but notifies every other allowlisted fixture", async () => {
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

    expect(result).toMatchObject({
      fetchedCount: 6,
      allowlistedCount: 5,
      storedNewCount: 5,
      skippedCount: 1,
      notificationSuppressedCount: 1,
      notificationSentCount: 4,
      notificationFailedCount: 0
    });
    expect(capProposal).toMatchObject({
      protocol: "aave",
      publisherName: "LlamaRisk",
      notificationStatus: "skipped",
      notificationSkipReason: AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON
    });
    expect(notificationService.messages).toHaveLength(4);
    expect(notificationService.messages.map((message) => message.title)).not.toContain(
      capProposal?.title
    );
    expect(notificationService.messages.map((message) => message.publisherName)).toEqual(
      expect.arrayContaining(["AaveLabs", "TokenLogic", "Certora", "kpk"])
    );
  });
});
