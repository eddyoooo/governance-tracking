import { Router } from "express";
import { notifyPendingProposals } from "../../notifications/proposalNotifications.js";
import type { AppContext } from "../../server.js";
import type { FetchRunSort } from "../../storage/fetchRun.repository.js";

const MAX_FETCH_RUN_LIMIT = 100;
const fetchRunSorts = new Set<FetchRunSort>(["startedAt_desc", "startedAt_asc"]);

class AdminQueryParameterError extends Error {}

function parseStringParam(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AdminQueryParameterError(`Query parameter ${name} must be a string.`);
  }

  const parsed = value.trim();

  return parsed || undefined;
}

function parseLimit(value: unknown): number | undefined {
  const parsed = parseStringParam(value, "limit");

  if (parsed === undefined) {
    return undefined;
  }

  const limit = Number(parsed);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FETCH_RUN_LIMIT) {
    throw new AdminQueryParameterError(
      `Query parameter limit must be an integer between 1 and ${MAX_FETCH_RUN_LIMIT}.`
    );
  }

  return limit;
}

function parseOffset(value: unknown): number | undefined {
  const parsed = parseStringParam(value, "offset");

  if (parsed === undefined) {
    return undefined;
  }

  const offset = Number(parsed);

  if (!Number.isInteger(offset) || offset < 0) {
    throw new AdminQueryParameterError(
      "Query parameter offset must be a non-negative integer."
    );
  }

  return offset;
}

function parseSort(value: unknown): FetchRunSort | undefined {
  const parsed = parseStringParam(value, "sort");

  if (parsed === undefined) {
    return undefined;
  }

  if (!fetchRunSorts.has(parsed as FetchRunSort)) {
    throw new AdminQueryParameterError(
      "Query parameter sort must be one of: startedAt_desc, startedAt_asc."
    );
  }

  return parsed as FetchRunSort;
}

export function createAdminRouter(context: AppContext): Router {
  const router = Router();

  router.post("/fetch/:protocol", async (request, response, next) => {
    try {
      const result = await context.fetchJob.run(request.params.protocol);
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

  router.get("/fetch-runs", async (request, response, next) => {
    try {
      const runs = await context.fetchRunRepository.findAll({
        limit: parseLimit(request.query.limit),
        offset: parseOffset(request.query.offset),
        sort: parseSort(request.query.sort)
      });

      response.json({ fetchRuns: runs });
    } catch (error) {
      if (error instanceof AdminQueryParameterError) {
        response.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  return router;
}
