import type { RawGovernanceItem } from "./types.js";

export interface AllowlistFilterResult<TItem extends RawGovernanceItem> {
  allowed: TItem[];
  skipped: TItem[];
}

export function normalizePublisherName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ");
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const distance = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    distance[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    distance[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;

      distance[row][col] = Math.min(
        distance[row - 1][col] + 1,
        distance[row][col - 1] + 1,
        distance[row - 1][col - 1] + cost
      );
    }
  }

  return distance[left.length][right.length];
}

export function matchesPublisherAllowlist(
  publisherName: string,
  allowlist: string[]
): boolean {
  const normalizedPublisher = normalizePublisherName(publisherName);

  if (!normalizedPublisher || allowlist.length === 0) {
    return false;
  }

  return allowlist.some((allowedPublisher) => {
    const normalizedAllowed = normalizePublisherName(allowedPublisher);

    if (!normalizedAllowed) {
      return false;
    }

    if (normalizedAllowed === normalizedPublisher) {
      return true;
    }

    if (Math.min(normalizedAllowed.length, normalizedPublisher.length) < 6) {
      return false;
    }

    const threshold = Math.max(1, Math.floor(normalizedAllowed.length * 0.12));

    return levenshteinDistance(normalizedAllowed, normalizedPublisher) <= threshold;
  });
}

export function filterByPublisherAllowlist<TItem extends RawGovernanceItem>(
  items: TItem[],
  allowlist: string[]
): AllowlistFilterResult<TItem> {
  const allowed: TItem[] = [];
  const skipped: TItem[] = [];

  for (const item of items) {
    if (matchesPublisherAllowlist(item.publisherName, allowlist)) {
      allowed.push(item);
    } else {
      skipped.push(item);
    }
  }

  return { allowed, skipped };
}
