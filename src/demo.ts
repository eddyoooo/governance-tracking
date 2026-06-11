import { loadEnv } from "./config/env.js";
import { createApp } from "./server.js";

async function main(): Promise<void> {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "development",
    STORAGE_MODE: "memory",
    DEMO_MODE: "true",
    ENABLE_SCHEDULER: "false",
    ENABLE_DEBUG_ENDPOINTS: "true",
    LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher"]),
    ENABLE_TELEGRAM_NOTIFICATIONS: "false",
    LOG_LEVEL: "silent"
  });
  const { context } = createApp({ env });
  const firstRun = await context.fetchJob.run("lido");
  const secondRun = await context.fetchJob.run("lido");
  const proposals = await context.proposalRepository.findAll();

  console.log(
    JSON.stringify(
      {
        demoMode: true,
        description:
          "Fixture-backed demo: the first fetch inserts one allowlisted proposal, the second fetch recognizes it as unchanged and does not duplicate or rewrite it.",
        allowedPublishers: env.lidoAllowedPublishers,
        firstRun,
        secondRun,
        storedProposalCount: proposals.length,
        proposals
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
