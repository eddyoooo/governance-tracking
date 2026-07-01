import cron, { type ScheduledTask } from "node-cron";
import type { AppContext } from "../server.js";

export interface SchedulerHandle {
  stop(): void;
}

export function startScheduler(context: AppContext): SchedulerHandle | null {
  const { env, logger, fetchJob } = context;

  if (!env.enableScheduler) {
    logger.info("Scheduler disabled");
    return null;
  }

  if (!cron.validate(env.fetchIntervalCron)) {
    throw new Error(`Invalid FETCH_INTERVAL_CRON: ${env.fetchIntervalCron}`);
  }

  if (
    context.adminStatusReporter.enabled &&
    !cron.validate(env.adminStatusCron)
  ) {
    throw new Error(`Invalid ADMIN_STATUS_CRON: ${env.adminStatusCron}`);
  }

  const scheduledTasks: ScheduledTask[] = [];
  const scheduledProtocols = context.protocolRegistry
    .list()
    .filter((adapter) => adapter.enabled)
    .map((adapter) => adapter.protocol);

  if (scheduledProtocols.length === 0) {
    logger.warn("No enabled protocol adapters found for governance fetch scheduler");
  } else {
    logger.info(
      { cron: env.fetchIntervalCron, protocols: scheduledProtocols },
      "Starting governance fetch scheduler"
    );

    scheduledTasks.push(
      cron.schedule(env.fetchIntervalCron, () => {
        for (const protocol of scheduledProtocols) {
          fetchJob.run(protocol).catch((error) => {
            logger.error({ error, protocol }, "Scheduled governance fetch failed");
          });
        }
      })
    );
  }

  if (context.adminStatusReporter.enabled) {
    logger.info(
      { cron: env.adminStatusCron },
      "Starting admin status report scheduler"
    );

    scheduledTasks.push(
      cron.schedule(env.adminStatusCron, () => {
        context.adminStatusReporter.sendDailyStatusReport().catch((error) => {
          logger.error({ error }, "Scheduled admin status report failed");
        });
      })
    );
  }

  if (scheduledTasks.length === 0) {
    logger.warn("Scheduler not started because no scheduled jobs are enabled");
    return null;
  }

  return {
    stop(): void {
      for (const task of scheduledTasks) {
        task.stop();
      }
    }
  };
}
