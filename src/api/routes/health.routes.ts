import { Router } from "express";
import type { AppContext } from "../../server.js";

export function createHealthRouter(context: AppContext): Router {
  const router = Router();

  router.get("/", (_request, response) => {
    response.json({
      ok: true,
      storageMode: context.env.demoMode ? "memory" : context.env.storageMode,
      schedulerEnabled: context.env.enableScheduler,
      onchainGovernance: {
        enabledProtocols: context.evmGovernanceRegistry
          .list()
          .map((adapter) => adapter.protocol),
        schedule: context.env.onchainFetchIntervalCron
      }
    });
  });

  return router;
}
