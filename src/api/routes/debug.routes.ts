import { Router } from "express";
import { toSafeConfig } from "../../config/env.js";
import type { AppContext } from "../../server.js";

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

  router.get("/lido/recent", async (_request, response, next) => {
    try {
      const adapter = context.protocolRegistry.get("lido");

      if (!adapter) {
        response.status(404).json({ error: "Lido adapter not found." });
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

  router.post("/lido/fetch-once", async (_request, response, next) => {
    try {
      const result = await context.fetchJob.run("lido");
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
