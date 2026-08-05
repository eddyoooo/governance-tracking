import type { Logger } from "pino";
import type {
  NotificationDelivery,
  StoredProposal
} from "../protocols/types.js";
import type { ProposalRepository } from "../storage/proposal.repository.js";
import type {
  NotificationMessage,
  NotificationRecipient,
  NotificationService
} from "./notification.service.js";

export interface ProposalNotificationResult {
  status: "sent" | "failed" | "skipped";
  error?: string;
}

export interface NotificationRecoveryResult {
  candidateCount: number;
  attemptedProposalCount: number;
  attemptedRecipientCount: number;
  recoveredCount: number;
  stillPendingCount: number;
  stillFailedCount: number;
  skippedCount: number;
  errors: string[];
  skippedBecauseRunning: boolean;
}

export const NOTIFICATION_RECOVERY_BATCH_SIZE = 100;
const NOTIFICATION_RECOVERY_SCAN_SIZE = 1_000;
const RETRY_DELAYS_MS = [
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000
] as const;

export function buildProposalNotificationMessage(
  proposal: StoredProposal
): NotificationMessage {
  return {
    protocol: proposal.protocol,
    sourceType: proposal.sourceType,
    publisherName: proposal.publisherName,
    title: proposal.title,
    sourceUrl: proposal.sourceUrl
  };
}

export function notificationRetryAt(
  attemptCount: number,
  attemptedAt: string
): string {
  const delayIndex = Math.min(
    Math.max(attemptCount - 1, 0),
    RETRY_DELAYS_MS.length - 1
  );

  return new Date(
    Date.parse(attemptedAt) + RETRY_DELAYS_MS[delayIndex]
  ).toISOString();
}

export class ProposalNotificationDispatcher {
  private recoveryRunning = false;
  private readonly proposalLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly proposalRepository: ProposalRepository,
    private readonly notificationService: NotificationService,
    private readonly logger: Pick<Logger, "error" | "info" | "warn">
  ) {}

  async notifyNewProposal(
    proposal: StoredProposal
  ): Promise<ProposalNotificationResult> {
    return this.withProposalLock(proposal.id, async () => {
      const current = await this.proposalRepository.findById(proposal.id);

      if (!current) {
        return {
          status: "failed",
          error: "Proposal disappeared before notification delivery."
        };
      }

      if (
        current.notificationStatus === "sent" ||
        current.notificationStatus === "skipped"
      ) {
        return { status: current.notificationStatus };
      }

      if (current.notificationStatus === "failed") {
        return {
          status: "failed",
          error:
            current.notificationError ??
            "Proposal notification is awaiting automatic recovery."
        };
      }

      if (!this.notificationService.enabled) {
        await this.proposalRepository.updateNotificationStatus(
          current.id,
          "skipped"
        );
        return { status: "skipped" };
      }

      const initialized = await this.initializeDeliveries(current);

      if (!initialized) {
        return {
          status: "failed",
          error: "Proposal disappeared before notification delivery."
        };
      }

      return this.attemptOutstandingRecipients(initialized, true);
    });
  }

  async recoverOutstanding(
    now = new Date().toISOString()
  ): Promise<NotificationRecoveryResult> {
    if (this.recoveryRunning) {
      return emptyRecoveryResult(true);
    }

    this.recoveryRunning = true;

    try {
      const [pending, failed] = await Promise.all([
        this.proposalRepository.findByNotificationStatus(
          "pending",
          NOTIFICATION_RECOVERY_SCAN_SIZE
        ),
        this.proposalRepository.findByNotificationStatus(
          "failed",
          NOTIFICATION_RECOVERY_SCAN_SIZE
        )
      ]);
      const activeRecipientKeys = new Set(
        this.notificationService
          .getRecipients()
          .map((recipient) => recipient.key)
      );
      const candidates = deduplicateProposals([...pending, ...failed])
        .filter((proposal) =>
          needsRecoveryNow(proposal, activeRecipientKeys, now)
        )
        .slice(0, NOTIFICATION_RECOVERY_BATCH_SIZE);
      const result = emptyRecoveryResult(false);
      result.candidateCount = candidates.length;

      for (const candidate of candidates) {
        const candidateResult = await this.withProposalLock(
          candidate.id,
          async () => this.recoverProposal(candidate.id, now)
        );

        result.attemptedProposalCount += candidateResult.attempted
          ? 1
          : 0;
        result.attemptedRecipientCount += candidateResult.attemptedRecipientCount;
        result.recoveredCount += candidateResult.recovered ? 1 : 0;
        result.stillPendingCount += candidateResult.status === "pending" ? 1 : 0;
        result.stillFailedCount += candidateResult.status === "failed" ? 1 : 0;
        result.skippedCount += candidateResult.status === "skipped" ? 1 : 0;

        if (candidateResult.error) {
          result.errors.push(candidateResult.error);
        }
      }

      return result;
    } finally {
      this.recoveryRunning = false;
    }
  }

  private async recoverProposal(
    proposalId: string,
    now: string
  ): Promise<{
    attempted: boolean;
    attemptedRecipientCount: number;
    recovered: boolean;
    status: StoredProposal["notificationStatus"];
    error?: string;
  }> {
    const current = await this.proposalRepository.findById(proposalId);

    if (!current) {
      return {
        attempted: false,
        attemptedRecipientCount: 0,
        recovered: false,
        status: "skipped",
        error: `Notification recovery proposal no longer exists: ${proposalId}`
      };
    }

    if (!this.notificationService.enabled) {
      return {
        attempted: false,
        attemptedRecipientCount: 0,
        recovered: false,
        status: current.notificationStatus
      };
    }

    const initialized = await this.initializeDeliveries(current, now);

    if (!initialized?.notificationDeliveries) {
      if (initialized?.notificationStatus === "skipped") {
        return {
          attempted: false,
          attemptedRecipientCount: 0,
          recovered: false,
          status: "skipped"
        };
      }

      return {
        attempted: false,
        attemptedRecipientCount: 0,
        recovered: false,
        status: "failed",
        error:
          initialized?.notificationError ??
          `Unable to reconstruct notification recipients for ${current.id}.`
      };
    }

    const reconciled = await this.reconcileRemovedRecipients(initialized, now);
    const eligibleRecipientKeys = Object.values(
      reconciled.notificationDeliveries ?? {}
    )
      .filter(
        (delivery) =>
          delivery.status === "pending" ||
          (delivery.status === "failed" &&
            (!delivery.nextRetryAt || delivery.nextRetryAt <= now))
      )
      .map((delivery) => delivery.recipientKey);

    if (eligibleRecipientKeys.length === 0) {
      return {
        attempted: false,
        attemptedRecipientCount: 0,
        recovered: false,
        status: reconciled.notificationStatus
      };
    }

    const deliveryResult = await this.attemptOutstandingRecipients(
      reconciled,
      false,
      new Set(eligibleRecipientKeys),
      now
    );
    const latest = await this.proposalRepository.findById(current.id);

    return {
      attempted: true,
      attemptedRecipientCount: eligibleRecipientKeys.length,
      recovered: latest?.notificationStatus === "sent",
      status: latest?.notificationStatus ?? deliveryResult.status,
      error: latest?.notificationError ?? deliveryResult.error
    };
  }

  private async initializeDeliveries(
    proposal: StoredProposal,
    now = new Date().toISOString()
  ): Promise<StoredProposal | null> {
    if (proposal.notificationDeliveries) {
      return this.reconcileRemovedRecipients(proposal, now);
    }

    const recipients = this.notificationService.getRecipients();

    if (recipients.length === 0) {
      return this.proposalRepository.updateNotificationState(
        proposal.id,
        () => ({
          notificationStatus: "failed",
          notificationError:
            "Notifications are enabled but no notification recipients are configured."
        })
      );
    }

    const legacyDeliveries =
      proposal.notificationStatus === "failed"
        ? buildLegacyDeliveries(proposal, recipients, now)
        : null;

    if (
      proposal.notificationStatus === "failed" &&
      !legacyDeliveries
    ) {
      const error =
        "Legacy notification failure was automatically closed without resend because recipient identity could not be verified safely.";

      this.logger.warn(
        { proposalId: proposal.id },
        "Closing ambiguous legacy notification failure without resend"
      );
      return this.proposalRepository.updateNotificationState(
        proposal.id,
        () => ({
          notificationStatus: "skipped",
          notificationError: `${error}${
            proposal.notificationError
              ? ` Previous error: ${proposal.notificationError}`
              : ""
          }`
        })
      );
    }

    const deliveries =
      legacyDeliveries ?? buildPendingDeliveries(recipients, now);

    return this.proposalRepository.updateNotificationState(
      proposal.id,
      () => notificationStateFromDeliveries(deliveries)
    );
  }

  private async reconcileRemovedRecipients(
    proposal: StoredProposal,
    now: string
  ): Promise<StoredProposal> {
    if (!proposal.notificationDeliveries) {
      return proposal;
    }

    const activeKeys = new Set(
      this.notificationService.getRecipients().map((recipient) => recipient.key)
    );
    let changed = false;
    const deliveries = Object.fromEntries(
      Object.entries(proposal.notificationDeliveries).map(([key, delivery]) => {
        if (
          activeKeys.has(key) ||
          delivery.status === "sent" ||
          delivery.status === "skipped"
        ) {
          return [key, delivery];
        }

        changed = true;
        return [
          key,
          {
            ...delivery,
            status: "skipped" as const,
            updatedAt: now,
            lastError: "Recipient is no longer configured."
          }
        ];
      })
    );

    if (!changed) {
      return proposal;
    }

    return (
      (await this.proposalRepository.updateNotificationState(
        proposal.id,
        () => notificationStateFromDeliveries(deliveries)
      )) ?? proposal
    );
  }

  private async attemptOutstandingRecipients(
    proposal: StoredProposal,
    includeFailed: boolean,
    eligibleRecipientKeys?: ReadonlySet<string>,
    now = new Date().toISOString()
  ): Promise<ProposalNotificationResult> {
    const recipientKeys = Object.values(proposal.notificationDeliveries ?? {})
      .filter(
        (delivery) =>
          (delivery.status === "pending" ||
            (delivery.status === "failed" &&
              (includeFailed ||
                eligibleRecipientKeys?.has(delivery.recipientKey)))) &&
          (!eligibleRecipientKeys ||
            eligibleRecipientKeys.has(delivery.recipientKey))
      )
      .map((delivery) => delivery.recipientKey);

    for (const recipientKey of recipientKeys) {
      await this.attemptRecipient(proposal.id, recipientKey, now);
    }

    const latest = await this.proposalRepository.findById(proposal.id);

    if (!latest) {
      return {
        status: "failed",
        error: "Proposal disappeared during notification delivery."
      };
    }

    if (latest.notificationStatus === "sent") {
      return { status: "sent" };
    }

    if (latest.notificationStatus === "skipped") {
      return { status: "skipped" };
    }

    return {
      status: "failed",
      error:
        latest.notificationError ?? "One or more notification deliveries failed."
    };
  }

  private async attemptRecipient(
    proposalId: string,
    recipientKey: string,
    attemptedAt: string
  ): Promise<void> {
    const prepared = await this.proposalRepository.updateNotificationState(
      proposalId,
      (proposal) => {
        const deliveries = cloneDeliveries(proposal.notificationDeliveries);
        const delivery = deliveries[recipientKey];

        if (!delivery || delivery.status === "sent" || delivery.status === "skipped") {
          return currentNotificationState(proposal);
        }

        deliveries[recipientKey] = {
          ...delivery,
          status: "pending",
          attemptCount: delivery.attemptCount + 1,
          lastAttemptAt: attemptedAt,
          updatedAt: attemptedAt
        };
        delete deliveries[recipientKey].nextRetryAt;

        return notificationStateFromDeliveries(deliveries);
      }
    );
    const delivery = prepared?.notificationDeliveries?.[recipientKey];

    if (!prepared || !delivery || delivery.status !== "pending") {
      return;
    }

    try {
      await this.notificationService.send(
        buildProposalNotificationMessage(prepared),
        [recipientKey]
      );
      await this.proposalRepository.updateNotificationState(
        proposalId,
        (proposal) => {
          const deliveries = cloneDeliveries(proposal.notificationDeliveries);
          const current = deliveries[recipientKey];

          if (!current) {
            return currentNotificationState(proposal);
          }

          deliveries[recipientKey] = {
            ...current,
            status: "sent",
            sentAt: attemptedAt,
            updatedAt: attemptedAt
          };
          delete deliveries[recipientKey].lastError;
          delete deliveries[recipientKey].nextRetryAt;

          return notificationStateFromDeliveries(deliveries);
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.proposalRepository.updateNotificationState(
        proposalId,
        (proposal) => {
          const deliveries = cloneDeliveries(proposal.notificationDeliveries);
          const current = deliveries[recipientKey];

          if (!current) {
            return currentNotificationState(proposal);
          }

          deliveries[recipientKey] = {
            ...current,
            status: "failed",
            lastError: message,
            nextRetryAt: notificationRetryAt(current.attemptCount, attemptedAt),
            updatedAt: attemptedAt
          };

          return notificationStateFromDeliveries(deliveries);
        }
      );
      this.logger.error(
        {
          proposalId,
          recipientMaskedId: delivery.recipientMaskedId,
          error
        },
        "Failed to send proposal notification to configured recipient"
      );
    }
  }

  private async withProposalLock<T>(
    proposalId: string,
    action: () => Promise<T>
  ): Promise<T> {
    const previous = this.proposalLocks.get(proposalId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.proposalLocks.set(proposalId, current);

    await previous;

    try {
      return await action();
    } finally {
      release?.();
      if (this.proposalLocks.get(proposalId) === current) {
        this.proposalLocks.delete(proposalId);
      }
    }
  }
}

function buildPendingDeliveries(
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

function buildLegacyDeliveries(
  proposal: StoredProposal,
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

function notificationStateFromDeliveries(
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

function currentNotificationState(proposal: StoredProposal) {
  return {
    notificationStatus: proposal.notificationStatus,
    notificationError: proposal.notificationError,
    notificationDeliveries: proposal.notificationDeliveries
  };
}

function cloneDeliveries(
  deliveries: StoredProposal["notificationDeliveries"]
): Record<string, NotificationDelivery> {
  return Object.fromEntries(
    Object.entries(deliveries ?? {}).map(([key, delivery]) => [
      key,
      { ...delivery }
    ])
  );
}

function deduplicateProposals(proposals: StoredProposal[]): StoredProposal[] {
  return [...new Map(proposals.map((proposal) => [proposal.id, proposal])).values()]
    .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt));
}

function needsRecoveryNow(
  proposal: StoredProposal,
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

function emptyRecoveryResult(
  skippedBecauseRunning: boolean
): NotificationRecoveryResult {
  return {
    candidateCount: 0,
    attemptedProposalCount: 0,
    attemptedRecipientCount: 0,
    recoveredCount: 0,
    stillPendingCount: 0,
    stillFailedCount: 0,
    skippedCount: 0,
    errors: [],
    skippedBecauseRunning
  };
}
