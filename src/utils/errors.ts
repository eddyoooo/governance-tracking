export interface SafeErrorDetails {
  name: string;
  message: string;
}

export function errorMessage(error: unknown): string {
  return sanitizeSensitiveText(error instanceof Error ? error.message : String(error));
}

export function safeErrorDetails(error: unknown): SafeErrorDetails {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    message: errorMessage(error)
  };
}

export function sanitizeSensitiveText(value: string): string {
  return value
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, "[redacted-private-key]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]");
}
