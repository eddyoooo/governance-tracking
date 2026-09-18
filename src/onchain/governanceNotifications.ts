import type { LifecycleNotificationMessage } from "../notifications/notification.service.js";
import type {
  GovernanceLifecycleEvent,
  GovernanceTransitionType,
  StoredGovernanceDecision
} from "./types.js";

const TRANSITION_HEADINGS: Record<GovernanceTransitionType, string> = {
  created: "NEW GOVERNANCE VOTE TRACKED",
  succeeded: "ON-CHAIN GOVERNANCE VOTE RESULT",
  defeated: "ON-CHAIN GOVERNANCE VOTE RESULT",
  canceled: "GOVERNANCE VOTE CANCELED",
  queued: "GOVERNANCE PROPOSAL QUEUED",
  expired: "GOVERNANCE PROPOSAL EXPIRED",
  executed: "GOVERNANCE PROPOSAL EXECUTED"
};

export function buildGovernanceLifecycleMessage(
  decision: StoredGovernanceDecision,
  transition: GovernanceTransitionType
): LifecycleNotificationMessage {
  const fields = [{ label: "Status", value: statusLabel(transition) }];

  if (transition === "succeeded" || transition === "defeated") {
    if (decision.votingEndedAt) {
      fields.push({
        label: "Voting ended",
        value: formatUtcTimestamp(decision.votingEndedAt)
      });
    }

    fields.push(
      { label: "For", value: formatUniVotes(decision.forVotes) },
      { label: "Against", value: formatUniVotes(decision.againstVotes) },
      { label: "Abstain", value: formatUniVotes(decision.abstainVotes) }
    );
  }

  return {
    kind: "lifecycle",
    heading: TRANSITION_HEADINGS[transition],
    protocol: decision.protocol,
    sourceType: decision.sourceType,
    title: decision.title,
    sourceUrl: decision.sourceUrl,
    fields
  };
}

export function formatUtcTimestamp(value: string): string {
  const timestamp = new Date(value);

  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error(`Governance timestamp must be canonical ISO-8601: ${value}`);
  }

  const pad = (part: number) => part.toString().padStart(2, "0");

  return `${timestamp.getUTCFullYear()}-${pad(timestamp.getUTCMonth() + 1)}-${pad(
    timestamp.getUTCDate()
  )} ${pad(timestamp.getUTCHours())}:${pad(timestamp.getUTCMinutes())} UTC`;
}

export function governanceEventMessage(
  event: GovernanceLifecycleEvent
): LifecycleNotificationMessage {
  if (event.message.kind !== "lifecycle") {
    throw new Error(`Governance event ${event.id} has an invalid message kind.`);
  }

  return event.message;
}

export function formatUniVotes(value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(`UNI vote amount must be a non-negative integer: ${value}`);
  }

  const amount = BigInt(value);
  const whole = amount / 10n ** 18n;
  const fraction = amount % 10n ** 18n;
  const fractionDigits = fraction
    .toString()
    .padStart(18, "0")
    .slice(0, 2)
    .replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${grouped}${fractionDigits ? `.${fractionDigits}` : ""} UNI`;
}

function statusLabel(transition: GovernanceTransitionType): string {
  return `${transition.charAt(0).toUpperCase()}${transition.slice(1)}`;
}
