import type { Logger } from "pino";
import type { StoredProposal } from "../protocols/types.js";
import type { ProposalRepository } from "../storage/proposal.repository.js";
import type {
  NotificationMessage,
  NotificationService
} from "./notification.service.js";

export interface ProposalNotificationResult {
  status: "sent" | "failed" | "skipped";
  error?: string;
}

export interface NotifyPendingResult {
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  errors: string[];
}

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

export async function notifyProposal(
  proposal: StoredProposal,
  proposalRepository: ProposalRepository,
  notificationService: NotificationService,
  logger: Pick<Logger, "error" | "info">
): Promise<ProposalNotificationResult> {
  if (!notificationService.enabled) {
    await proposalRepository.updateNotificationStatus(proposal.id, "skipped");
    return { status: "skipped" };
  }

  try {
    await notificationService.send(buildProposalNotificationMessage(proposal));
    await proposalRepository.updateNotificationStatus(proposal.id, "sent");

    return { status: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await proposalRepository.updateNotificationStatus(proposal.id, "failed", message);
    logger.error(
      {
        proposalId: proposal.id,
        protocol: proposal.protocol,
        sourceType: proposal.sourceType,
        sourceId: proposal.sourceId,
        error
      },
      "Failed to send proposal notification"
    );

    return {
      status: "failed",
      error: message
    };
  }
}

export async function notifyPendingProposals(
  proposalRepository: ProposalRepository,
  notificationService: NotificationService,
  logger: Pick<Logger, "error" | "info">
): Promise<NotifyPendingResult> {
  const pending = await proposalRepository.findByNotificationStatus("pending", {
    limit: 100,
    sort: "firstSeenAt_asc"
  });
  const result: NotifyPendingResult = {
    pendingCount: pending.length,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errors: []
  };

  for (const proposal of pending) {
    const notificationResult = await notifyProposal(
      proposal,
      proposalRepository,
      notificationService,
      logger
    );

    if (notificationResult.status === "sent") {
      result.sentCount += 1;
    }

    if (notificationResult.status === "skipped") {
      result.skippedCount += 1;
    }

    if (notificationResult.status === "failed") {
      result.failedCount += 1;
      if (notificationResult.error) {
        result.errors.push(notificationResult.error);
      }
    }
  }

  return result;
}
