import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { FetchProtocolGovernanceJob } from "../../src/jobs/fetchProtocolGovernance.job.js";
import type {
  NotificationMessage,
  NotificationService
} from "../../src/notifications/notification.service.js";
import { LidoAdapter } from "../../src/protocols/lido/lido.adapter.js";
import { LidoForumClient } from "../../src/protocols/lido/lidoForum.client.js";
import { ProtocolRegistry } from "../../src/protocols/registry.js";
import { MemoryFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemoryProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import { createSilentLogger } from "../helpers/builders.js";

class RecordingNotificationService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];

  getRecipients() {
    return [{ key: "recipient-1", maskedId: "*****1111" }];
  }

  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(message);
  }
}

async function loadLeaderFixture(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL("../fixtures/lido/leader-recent-topics.json", import.meta.url),
      "utf8"
    )
  ) as unknown;
}

describe("Lido Leader publisher policy integration", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("parses, tracks, notifies, and deduplicates a Leader topic without trusting a Leader reply", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-28T08:00:00.000Z"));
    const fixture = await loadLeaderFixture();
    const fetchImpl = jest.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const adapter = new LidoAdapter({
      enabled: true,
      forumBaseUrl: "https://research.lido.fi",
      forumApiBaseUrl: "https://research.lido.fi",
      allowedPublishers: [
        "Lido Labs Foundation - Operations Team",
        "Lido | Finance Team",
        "Lido Ecosystem Foundation - Operations Team"
      ],
      maxPages: 5,
      client: new LidoForumClient({
        baseUrl: "https://research.lido.fi",
        apiBaseUrl: "https://research.lido.fi",
        fetchImpl
      })
    });
    const registry = new ProtocolRegistry();
    registry.register(adapter);
    const proposalRepository = new MemoryProposalRepository();
    const fetchRunRepository = new MemoryFetchRunRepository();
    const sourceActivityRepository = new MemorySourceActivityRepository();
    const protocolStateRepository = new MemoryProtocolStateRepository();
    const notificationService = new RecordingNotificationService();
    await protocolStateRepository.initializeBaseline(
      "lido",
      true,
      "2026-10-28T07:59:00.000Z"
    );
    const job = new FetchProtocolGovernanceJob(
      registry,
      proposalRepository,
      fetchRunRepository,
      sourceActivityRepository,
      createSilentLogger(),
      {
        notificationService,
        protocolStateRepository
      }
    );

    const firstRun = await job.run("lido");

    expect(firstRun).toMatchObject({
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 1,
      baselineSeededCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 0,
      skippedCount: 1,
      notificationSentCount: 1,
      notificationFailedCount: 0,
      errors: []
    });
    const [storedAfterFirstRun] = await proposalRepository.findAll();

    expect(storedAfterFirstRun).toMatchObject({
      protocol: "lido",
      sourceId: "11987",
      publisherName: "Izzy",
      title: "Unveiling Lido Lend: Security-First Lending",
      notificationStatus: "sent"
    });
    expect(storedAfterFirstRun).not.toHaveProperty("publisherTrustLevel");
    expect(notificationService.messages).toEqual([
      {
        protocol: "lido",
        sourceType: "forum",
        publisherName: "Izzy",
        title: "Unveiling Lido Lend: Security-First Lending",
        sourceUrl:
          "https://research.lido.fi/t/unveiling-lido-lend-security-first-lending/11987"
      }
    ]);

    jest.setSystemTime(new Date("2026-10-28T14:00:00.000Z"));
    const secondRun = await job.run(" LIDO ");

    expect(secondRun).toMatchObject({
      fetchedCount: 2,
      allowlistedCount: 1,
      storedNewCount: 0,
      updatedExistingCount: 0,
      unchangedExistingCount: 1,
      skippedCount: 1,
      notificationSentCount: 0,
      notificationFailedCount: 0,
      errors: []
    });
    expect(notificationService.messages).toHaveLength(1);
    const proposalsAfterSecondRun = await proposalRepository.findAll();
    const fetchRuns = await fetchRunRepository.findAll();

    expect(proposalsAfterSecondRun).toHaveLength(1);
    expect(proposalsAfterSecondRun[0]).toEqual(storedAfterFirstRun);
    expect(fetchRuns).toHaveLength(2);
    expect(fetchRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: "lido",
          status: "success",
          fetchedCount: 2,
          allowlistedCount: 1,
          skippedCount: 1
        })
      ])
    );
    await expect(sourceActivityRepository.findByProtocol("lido")).resolves.toMatchObject({
      latestRawSourceId: "11988",
      lastFetchedCount: 2,
      status: "healthy"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
