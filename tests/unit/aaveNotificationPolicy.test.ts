import { describe, expect, it } from "@jest/globals";
import {
  AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON,
  aaveRoutineCapNotificationPolicy,
  isRoutineAaveRiskStewardsCapChange
} from "../../src/protocols/aave/aaveNotificationPolicy.js";
import type { NotificationPolicyInput } from "../../src/notifications/notificationPolicy.js";

function input(
  title: string,
  overrides: Partial<NotificationPolicyInput> = {}
): NotificationPolicyInput {
  return {
    protocol: "aave",
    sourceType: "forum",
    publisherName: "LlamaRisk",
    title,
    ...overrides
  };
}

describe("Aave routine cap notification policy", () => {
  it.each([
    "Risk Stewards: Supply and Borrow Cap Changes on Aave V3 / 2026.11.03",
    "Risk Stewards: Supply and Borrow Cap Increases on Aave V3 / 2026.11.02",
    "Risk Stewards: Add Cap Increases on Aave V4 / 2026.11.01",
    "Risk Stewards: Borrow Cap Increases on Aave V3 / 2026.11.01",
    "Risk Stewards: Cap Increases on Aave V4 / 2026.10.26",
    "Risk Stewards: Cap Reductions on Aave V3 / 2026.10.15",
    "Risk Stewards: Supply Cap Decrease on Aave V3 / 2026.09.07",
    "Risk Stewards: Borrow and Draw Cap Reductions on Aave V3 and Aave V4 / 2026.08.01",
    "Risk Stewards: Change of Supply and Borrow Caps on Aave V3 / 2026.07.05",
    "Risk Stewards: Change of Borrow and Draw Caps on Aave V4 - 2026-07-05"
  ])("suppresses a recognized cap-only title: %s", (title) => {
    expect(isRoutineAaveRiskStewardsCapChange(input(title))).toBe(true);
    expect(aaveRoutineCapNotificationPolicy.evaluate(input(title))).toEqual({
      action: "suppress",
      reason: AAVE_ROUTINE_CAP_NOTIFICATION_SKIP_REASON
    });
  });

  it("handles publisher and title case plus harmless surrounding whitespace", () => {
    expect(
      isRoutineAaveRiskStewardsCapChange(
        input(
          "  RISK   STEWARDS:   BORROW CAP INCREASES ON AAVE V3 / 2026.11.01  ",
          { publisherName: "  llamARisk  " }
        )
      )
    ).toBe(true);
  });

  it("recognizes an exact raw username alias when the display name differs", () => {
    expect(
      isRoutineAaveRiskStewardsCapChange(
        input(
          "Risk Stewards: Borrow Cap Increases on Aave V3 / 2026.11.01",
          {
            publisherName: "Llama Risk Team",
            publisherAliases: ["LlamaRisk"]
          }
        )
      )
    ).toBe(true);
  });

  it("canonicalizes only harmless spacing and punctuation in the publisher identity", () => {
    const title =
      "Risk Stewards: Borrow Cap Increases on Aave V3 / 2026.11.01";

    expect(
      isRoutineAaveRiskStewardsCapChange(
        input(title, { publisherName: "Llama Risk" })
      )
    ).toBe(true);
    expect(
      isRoutineAaveRiskStewardsCapChange(
        input(title, { publisherName: "Llama-Risk" })
      )
    ).toBe(true);
  });

  it.each([
    "Risk Stewards: Cap and IRM Changes on Aave V4 / 2026.11.03",
    "Risk Stewards: Cap Reductions and USDT IRM Change on Aave V3 / 2026.10.27",
    "Risk Stewards: PT Parameter Changes on Aave V3 / 2026.08.15",
    "Risk Stewards: Temporary Slope2 Reductions on Aave V3 / 2026.08.07",
    "Risk Stewards: JAAA Reserve Parameter Update on Aave V3 / 2026.07.20",
    "Risk Stewards: Oracle Changes on Aave V3 / 2026.11.03",
    "Risk Stewards: Supply Cap Increases and Oracle Change on Aave V3 / 2026.11.03",
    "Risk Stewards: Supply Cap Changes on Aave V3 and Oracle Changes / 2026.11.03",
    "Risk Stewards: Supply Cap Changes on Aave V3 plus another action / 2026.11.03",
    "Risk Stewards: Supply and Borrow Cap Changes on Aave V3",
    "Risk Stewards - Supply and Borrow Cap Changes on Aave V3 - 2026-11-03",
    "[ARFC] Supply and Borrow Cap Changes on Aave V3 / 2026.11.03",
    "Risk Stewards: Unexpected Cap Adjustment on Aave V3 / 2026.11.03",
    "Risk Stewards: Supply and Borrow Cap Changes on Ethereum / 2026.11.03",
    "Risk Stewards: Supply and Borrow Cap Changes on Aave V3 / 2026.13.01",
    "Risk Stewards: Supply and Borrow Cap Changes on Aave V3 / 2026.02.30"
  ])("fails open and keeps a non-routine or malformed title alertable: %s", (title) => {
    expect(isRoutineAaveRiskStewardsCapChange(input(title))).toBe(false);
    expect(aaveRoutineCapNotificationPolicy.evaluate(input(title))).toEqual({
      action: "notify"
    });
  });

  it.each([
    { protocol: "lido" },
    { protocol: "uniswap" },
    { sourceType: "onchain" },
    { sourceType: "snapshot" },
    { publisherName: "LlamaRis" },
    { publisherName: "LlamaRisk DAO" },
    { publisherName: "TokenLogic" },
    { publisherName: "" }
  ])("does not suppress outside the exact Aave forum publisher scope: %o", (overrides) => {
    expect(
      isRoutineAaveRiskStewardsCapChange(
        input(
          "Risk Stewards: Borrow Cap Increases on Aave V3 / 2026.11.01",
          overrides
        )
      )
    ).toBe(false);
  });

  it("still uses publisherName when an unrelated alias list is supplied", () => {
    expect(
      isRoutineAaveRiskStewardsCapChange(
        input(
          "Risk Stewards: Borrow Cap Increases on Aave V3 / 2026.11.01",
          { publisherAliases: ["Llama Risk Team"] }
        )
      )
    ).toBe(true);
  });
});
