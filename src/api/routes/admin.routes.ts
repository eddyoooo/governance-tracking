import { Router } from "express";
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

  router.post("/fetch-onchain/:protocol", async (request, response, next) => {
    try {
      const result = await context.onchainGovernanceJob.run(
        request.params.protocol.trim().toLowerCase()
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

  router.get("/governance-votes", async (request, response, next) => {
    try {
      const limit = parseLimit(request.query.limit, 100);
      const requestedProtocol = parseOptionalProtocol(request.query.protocol);
      const adapters = context.evmGovernanceRegistry
        .list()
        .filter(
          (adapter) =>
            !requestedProtocol || adapter.protocol === requestedProtocol
        );
      const votes = (
        await Promise.all(
          adapters.map((adapter) =>
            context.governanceRepository.findDecisionsBySource(adapter.sourceKey)
          )
        )
      )
        .flat()
        .sort((left, right) => -left.updatedAt.localeCompare(right.updatedAt))
        .slice(0, limit);

      response.json({ governanceVotes: votes });
    } catch (error) {
      next(error);
    }
  });

  router.get("/onchain-source-status", async (_request, response, next) => {
    try {
      const sources = await context.governanceRepository.findAllSourceStates(100);

      response.json({ onchainSources: sources });
    } catch (error) {
      next(error);
    }
  });

  router.get("/onchain-scan-runs", async (request, response, next) => {
    try {
      const limit = parseLimit(request.query.limit, 100);
      const runs = await context.governanceRepository.findScanRuns(limit);

      response.json({ onchainScanRuns: runs });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function parseLimit(value: unknown, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AdminQueryValidationError("limit must be a positive integer.");
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed > 500) {
    throw new AdminQueryValidationError("limit must be between 1 and 500.");
  }

  return parsed;
}

function parseOptionalProtocol(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !/^[a-z0-9_-]+$/i.test(value.trim())) {
    throw new AdminQueryValidationError("protocol must be a valid protocol name.");
  }

  return value.trim().toLowerCase();
}

export class AdminQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminQueryValidationError";
  }
}
