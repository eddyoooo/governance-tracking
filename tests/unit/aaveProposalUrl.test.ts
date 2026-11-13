import { describe, expect, it } from "@jest/globals";
import { migrateAaveProposalUrl } from "../../src/onchain/aave/aaveProposalUrl.js";

describe("Aave proposal link migration", () => {
  it.each(["0", "542"])("migrates only the retired detail URL for proposal %s", (id) => {
    const legacy = `https://vote.onaave.com/proposal/?proposalId=${id}`;
    const current = `https://app.aave.com/governance/v3/proposal/?proposalId=${id}`;
    expect(migrateAaveProposalUrl(legacy)).toBe(current);
    expect(migrateAaveProposalUrl(legacy, id)).toBe(current);
    expect(migrateAaveProposalUrl(current, id)).toBe(current);
  });

  it.each([
    "https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170",
    "https://vote.uniswapfoundation.org/proposals/100",
    "https://vote.onaave.com/",
    "https://vote.onaave.com.evil.example/proposal/?proposalId=542",
    "https://vote.onaave.com/proposal/?proposalId=0542",
    "https://vote.onaave.com/proposal/?proposalId=542&proposalId=543",
    "https://vote.onaave.com/proposal/?proposalId=542\n"
  ])("leaves URLs outside the exact legacy pattern untouched (%s)", (url) => {
    expect(migrateAaveProposalUrl(url)).toBe(url);
  });
});
