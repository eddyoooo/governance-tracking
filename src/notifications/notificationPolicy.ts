export interface NotificationPolicyInput {
  protocol: string;
  sourceType: string;
  title: string;
  publisherName: string;
  publisherAliases?: readonly string[];
}

export type NotificationPolicyDecision =
  | { action: "notify" }
  | { action: "suppress"; reason: string };

export interface NotificationPolicy {
  evaluate(input: NotificationPolicyInput): NotificationPolicyDecision;
}

export type NotificationPolicyEvaluator<T = NotificationPolicyInput> = (
  input: T
) => NotificationPolicyDecision;

export const NOTIFY_NOTIFICATION_DECISION: NotificationPolicyDecision = {
  action: "notify"
};
