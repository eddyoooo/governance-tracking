import { describe, expect, it } from "@jest/globals";
import { evaluateGovernanceNotificationPolicy } from "../../src/onchain/governanceNotificationPolicy.js";
import type { GovernanceTransitionType } from "../../src/onchain/types.js";

const transitions = {
  created: false,
  succeeded: true,
  defeated: true,
  queued: false,
  executed: false,
  canceled: false,
  expired: false
} satisfies Record<GovernanceTransitionType, boolean>;

describe("on-chain notification policy", () => {
  it.each(Object.keys(transitions) as GovernanceTransitionType[])("applies the Aave policy for %s without changing Uniswap", (transition) => {
    expect(evaluateGovernanceNotificationPolicy({ protocol: "aave", transition })).toEqual(
      transitions[transition] ? { action: "notify" } : { action: "suppress", reason: "aave_onchain_result_only" }
    );
    expect(evaluateGovernanceNotificationPolicy({ protocol: "uniswap", transition })).toEqual({ action: "notify" });
  });
});
