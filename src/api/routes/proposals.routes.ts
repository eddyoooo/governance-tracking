import { Router } from "express";
import type { AppContext } from "../../server.js";

const MAX_PROPOSAL_LIMIT = 100;

class QueryParameterError extends Error {}

function parseProtocol(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new QueryParameterError("Query parameter protocol must be a string.");
  }

  const protocol = value.trim();

  return protocol || undefined;
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new QueryParameterError("Query parameter limit must be a positive integer.");
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PROPOSAL_LIMIT) {
    throw new QueryParameterError(
      `Query parameter limit must be an integer between 1 and ${MAX_PROPOSAL_LIMIT}.`
    );
  }

  return limit;
}

export function createProposalsRouter(context: AppContext): Router {
  const router = Router();

  router.get("/", async (request, response, next) => {
    try {
      const protocol = parseProtocol(request.query.protocol);
      const limit = parseLimit(request.query.limit);
      const proposals = await context.proposalRepository.findAll({
        protocol,
        limit
      });

      response.json({ proposals });
    } catch (error) {
      if (error instanceof QueryParameterError) {
        response.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  router.get("/source/:protocol/:sourceType/:sourceId", async (request, response, next) => {
    try {
      const proposal = await context.proposalRepository.findBySourceIdentity(
        request.params.protocol,
        request.params.sourceType,
        request.params.sourceId
      );

      if (!proposal) {
        response.status(404).json({ error: "Proposal not found." });
        return;
      }

      response.json({ proposal });
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
