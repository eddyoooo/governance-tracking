export const uniswapSiteFixture = {
  categories: [
    {
      id: 9,
      name: "Temperature Check",
      slug: "temperature-check",
      read_restricted: false
    },
    {
      id: 5,
      name: "Requests for Comment",
      slug: "proposal-discussion",
      read_restricted: false
    },
    {
      id: 10,
      name: "Consensus Check",
      slug: "consensus-check",
      read_restricted: false
    },
    {
      id: 6,
      name: "Delegation Pitch",
      slug: "delegation-pitch",
      read_restricted: false
    },
    {
      id: 8,
      name: "Governance-Meta",
      slug: "governance-meta",
      read_restricted: false
    },
    {
      id: 14,
      name: "Service Providers",
      slug: "service-providers",
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

export function cloneUniswapSiteFixture() {
  return JSON.parse(JSON.stringify(uniswapSiteFixture)) as typeof uniswapSiteFixture;
}
