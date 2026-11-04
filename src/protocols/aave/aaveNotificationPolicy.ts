import {
  NOTIFY_NOTIFICATION_DECISION,
  type NotificationPolicy,
  type NotificationPolicyDecision,
  type NotificationPolicyInput
} from "../../notifications/notificationPolicy.js";

export const AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON =
  "aave_risk_stewards_routine_cap_change";

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

export const aaveRoutineCapNotificationPolicy: NotificationPolicy = {
  evaluate(input): NotificationPolicyDecision {
    return isRoutineAaveRiskStewardsCapChange(input)
      ? {
          action: "suppress",
          reason: AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON
        }
      : NOTIFY_NOTIFICATION_DECISION;
  }
};

export function isRoutineAaveRiskStewardsCapChange(
  input: NotificationPolicyInput
): boolean {
  if (
    input.protocol.trim().toLowerCase() !== "aave" ||
    input.sourceType.trim().toLowerCase() !== "forum" ||
    !hasExactLlamaRiskAlias(input)
  ) {
    return false;
  }

  const prefixedTitle = collapseWhitespace(input.title).match(RISK_STEWARDS_PREFIX);

  if (!prefixedTitle) {
    return false;
  }

  const datedTitle = prefixedTitle[1].match(DATED_TITLE_SUFFIX);

  if (!datedTitle || !hasValidDateSuffix(datedTitle)) {
    return false;
  }

  const titleWithoutDate = datedTitle[1].trim();
  const targetSeparator = titleWithoutDate.toLowerCase().lastIndexOf(" on ");

  if (targetSeparator < 1) {
    return false;
  }

  const operation = titleWithoutDate.slice(0, targetSeparator).trim();
  const target = titleWithoutDate.slice(targetSeparator + 4).trim();

  return (
    AAVE_VERSION_TARGET.test(target) &&
    (CAP_ACTION_PATTERN.test(operation) || CHANGE_OF_CAPS_PATTERN.test(operation))
  );
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
