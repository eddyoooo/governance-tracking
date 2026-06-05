import { createHash } from "node:crypto";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const sortedKeys = Object.keys(objectValue).sort();

  return `{${sortedKeys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256(stableStringify(value));
}

export function createProposalId(
  protocol: string,
  sourceType: string,
  sourceId: string
): string {
  const safeSourceId = sourceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const suffix = sha256(`${protocol}:${sourceType}:${sourceId}`).slice(0, 10);

  return `${protocol}_${sourceType}_${safeSourceId}_${suffix}`;
}

export function createFetchRunId(protocol: string, startedAt: string): string {
  return `fetchRun_${protocol}_${sha256(`${protocol}:${startedAt}`).slice(0, 12)}`;
}
