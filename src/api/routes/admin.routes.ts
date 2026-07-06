import { Router } from "express";
import { notifyPendingProposals } from "../../notifications/proposalNotifications.js";
import type { AppContext } from "../../server.js";

export function createAdminRouter(context: AppContext): Router {
  const router = Router();

  router.post("/fetch/:protocol", async (request, response, next) => {
    try {
      const result = await context.fetchJob.run(
        request.params.protocol.trim().toLowerCase()
      );
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/notify-pending", async (_request, response, next) => {
    try {
      const result = await notifyPendingProposals(
        context.proposalRepository,
        context.notificationService,
        context.logger
      );

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/status/send", async (_request, response, next) => {
    try {
      if (!context.adminStatusReporter.enabled) {
        response.status(409).json({ error: "Admin status reports are disabled." });
        return;
      }

      const result = await context.adminStatusReporter.sendDailyStatusReport();

      response.json({
        sent: true,
        healthy: result.healthy,
        problems: result.problems
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/fetch-runs", async (_request, response, next) => {
    try {
      const runs = await context.fetchRunRepository.findAll(100);

      response.json({ fetchRuns: runs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/source-activity", async (_request, response, next) => {
    try {
      const sourceActivity = await context.sourceActivityRepository.findAll(100);

      response.json({ sourceActivity });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
