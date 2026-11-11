import {
  NOTIFY_NOTIFICATION_DECISION,
  type NotificationPolicy,
  type NotificationPolicyDecision,
  type NotificationPolicyInput
} from "../../notifications/notificationPolicy.js";

export const AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON =
  "aave_risk_stewards_routine_cap_change";
export const AAVE_ROUTINE_CAP_AND_IRM_NOTIFICATION_SKIP_REASON =
  "aave_risk_stewards_routine_cap_and_irm_change";

const LLAMA_RISK_PUBLISHER = "llamarisk";
const RISK_STEWARDS_PREFIX = /^risk\s+stewards\s*:\s*(.+)$/i;
const DATED_TITLE_SUFFIX =
  /^(.*?)\s+(?:\/\s*(\d{4})\.(\d{2})\.(\d{2})|[-\u2013\u2014]\s*(\d{4})-(\d{2})-(\d{2}))\s*$/;
const AAVE_VERSION_TARGET =
  /^aave\s+v[34](?:\s+and\s+aave\s+v[34])?$/i;
const CAP_ACTION = "(?:increase|increases|decrease|decreases|reduction|reductions|change|changes)";
const CAP_SUBJECT =
  "(?:cap|(?:supply|borrow|draw|add) cap|(?:supply and borrow|borrow and supply|borrow and draw|draw and borrow) caps?)";
const CAP_ACTION_PATTERN = new RegExp(`^${CAP_SUBJECT} ${CAP_ACTION}$`, "i");
const CHANGE_OF_CAPS_PATTERN =
  /^changes? of (?:supply and borrow|borrow and supply|borrow and draw|draw and borrow) caps?$/i;
// Recognize the observed USDT variant, not arbitrary words that could hide other actions.
const IRM_SUBJECT = "(?:usdt )?irm";
const CAP_AND_IRM_SHARED_ACTION_PATTERN = new RegExp(
  `^${CAP_SUBJECT} and ${IRM_SUBJECT} ${CAP_ACTION}$`,
  "i"
);
const CAP_ACTION_AND_IRM_ACTION_PATTERN = new RegExp(
  `^${CAP_SUBJECT} ${CAP_ACTION} and ${IRM_SUBJECT} ${CAP_ACTION}$`,
  "i"
);

export const aaveRoutineCapNotificationPolicy: NotificationPolicy = {
  evaluate(input): NotificationPolicyDecision {
    const reason = getAaveRoutineRiskStewardsSkipReason(input);

    return reason ? { action: "suppress", reason } : NOTIFY_NOTIFICATION_DECISION;
  }
};

export function isRoutineAaveRiskStewardsCapChange(
  input: NotificationPolicyInput
): boolean {
  return getAaveRoutineRiskStewardsSkipReason(input) !== undefined;
}

function getAaveRoutineRiskStewardsSkipReason(
  input: NotificationPolicyInput
): string | undefined {
  if (
    input.protocol.trim().toLowerCase() !== "aave" ||
    input.sourceType.trim().toLowerCase() !== "forum" ||
    !hasExactLlamaRiskAlias(input)
  ) {
    return undefined;
  }

  const prefixedTitle = collapseWhitespace(input.title).match(RISK_STEWARDS_PREFIX);

  if (!prefixedTitle) {
    return undefined;
  }

  const datedTitle = prefixedTitle[1].match(DATED_TITLE_SUFFIX);

  if (!datedTitle || !hasValidDateSuffix(datedTitle)) {
    return undefined;
  }

  const titleWithoutDate = datedTitle[1].trim();
  const targetSeparator = titleWithoutDate.toLowerCase().lastIndexOf(" on ");

  if (targetSeparator < 1) {
    return undefined;
  }

  const operation = titleWithoutDate.slice(0, targetSeparator).trim();
  const target = titleWithoutDate.slice(targetSeparator + 4).trim();

  if (!AAVE_VERSION_TARGET.test(target)) {
    return undefined;
  }

  if (
    CAP_ACTION_PATTERN.test(operation) ||
    CHANGE_OF_CAPS_PATTERN.test(operation)
  ) {
    return AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON;
  }

  if (
    CAP_AND_IRM_SHARED_ACTION_PATTERN.test(operation) ||
    CAP_ACTION_AND_IRM_ACTION_PATTERN.test(operation)
  ) {
    return AAVE_ROUTINE_CAP_AND_IRM_NOTIFICATION_SKIP_REASON;
  }

  return undefined;
}

function hasExactLlamaRiskAlias(input: NotificationPolicyInput): boolean {
  const aliases = [input.publisherName, ...(input.publisherAliases ?? [])];

  return aliases.some(
    (alias) => normalizePublisherIdentity(alias) === LLAMA_RISK_PUBLISHER
  );
}

function normalizePublisherIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function hasValidDateSuffix(match: RegExpMatchArray): boolean {
  const [year, month, day] = match[2]
    ? [match[2], match[3], match[4]]
    : [match[5], match[6], match[7]];

  if (!year || !month || !day) {
    return false;
  }

  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));

  return (
    date.getUTCFullYear() === numericYear &&
    date.getUTCMonth() === numericMonth - 1 &&
    date.getUTCDate() === numericDay
  );
}
