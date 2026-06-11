import type { Logger } from "pino";
import { cloneLidoRecentTopicsFixture } from "../../demoFixtures/lidoRecentTopics.fixture.js";
import { LidoForumClient } from "./lidoForum.client.js";

export interface LidoDemoClientOptions {
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  logger?: Logger;
}

export function createLidoDemoClient(options: LidoDemoClientOptions): LidoForumClient {
  return new LidoForumClient({
    baseUrl: options.forumBaseUrl,
    apiBaseUrl: options.forumApiBaseUrl,
    logger: options.logger,
    fetchImpl: async () =>
      new Response(JSON.stringify(cloneLidoRecentTopicsFixture()), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
  });
}
