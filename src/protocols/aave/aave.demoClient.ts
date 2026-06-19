import type { Logger } from "pino";
import { cloneAaveRecentTopicsFixture } from "../../demoFixtures/aaveRecentTopics.fixture.js";
import { cloneAaveSiteFixture } from "../../demoFixtures/aaveSite.fixture.js";
import { AaveForumClient } from "./aaveForum.client.js";

export interface AaveDemoClientOptions {
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  logger?: Logger;
}

export function createAaveDemoClient(options: AaveDemoClientOptions): AaveForumClient {
  return new AaveForumClient({
    baseUrl: options.forumBaseUrl,
    apiBaseUrl: options.forumApiBaseUrl,
    logger: options.logger,
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const payload = url.pathname === "/site.json"
        ? cloneAaveSiteFixture()
        : cloneAaveRecentTopicsFixture();

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });
}
