import { Router } from "express";
import type { AppContext } from "../../server.js";

export function createProtocolsRouter(context: AppContext): Router {
  const router = Router();

  router.get("/", (_request, response) => {
    response.json({
      protocols: context.protocolRegistry.list().map((adapter) => ({
        protocol: adapter.protocol,
        enabled: adapter.enabled,
        source: adapter.source,
        allowedPublisherCount: adapter.publisherAllowlist.length
      }))
    });
  });

  return router;
}
