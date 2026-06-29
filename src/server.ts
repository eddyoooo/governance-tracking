import express, { type Express } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { env as defaultEnv, type Env } from "./config/env.js";
import {
  FetchAlreadyRunningError,
  FetchProtocolGovernanceJob,
  UnknownProtocolAdapterError
} from "./jobs/fetchProtocolGovernance.job.js";
import {
  createNotificationService,
  type NotificationService
} from "./notifications/index.js";
import { createProtocolRegistry, type ProtocolRegistry } from "./protocols/registry.js";
import {
  createRepositories,
  type Repositories
} from "./storage/index.js";
import { createLogger } from "./utils/logger.js";
import { createAdminRouter } from "./api/routes/admin.routes.js";
import { createHealthRouter } from "./api/routes/health.routes.js";
import { requireApiAuth } from "./api/middleware/auth.middleware.js";
import type { FetchRunRepository } from "./storage/fetchRun.repository.js";
import type { ProposalRepository } from "./storage/proposal.repository.js";

export interface AppContext {
  env: Env;
  logger: Logger;
  proposalRepository: ProposalRepository;
  fetchRunRepository: FetchRunRepository;
  protocolRegistry: ProtocolRegistry;
  notificationService: NotificationService;
  fetchJob: FetchProtocolGovernanceJob;
}

export interface CreateAppOptions {
  env?: Env;
  logger?: Logger;
  repositories?: Repositories;
  protocolRegistry?: ProtocolRegistry;
  notificationService?: NotificationService;
  fetchJob?: FetchProtocolGovernanceJob;
}

export interface CreatedApp {
  app: Express;
  context: AppContext;
}

function isMalformedJsonError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  );
}

export function createApp(options: CreateAppOptions = {}): CreatedApp {
  const runtimeEnv = options.env ?? defaultEnv;
  const logger = options.logger ?? createLogger(runtimeEnv);
  const repositories = options.repositories ?? createRepositories(runtimeEnv, logger);
  const protocolRegistry =
    options.protocolRegistry ?? createProtocolRegistry(runtimeEnv, logger);
  const notificationService =
    options.notificationService ?? createNotificationService(runtimeEnv, logger);
  const fetchJob =
    options.fetchJob ??
    new FetchProtocolGovernanceJob(
      protocolRegistry,
      repositories.proposalRepository,
      repositories.fetchRunRepository,
      logger,
      {
        notificationService
      }
    );
  const context: AppContext = {
    env: runtimeEnv,
    logger,
    proposalRepository: repositories.proposalRepository,
    fetchRunRepository: repositories.fetchRunRepository,
    protocolRegistry,
    notificationService,
    fetchJob
  };
  const app = express();

  app.disable("x-powered-by");

  if (runtimeEnv.nodeEnv !== "production") {
    app.set("json spaces", 2);
  }

  app.use(pinoHttp({ logger }));
  app.use(requireApiAuth(runtimeEnv));
  app.use(express.json());

  app.get("/", (_request, response) => {
    response.json({
      name: "governance-tracking",
      mode: "monitor",
      routes: [
        "GET /health",
        "POST /api/admin/fetch/:protocol",
        "POST /api/admin/notify-pending",
        "GET /api/admin/fetch-runs"
      ]
    });
  });

  app.use("/health", createHealthRouter(context));
  app.use("/api/admin", createAdminRouter(context));

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      const message = error instanceof Error ? error.message : String(error);

      if (isMalformedJsonError(error)) {
        response.status(400).json({ error: "Malformed JSON request body." });
        return;
      }

      if (error instanceof UnknownProtocolAdapterError) {
        response.status(404).json({ error: message });
        return;
      }

      if (error instanceof FetchAlreadyRunningError) {
        response.status(409).json({ error: message });
        return;
      }

      logger.error({ error }, "Request failed");
      response.status(500).json({ error: message });
    }
  );

  return { app, context };
}
