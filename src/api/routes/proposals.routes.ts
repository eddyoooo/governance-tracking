import { Router } from "express";
import type { AppContext } from "../../server.js";

export function createProposalsRouter(context: AppContext): Router {
  const router = Router();

  router.get("/", async (request, response, next) => {
    try {
      const protocol =
        typeof request.query.protocol === "string" ? request.query.protocol : undefined;
      const limit =
        typeof request.query.limit === "string" ? Number(request.query.limit) : undefined;
      const proposals = await context.proposalRepository.findAll({
        protocol,
        limit: Number.isFinite(limit) ? limit : undefined
      });

      response.json({ proposals });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (request, response, next) => {
    try {
      const proposal = await context.proposalRepository.findById(request.params.id);

      if (!proposal) {
        response.status(404).json({ error: "Proposal not found." });
        return;
      }

      response.json({ proposal });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
