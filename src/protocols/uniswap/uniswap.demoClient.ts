import type { Logger } from "pino";
import { cloneUniswapRecentTopicsFixture } from "../../demoFixtures/uniswapRecentTopics.fixture.js";
import { cloneUniswapSiteFixture } from "../../demoFixtures/uniswapSite.fixture.js";
import { UniswapForumClient } from "./uniswapForum.client.js";

export interface UniswapDemoClientOptions {
  forumBaseUrl: string;
  forumApiBaseUrl: string;
  logger?: Logger;
}

export function createUniswapDemoClient(
  options: UniswapDemoClientOptions
): UniswapForumClient {
  return new UniswapForumClient({
    baseUrl: options.forumBaseUrl,
    apiBaseUrl: options.forumApiBaseUrl,
    logger: options.logger,
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const payload =
        url.pathname === "/site.json"
          ? cloneUniswapSiteFixture()
          : cloneUniswapRecentTopicsFixture();

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });
}
