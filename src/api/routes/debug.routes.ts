import { Router } from "express";
import { isMemoryMode, toSafeConfig } from "../../config/env.js";
import { cloneAaveRecentTopicsFixture } from "../../demoFixtures/aaveRecentTopics.fixture.js";
import { cloneAaveSiteFixture } from "../../demoFixtures/aaveSite.fixture.js";
import { cloneLidoRecentTopicsFixture } from "../../demoFixtures/lidoRecentTopics.fixture.js";
import { telegramTestNotificationFixtures } from "../../demoFixtures/telegramNotification.fixture.js";
import type { AppContext } from "../../server.js";
import { MemoryFetchRunRepository } from "../../storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../storage/memoryProposal.repository.js";

export function createDebugRouter(context: AppContext): Router {
  const router = Router();

  router.use((request, response, next) => {
    if (!context.env.enableDebugEndpoints) {
      response.status(404).json({ error: "Debug endpoints are disabled." });
      return;
    }

    next();
  });

  router.get("/config-safe", (_request, response) => {
    response.json(toSafeConfig(context.env));
  });

  router.get("/:protocol/recent", async (request, response, next) => {
    try {
      const adapter = context.protocolRegistry.get(request.params.protocol);

      if (!adapter) {
        response.status(404).json({ error: "Protocol adapter not found." });
        return;
      }

      const items = await adapter.fetchRecent();
      response.json({
        count: items.length,
        items
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:protocol/fetch-once", async (request, response, next) => {
    try {
      const result = await context.fetchJob.run(request.params.protocol);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/demo-fixtures", (_request, response) => {
    response.json({
      aaveRecentTopics: cloneAaveRecentTopicsFixture(),
      aaveSite: cloneAaveSiteFixture(),
      lidoRecentTopics: cloneLidoRecentTopicsFixture(),
      telegramTestNotifications: telegramTestNotificationFixtures
    });
  });

  router.post("/reset-demo-state", (_request, response) => {
    if (!isMemoryMode(context.env)) {
      response.status(403).json({
        error: "Demo state reset is only available in DEMO_MODE=true or STORAGE_MODE=memory."
      });
      return;
    }

    if (
      !(context.proposalRepository instanceof MemoryProposalRepository) ||
      !(context.fetchRunRepository instanceof MemoryFetchRunRepository)
    ) {
      response.status(409).json({
        error: "Demo state reset requires in-memory repositories."
      });
      return;
    }

    context.proposalRepository.clear();
    context.fetchRunRepository.clear();

    response.json({
      reset: true,
      storageMode: "memory"
    });
  });

  return router;
}
