import { Router } from "express";
import type {
  GovernanceSourceType,
  NotificationStatus
} from "../../protocols/types.js";
import type { AppContext } from "../../server.js";
import type { ProposalSort } from "../../storage/proposal.repository.js";

const MAX_PROPOSAL_LIMIT = 100;
const sourceTypes = new Set<GovernanceSourceType>(["forum", "snapshot", "onchain"]);
const notificationStatuses = new Set<NotificationStatus>([
  "pending",
  "sent",
  "skipped",
  "failed"
]);
const proposalSorts = new Set<ProposalSort>([
  "publishedAt_desc",
  "publishedAt_asc",
  "firstSeenAt_desc",
  "firstSeenAt_asc",
  "lastSeenAt_desc",
  "lastSeenAt_asc"
]);

class QueryParameterError extends Error {}

function parseString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new QueryParameterError(`Query parameter ${name} must be a string.`);
  }

  const parsed = value.trim();

  return parsed || undefined;
}

function parseProtocol(value: unknown): string | undefined {
  return parseString(value, "protocol");
}

function parsePublisherName(value: unknown): string | undefined {
  return parseString(value, "publisherName");
}

function parseSourceType(value: unknown): GovernanceSourceType | undefined {
  const parsed = parseString(value, "sourceType");

  if (parsed === undefined) {
    return undefined;
  }

  if (!sourceTypes.has(parsed as GovernanceSourceType)) {
    throw new QueryParameterError(
      "sourceType must be one of: forum, snapshot, onchain."
    );
  }

  return parsed as GovernanceSourceType;
}

function parseNotificationStatus(value: unknown): NotificationStatus | undefined {
  const parsed = parseString(value, "notificationStatus");

  if (parsed === undefined) {
    return undefined;
  }

  if (!notificationStatuses.has(parsed as NotificationStatus)) {
    throw new QueryParameterError(
      "Query parameter notificationStatus must be one of: pending, sent, skipped, failed."
    );
  }

  return parsed as NotificationStatus;
}

function parseLimit(value: unknown): number | undefined {
  const parsed = parseString(value, "limit");

  if (parsed === undefined) {
    return undefined;
  }

  const limit = Number(parsed);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PROPOSAL_LIMIT) {
    throw new QueryParameterError(
      `Query parameter limit must be an integer between 1 and ${MAX_PROPOSAL_LIMIT}.`
    );
  }

  return limit;
}

function parseOffset(value: unknown): number | undefined {
  const parsed = parseString(value, "offset");

  if (parsed === undefined) {
    return undefined;
  }

  const offset = Number(parsed);

  if (!Number.isInteger(offset) || offset < 0) {
    throw new QueryParameterError(
      "Query parameter offset must be a non-negative integer."
    );
  }

  return offset;
}

function parseSort(value: unknown): ProposalSort | undefined {
  const parsed = parseString(value, "sort");

  if (parsed === undefined) {
    return undefined;
  }

  if (!proposalSorts.has(parsed as ProposalSort)) {
    throw new QueryParameterError(
      "Query parameter sort must be one of: publishedAt_desc, publishedAt_asc, firstSeenAt_desc, firstSeenAt_asc, lastSeenAt_desc, lastSeenAt_asc."
    );
  }

  return parsed as ProposalSort;
}

export function createProposalsRouter(context: AppContext): Router {
  const router = Router();

  router.get("/", async (request, response, next) => {
    try {
      const protocol = parseProtocol(request.query.protocol);
      const publisherName = parsePublisherName(request.query.publisherName);
      const sourceType = parseSourceType(request.query.sourceType);
      const notificationStatus = parseNotificationStatus(
        request.query.notificationStatus
      );
      const limit = parseLimit(request.query.limit);
      const offset = parseOffset(request.query.offset);
      const sort = parseSort(request.query.sort);
      const proposals = await context.proposalRepository.findAll({
        protocol,
        publisherName,
        sourceType,
        notificationStatus,
        limit,
        offset,
        sort
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
      const sourceType = parseSourceType(request.params.sourceType);

      const proposal = await context.proposalRepository.findBySourceIdentity(
        request.params.protocol,
        sourceType ?? request.params.sourceType,
        request.params.sourceId
      );

      if (!proposal) {
        response.status(404).json({ error: "Proposal not found." });
        return;
      }

      response.json({ proposal });
    } catch (error) {
      if (error instanceof QueryParameterError) {
        response.status(400).json({ error: error.message });
        return;
      }

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
