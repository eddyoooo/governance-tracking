import cron, { type ScheduledTask } from "node-cron";
import type { AppContext } from "../server.js";
import { safeErrorDetails } from "../utils/errors.js";

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

  if (
    context.notificationService.enabled &&
    !cron.validate(env.notificationRetryCron)
  ) {
    throw new Error(
      `Invalid NOTIFICATION_RETRY_CRON: ${env.notificationRetryCron}`
    );
  }

  const scheduledOnchainProtocols = context.evmGovernanceRegistry
    .list()
    .filter((adapter) => adapter.enabled)
    .map((adapter) => adapter.protocol);

  if (
    scheduledOnchainProtocols.length > 0 &&
    !cron.validate(env.onchainFetchIntervalCron)
  ) {
    throw new Error(
      `Invalid ONCHAIN_FETCH_INTERVAL_CRON: ${env.onchainFetchIntervalCron}`
    );
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
            logger.error(
              { error: safeErrorDetails(error), protocol },
              "Scheduled governance fetch failed"
            );
          });
        }
      })
    );
  }

  if (scheduledOnchainProtocols.length > 0) {
    logger.info(
      {
        cron: env.onchainFetchIntervalCron,
        protocols: scheduledOnchainProtocols
      },
      "Starting on-chain governance scheduler"
    );

    scheduledTasks.push(
      cron.schedule(env.onchainFetchIntervalCron, () => {
        for (const protocol of scheduledOnchainProtocols) {
          context.onchainGovernanceJob.run(protocol).catch((error) => {
            logger.error(
              { error: safeErrorDetails(error), protocol },
              "Scheduled on-chain governance scan failed"
            );
          });
        }
      })
    );
  }

  if (context.notificationService.enabled) {
    logger.info(
      { cron: env.notificationRetryCron },
      "Starting automatic notification recovery scheduler"
    );

    scheduledTasks.push(
      cron.schedule(env.notificationRetryCron, () => {
        Promise.all([
          context.notificationDispatcher.recoverOutstanding(),
          context.governanceNotificationDispatcher.recoverOutstanding()
        ])
          .then(([proposalResult, governanceResult]) => {
            const candidateCount =
              proposalResult.candidateCount + governanceResult.candidateCount;

            if (
              candidateCount > 0 ||
              proposalResult.skippedBecauseRunning ||
              governanceResult.skippedBecauseRunning
            ) {
              logger.info(
                {
                  candidateCount,
                  attemptedProposalCount:
                    proposalResult.attemptedProposalCount +
                    governanceResult.attemptedProposalCount,
                  attemptedRecipientCount:
                    proposalResult.attemptedRecipientCount +
                    governanceResult.attemptedRecipientCount,
                  recoveredCount:
                    proposalResult.recoveredCount +
                    governanceResult.recoveredCount,
                  stillPendingCount:
                    proposalResult.stillPendingCount +
                    governanceResult.stillPendingCount,
                  stillFailedCount:
                    proposalResult.stillFailedCount +
                    governanceResult.stillFailedCount,
                  skippedBecauseRunning:
                    proposalResult.skippedBecauseRunning ||
                    governanceResult.skippedBecauseRunning
                },
                "Finished automatic notification recovery"
              );
            }
          })
          .catch((error) => {
            logger.error(
              { error: safeErrorDetails(error) },
              "Scheduled notification recovery failed"
            );
          });
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
          logger.error(
            { error: safeErrorDetails(error) },
            "Scheduled admin status report failed"
          );
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
