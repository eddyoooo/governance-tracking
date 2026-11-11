import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { FetchProtocolGovernanceJob } from "../../src/jobs/fetchProtocolGovernance.job.js";
import { ProtocolRegistry } from "../../src/protocols/registry.js";
import { MemoryProposalRepository } from "../../src/storage/memoryProposal.repository.js";
import { MemoryFetchRunRepository } from "../../src/storage/fetchRun.repository.js";
import { MemoryProtocolStateRepository } from "../../src/storage/protocolState.repository.js";
import { MemorySourceActivityRepository } from "../../src/storage/sourceActivity.repository.js";
import type { NotificationMessage, NotificationService } from "../../src/notifications/notification.service.js";
import { AaveAdapter } from "../../src/protocols/aave/aave.adapter.js";
import { AaveForumClient } from "../../src/protocols/aave/aaveForum.client.js";
import { CowAdapter } from "../../src/protocols/cow/cow.adapter.js";
import { CowForumClient } from "../../src/protocols/cow/cowForum.client.js";
import { LidoAdapter } from "../../src/protocols/lido/lido.adapter.js";
import { LidoForumClient } from "../../src/protocols/lido/lidoForum.client.js";
import { UniswapAdapter } from "../../src/protocols/uniswap/uniswap.adapter.js";
import { UniswapForumClient } from "../../src/protocols/uniswap/uniswapForum.client.js";
import { createRawGovernanceItem, createSilentLogger } from "../helpers/builders.js";

class RecordingService implements NotificationService {
  readonly name = "recording";
  readonly enabled = true;
  readonly messages: NotificationMessage[] = [];
  getRecipients() { return [{ key: "recipient", maskedId: "***1111" }]; }
  async send(message: NotificationMessage) { this.messages.push(message); }
}

function runtime(protocol: string) {
  let phase = 0;
  const item = (sourceId: string, publishedAt: string) => createRawGovernanceItem({ protocol, sourceId, publishedAt });
  const original = item("101", "2026-11-09T00:00:00.000Z");
  const visible = item("102", "2026-11-10T08:30:00.000Z");
  const delayed = item("103", "2026-11-10T08:40:00.000Z");
  const items = () => phase === 0 ? [original] : phase === 1 ? [original, visible] : [original, visible, delayed];
  const baseUrl = "https://forum.example";
  const fetchImpl = jest.fn<typeof fetch>(async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/site.json") return Response.json({ categories: [] });
    if (parsed.searchParams.get("page") === "1") return new Response("Unavailable", { status: 400 });
    return Response.json({ users: [{ id: 1, username: "allowed", name: "Allowed Publisher" }],
      topic_list: { topics: items().map((topic) => ({ id: Number(topic.sourceId), title: topic.title,
        slug: `proposal-${topic.sourceId}`, created_at: topic.publishedAt,
        posters: [{ user_id: 1, description: "Original Poster" }] })),
      more_topics_url: phase === 1 ? "/latest.json?page=1" : null } });
  });
  const clientOptions = { baseUrl, apiBaseUrl: baseUrl, fetchImpl };
  const adapterOptions = { enabled: true, forumBaseUrl: baseUrl, forumApiBaseUrl: baseUrl,
    allowedPublishers: ["Allowed Publisher"], maxPages: 2, categoryMaxPages: 2 };
  const adapter = protocol === "lido" ? new LidoAdapter({ ...adapterOptions, client: new LidoForumClient(clientOptions) })
    : protocol === "aave" ? new AaveAdapter({ ...adapterOptions, client: new AaveForumClient(clientOptions) })
    : protocol === "uniswap" ? new UniswapAdapter({ ...adapterOptions, client: new UniswapForumClient(clientOptions) })
    : new CowAdapter({ ...adapterOptions, client: new CowForumClient(clientOptions) });
  const registry = new ProtocolRegistry();
  registry.register(adapter);
  const proposals = new MemoryProposalRepository();
  const runs = new MemoryFetchRunRepository();
  const states = new MemoryProtocolStateRepository();
  const notifications = new RecordingService();
  const job = new FetchProtocolGovernanceJob(registry, proposals, runs, new MemorySourceActivityRepository(),
    createSilentLogger(), { notificationService: notifications, protocolStateRepository: states });
  return { job, proposals, runs, states, notifications, setPhase: (next: number) => { phase = next; } };
}

describe("forum partial-coverage recovery", () => {
  afterEach(() => jest.useRealTimers());

  it.each(["lido", "aave", "uniswap", "cow"])("does not silently lose a delayed %s alert after a partial fetch", async (protocol) => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-10T08:00:00.000Z"));
    const instance = runtime(protocol);
    await instance.job.run(protocol);
    instance.setPhase(1);
    jest.setSystemTime(new Date("2026-11-10T09:00:00.000Z"));
    const partial = await instance.job.run(protocol);
    expect(partial.run).toMatchObject({ coverageComplete: false,
      errors: [expect.stringContaining("page 1 failed")] });
    expect(JSON.stringify(partial.errors)).not.toContain("https://forum.example");
    expect(instance.notifications.messages).toHaveLength(1);
    instance.setPhase(2);
    jest.setSystemTime(new Date("2026-11-10T10:00:00.000Z"));
    const recovered = await instance.job.run(protocol);
    expect(recovered).toMatchObject({ notificationSentCount: 1, storedNewCount: 1 });
    expect(instance.notifications.messages).toHaveLength(2);
    await expect(instance.proposals.countByNotificationStatus("sent")).resolves.toBe(2);
  });

  it("keeps the initial baseline silent and incomplete until a full configured fetch succeeds", async () => {
    const instance = runtime("aave");
    instance.setPhase(1);
    await instance.job.run("aave");
    await expect(instance.states.findByProtocol("aave")).resolves.toMatchObject({ baselineStatus: "seeding" });
    instance.setPhase(2);
    await instance.job.run("aave");
    await expect(instance.states.findByProtocol("aave")).resolves.toMatchObject({ baselineStatus: "complete" });
    expect(instance.notifications.messages).toEqual([]);
    await expect(instance.proposals.countByNotificationStatus("skipped")).resolves.toBe(3);
  });
});
