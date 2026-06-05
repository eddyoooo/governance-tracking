import { readFile } from "node:fs/promises";
import pino from "pino";
import { loadEnv } from "./config/env.js";
import { FetchProtocolGovernanceJob } from "./jobs/fetchProtocolGovernance.job.js";
import { LidoAdapter } from "./protocols/lido/lido.adapter.js";
import { LidoForumClient } from "./protocols/lido/lidoForum.client.js";
import { ProtocolRegistry } from "./protocols/registry.js";
import { MemoryFetchRunRepository } from "./storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "./storage/memoryProposal.repository.js";

async function loadFixture(name: string): Promise<unknown> {
  const fixture = await readFile(
    new URL(`../tests/fixtures/lido/${name}`, import.meta.url),
    "utf8"
  );

  return JSON.parse(fixture) as unknown;
}

async function main(): Promise<void> {
  const recentTopicsFixture = await loadFixture("recent-topics.json");
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "development",
    STORAGE_MODE: "memory",
    DEMO_MODE: "true",
    ENABLE_SCHEDULER: "false",
    ENABLE_DEBUG_ENDPOINTS: "true",
    LIDO_ALLOWED_PUBLISHERS: JSON.stringify(["Allowed Publisher"]),
    LOG_LEVEL: "silent"
  });
  const logger = pino({ level: env.logLevel });
  const client = new LidoForumClient({
    baseUrl: env.lidoForumBaseUrl,
    apiBaseUrl: env.lidoForumApiBaseUrl,
    logger,
    fetchImpl: async () =>
      new Response(JSON.stringify(recentTopicsFixture), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  const registry = new ProtocolRegistry();
  const proposalRepository = new MemoryProposalRepository();
  const fetchRunRepository = new MemoryFetchRunRepository();

  registry.register(
    new LidoAdapter({
      enabled: true,
      forumBaseUrl: env.lidoForumBaseUrl,
      forumApiBaseUrl: env.lidoForumApiBaseUrl,
      allowedPublishers: env.lidoAllowedPublishers,
      logger,
      client
    })
  );

  const job = new FetchProtocolGovernanceJob(
    registry,
    proposalRepository,
    fetchRunRepository,
    logger
  );
  const result = await job.run("lido");
  const proposals = await proposalRepository.findAll();

  console.log(
    JSON.stringify(
      {
        demoMode: true,
        fetchedFixtureItems: result.fetchedCount,
        allowedPublishers: env.lidoAllowedPublishers,
        storedNormalizedProposals: result.storedCount,
        skippedNonAllowlistedPublishers: result.skippedCount,
        proposals
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
