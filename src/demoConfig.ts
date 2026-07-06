export function readBooleanFlag(
  name: string,
  source: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = source[name]?.trim().toLowerCase();

  return raw === "true" || raw === "1" || raw === "yes";
}

export function shouldEnableAdminStatusDemo(
  source: NodeJS.ProcessEnv = process.env
): boolean {
  return readBooleanFlag("ENABLE_ADMIN_DEMO", source);
}

export function telegramAdminUserIdForDemo(
  source: NodeJS.ProcessEnv = process.env
): string {
  return source.TELEGRAM_ADMIN_USER_ID?.trim() || "1549323073";
}

export function telegramAllowedUserIdsForDemo(
  source: NodeJS.ProcessEnv = process.env
): string {
  return JSON.stringify([telegramAdminUserIdForDemo(source)]);
}
