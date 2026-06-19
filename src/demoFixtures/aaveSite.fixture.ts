export const aaveSiteFixture = {
  categories: [
    {
      id: 4,
      name: "Governance",
      slug: "governance",
      read_restricted: false
    },
    {
      id: 8,
      name: "General",
      slug: "general",
      parent_category_id: 4,
      read_restricted: false
    },
    {
      id: 9,
      name: "New Asset",
      slug: "new-asset",
      parent_category_id: 4,
      read_restricted: false
    },
    {
      id: 10,
      name: "New Market",
      slug: "new-market",
      parent_category_id: 4,
      read_restricted: false
    },
    {
      id: 11,
      name: "Maintenance",
      slug: "maintenance",
      parent_category_id: 4,
      read_restricted: false
    },
    {
      id: 7,
      name: "Risk",
      slug: "risk",
      read_restricted: false
    },
    {
      id: 12,
      name: "General",
      slug: "general",
      parent_category_id: 7,
      read_restricted: false
    },
    {
      id: 13,
      name: "Smart Contract",
      slug: "smart-contract",
      parent_category_id: 7,
      read_restricted: false
    },
    {
      id: 14,
      name: "Liquidity",
      slug: "liquidity",
      parent_category_id: 7,
      read_restricted: false
    },
    {
      id: 15,
      name: "Solvency",
      slug: "solvency",
      parent_category_id: 7,
      read_restricted: false
    },
    {
      id: 16,
      name: "Liquidation",
      slug: "liquidation",
      parent_category_id: 7,
      read_restricted: false
    },
    {
      id: 17,
      name: "Oracles",
      slug: "oracles",
      parent_category_id: 7,
      read_restricted: false
    },
    {
      id: 26,
      name: "Development",
      slug: "development",
      read_restricted: false
    },
    {
      id: 30,
      name: "Finance",
      slug: "finance",
      read_restricted: false
    },
    {
      id: 29,
      name: "Service Provider engagements",
      slug: "service-provider-engagements",
      read_restricted: false
    },
    {
      id: 27,
      name: "Delegate Platforms",
      slug: "delegate-platforms",
      read_restricted: false
    },
    {
      id: 6,
      name: "Other",
      slug: "other",
      read_restricted: false
    },
    {
      id: 20,
      name: "Site Feedback",
      slug: "site-feedback",
      parent_category_id: 6,
      read_restricted: false
    },
    {
      id: 999,
      name: "Private Staff",
      slug: "private-staff",
      read_restricted: true
    }
  ]
} as const;

export function cloneAaveSiteFixture() {
  return JSON.parse(JSON.stringify(aaveSiteFixture)) as typeof aaveSiteFixture;
}
