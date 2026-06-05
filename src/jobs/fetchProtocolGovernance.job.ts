import type { Logger } from "pino";
import { filterByPublisherAllowlist } from "../protocols/allowlist.js";
import type { ProtocolRegistry } from "../protocols/registry.js";
import { createFetchRunId } from "../utils/hash.js";
import type { FetchRun, FetchRunRepository } from "../storage/fetchRun.repository.js";
import type { ProposalRepository } from "../storage/proposal.repository.js";

export interface FetchProtocolResult {
  run: FetchRun;
  fetchedCount: number;
  storedCount: number;
  skippedCount: number;
}

export class FetchProtocolGovernanceJob {
  private readonly runningProtocols = new Set<string>();

  constructor(
    private readonly registry: ProtocolRegistry,
    private readonly proposalRepository: ProposalRepository,
    private readonly fetchRunRepository: FetchRunRepository,
    private readonly logger: Logger
  ) {}

  async run(protocol: string): Promise<FetchProtocolResult> {
    if (this.runningProtocols.has(protocol)) {
      throw new Error(`Fetch already running for protocol: ${protocol}`);
    }

    const adapter = this.registry.get(protocol);

    if (!adapter) {
      throw new Error(`Unknown protocol adapter: ${protocol}`);
    }

    this.runningProtocols.add(protocol);
    const startedAt = new Date().toISOString();
    const runId = createFetchRunId(protocol, startedAt);
    const run: FetchRun = {
      id: runId,
      protocol,
      startedAt,
      status: "running",
      fetchedCount: 0,
      storedCount: 0,
      skippedCount: 0
    };

    await this.fetchRunRepository.upsert(run);

    try {
      this.logger.info({ protocol, runId }, "Starting governance fetch");
      const rawItems = await adapter.fetchRecent();
      const filtered = filterByPublisherAllowlist(rawItems, adapter.publisherAllowlist);
      const normalizedItems = filtered.allowed.map((item) => adapter.normalize(item));
      const upsertResults = await this.proposalRepository.upsertMany(normalizedItems);
      const finishedRun: FetchRun = {
        ...run,
        finishedAt: new Date().toISOString(),
        status: "success",
        fetchedCount: rawItems.length,
        storedCount: upsertResults.length,
        skippedCount: filtered.skipped.length
      };

      await this.fetchRunRepository.upsert(finishedRun);
      this.logger.info(
        {
          protocol,
          runId,
          fetchedCount: finishedRun.fetchedCount,
          storedCount: finishedRun.storedCount,
          skippedCount: finishedRun.skippedCount
        },
        "Finished governance fetch"
      );

      return {
        run: finishedRun,
        fetchedCount: finishedRun.fetchedCount,
        storedCount: finishedRun.storedCount,
        skippedCount: finishedRun.skippedCount
      };
    } catch (error) {
      const failedRun: FetchRun = {
        ...run,
        finishedAt: new Date().toISOString(),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error)
      };

      await this.fetchRunRepository.upsert(failedRun);
      this.logger.error({ protocol, runId, error }, "Governance fetch failed");
      throw error;
    } finally {
      this.runningProtocols.delete(protocol);
    }
  }
}
