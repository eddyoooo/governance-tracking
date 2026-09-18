import type {
  NotificationDelivery
} from "../protocols/types.js";
import type { ProposalNotificationState } from "../storage/proposal.repository.js";
import type { NotificationRecipient } from "./notification.service.js";
import type { NotificationRecord } from "./proposalNotifications.js";

export function buildPendingDeliveries(
  recipients: readonly NotificationRecipient[],
  now: string
): Record<string, NotificationDelivery> {
  return Object.fromEntries(
    recipients.map((recipient) => [
      recipient.key,
      {
        recipientKey: recipient.key,
        recipientMaskedId: recipient.maskedId,
        status: "pending",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now
      }
    ])
  );
}

export function buildLegacyDeliveries(
  proposal: NotificationRecord,
  recipients: readonly NotificationRecipient[],
  now: string
): Record<string, NotificationDelivery> | null {
  const error = proposal.notificationError ?? "";
  const attemptedCountMatch = error.match(
    /of\s+(\d+)\s+allowed recipients/i
  );
  const attemptedCount = attemptedCountMatch
    ? Number(attemptedCountMatch[1])
    : null;
  const failureMatches = [
    ...error.matchAll(/recipient\s+(\d+)(?:\s+\(([^)]+)\))?\s+failed/gi)
  ];

  if (
    attemptedCount !== recipients.length ||
    failureMatches.length === 0
  ) {
    return null;
  }

  const failedIndexes = new Set<number>();
  const maskedIdCounts = new Map<string, number>();

  for (const recipient of recipients) {
    maskedIdCounts.set(
      recipient.maskedId,
      (maskedIdCounts.get(recipient.maskedId) ?? 0) + 1
    );
  }

  for (const match of failureMatches) {
    const index = Number(match[1]);
    const recipient = recipients[index - 1];
    const recordedMaskedId = match[2];

    if (
      !recipient ||
      (recipients.length > 1 && !recordedMaskedId) ||
      (recordedMaskedId && recordedMaskedId !== recipient.maskedId) ||
      (recordedMaskedId &&
        (maskedIdCounts.get(recordedMaskedId) ?? 0) > 1)
    ) {
      return null;
    }

    failedIndexes.add(index);
  }

  return Object.fromEntries(
    recipients.map((recipient, index) => {
      const failed = failedIndexes.has(index + 1);
      const delivery: NotificationDelivery = {
        recipientKey: recipient.key,
        recipientMaskedId: recipient.maskedId,
        status: failed ? "failed" : "sent",
        attemptCount: 1,
        createdAt: proposal.createdAt,
        updatedAt: now
      };

      if (failed) {
        delivery.lastAttemptAt = proposal.updatedAt;
        delivery.nextRetryAt = now;
        delivery.lastError = error;
      } else {
        delivery.sentAt = proposal.updatedAt;
      }

      return [recipient.key, delivery];
    })
  );
}

export function notificationStateFromDeliveries(
  deliveries: Record<string, NotificationDelivery>
) {
  const values = Object.values(deliveries);
  const failed = values.filter((delivery) => delivery.status === "failed");

  if (failed.length > 0) {
    return {
      notificationStatus: "failed" as const,
      notificationError: [
        `Telegram delivery unresolved for ${failed.length} recipient(s)`,
        ...failed.map(
          (delivery) =>
            `${delivery.recipientMaskedId}: ${
              delivery.lastError ?? "No error recorded."
            }`
        )
      ].join("; "),
      notificationDeliveries: deliveries
    };
  }

  if (values.some((delivery) => delivery.status === "pending")) {
    return {
      notificationStatus: "pending" as const,
      notificationDeliveries: deliveries
    };
  }

  if (values.some((delivery) => delivery.status === "sent")) {
    return {
      notificationStatus: "sent" as const,
      notificationDeliveries: deliveries
    };
  }

  return {
    notificationStatus: "skipped" as const,
    notificationDeliveries: deliveries
  };
}

export function currentNotificationState(
  proposal: NotificationRecord
): ProposalNotificationState {
  return {
    notificationStatus: proposal.notificationStatus,
    notificationError: proposal.notificationError,
    notificationDeliveries: proposal.notificationDeliveries
  };
}

export function cloneDeliveries(
  deliveries: NotificationRecord["notificationDeliveries"]
): Record<string, NotificationDelivery> {
  return Object.fromEntries(
    Object.entries(deliveries ?? {}).map(([key, delivery]) => [
      key,
      { ...delivery }
    ])
  );
}

export function deduplicateProposals<T extends NotificationRecord>(
  proposals: T[]
): T[] {
  return [...new Map(proposals.map((proposal) => [proposal.id, proposal])).values()]
    .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt));
}

export function needsRecoveryNow(
  proposal: NotificationRecord,
  activeRecipientKeys: ReadonlySet<string>,
  now: string
): boolean {
  const deliveries = Object.values(proposal.notificationDeliveries ?? {});

  if (deliveries.length === 0) {
    return true;
  }

  return deliveries.some(
    (delivery) =>
      delivery.status === "pending" ||
      (delivery.status === "failed" &&
        (!activeRecipientKeys.has(delivery.recipientKey) ||
          !delivery.nextRetryAt ||
          delivery.nextRetryAt <= now))
  );
}
