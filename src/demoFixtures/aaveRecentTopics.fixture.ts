export const aaveRecentTopicsFixture = {
  users: [
    {
      id: 5301,
      username: "AaveLabs"
    },
    {
      id: 10100,
      username: "LlamaRisk"
    },
    {
      id: 7532,
      username: "TokenLogic"
    },
    {
      id: 14891,
      username: "Gepetto"
    }
  ],
  topic_list: {
    can_create_topic: false,
    more_topics_url: null,
    per_page: 30,
    topics: [
      {
        id: 25170,
        title: "[ARFC] Deploy Aave V4 on Arc",
        slug: "arfc-deploy-aave-v4-on-arc",
        posts_count: 2,
        reply_count: 0,
        created_at: "2026-06-19T12:00:28.625Z",
        last_posted_at: "2026-06-19T14:44:55.603Z",
        category_id: 10,
        last_poster_username: "MconnectDAO",
        posters: [
          {
            description: "Original Poster",
            user_id: 5301,
            primary_group_id: 46,
            flair_group_id: 46
          },
          {
            extras: "latest",
            description: "Most Recent Poster",
            user_id: 14349
          }
        ]
      },
      {
        id: 25168,
        title: "Risk Stewards: Supply Cap Increases on Aave V3 / 2026.06.18",
        slug: "risk-stewards-supply-cap-increases-on-aave-v3-2026-06-18",
        posts_count: 1,
        reply_count: 0,
        created_at: "2026-06-18T20:17:30.736Z",
        last_posted_at: "2026-06-18T20:17:30.834Z",
        category_id: 7,
        last_poster_username: "LlamaRisk",
        posters: [
          {
            extras: "latest single",
            description: "Original Poster, Most Recent Poster",
            user_id: 10100
          }
        ]
      },
      {
        id: 25154,
        title: "[ARFC] Umbrella Parameter Update: Target Liquidity and Emission Optimization",
        slug: "arfc-umbrella-parameter-update-target-liquidity-and-emission-optimization",
        posts_count: 1,
        reply_count: 0,
        created_at: "2026-06-16T15:45:02.282Z",
        last_posted_at: "2026-06-16T15:45:02.390Z",
        category_id: 30,
        last_poster_username: "TokenLogic",
        posters: [
          {
            extras: "latest single",
            description: "Original Poster, Most Recent Poster",
            user_id: 7532,
            primary_group_id: 49,
            flair_group_id: 49
          }
        ]
      },
      {
        id: 25089,
        title: "AAVE Needs a Formal Surplus Allocation Framework",
        slug: "aave-needs-a-formal-surplus-allocation-framework",
        posts_count: 12,
        reply_count: 4,
        created_at: "2026-06-07T14:59:58.975Z",
        last_posted_at: "2026-06-16T19:05:28.051Z",
        category_id: 4,
        last_poster_username: "Gepetto",
        posters: [
          {
            extras: "latest",
            description: "Original Poster, Most Recent Poster",
            user_id: 14891
          }
        ]
      }
    ]
  }
} as const;

export function cloneAaveRecentTopicsFixture() {
  return JSON.parse(JSON.stringify(aaveRecentTopicsFixture)) as typeof aaveRecentTopicsFixture;
}
