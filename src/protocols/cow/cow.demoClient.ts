import type { Logger } from "pino";
import { cloneCowRecentTopicsFixture } from "../../demoFixtures/cowRecentTopics.fixture.js";
import { cloneCowSiteFixture } from "../../demoFixtures/cowSite.fixture.js";
import { CowForumClient } from "./cowForum.client.js";

export interface CowDemoClientOptions {
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  logger?: Logger;
}

export function createCowDemoClient(
  options: CowDemoClientOptions
): CowForumClient {
  return new CowForumClient({
    baseUrl: options.forumBaseUrl,
    apiBaseUrl: options.forumApiBaseUrl,
    logger: options.logger,
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const payload =
        url.pathname === "/site.json"
          ? cloneCowSiteFixture()
          : cloneCowRecentTopicsFixture();

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });
}
