export const uniswapRecentTopicsFixture = {
  users: [
    {
      id: 10687,
      username: "eek637",
      name: null
    },
    {
      id: 18516,
      username: "squidwardjalapeno",
      name: "Squidward Jalapeno"
    },
    {
      id: 18887,
      username: "Axia",
      name: "Rika_Axia Network"
    },
    {
      id: 19068,
      username: "Mr.Vock",
      name: "Sergei"
    }
  ],
  topic_list: {
    can_create_topic: false,
    more_topics_url: null,
    per_page: 30,
    topics: [
      {
        id: 26127,
        title:
          "[RFC] - Update Crosschain Governance Parameters for Avalanche, MegaETH, Soneium, and X Layer",
        slug:
          "rfc-update-crosschain-governance-parameters-for-avalanche-megaeth-soneium-and-x-layer",
        posts_count: 1,
        reply_count: 0,
        created_at: "2026-06-19T17:04:30.632Z",
        last_posted_at: "2026-06-19T17:04:30.632Z",
        category_id: 5,
        last_poster_username: "eek637",
        posters: [
          {
            extras: "latest single",
            description: "Original Poster, Most Recent Poster",
            user_id: 10687
          }
        ]
      },
      {
        id: 26123,
        title:
          '[RFC] Introduction and Advice: "Seeds & Bones" Web3 Survival MOBA on Unichain & Ecosystem Grant Inquiry / General Guidance',
        slug:
          "rfc-introduction-and-advice-seeds-bones-web3-survival-moba-on-unichain-ecosystem-grant-inquiry-general-guidance",
        posts_count: 1,
        reply_count: 0,
        created_at: "2026-06-14T03:00:12.974Z",
        last_posted_at: "2026-06-14T03:00:12.974Z",
        category_id: 5,
        last_poster_username: "squidwardjalapeno",
        posters: [
          {
            extras: "latest single",
            description: "Original Poster, Most Recent Poster",
            user_id: 18516
          }
        ]
      },
      {
        id: 26036,
        title: "Axia Network Delegate Platform",
        slug: "axia-network-delegate-platform",
        posts_count: 1,
        reply_count: 0,
        created_at: "2026-02-20T21:49:40.384Z",
        last_posted_at: "2026-02-20T21:49:40.384Z",
        category_id: 6,
        last_poster_username: "Axia",
        posters: [
          {
            extras: "latest single",
            description: "Original Poster, Most Recent Poster",
            user_id: 18887
          }
        ]
      },
      {
        id: 26132,
        title:
          "RFC : Tokenomics overhaul : hard-capping supply via auto burn, pivoting unification to staking distribution and staking DAO treasury reserves",
        slug:
          "rfc-tokenomics-overhaul-hard-capping-supply-via-auto-burn-pivoting-unification-to-staking-distribution-and-staking-dao-treasury-reserves",
        posts_count: 2,
        reply_count: 1,
        created_at: "2026-06-25T12:09:44.808Z",
        last_posted_at: "2026-06-25T13:18:24.000Z",
        category_id: 1,
        last_poster_username: "Jstack",
        posters: [
          {
            description: "Original Poster",
            user_id: 19068
          }
        ]
      }
    ]
  }
} as const;

export function cloneUniswapRecentTopicsFixture() {
  return JSON.parse(
    JSON.stringify(uniswapRecentTopicsFixture)
  ) as typeof uniswapRecentTopicsFixture;
}
