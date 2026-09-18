import express, { type Express } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { env as defaultEnv, type Env } from "./config/env.js";
import {
  createAdminStatusReporter,
  type AdminStatusReporter
} from "./adminStatus/adminStatus.service.js";
import {
  FetchAlreadyRunningError,
  FetchProtocolGovernanceJob,
  UnknownProtocolAdapterError
} from "./jobs/fetchProtocolGovernance.job.js";
import {
  createNotificationService,
  ProposalNotificationDispatcher,
  type NotificationService
} from "./notifications/index.js";
import { createProtocolRegistry, type ProtocolRegistry } from "./protocols/registry.js";
import {
  createRepositories,
  type Repositories
} from "./storage/index.js";
import { createLogger } from "./utils/logger.js";
import { createAdminRouter } from "./api/routes/admin.routes.js";
import { AdminQueryValidationError } from "./api/routes/admin.routes.js";
import { createHealthRouter } from "./api/routes/health.routes.js";
import { requireApiAuth } from "./api/middleware/auth.middleware.js";
import type { FetchRunRepository } from "./storage/fetchRun.repository.js";
import type { ProposalRepository } from "./storage/proposal.repository.js";
import type { ProtocolStateRepository } from "./storage/protocolState.repository.js";
import type { SourceActivityRepository } from "./storage/sourceActivity.repository.js";
import {
  OnchainGovernanceScanJob,
  OnchainScanAlreadyRunningError,
  UnknownOnchainGovernanceSourceError
} from "./onchain/onchainGovernance.job.js";
import {
  createEvmGovernanceRegistry,
  type EvmGovernanceRegistry
} from "./onchain/registry.js";
import { governanceEventMessage } from "./onchain/governanceNotifications.js";
import type { GovernanceLifecycleEvent } from "./onchain/types.js";
import type { GovernanceRepository } from "./storage/governance.repository.js";
import { errorMessage, safeErrorDetails } from "./utils/errors.js";

export interface AppContext {
  env: Env;
  logger: Logger;
  proposalRepository: ProposalRepository;
  fetchRunRepository: FetchRunRepository;
  sourceActivityRepository: SourceActivityRepository;
  protocolStateRepository: ProtocolStateRepository;
  governanceRepository: GovernanceRepository;
  protocolRegistry: ProtocolRegistry;
  evmGovernanceRegistry: EvmGovernanceRegistry;
  notificationService: NotificationService;
  notificationDispatcher: ProposalNotificationDispatcher;
  governanceNotificationDispatcher: ProposalNotificationDispatcher<GovernanceLifecycleEvent>;
  adminStatusReporter: AdminStatusReporter;
  fetchJob: FetchProtocolGovernanceJob;
  onchainGovernanceJob: OnchainGovernanceScanJob;
}

export interface CreateAppOptions {
  env?: Env;
  logger?: Logger;
  repositories?: Repositories;
  protocolRegistry?: ProtocolRegistry;
  evmGovernanceRegistry?: EvmGovernanceRegistry;
  notificationService?: NotificationService;
  notificationDispatcher?: ProposalNotificationDispatcher;
  governanceNotificationDispatcher?: ProposalNotificationDispatcher<GovernanceLifecycleEvent>;
  adminStatusReporter?: AdminStatusReporter;
  fetchJob?: FetchProtocolGovernanceJob;
  onchainGovernanceJob?: OnchainGovernanceScanJob;
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
  const evmGovernanceRegistry =
    options.evmGovernanceRegistry ?? createEvmGovernanceRegistry(runtimeEnv);
  const notificationService =
    options.notificationService ?? createNotificationService(runtimeEnv, logger);
  const protocolStateRepository = repositories.protocolStateRepository;
  const notificationDispatcher =
    options.notificationDispatcher ??
    new ProposalNotificationDispatcher(
      repositories.proposalRepository,
      notificationService,
      logger
    );
  const governanceNotificationDispatcher =
    options.governanceNotificationDispatcher ??
    new ProposalNotificationDispatcher<GovernanceLifecycleEvent>(
      repositories.governanceRepository,
      notificationService,
      logger,
      governanceEventMessage
    );
  const adminStatusReporter =
    options.adminStatusReporter ??
    createAdminStatusReporter({
      env: runtimeEnv,
      protocolRegistry,
      fetchRunRepository: repositories.fetchRunRepository,
      proposalRepository: repositories.proposalRepository,
      sourceActivityRepository: repositories.sourceActivityRepository,
      governanceRepository: repositories.governanceRepository,
      evmGovernanceRegistry,
      logger
    });
  const fetchJob =
    options.fetchJob ??
    new FetchProtocolGovernanceJob(
      protocolRegistry,
      repositories.proposalRepository,
      repositories.fetchRunRepository,
      repositories.sourceActivityRepository,
      logger,
      {
        notificationService,
        notificationDispatcher,
        protocolStateRepository,
        sourceActivityConfig:
          FetchProtocolGovernanceJob.sourceActivityConfigFromEnv(runtimeEnv)
      }
    );
  const onchainGovernanceJob =
    options.onchainGovernanceJob ??
    new OnchainGovernanceScanJob(
      evmGovernanceRegistry,
      repositories.governanceRepository,
      notificationService,
      governanceNotificationDispatcher,
      logger
    );
  const context: AppContext = {
    env: runtimeEnv,
    logger,
    proposalRepository: repositories.proposalRepository,
    fetchRunRepository: repositories.fetchRunRepository,
    sourceActivityRepository: repositories.sourceActivityRepository,
    protocolStateRepository,
    governanceRepository: repositories.governanceRepository,
    protocolRegistry,
    evmGovernanceRegistry,
    notificationService,
    notificationDispatcher,
    governanceNotificationDispatcher,
    adminStatusReporter,
    fetchJob,
    onchainGovernanceJob
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
        "POST /api/admin/fetch-onchain/:protocol",
        "POST /api/admin/status/send",
        "GET /api/admin/fetch-runs",
        "GET /api/admin/source-activity",
        "GET /api/admin/governance-votes",
        "GET /api/admin/onchain-source-status",
        "GET /api/admin/onchain-scan-runs"
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
      const message = errorMessage(error);

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

      if (error instanceof UnknownOnchainGovernanceSourceError) {
        response.status(404).json({ error: message });
        return;
      }

      if (error instanceof OnchainScanAlreadyRunningError) {
        response.status(409).json({ error: message });
        return;
      }

      if (error instanceof AdminQueryValidationError) {
        response.status(400).json({ error: message });
        return;
      }

      logger.error({ error: safeErrorDetails(error) }, "Request failed");
      response.status(500).json({
        error:
          runtimeEnv.nodeEnv === "production"
            ? "Internal server error."
            : message
      });
    }
  );

  return { app, context };
}
