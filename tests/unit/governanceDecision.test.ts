import { describe, expect, it } from "@jest/globals";
import {
  assertValidGovernanceStatusTransition,
  createGovernanceDecisionId,
  createGovernanceLifecycleEventId,
  deriveGovernanceTransitions,
  extractGovernanceTitle,
  isTerminalGovernanceStatus,
  mergeGovernanceDecision,
  outcomesForStatus
} from "../../src/onchain/governanceDecision.js";
import type {
  GovernanceDecisionStatus,
  GovernanceTransitionType
} from "../../src/onchain/types.js";
import {
  createGovernanceObservation,
  createStoredGovernanceDecision,
  TEST_GOVERNOR_ADDRESS
} from "../helpers/onchainBuilders.js";

describe("on-chain governance decision model", () => {
  it("creates deterministic source-identity ids with case-insensitive addresses", () => {
    const first = createGovernanceDecisionId({
      protocol: "uniswap",
      chainId: 1,
      governorAddress: TEST_GOVERNOR_ADDRESS,
      proposalId: "100"
    });
    const second = createGovernanceDecisionId({
      protocol: "uniswap",
      chainId: 1,
      governorAddress: TEST_GOVERNOR_ADDRESS.toLowerCase(),
      proposalId: "100"
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^uniswap_onchain_1_100_[a-f0-9]{12}$/);
    expect(
      createGovernanceDecisionId({
        protocol: "uniswap",
        chainId: 1,
        governorAddress: TEST_GOVERNOR_ADDRESS,
        proposalId: "101"
      })
    ).not.toBe(first);
  });

  it("creates one deterministic id per decision lifecycle transition", () => {
    const decisionId = "uniswap_onchain_1_100_test";
    const created = createGovernanceLifecycleEventId(decisionId, "created");

    expect(created).toBe(
      createGovernanceLifecycleEventId(decisionId, "created")
    );
    expect(created).toMatch(/^governanceEvent_[a-f0-9]{24}$/);
    expect(createGovernanceLifecycleEventId(decisionId, "executed")).not.toBe(
      created
    );
  });

  it.each([
    ["# Enable protocol fees\nBody", "Enable protocol fees"],
    ["###   Governance Renewal  \nBody", "Governance Renewal"],
    ["**Treasury transfer**\nBody", "Treasury transfer"],
    ["\n\nPlain title\nBody", "Plain title"],
    ["\0\0Safe title", "Safe title"],
    [undefined, "Uniswap governance proposal #42"],
    ["\n\n", "Uniswap governance proposal #42"]
  ])("extracts a safe title from %p", (description, expected) => {
    expect(extractGovernanceTitle(description, "42")).toBe(expected);
  });

  it("bounds unusually long governance titles", () => {
    const title = extractGovernanceTitle("# " + "a".repeat(500), "42");

    expect(title).toHaveLength(300);
    expect(title.endsWith("...")).toBe(true);
  });

  it.each<[
    GovernanceDecisionStatus,
    ReturnType<typeof outcomesForStatus>
  ]>([
    ["pending", { voteOutcome: "pending", executionOutcome: "not_started" }],
    ["active", { voteOutcome: "pending", executionOutcome: "not_started" }],
    ["canceled", { voteOutcome: "canceled", executionOutcome: "canceled" }],
    ["defeated", { voteOutcome: "defeated", executionOutcome: "not_started" }],
    ["succeeded", { voteOutcome: "succeeded", executionOutcome: "awaiting_queue" }],
    ["queued", { voteOutcome: "succeeded", executionOutcome: "queued" }],
    ["expired", { voteOutcome: "succeeded", executionOutcome: "expired" }],
    ["executed", { voteOutcome: "succeeded", executionOutcome: "executed" }]
  ])("maps %s to explicit vote and execution outcomes", (status, expected) => {
    expect(outcomesForStatus(status)).toEqual(expected);
  });

  it.each<GovernanceDecisionStatus>(["canceled", "executed"])(
    "recognizes %s as terminal",
    (status) => {
    expect(isTerminalGovernanceStatus(status)).toBe(true);
    }
  );

  it.each<GovernanceDecisionStatus>([
    "pending",
    "active",
    "defeated",
    "succeeded",
    "queued",
    "expired"
  ])("recognizes %s as refreshable", (status) => {
    expect(isTerminalGovernanceStatus(status)).toBe(false);
  });

  it.each<[
    GovernanceDecisionStatus,
    GovernanceDecisionStatus,
    GovernanceTransitionType[]
  ]>([
    ["pending", "active", []],
    ["active", "succeeded", ["succeeded"]],
    ["active", "queued", ["succeeded", "queued"]],
    ["active", "executed", ["succeeded", "queued", "executed"]],
    ["succeeded", "queued", ["queued"]],
    ["succeeded", "expired", ["queued", "expired"]],
    ["queued", "executed", ["executed"]],
    ["active", "defeated", ["defeated"]],
    ["pending", "canceled", ["canceled"]],
    ["defeated", "canceled", ["canceled"]],
    ["expired", "canceled", ["canceled"]]
  ])(
    "derives the complete lifecycle for %s -> %s",
    (previousStatus, currentStatus, expected) => {
      expect(
        deriveGovernanceTransitions(
          createStoredGovernanceDecision({ status: previousStatus }),
          createStoredGovernanceDecision({ status: currentStatus })
        )
      ).toEqual(expected);
    }
  );

  it("enforces the complete Governor Bravo status-transition matrix", () => {
    const statuses: GovernanceDecisionStatus[] = [
      "pending",
      "active",
      "canceled",
      "defeated",
      "succeeded",
      "queued",
      "expired",
      "executed"
    ];
    const expected = new Map<string, GovernanceTransitionType[]>([
      ["pending:active", []],
      ["pending:canceled", ["canceled"]],
      ["pending:defeated", ["defeated"]],
      ["pending:succeeded", ["succeeded"]],
      ["pending:queued", ["succeeded", "queued"]],
      ["pending:expired", ["succeeded", "queued", "expired"]],
      ["pending:executed", ["succeeded", "queued", "executed"]],
      ["active:canceled", ["canceled"]],
      ["active:defeated", ["defeated"]],
      ["active:succeeded", ["succeeded"]],
      ["active:queued", ["succeeded", "queued"]],
      ["active:expired", ["succeeded", "queued", "expired"]],
      ["active:executed", ["succeeded", "queued", "executed"]],
      ["succeeded:canceled", ["canceled"]],
      ["succeeded:queued", ["queued"]],
      ["succeeded:expired", ["queued", "expired"]],
      ["succeeded:executed", ["queued", "executed"]],
      ["queued:canceled", ["canceled"]],
      ["queued:expired", ["expired"]],
      ["queued:executed", ["executed"]],
      ["defeated:canceled", ["canceled"]],
      ["expired:canceled", ["canceled"]]
    ]);

    for (const previousStatus of statuses) {
      for (const currentStatus of statuses) {
        const key = `${previousStatus}:${currentStatus}`;
        const previous = createStoredGovernanceDecision({
          status: previousStatus
        });
        const current = createStoredGovernanceDecision({ status: currentStatus });

        if (previousStatus === currentStatus) {
          expect(deriveGovernanceTransitions(previous, current)).toEqual([]);
        } else if (expected.has(key)) {
          expect(deriveGovernanceTransitions(previous, current)).toEqual(
            expected.get(key)
          );
        } else {
          expect(() => deriveGovernanceTransitions(previous, current)).toThrow(
            `Invalid governance status transition: ${previousStatus} -> ${currentStatus}`
          );
        }
      }
    }
  });

  it.each<[GovernanceDecisionStatus, GovernanceTransitionType[]]>([
    ["pending", ["created"]],
    ["active", ["created"]],
    ["canceled", ["created", "canceled"]],
    ["defeated", ["created", "defeated"]],
    ["succeeded", ["created", "succeeded"]],
    ["queued", ["created", "succeeded", "queued"]],
    ["expired", ["created", "succeeded", "queued", "expired"]],
    ["executed", ["created", "succeeded", "queued", "executed"]]
  ])(
    "reconstructs all implied lifecycle events for a newly observed %s proposal",
    (status, expected) => {
      expect(
        deriveGovernanceTransitions(
          null,
          createStoredGovernanceDecision({ status })
        )
      ).toEqual(expected);
    }
  );

  it.each(["pending", "active"] as const)(
    "preserves a canonical queue when a %s proposal is canceled between polls",
    (previousStatus) => {
      const previous = createStoredGovernanceDecision({
        status: previousStatus,
        queuedBlockNumber: null,
        queuedTransactionHash: null
      });
      const current = createStoredGovernanceDecision({
        status: "canceled",
        queuedBlockNumber: 180,
        queuedTransactionHash: `0x${"33".repeat(32)}`
      });

      expect(deriveGovernanceTransitions(previous, current)).toEqual([
        "succeeded",
        "queued",
        "canceled"
      ]);
    }
  );

  it("preserves a queue observed after a succeeded vote and before cancellation", () => {
    expect(
      deriveGovernanceTransitions(
        createStoredGovernanceDecision({
          status: "succeeded",
          queuedBlockNumber: null,
          queuedTransactionHash: null
        }),
        createStoredGovernanceDecision({
          status: "canceled",
          queuedBlockNumber: 180,
          queuedTransactionHash: `0x${"33".repeat(32)}`
        })
      )
    ).toEqual(["queued", "canceled"]);
  });

  it("reconstructs a historical queued-then-canceled proposal", () => {
    expect(
      deriveGovernanceTransitions(
        null,
        createStoredGovernanceDecision({
          status: "canceled",
          queuedBlockNumber: 180,
          queuedTransactionHash: `0x${"33".repeat(32)}`
        })
      )
    ).toEqual(["created", "succeeded", "queued", "canceled"]);
  });

  it("reconstructs a queued-then-canceled lifecycle from a retained ETA", () => {
    const current = createStoredGovernanceDecision({
      status: "canceled",
      eta: "1789000000",
      queuedBlockNumber: null,
      queuedTransactionHash: null
    });

    expect(deriveGovernanceTransitions(null, current)).toEqual([
      "created",
      "succeeded",
      "queued",
      "canceled"
    ]);
  });

  it("does not recreate a queue transition that was already observed", () => {
    expect(
      deriveGovernanceTransitions(
        createStoredGovernanceDecision({
          status: "queued",
          queuedBlockNumber: 180,
          queuedTransactionHash: `0x${"33".repeat(32)}`
        }),
        createStoredGovernanceDecision({
          status: "canceled",
          queuedBlockNumber: 180,
          queuedTransactionHash: `0x${"33".repeat(32)}`
        })
      )
    ).toEqual(["canceled"]);
  });

  it("records a successful vote when a historical canceled proposal retains an ETA", () => {
    const result = mergeGovernanceDecision(
      null,
      createGovernanceObservation({
        status: "canceled",
        eta: "1789000000",
        lastObservedBlockNumber: 200
      }),
      "2026-09-02T00:00:00.000Z"
    );

    expect(result.decision).toMatchObject({
      status: "canceled",
      voteOutcome: "succeeded",
      executionOutcome: "canceled",
      eta: "1789000000"
    });
    expect(deriveGovernanceTransitions(null, result.decision)).toEqual([
      "created",
      "succeeded",
      "queued",
      "canceled"
    ]);
  });

  it.each(["succeeded", "defeated"] as const)(
    "preserves a previously observed %s vote when the proposal is later canceled",
    (voteStatus) => {
      const existing = createStoredGovernanceDecision({
        status: voteStatus,
        lastObservedBlockNumber: 120
      });
      const result = mergeGovernanceDecision(
        existing,
        createGovernanceObservation({
          status: "canceled",
          lastObservedBlockNumber: 130
        }),
        "2026-09-02T00:00:00.000Z"
      );

      expect(result.decision.voteOutcome).toBe(voteStatus);
      expect(result.decision.executionOutcome).toBe("canceled");
      expect(deriveGovernanceTransitions(existing, result.decision)).toEqual([
        "canceled"
      ]);
    }
  );

  it("rejects queue evidence after a previously observed defeated vote", () => {
    expect(() =>
      mergeGovernanceDecision(
        createStoredGovernanceDecision({
          status: "defeated",
          lastObservedBlockNumber: 120
        }),
        createGovernanceObservation({
          status: "canceled",
          eta: "1789000000",
          lastObservedBlockNumber: 130
        }),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow("defeated governance proposal cannot later contain queue evidence");
  });

  it("does not hide an invalid execution outcome while normalizing cancellation", () => {
    expect(() =>
      mergeGovernanceDecision(
        null,
        createGovernanceObservation({
          status: "canceled",
          executionOutcome: "not_started"
        }),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow("outcomes do not match status canceled");
  });

  it.each(["succeeded", "defeated"] as const)(
    "preserves an inferred %s result in a newly observed canceled proposal",
    (voteOutcome) => {
      const current = mergeGovernanceDecision(
        null,
        createGovernanceObservation({
          status: "canceled",
          voteOutcome,
          lastObservedBlockNumber: 130
        }),
        "2026-09-02T00:00:00.000Z"
      ).decision;

      expect(current.voteOutcome).toBe(voteOutcome);
      expect(deriveGovernanceTransitions(null, current)).toEqual([
        "created",
        voteOutcome,
        "canceled"
      ]);
    }
  );

  it.each(["succeeded", "defeated"] as const)(
    "emits a missed %s result when canonical cancellation metadata arrives later",
    (voteOutcome) => {
      const previous = createStoredGovernanceDecision({
        status: "canceled",
        voteOutcome: "canceled"
      });
      const current = createStoredGovernanceDecision({
        status: "canceled",
        voteOutcome
      });

      expect(deriveGovernanceTransitions(previous, current)).toEqual([
        voteOutcome
      ]);
    }
  );

  it("validates chronology again after merging old and new lifecycle references", () => {
    expect(() =>
      mergeGovernanceDecision(
        createStoredGovernanceDecision({
          status: "active",
          createdBlockNumber: 101,
          createdTransactionHash: `0x${"11".repeat(32)}`
        }),
        createGovernanceObservation({
          status: "canceled",
          createdBlockNumber: undefined,
          createdTransactionHash: undefined,
          canceledBlockNumber: 100,
          canceledTransactionHash: `0x${"33".repeat(32)}`
        }),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow("canceled block cannot precede its creation block");
  });

  it.each([
    ["executed", "active"],
    ["defeated", "succeeded"],
    ["canceled", "queued"],
    ["queued", "succeeded"],
    ["succeeded", "active"]
  ] as Array<[GovernanceDecisionStatus, GovernanceDecisionStatus]>)(
    "rejects impossible or regressive status transition %s -> %s",
    (previous, current) => {
      expect(() => assertValidGovernanceStatusTransition(previous, current)).toThrow(
        `Invalid governance status transition: ${previous} -> ${current}`
      );
    }
  );

  it("preserves immutable timestamps and detects meaningful updates", () => {
    const original = createStoredGovernanceDecision({
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      lastSyncedAt: "2026-08-01T00:00:00.000Z"
    });
    const result = mergeGovernanceDecision(
      original,
      createGovernanceObservation({
        title: "Updated proposal title",
        lastObservedBlockNumber: 200
      }),
      "2026-09-01T00:00:00.000Z"
    );

    expect(result).toMatchObject({ created: false, updated: true });
    expect(result.decision).toMatchObject({
      title: "Updated proposal title",
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      lastSyncedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    });
  });

  it("does not rewrite a decision when only observation metadata changes", () => {
    const existing = createStoredGovernanceDecision();
    const result = mergeGovernanceDecision(
      existing,
      createGovernanceObservation({ lastObservedBlockNumber: 999 }),
      "2026-09-02T00:00:00.000Z"
    );

    expect(result).toEqual({
      decision: existing,
      created: false,
      updated: false
    });
  });

  it("persists increasing vote totals without emitting a lifecycle transition", () => {
    const existing = createStoredGovernanceDecision({
      status: "active",
      forVotes: "100",
      againstVotes: "20",
      abstainVotes: "3",
      lastObservedBlockNumber: 130
    });
    const result = mergeGovernanceDecision(
      existing,
      createGovernanceObservation({
        status: "active",
        forVotes: "125",
        againstVotes: "21",
        abstainVotes: "3",
        lastObservedBlockNumber: 140
      }),
      "2026-09-02T00:00:00.000Z"
    );

    expect(result).toMatchObject({ created: false, updated: true });
    expect(result.decision).toMatchObject({
      forVotes: "125",
      againstVotes: "21",
      abstainVotes: "3",
      lastObservedBlockNumber: 140
    });
    expect(deriveGovernanceTransitions(existing, result.decision)).toEqual([]);
  });

  it.each([
    ["forVotes", { forVotes: "99" }],
    ["againstVotes", { againstVotes: "19" }],
    ["abstainVotes", { abstainVotes: "2" }]
  ] as const)("rejects a regression in %s", (field, override) => {
    const existing = createStoredGovernanceDecision({
      status: "active",
      forVotes: "100",
      againstVotes: "20",
      abstainVotes: "3",
      lastObservedBlockNumber: 130
    });

    expect(() =>
      mergeGovernanceDecision(
        existing,
        createGovernanceObservation({
          status: "active",
          forVotes: "100",
          againstVotes: "20",
          abstainVotes: "3",
          lastObservedBlockNumber: 140,
          ...override
        }),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow(`Governance proposal ${field} regressed`);
  });

  it("rejects a regression in the finalized observation block", () => {
    expect(() =>
      mergeGovernanceDecision(
        createStoredGovernanceDecision({ lastObservedBlockNumber: 140 }),
        createGovernanceObservation({ lastObservedBlockNumber: 139 }),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow("observation block regressed from 140 to 139");
  });

  it.each([
    ["proposer", { proposer: "0x0000000000000000000000000000000000000002" }],
    ["voting window", { endBlock: 111 }],
    [
      "actions",
      {
        actions: [
          {
            index: 0,
            target: "0x0000000000000000000000000000000000000002",
            value: "0",
            signature: "setValue(uint256)",
            calldata: "0x01"
          }
        ]
      }
    ],
    ["source URL", { sourceUrl: "https://example.com/wrong" }]
  ] as const)("rejects changes to immutable proposal %s", (_field, override) => {
    expect(() =>
      mergeGovernanceDecision(
        createStoredGovernanceDecision(),
        createGovernanceObservation(override),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow(/cannot change/);
  });

  it("allows an ETA to be established once but never changed or removed", () => {
    const succeeded = createStoredGovernanceDecision({
      status: "succeeded",
      eta: null
    });
    const queued = mergeGovernanceDecision(
      succeeded,
      createGovernanceObservation({ status: "queued", eta: "1789000000" }),
      "2026-09-02T00:00:00.000Z"
    ).decision;

    expect(queued.eta).toBe("1789000000");
    expect(() =>
      mergeGovernanceDecision(
        queued,
        createGovernanceObservation({ status: "queued", eta: "1789000001" }),
        "2026-09-03T00:00:00.000Z"
      )
    ).toThrow("ETA cannot change once queued");
    expect(() =>
      mergeGovernanceDecision(
        queued,
        createGovernanceObservation({ status: "queued", eta: null }),
        "2026-09-03T00:00:00.000Z"
      )
    ).toThrow("ETA cannot change once queued");
  });

  it("preserves an established voting end timestamp and rejects changes", () => {
    const votingEndedAt = "2026-09-10T14:35:00.000Z";
    const existing = createStoredGovernanceDecision({
      status: "succeeded",
      votingEndedAt
    });
    const preserved = mergeGovernanceDecision(
      existing,
      createGovernanceObservation({ status: "succeeded" }),
      "2026-09-11T00:00:00.000Z"
    ).decision;

    expect(preserved.votingEndedAt).toBe(votingEndedAt);
    expect(() =>
      mergeGovernanceDecision(
        existing,
        createGovernanceObservation({
          status: "succeeded",
          votingEndedAt: "2026-09-10T14:36:00.000Z"
        }),
        "2026-09-11T00:00:00.000Z"
      )
    ).toThrow("voting end timestamp cannot change");
  });

  it.each([
    ["unknown status", { status: "unknown" }, "Invalid governance decision status"],
    ["status/outcome mismatch", { voteOutcome: "defeated" }, "outcomes do not match"],
    ["zero proposal id", { proposalId: "0" }, "proposal id must be a positive integer"],
    ["reversed voting window", { endBlock: 102 }, "end block must be after"],
    ["invalid ETA", { eta: "-1" }, "proposal eta must be a non-negative integer"],
    [
      "invalid voting end timestamp",
      { votingEndedAt: "2026-09-10 14:35" },
      "voting end timestamp is invalid"
    ],
    [
      "voting end timestamp before a final result",
      { votingEndedAt: "2026-09-10T14:35:00.000Z" },
      "voting end timestamp requires a final vote outcome"
    ],
    ["invalid vote total", { forVotes: "1.5" }, "proposal forVotes must be a non-negative integer"],
    ["non-array actions", { actions: undefined }, "actions must be an array"],
    ["malformed action", { actions: [null] }, "action 0 is malformed"],
    [
      "non-contiguous action index",
      { actions: [{ ...createGovernanceObservation().actions[0], index: 1 }] },
      "action index 1 does not match position 0"
    ],
    [
      "invalid action target",
      { actions: [{ ...createGovernanceObservation().actions[0], target: "0xbad" }] },
      "action 0 target is invalid"
    ],
    [
      "invalid action value",
      { actions: [{ ...createGovernanceObservation().actions[0], value: "-1" }] },
      "action 0 value must be a non-negative integer"
    ],
    [
      "invalid action signature",
      { actions: [{ ...createGovernanceObservation().actions[0], signature: 123 }] },
      "action 0 signature is invalid"
    ],
    [
      "invalid action calldata",
      { actions: [{ ...createGovernanceObservation().actions[0], calldata: "0x1" }] },
      "action 0 calldata is invalid"
    ],
    [
      "unpaired transaction reference",
      { queuedBlockNumber: 180 },
      "queued block and transaction must be recorded together"
    ],
    [
      "invalid transaction hash",
      { queuedBlockNumber: 180, queuedTransactionHash: "0xbad" },
      "queued transaction hash is invalid"
    ],
    [
      "invalid lifecycle block",
      {
        queuedBlockNumber: -1,
        queuedTransactionHash: `0x${"22".repeat(32)}`
      },
      "queued block must be a non-negative safe integer"
    ],
    [
      "cancellation reference without canceled state",
      {
        canceledBlockNumber: 109,
        canceledTransactionHash: `0x${"33".repeat(32)}`
      },
      "cancellation reference is incompatible with status pending"
    ],
    [
      "queue reference before a queued state",
      {
        queuedBlockNumber: 109,
        queuedTransactionHash: `0x${"33".repeat(32)}`
      },
      "queue reference is incompatible with status pending"
    ],
    [
      "execution reference before execution",
      {
        status: "queued",
        eta: "1789000000",
        queuedBlockNumber: 108,
        queuedTransactionHash: `0x${"33".repeat(32)}`,
        executedBlockNumber: 109,
        executedTransactionHash: `0x${"44".repeat(32)}`
      },
      "execution reference is incompatible with status queued"
    ],
    [
      "future creation block",
      { createdBlockNumber: 121 },
      "created block cannot be after its observation block"
    ],
    [
      "cancellation before creation",
      {
        status: "canceled",
        canceledBlockNumber: 100,
        canceledTransactionHash: `0x${"33".repeat(32)}`
      },
      "canceled block cannot precede its creation block"
    ],
    [
      "execution before queue",
      {
        status: "executed",
        eta: "1789000000",
        queuedBlockNumber: 180,
        queuedTransactionHash: `0x${"33".repeat(32)}`,
        executedBlockNumber: 179,
        executedTransactionHash: `0x${"44".repeat(32)}`,
        lastObservedBlockNumber: 200
      },
      "executed block cannot precede its queue block"
    ]
  ] as const)("rejects a malformed observation: %s", (_name, override, message) => {
    expect(() =>
      mergeGovernanceDecision(
        null,
        createGovernanceObservation(override as never),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow(message);
  });

  it.each([
    ["id", { id: "other-id" }],
    ["sourceKey", { sourceKey: "other-source" }],
    ["protocol", { protocol: "other" }],
    ["chainId", { chainId: 10 }],
    ["governorAddress", { governorAddress: "0x0000000000000000000000000000000000000002" }],
    [
      "proposalId",
      {
        proposalId: "2",
        id: createGovernanceDecisionId({
          protocol: "uniswap",
          chainId: 1,
          governorAddress: TEST_GOVERNOR_ADDRESS,
          proposalId: "1"
        })
      }
    ]
  ] as const)("rejects changes to identity field %s", (field, override) => {
    expect(() =>
      mergeGovernanceDecision(
        createStoredGovernanceDecision(),
        createGovernanceObservation(override),
        "2026-09-02T00:00:00.000Z"
      )
    ).toThrow(`Governance decision identity field ${field} cannot change.`);
  });
});
