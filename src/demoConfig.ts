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
