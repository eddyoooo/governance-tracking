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

  logger.info({ cron: env.fetchIntervalCron }, "Starting governance fetch scheduler");

  return cron.schedule(env.fetchIntervalCron, () => {
    fetchJob.run("lido").catch((error) => {
      logger.error({ error }, "Scheduled Lido fetch failed");
    });
  });
}
