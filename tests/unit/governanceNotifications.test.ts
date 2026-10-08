import { describe, expect, it } from "@jest/globals";
import {
  buildGovernanceLifecycleMessage,
  formatUtcTimestamp,
  formatUniVotes,
  governanceEventMessage
} from "../../src/onchain/governanceNotifications.js";
import { formatTelegramGovernanceMessage } from "../../src/notifications/telegramNotification.service.js";
import { createStoredGovernanceDecision } from "../helpers/onchainBuilders.js";

describe("on-chain governance notifications", () => {
  it.each([
    ["0", "0 UNI"],
    ["1000000000000000000", "1 UNI"],
    ["1234567890000000000000", "1,234.56 UNI"],
    ["1001000000000000000", "1 UNI"],
    ["999999999999999999999999999", "999,999,999.99 UNI"]
  ])("formats UNI base units %s as %s", (value, expected) => {
    expect(formatUniVotes(value)).toBe(expected);
  });

  it.each(["1.5", "not-a-number", "-1", "+1", " 1", ""])(
    "rejects malformed vote amount %p instead of displaying misleading data",
    (value) => {
      expect(() => formatUniVotes(value)).toThrow(
        "UNI vote amount must be a non-negative integer"
      );
    }
  );

  it("builds the creation notification from stored chain data", () => {
    const decision = createStoredGovernanceDecision({ proposalId: "100" });
    const message = buildGovernanceLifecycleMessage(decision, "created");

    expect(message).toEqual({
      kind: "lifecycle",
      heading: "NEW GOVERNANCE VOTE TRACKED",
      protocol: "uniswap",
      sourceType: "onchain",
      title: "Real Uniswap proposal #100",
      sourceUrl: "https://vote.uniswapfoundation.org/proposals/100",
      fields: [{ label: "Status", value: "Created" }]
    });
  });

  it.each([
    ["succeeded", "Succeeded"],
    ["defeated", "Defeated"]
  ] as const)("includes vote totals for a %s result", (transition, label) => {
    const message = buildGovernanceLifecycleMessage(
      createStoredGovernanceDecision({
        status: transition,
        votingEndedAt: "2026-09-10T14:35:00.000Z",
        forVotes: "46604583000000000000000000",
        againstVotes: "1274746000000000000000000",
        abstainVotes: "500000000000000000000"
      }),
      transition
    );

    expect(message.fields).toEqual(
      expect.arrayContaining([
        { label: "Status", value: label },
        { label: "Voting ended", value: "2026-09-10 14:35 UTC" },
        { label: "For", value: "46,604,583 UNI (97.34%)" },
        { label: "Against", value: "1,274,746 UNI (2.66%)" },
        { label: "Abstain", value: "500 UNI (0.01%)" }
      ])
    );
    expect(message.heading).toBe("ON-CHAIN GOVERNANCE VOTE RESULT");
  });

  it("uses integer-safe percentage rounding for equal vote shares", () => {
    const message = buildGovernanceLifecycleMessage(
      createStoredGovernanceDecision({
        status: "succeeded",
        forVotes: "1",
        againstVotes: "1",
        abstainVotes: "1"
      }),
      "succeeded"
    );

    expect(message.fields).toEqual(
      expect.arrayContaining([
        { label: "For", value: "0 UNI (33.33%)" },
        { label: "Against", value: "0 UNI (33.33%)" },
        { label: "Abstain", value: "0 UNI (33.33%)" }
      ])
    );
  });

  it("formats an all-zero vote without dividing by zero", () => {
    const message = buildGovernanceLifecycleMessage(
      createStoredGovernanceDecision({
        status: "defeated",
        forVotes: "0",
        againstVotes: "0",
        abstainVotes: "0"
      }),
      "defeated"
    );

    expect(message.fields).toEqual(
      expect.arrayContaining([
        { label: "For", value: "0 UNI (0.00%)" },
        { label: "Against", value: "0 UNI (0.00%)" },
        { label: "Abstain", value: "0 UNI (0.00%)" }
      ])
    );
  });

  it("shows a minimum 0.01% share for a non-zero vote amount", () => {
    const message = buildGovernanceLifecycleMessage(
      createStoredGovernanceDecision({
        status: "succeeded",
        forVotes: "999999999999999999999999",
        againstVotes: "0",
        abstainVotes: "1"
      }),
      "succeeded"
    );

    expect(message.fields).toEqual(
      expect.arrayContaining([
        { label: "For", value: "999,999.99 UNI (100.00%)" },
        { label: "Against", value: "0 UNI (0.00%)" },
        { label: "Abstain", value: "0 UNI (0.01%)" }
      ])
    );
  });

  it("rejects malformed stored vote totals before building a result message", () => {
    const decision = createStoredGovernanceDecision({
      status: "succeeded",
      againstVotes: "invalid"
    });

    expect(() => buildGovernanceLifecycleMessage(decision, "succeeded")).toThrow(
      "UNI vote amount must be a non-negative integer: invalid"
    );
  });

  it("formats canonical voting timestamps in an explicit UTC representation", () => {
    expect(formatUtcTimestamp("2026-09-10T04:05:00.000Z")).toBe(
      "2026-09-10 04:05 UTC"
    );
    expect(() => formatUtcTimestamp("2026-09-10 04:05")).toThrow(
      "must be canonical ISO-8601"
    );
  });

  it("keeps the existing forum shape unchanged and formats lifecycle messages separately", () => {
    const forumText = formatTelegramGovernanceMessage({
      protocol: "aave",
      sourceType: "forum",
      publisherName: "LlamaRisk",
      title: "Risk Stewards: Parameter Changes",
      sourceUrl: "https://governance.aave.com/t/example/1"
    });
    const lifecycleText = formatTelegramGovernanceMessage(
      buildGovernanceLifecycleMessage(
        createStoredGovernanceDecision({ title: "Fee activation <phase 2>" }),
        "executed"
      )
    );

    expect(forumText).toBe(
      "<b>NEW GOVERNANCE ITEM TRACKED</b>\n" +
        "Protocol: Aave\n" +
        "Source: Forum\n" +
        "Publisher: LlamaRisk\n" +
        "Title: Risk Stewards: Parameter Changes\n" +
        "Link: https://governance.aave.com/t/example/1"
    );
    expect(lifecycleText).toContain("<b>GOVERNANCE PROPOSAL EXECUTED</b>");
    expect(lifecycleText).toContain("Protocol: <b>UNISWAP</b>");
    expect(lifecycleText).not.toContain("Source:");
    expect(lifecycleText).not.toContain("Proposal:");
    expect(lifecycleText).not.toContain("Proposer:");
    expect(lifecycleText).toContain("Title: Fee activation &lt;phase 2&gt;");
    expect(lifecycleText).not.toContain("Publisher:");
  });

  it("rejects a corrupted persisted lifecycle message", () => {
    expect(() =>
      governanceEventMessage({
        id: "event",
        decisionId: "decision",
        sourceKey: "source",
        protocol: "uniswap",
        transition: "created",
        decisionStatus: "pending",
        blockNumber: 1,
        transactionHash: null,
        message: {
          protocol: "uniswap",
          sourceType: "forum",
          publisherName: "unexpected",
          title: "bad",
          sourceUrl: "https://example.com"
        },
        notificationStatus: "pending",
        firstSeenAt: "2026-09-01T00:00:00.000Z",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z"
      })
    ).toThrow("Governance event event has an invalid message kind.");
  });
});
