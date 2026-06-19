import cron, { type ScheduledTask } from "node-cron";
import type { AppContext } from "../server.js";

export function startScheduler(context: AppContext): ScheduledTask | null {
  const { env, logger, fetchJob } = context;

  if (!env.enableScheduler) {
    logger.info("Scheduler disabled");
    return null;
  }

  if (!cron.validate(env.fetchIntervalCron)) {
    throw new Error(`Invalid FETCH_INTERVAL_CRON: ${env.fetchIntervalCron}`);
  }

  const scheduledProtocols = context.protocolRegistry
    .list()
    .filter((adapter) => adapter.enabled)
    .map((adapter) => adapter.protocol);

  logger.info(
    { cron: env.fetchIntervalCron, protocols: scheduledProtocols },
    "Starting governance fetch scheduler"
  );

  return cron.schedule(env.fetchIntervalCron, () => {
    for (const protocol of scheduledProtocols) {
      fetchJob.run(protocol).catch((error) => {
        logger.error({ error, protocol }, "Scheduled governance fetch failed");
      });
    }
  });
}
