import { Router } from "express";
import type { AppContext } from "../../server.js";

export function createAdminRouter(context: AppContext): Router {
  const router = Router();

  router.post("/fetch/lido", async (_request, response, next) => {
    try {
      const result = await context.fetchJob.run("lido");
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
