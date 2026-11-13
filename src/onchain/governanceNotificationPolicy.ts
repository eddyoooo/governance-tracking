import {
  NOTIFY_NOTIFICATION_DECISION,
  type NotificationPolicyDecision
} from "../notifications/notificationPolicy.js";
import type { GovernanceLifecycleEvent } from "./types.js";

export const AAVE_ONCHAIN_NON_RESULT_SKIP_REASON = "aave_onchain_result_only";

export function evaluateGovernanceNotificationPolicy(
  event: Pick<GovernanceLifecycleEvent, "protocol" | "transition">
): NotificationPolicyDecision {
  if (event.protocol === "aave" && event.transition !== "succeeded" && event.transition !== "defeated") {
    return { action: "suppress", reason: AAVE_ONCHAIN_NON_RESULT_SKIP_REASON };
  }

  return NOTIFY_NOTIFICATION_DECISION;
}
