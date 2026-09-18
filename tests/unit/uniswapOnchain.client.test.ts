import { describe, expect, it, jest } from "@jest/globals";
import type { PublicClient } from "viem";
import {
  UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK,
  UNISWAP_ONCHAIN_LOG_BLOCK_RANGE,
  UniswapOnchainClient
} from "../../src/onchain/uniswap/uniswapOnchain.client.js";
import {
  createGovernanceContractEvent,
  createStoredGovernanceDecision,
  TEST_GOVERNOR_ADDRESS,
  TEST_IMPLEMENTATION_ADDRESS,
  TEST_PROPOSER_ADDRESS,
  TEST_TARGET_ADDRESS,
  TEST_TIMELOCK_ADDRESS,
  TEST_UNI_ADDRESS
} from "../helpers/onchainBuilders.js";

const HASH_A = `0x${"aa".repeat(32)}` as const;
const HASH_B = `0x${"bb".repeat(32)}` as const;
const HASH_C = `0x${"cc".repeat(32)}` as const;

function createPublicClientMock() {
  const values: Record<string, unknown> = {
    timelock: TEST_TIMELOCK_ADDRESS,
    uni: TEST_UNI_ADDRESS,
    implementation: TEST_IMPLEMENTATION_ADDRESS,
    proposalCount: 100n,
    initialProposalId: 8n,
    votingDelay: 13_140n,
    votingPeriod: 40_320n,
    proposalThreshold: 1_000_000n * 10n ** 18n,
    quorumVotes: 40_000_000n * 10n ** 18n,
    state: 7,
    proposals: [
      100n,
      TEST_PROPOSER_ADDRESS,
      1_785_000_000n,
      25_500_000n,
      25_540_320n,
      46_604_583n * 10n ** 18n,
      1_274_746n * 10n ** 18n,
      500n * 10n ** 18n,
      false,
      true
    ] as const,
    getActions: [
      [TEST_TARGET_ADDRESS],
      [0n],
      ["setFeeProtocol(uint8)"],
      ["0x01"]
    ] as const
  };
  const getChainId = jest.fn(async () => 1);
  const getBlock = jest.fn(async (input?: { blockNumber?: bigint }) => ({
    number: input?.blockNumber ?? 25_981_000n,
    hash: HASH_A,
    timestamp: 1_789_000_000n
  }));
  const getCode = jest.fn(async () => "0x6001600055" as const);
  const readContract = jest.fn(async (input: { functionName: string }) =>
    values[input.functionName]
  );
  const getLogs = jest.fn(async () => [] as unknown[]);
  const client = {
    getChainId,
    getBlock,
    getCode,
    readContract,
    getLogs
  } as unknown as PublicClient;

  return {
    client,
    values,
    getChainId,
    getBlock,
    getCode,
    readContract,
    getLogs
  };
}

function createClient(mock = createPublicClientMock()) {
  return {
    mock,
    client: new UniswapOnchainClient({
      governorAddress: TEST_GOVERNOR_ADDRESS,
      timelockAddress: TEST_TIMELOCK_ADDRESS,
      uniTokenAddress: TEST_UNI_ADDRESS,
      publicClient: mock.client
    })
  };
}

function rawCreatedLog(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "ProposalCreated",
    args: {
      id: 100n,
      proposer: TEST_PROPOSER_ADDRESS,
      targets: [TEST_TARGET_ADDRESS],
      values: [0n],
      signatures: ["setFeeProtocol(uint8)"],
      calldatas: ["0x01"],
      startBlock: 25_500_000n,
      endBlock: 25_540_320n,
      description: "# Activate v4 Protocol Fees (Part 1/2)\n\nProposal body"
    },
    blockNumber: 25_498_000n,
    blockHash: HASH_A,
    transactionHash: HASH_B,
    logIndex: 4,
    ...overrides
  };
}

function updateProposalTuple(
  setup: ReturnType<typeof createPublicClientMock>,
  values: Partial<{
    eta: bigint;
    startBlock: bigint;
    endBlock: bigint;
    forVotes: bigint;
    againstVotes: bigint;
    abstainVotes: bigint;
    canceled: boolean;
    executed: boolean;
  }>
): void {
  const proposal = [...(setup.values.proposals as readonly unknown[])];

  if (values.eta !== undefined) proposal[2] = values.eta;
  if (values.startBlock !== undefined) proposal[3] = values.startBlock;
  if (values.endBlock !== undefined) proposal[4] = values.endBlock;
  if (values.forVotes !== undefined) proposal[5] = values.forVotes;
  if (values.againstVotes !== undefined) proposal[6] = values.againstVotes;
  if (values.abstainVotes !== undefined) proposal[7] = values.abstainVotes;
  if (values.canceled !== undefined) proposal[8] = values.canceled;
  if (values.executed !== undefined) proposal[9] = values.executed;
  setup.values.proposals = proposal;
}

function createGovernanceObservationActions() {
  return [
    {
      index: 0,
      target: TEST_TARGET_ADDRESS,
      value: "0",
      signature: "setFeeProtocol(uint8)",
      calldata: "0x01"
    }
  ];
}

describe("UniswapOnchainClient", () => {
  it("requires an RPC transport when no public client is injected", () => {
    expect(
      () =>
        new UniswapOnchainClient({
          governorAddress: TEST_GOVERNOR_ADDRESS,
          timelockAddress: TEST_TIMELOCK_ADDRESS,
          uniTokenAddress: TEST_UNI_ADDRESS
        })
    ).toThrow("requires an Ethereum RPC URL");
  });

  it("validates chain, contract code, proxy relationships, and governance parameters", async () => {
    const { client, mock } = createClient();

    const result = await client.validateSource();

    expect(result).toEqual({
      chainId: 1,
      latestFinalizedBlock: {
        number: 25_981_000,
        hash: HASH_A,
        timestamp: "2026-09-10T00:26:40.000Z"
      },
      implementationAddress: TEST_IMPLEMENTATION_ADDRESS,
      proposalCount: "100",
      initialProposalId: "8",
      votingDelay: "13140",
      votingPeriod: "40320",
      proposalThreshold: "1000000000000000000000000",
      quorumVotes: "40000000000000000000000000"
    });
    expect(mock.getCode).toHaveBeenCalledTimes(4);
    expect(mock.readContract).toHaveBeenCalledTimes(9);
    for (const [request] of mock.getCode.mock.calls) {
      expect(request).toMatchObject({ blockNumber: 25_981_000n });
    }
    for (const [request] of mock.readContract.mock.calls) {
      expect(request).toMatchObject({ blockNumber: 25_981_000n });
    }
  });

  it("rejects a non-mainnet RPC before trusting any scan", async () => {
    const setup = createPublicClientMock();
    setup.getChainId.mockResolvedValueOnce(10);
    const { client } = createClient(setup);

    await expect(client.validateSource()).rejects.toThrow(
      "must use Ethereum mainnet chain id 1; received 10"
    );
    expect(setup.getCode).not.toHaveBeenCalled();
    expect(setup.readContract).not.toHaveBeenCalled();
  });

  it.each([
    ["GovernorBravo", 0],
    ["Timelock", 1],
    ["UNI token", 2],
    ["Governor implementation", 3]
  ] as const)("rejects missing %s bytecode", async (name, callIndex) => {
    const setup = createPublicClientMock();
    setup.getCode.mockImplementation(async (_input: unknown) => {
      const index = setup.getCode.mock.calls.length - 1;
      return index === callIndex ? "0x" : "0x6001";
    });
    const { client } = createClient(setup);

    await expect(client.validateSource()).rejects.toThrow(
      `${name} contract has no bytecode`
    );
  });

  it("rejects mismatched configured Timelock and UNI relationships", async () => {
    const timelockSetup = createPublicClientMock();
    timelockSetup.values.timelock = "0x0000000000000000000000000000000000000002";
    await expect(createClient(timelockSetup).client.validateSource()).rejects.toThrow(
      "Governor Timelock address mismatch"
    );

    const uniSetup = createPublicClientMock();
    uniSetup.values.uni = "0x0000000000000000000000000000000000000002";
    await expect(createClient(uniSetup).client.validateSource()).rejects.toThrow(
      "Governor UNI token address mismatch"
    );
  });

  it.each([
    ["proposalCount", "Governor proposalCount"],
    ["initialProposalId", "Governor initialProposalId"],
    ["votingDelay", "Governor votingDelay"],
    ["votingPeriod", "Governor votingPeriod"],
    ["proposalThreshold", "Governor proposalThreshold"],
    ["quorumVotes", "Governor quorumVotes"]
  ] as const)("rejects malformed or negative %s values", async (field, label) => {
    const setup = createPublicClientMock();
    setup.values[field] = -1n;

    await expect(createClient(setup).client.validateSource()).rejects.toThrow(
      `${label} must be a non-negative integer`
    );

    setup.values[field] = "1";
    await expect(createClient(setup).client.validateSource()).rejects.toThrow(
      `${label} must be a non-negative integer`
    );
  });

  it("rejects an impossible proposal counter relationship", async () => {
    const setup = createPublicClientMock();
    setup.values.proposalCount = 7n;
    setup.values.initialProposalId = 8n;

    await expect(createClient(setup).client.validateSource()).rejects.toThrow(
      "proposalCount 7 is below initialProposalId 8"
    );
  });

  it("rejects a finalized chain head from before Governor deployment", async () => {
    const setup = createPublicClientMock();
    setup.getBlock.mockResolvedValueOnce({
      number: BigInt(UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK - 1),
      hash: HASH_A,
      timestamp: 1_789_000_000n
    } as never);

    await expect(createClient(setup).client.validateSource()).rejects.toThrow(
      "predates the Uniswap Governor deployment block"
    );
    expect(setup.getCode).not.toHaveBeenCalled();
    expect(setup.readContract).not.toHaveBeenCalled();
  });

  it("normalizes and sorts all tracked Governor Bravo event types", async () => {
    const setup = createPublicClientMock();
    setup.getLogs.mockResolvedValueOnce([
      {
        eventName: "ProposalExecuted",
        args: { id: 100n },
        blockNumber: 25_500_000n,
        blockHash: HASH_C,
        transactionHash: HASH_C,
        logIndex: 2
      },
      rawCreatedLog(),
      {
        eventName: "ProposalCanceled",
        args: { id: 99n },
        blockNumber: 25_499_000n,
        blockHash: HASH_B,
        transactionHash: HASH_C,
        logIndex: 1
      },
      {
        eventName: "ProposalQueued",
        args: { id: 100n, eta: 1_785_000_000n },
        blockNumber: 25_499_500n,
        blockHash: HASH_B,
        transactionHash: HASH_A,
        logIndex: 1
      }
    ] as never);
    const { client } = createClient(setup);

    const events = await client.getEvents(25_490_001, 25_500_000);

    expect(events.map((event) => event.type)).toEqual([
      "created",
      "canceled",
      "queued",
      "executed"
    ]);
    expect(events[0]).toMatchObject({
      id: `${HASH_B}:4`,
      proposalId: "100",
      proposer: TEST_PROPOSER_ADDRESS,
      description: "# Activate v4 Protocol Fees (Part 1/2)\n\nProposal body",
      actions: [
        {
          index: 0,
          target: TEST_TARGET_ADDRESS,
          value: "0",
          signature: "setFeeProtocol(uint8)",
          calldata: "0x01"
        }
      ]
    });
    expect(events[2]).toMatchObject({ type: "queued", eta: "1785000000" });
  });

  it("deduplicates identical provider logs and rejects conflicting duplicates", async () => {
    const repeated = rawCreatedLog();
    const exact = createPublicClientMock();
    exact.getLogs.mockResolvedValueOnce([repeated, repeated] as never);

    await expect(
      createClient(exact).client.getEvents(25_490_001, 25_500_000)
    ).resolves.toHaveLength(1);

    const conflicting = createPublicClientMock();
    conflicting.getLogs.mockResolvedValueOnce([
      repeated,
      rawCreatedLog({
        args: {
          ...rawCreatedLog().args,
          description: "# Conflicting payload"
        }
      })
    ] as never);

    await expect(
      createClient(conflicting).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("conflicting governance event");
  });

  it("rejects a provider log outside the exact requested range", async () => {
    const setup = createPublicClientMock();
    setup.getLogs.mockResolvedValueOnce([
      rawCreatedLog({ blockNumber: 25_500_001n })
    ] as never);

    await expect(
      createClient(setup).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("outside requested block range");
  });

  it("enforces deployment and provider block-range boundaries", async () => {
    const { client } = createClient();

    await expect(
      client.getEvents(UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK - 1, UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK)
    ).rejects.toThrow("cannot start before deployment block");
    await expect(
      client.getEvents(
        UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK + 1,
        UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK
      )
    ).rejects.toThrow(
      "range end must not precede start"
    );
    await expect(
      client.getEvents(
        UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK,
        UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK + UNISWAP_ONCHAIN_LOG_BLOCK_RANGE
      )
    ).rejects.toThrow(`exceeds ${UNISWAP_ONCHAIN_LOG_BLOCK_RANGE} blocks`);
  });

  it.each([
    [-1, UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK],
    [1.5, UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK],
    [UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK, Number.MAX_SAFE_INTEGER + 1]
  ])("rejects unsafe log range %s..%s before calling the provider", async (from, to) => {
    const setup = createPublicClientMock();
    const { client } = createClient(setup);

    await expect(client.getEvents(from, to)).rejects.toThrow(
      "must be a non-negative safe integer"
    );
    expect(setup.getLogs).not.toHaveBeenCalled();
  });

  it("rejects unconfirmed, malformed, and unsupported event logs", async () => {
    const unconfirmed = createPublicClientMock();
    unconfirmed.getLogs.mockResolvedValueOnce([
      rawCreatedLog({ blockHash: null })
    ] as never);
    await expect(
      createClient(unconfirmed).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("unconfirmed event log");

    const unsupported = createPublicClientMock();
    unsupported.getLogs.mockResolvedValueOnce([
      rawCreatedLog({ eventName: "VoteCast" })
    ] as never);
    await expect(
      createClient(unsupported).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("Unsupported Uniswap governance event: VoteCast");

    const invalidId = createPublicClientMock();
    invalidId.getLogs.mockResolvedValueOnce([
      rawCreatedLog({ args: { ...rawCreatedLog().args, id: 0n } })
    ] as never);
    await expect(
      createClient(invalidId).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("Invalid Uniswap governance proposal id: 0");

    const invalidIndex = createPublicClientMock();
    invalidIndex.getLogs.mockResolvedValueOnce([
      rawCreatedLog({ logIndex: -1 })
    ] as never);
    await expect(
      createClient(invalidIndex).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("invalid event log index");

    const missingArgs = createPublicClientMock();
    missingArgs.getLogs.mockResolvedValueOnce([
      rawCreatedLog({ args: null })
    ] as never);
    await expect(
      createClient(missingArgs).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("malformed event arguments");
  });

  it.each([
    ["block hash", rawCreatedLog({ blockHash: "0xbad" }), "event block hash"],
    [
      "transaction hash",
      rawCreatedLog({ transactionHash: "0xbad" }),
      "event transaction hash"
    ],
    [
      "description",
      rawCreatedLog({
        args: { ...rawCreatedLog().args, description: 123 }
      }),
      "description is not a string"
    ],
    [
      "queue ETA",
      {
        ...rawCreatedLog(),
        eventName: "ProposalQueued",
        args: { id: 100n, eta: -1n }
      },
      "queued proposal eta must be a non-negative integer"
    ]
  ])("rejects malformed event %s data", async (_field, log, message) => {
    const setup = createPublicClientMock();
    setup.getLogs.mockResolvedValueOnce([log] as never);

    await expect(
      createClient(setup).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow(message);
  });

  it("rejects inconsistent proposal action arrays", async () => {
    const setup = createPublicClientMock();
    setup.getLogs.mockResolvedValueOnce([
      rawCreatedLog({
        args: {
          ...rawCreatedLog().args,
          values: []
        }
      })
    ] as never);

    await expect(
      createClient(setup).client.getEvents(25_490_001, 25_500_000)
    ).rejects.toThrow("action arrays have inconsistent lengths");
  });

  it.each([
    [undefined, "malformed proposal action tuple"],
    [[[], [], []], "malformed proposal action tuple"],
    [["targets", [], [], []], "malformed proposal action arrays"]
  ])("rejects malformed action tuple %p", async (actions, message) => {
    const setup = createPublicClientMock();
    setup.values.getActions = actions;

    await expect(
      createClient(setup).client.getDecision("100", [], null, 25_981_000)
    ).rejects.toThrow(message);
  });

  it.each([
    ["negative value", [[TEST_TARGET_ADDRESS], [-1n], ["call()"], ["0x"]]],
    ["non-string signature", [[TEST_TARGET_ADDRESS], [0n], [1], ["0x"]]],
    ["odd-length calldata", [[TEST_TARGET_ADDRESS], [0n], ["call()"], ["0x1"]]],
    ["non-address target", [[123], [0n], ["call()"], ["0x"]]]
  ] as const)("rejects a malformed action: %s", async (_label, actions) => {
    const setup = createPublicClientMock();
    setup.values.getActions = actions;

    await expect(
      createClient(setup).client.getDecision("100", [], null, 25_981_000)
    ).rejects.toThrow();
  });

  it.each([
    ["no actions", [[], [], [], []], "must contain at least one action"],
    [
      "too many actions",
      [
        Array(11).fill(TEST_TARGET_ADDRESS),
        Array(11).fill(0n),
        Array(11).fill("call()"),
        Array(11).fill("0x")
      ],
      "exceeds the supported 10-action limit"
    ]
  ])("rejects a proposal with %s", async (_name, actions, message) => {
    const setup = createPublicClientMock();
    setup.values.getActions = actions;

    await expect(
      createClient(setup).client.getDecision("100", [], null, 25_981_000)
    ).rejects.toThrow(message);
  });

  it("loads a complete decision and preserves event-derived metadata", async () => {
    const setup = createPublicClientMock();
    const { client } = createClient(setup);
    const events = [
      {
        id: `${HASH_B}:4`,
        type: "created" as const,
        proposalId: "100",
        blockNumber: 25_498_000,
        blockHash: HASH_A,
        transactionHash: HASH_B,
        logIndex: 4,
        description: "# Activate v4 Protocol Fees (Part 1/2)\n\nProposal body"
      },
      {
        id: `${HASH_A}:1`,
        type: "queued" as const,
        proposalId: "100",
        blockNumber: 25_550_000,
        blockHash: HASH_B,
        transactionHash: HASH_A,
        logIndex: 1
      },
      {
        id: `${HASH_C}:2`,
        type: "executed" as const,
        proposalId: "100",
        blockNumber: 25_600_000,
        blockHash: HASH_C,
        transactionHash: HASH_C,
        logIndex: 2
      }
    ];

    const decision = await client.getDecision("100", events, null, 25_981_000);

    expect(decision).toMatchObject({
      protocol: "uniswap",
      sourceType: "onchain",
      proposalId: "100",
      title: "Activate v4 Protocol Fees (Part 1/2)",
      status: "executed",
      voteOutcome: "succeeded",
      executionOutcome: "executed",
      eta: "1785000000",
      forVotes: "46604583000000000000000000",
      againstVotes: "1274746000000000000000000",
      abstainVotes: "500000000000000000000",
      createdBlockNumber: 25_498_000,
      createdTransactionHash: HASH_B,
      queuedBlockNumber: 25_550_000,
      queuedTransactionHash: HASH_A,
      executedBlockNumber: 25_600_000,
      executedTransactionHash: HASH_C,
      lastObservedBlockNumber: 25_981_000,
      votingEndedAt: "2026-09-10T00:26:40.000Z",
      sourceUrl: "https://vote.uniswapfoundation.org/proposals/100"
    });
    expect(decision.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decision.actions).toEqual([
      {
        index: 0,
        target: TEST_TARGET_ADDRESS,
        value: "0",
        signature: "setFeeProtocol(uint8)",
        calldata: "0x01"
      }
    ]);
    for (const [request] of setup.readContract.mock.calls) {
      expect(request).toMatchObject({ blockNumber: 25_981_000n });
    }
    expect(setup.getBlock).toHaveBeenCalledWith({ blockNumber: 25_540_320n });
  });

  it("does not load an end-block timestamp before voting has finished", async () => {
    const setup = createPublicClientMock();
    setup.values.state = 0;
    updateProposalTuple(setup, {
      eta: 0n,
      canceled: false,
      executed: false
    });

    const decision = await createClient(setup).client.getDecision(
      "100",
      [],
      null,
      25_490_000
    );

    expect(decision).toMatchObject({
      status: "pending",
      voteOutcome: "pending",
      votingEndedAt: undefined
    });
    expect(setup.getBlock).not.toHaveBeenCalled();
  });

  it("reuses a stored voting end timestamp without another RPC request", async () => {
    const setup = createPublicClientMock();
    const votingEndedAt = "2026-08-01T00:00:00.000Z";
    const existing = {
      description: "# Previously indexed title\nBody",
      title: "Previously indexed title",
      votingEndedAt
    } as never;

    const decision = await createClient(setup).client.getDecision(
      "100",
      [],
      existing,
      25_981_000
    );

    expect(decision.votingEndedAt).toBe(votingEndedAt);
    expect(setup.getBlock).not.toHaveBeenCalled();
  });

  it("rejects a voting-end timestamp returned for the wrong Ethereum block", async () => {
    const setup = createPublicClientMock();
    setup.getBlock.mockResolvedValueOnce({
      number: 25_540_321n,
      hash: HASH_A,
      timestamp: 1_789_000_000n
    } as never);

    await expect(
      createClient(setup).client.getDecision("100", [], null, 25_981_000)
    ).rejects.toThrow(
      "returned block 25540321 while loading block 25540320"
    );
    expect(setup.getBlock).toHaveBeenCalledTimes(1);
    expect(setup.getBlock).toHaveBeenCalledWith({ blockNumber: 25_540_320n });
  });

  it("preserves the stored description when refreshing without historical logs", async () => {
    const setup = createPublicClientMock();
    const { client } = createClient(setup);
    const existing = {
      description: "# Previously indexed title\nBody",
      title: "Previously indexed title"
    } as never;

    const decision = await client.getDecision("100", [], existing, 25_981_000);

    expect(decision.description).toBe("# Previously indexed title\nBody");
    expect(decision.title).toBe("Previously indexed title");
  });

  it("preserves the successful vote result of a queued proposal later canceled", async () => {
    const setup = createPublicClientMock();
    setup.values.state = 2;
    updateProposalTuple(setup, {
      eta: 1_785_000_000n,
      canceled: true,
      executed: false
    });

    const decision = await createClient(setup).client.getDecision(
      "100",
      [],
      null,
      25_981_000
    );

    expect(decision).toMatchObject({
      status: "canceled",
      voteOutcome: "succeeded",
      executionOutcome: "canceled",
      eta: "1785000000"
    });
  });

  it.each(["succeeded", "defeated"] as const)(
    "preserves a previously observed %s vote result when cancellation has no ETA",
    async (voteStatus) => {
      const setup = createPublicClientMock();
      setup.values.state = 2;
      updateProposalTuple(setup, {
        eta: 0n,
        canceled: true,
        executed: false
      });
      const existing = createStoredGovernanceDecision({ status: voteStatus });

      const decision = await createClient(setup).client.getDecision(
        "100",
        [],
        existing,
        25_981_000
      );

      expect(decision).toMatchObject({
        status: "canceled",
        voteOutcome: voteStatus,
        executionOutcome: "canceled",
        eta: null
      });
    }
  );

  it("keeps cancellation as the vote outcome when no prior result or queue evidence exists", async () => {
    const setup = createPublicClientMock();
    setup.values.state = 2;
    updateProposalTuple(setup, {
      eta: 0n,
      canceled: true,
      executed: false
    });

    const decision = await createClient(setup).client.getDecision(
      "100",
      [],
      null,
      25_981_000
    );

    expect(decision).toMatchObject({
      status: "canceled",
      voteOutcome: "canceled",
      executionOutcome: "canceled",
      eta: null
    });
  });

  it.each([
    [
      "succeeded",
      50_000_000n * 10n ** 18n,
      1_000_000n * 10n ** 18n,
      "succeeded"
    ],
    [
      "succeeded at exact quorum",
      40_000_000n * 10n ** 18n,
      1_000_000n * 10n ** 18n,
      "succeeded"
    ],
    [
      "defeated below quorum",
      39_999_999n * 10n ** 18n,
      1_000_000n * 10n ** 18n,
      "defeated"
    ],
    [
      "defeated by opposition",
      50_000_000n * 10n ** 18n,
      50_000_001n * 10n ** 18n,
      "defeated"
    ],
    [
      "defeated on an exact tie",
      50_000_000n * 10n ** 18n,
      50_000_000n * 10n ** 18n,
      "defeated"
    ]
  ] as const)(
    "infers a %s completed vote when cancellation happened after voting",
    async (_case, forVotes, againstVotes, expected) => {
      const setup = createPublicClientMock();
      setup.values.state = 2;
      updateProposalTuple(setup, {
        eta: 0n,
        forVotes,
        againstVotes,
        canceled: true,
        executed: false
      });
      const canceledEvent = createGovernanceContractEvent({
        proposalId: "100",
        type: "canceled",
        blockNumber: 25_540_321
      });

      const decision = await createClient(setup).client.getDecision(
        "100",
        [canceledEvent],
        null,
        25_981_000
      );

      expect(decision).toMatchObject({
        status: "canceled",
        voteOutcome: expected,
        executionOutcome: "canceled",
        canceledBlockNumber: 25_540_321
      });
      expect(setup.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "quorumVotes",
          blockNumber: 25_981_000n
        })
      );
    }
  );

  it("does not infer a final result when cancellation occurred during voting", async () => {
    const setup = createPublicClientMock();
    setup.values.state = 2;
    updateProposalTuple(setup, {
      eta: 0n,
      forVotes: 50_000_000n * 10n ** 18n,
      canceled: true,
      executed: false
    });
    const canceledEvent = createGovernanceContractEvent({
      proposalId: "100",
      type: "canceled",
      blockNumber: 25_540_320
    });

    const decision = await createClient(setup).client.getDecision(
      "100",
      [canceledEvent],
      null,
      25_981_000
    );

    expect(decision.voteOutcome).toBe("canceled");
    expect(decision.votingEndedAt).toBeUndefined();
    expect(setup.getBlock).not.toHaveBeenCalled();
    expect(
      setup.readContract.mock.calls.some(
        ([request]) => request.functionName === "quorumVotes"
      )
    ).toBe(false);
  });

  it.each([
    [
      "canceled flag",
      2,
      { eta: 0n, canceled: false, executed: false },
      25_981_000,
      "canceled flag is inconsistent"
    ],
    [
      "executed flag",
      7,
      { canceled: false, executed: false },
      25_981_000,
      "executed flag is inconsistent"
    ],
    [
      "pending voting window",
      0,
      { eta: 0n, canceled: false, executed: false },
      25_500_001,
      "pending proposal is already past its start block"
    ],
    [
      "active voting window",
      1,
      { eta: 0n, canceled: false, executed: false },
      25_500_000,
      "active proposal is outside its voting window"
    ],
    [
      "premature result",
      4,
      { eta: 0n, canceled: false, executed: false },
      25_540_320,
      "succeeded proposal has not passed its voting end block"
    ],
    [
      "missing queued ETA",
      5,
      { eta: 0n, canceled: false, executed: false },
      25_981_000,
      "queued proposal must have a non-zero ETA"
    ],
    [
      "unexpected active ETA",
      1,
      { eta: 1_785_000_000n, canceled: false, executed: false },
      25_500_100,
      "active proposal must not have a queued ETA"
    ],
    [
      "reversed voting window",
      7,
      { startBlock: 25_500_000n, endBlock: 25_500_000n },
      25_981_000,
      "end block must be after its start block"
    ]
  ] as const)(
    "rejects inconsistent proposal state: %s",
    async (_name, state, tuple, observedAtBlock, message) => {
      const setup = createPublicClientMock();
      setup.values.state = state;
      updateProposalTuple(setup, tuple);

      await expect(
        createClient(setup).client.getDecision(
          "100",
          [],
          null,
          observedAtBlock
        )
      ).rejects.toThrow(message);
    }
  );

  it.each([
    [
      "another proposal",
      createGovernanceContractEvent({ proposalId: "99" }),
      "received event data for proposal 99"
    ],
    [
      "future block",
      createGovernanceContractEvent({
        proposalId: "100",
        blockNumber: 25_981_001
      }),
      "is after observation block"
    ],
    [
      "proposer mismatch",
      createGovernanceContractEvent({
        proposalId: "100",
        blockNumber: 25_498_000,
        proposer: "0x0000000000000000000000000000000000000002",
        startBlock: 25_500_000,
        endBlock: 25_540_320,
        actions: createGovernanceObservationActions()
      }),
      "proposer differs from its creation event"
    ],
    [
      "start block mismatch",
      createGovernanceContractEvent({
        proposalId: "100",
        blockNumber: 25_498_000,
        startBlock: 25_500_001,
        endBlock: 25_540_320,
        actions: createGovernanceObservationActions()
      }),
      "start block differs from its creation event"
    ],
    [
      "end block mismatch",
      createGovernanceContractEvent({
        proposalId: "100",
        blockNumber: 25_498_000,
        startBlock: 25_500_000,
        endBlock: 25_540_321,
        actions: createGovernanceObservationActions()
      }),
      "end block differs from its creation event"
    ],
    [
      "action mismatch",
      createGovernanceContractEvent({
        proposalId: "100",
        blockNumber: 25_498_000,
        startBlock: 25_500_000,
        endBlock: 25_540_320,
        actions: [
          {
            ...createGovernanceObservationActions()[0],
            value: "1"
          }
        ]
      }),
      "actions differ from its creation event"
    ],
    [
      "queue ETA mismatch",
      createGovernanceContractEvent({
        proposalId: "100",
        type: "queued",
        blockNumber: 25_550_000,
        eta: "1785000001"
      }),
      "ETA differs from its queue event"
    ]
  ] as const)("rejects %s event inconsistency", async (_name, event, message) => {
    const setup = createPublicClientMock();

    await expect(
      createClient(setup).client.getDecision(
        "100",
        [event],
        null,
        25_981_000
      )
    ).rejects.toThrow(message);
  });

  it("rejects duplicate non-repeatable lifecycle stages for one proposal", async () => {
    const setup = createPublicClientMock();
    const first = createGovernanceContractEvent({
      proposalId: "100",
      blockNumber: 25_498_000
    });
    const duplicateStage = createGovernanceContractEvent({
      proposalId: "100",
      blockNumber: 25_498_001,
      transactionHash: `0x${"22".repeat(32)}`
    });

    await expect(
      createClient(setup).client.getDecision(
        "100",
        [first, duplicateStage],
        null,
        25_981_000
      )
    ).rejects.toThrow("Proposal 100 returned multiple created events");
  });

  it("accepts repeated Governor Bravo cancellation logs and preserves the earliest canonical cancellation", async () => {
    const setup = createPublicClientMock();
    setup.values.state = 2;
    updateProposalTuple(setup, {
      eta: 0n,
      canceled: true,
      executed: false
    });
    const firstCancellation = createGovernanceContractEvent({
      proposalId: "100",
      type: "canceled",
      blockNumber: 25_550_000,
      transactionHash: `0x${"22".repeat(32)}`
    });
    const repeatedCancellation = createGovernanceContractEvent({
      proposalId: "100",
      type: "canceled",
      blockNumber: 25_560_000,
      transactionHash: `0x${"33".repeat(32)}`
    });

    const firstObservation = await createClient(setup).client.getDecision(
      "100",
      [repeatedCancellation, firstCancellation],
      null,
      25_981_000
    );
    expect(firstObservation).toMatchObject({
      status: "canceled",
      canceledBlockNumber: 25_550_000,
      canceledTransactionHash: `0x${"22".repeat(32)}`
    });

    const existing = createStoredGovernanceDecision({
      ...firstObservation,
      title: firstObservation.title ?? "Canceled proposal",
      description: firstObservation.description ?? "",
      canceledBlockNumber: 25_550_000,
      canceledTransactionHash: `0x${"22".repeat(32)}`
    });
    const repeatedObservation = await createClient(setup).client.getDecision(
      "100",
      [repeatedCancellation],
      existing,
      25_981_000
    );
    expect(repeatedObservation).toMatchObject({
      canceledBlockNumber: 25_550_000,
      canceledTransactionHash: `0x${"22".repeat(32)}`
    });
  });

  it.each([
    [
      "cancellation event with succeeded state",
      4,
      { eta: 0n, canceled: false, executed: false },
      createGovernanceContractEvent({
        proposalId: "100",
        type: "canceled",
        blockNumber: 25_550_000
      }),
      "has a cancellation event but Governor state is succeeded"
    ],
    [
      "queue event with succeeded state",
      4,
      { eta: 0n, canceled: false, executed: false },
      createGovernanceContractEvent({
        proposalId: "100",
        type: "queued",
        blockNumber: 25_550_000,
        eta: "0"
      }),
      "has a queue event but Governor state is succeeded"
    ],
    [
      "execution event with queued state",
      5,
      { eta: 1_785_000_000n, canceled: false, executed: false },
      createGovernanceContractEvent({
        proposalId: "100",
        type: "executed",
        blockNumber: 25_550_000
      }),
      "has an execution event but Governor state is queued"
    ]
  ] as const)("rejects contradictory finalized RPC data: %s", async (
    _name,
    state,
    tuple,
    event,
    message
  ) => {
    const setup = createPublicClientMock();
    setup.values.state = state;
    updateProposalTuple(setup, tuple);

    await expect(
      createClient(setup).client.getDecision(
        "100",
        [event],
        null,
        25_981_000
      )
    ).rejects.toThrow(message);
  });

  it.each([
    ["0", "Invalid Uniswap governance proposal id: 0"],
    ["-1", "Invalid Uniswap governance proposal id: -1"],
    ["1.5", "Invalid Uniswap governance proposal id: 1.5"]
  ])("rejects invalid proposal id %s", async (proposalId, message) => {
    await expect(createClient().client.getDecision(proposalId, [], null, 1)).rejects.toThrow(
      message
    );
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid proposal observation block %s before reading the contract",
    async (observedAtBlock) => {
      const setup = createPublicClientMock();
      const { client } = createClient(setup);

      await expect(
        client.getDecision("100", [], null, observedAtBlock)
      ).rejects.toThrow(
        "proposal observation block must be a non-negative safe integer"
      );
      expect(setup.readContract).not.toHaveBeenCalled();
    }
  );

  it("rejects mismatched proposal tuples and unknown native states", async () => {
    const mismatch = createPublicClientMock();
    mismatch.values.proposals = [
      99n,
      ...(mismatch.values.proposals as readonly unknown[]).slice(1)
    ];
    await expect(
      createClient(mismatch).client.getDecision("100", [], null, 1)
    ).rejects.toThrow("returned proposal 99 while loading 100");

    const unknownState = createPublicClientMock();
    unknownState.values.state = 8;
    await expect(
      createClient(unknownState).client.getDecision("100", [], null, 1)
    ).rejects.toThrow("unsupported proposal state 8");
  });

  it.each([
    ["missing tuple", undefined, "malformed proposal tuple"],
    ["short tuple", [100n], "malformed proposal tuple"],
    [
      "non-address proposer",
      [100n, 123, 0n, 1n, 2n, 0n, 0n, 0n, false, false],
      "proposal proposer is not an address"
    ],
    [
      "negative vote total",
      [
        100n,
        TEST_PROPOSER_ADDRESS,
        0n,
        1n,
        2n,
        -1n,
        0n,
        0n,
        false,
        false
      ],
      "proposal forVotes must be a non-negative integer"
    ],
    [
      "malformed flags",
      [
        100n,
        TEST_PROPOSER_ADDRESS,
        0n,
        1n,
        2n,
        0n,
        0n,
        0n,
        0,
        false
      ],
      "proposal flags are malformed"
    ]
  ] as const)("rejects a %s response", async (_label, proposals, message) => {
    const setup = createPublicClientMock();
    setup.values.proposals = proposals;

    await expect(
      createClient(setup).client.getDecision("100", [], null, 25_981_000)
    ).rejects.toThrow(message);
  });

  it("rejects a malformed native state before persistence", async () => {
    const setup = createPublicClientMock();
    setup.values.state = "7";

    await expect(
      createClient(setup).client.getDecision("100", [], null, 25_981_000)
    ).rejects.toThrow("malformed proposal state 7");
  });

  it("returns a safe normalized block reference", async () => {
    const setup = createPublicClientMock();
    const { client } = createClient(setup);

    await expect(client.getBlock(25_981_000)).resolves.toEqual({
      number: 25_981_000,
      hash: HASH_A,
      timestamp: "2026-09-10T00:26:40.000Z"
    });
    expect(setup.getBlock).toHaveBeenCalledWith({ blockNumber: 25_981_000n });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid requested block number %s without an RPC call",
    async (blockNumber) => {
      const setup = createPublicClientMock();
      const { client } = createClient(setup);

      await expect(client.getBlock(blockNumber)).rejects.toThrow(
        "requested block number must be a non-negative safe integer"
      );
      expect(setup.getBlock).not.toHaveBeenCalled();
    }
  );

  it("rejects a provider response for the wrong requested block", async () => {
    const setup = createPublicClientMock();
    setup.getBlock.mockResolvedValueOnce({
      number: 25_981_000n,
      hash: HASH_A,
      timestamp: 1_789_000_000n
    } as never);
    const { client } = createClient(setup);

    await expect(client.getBlock(25_980_999)).rejects.toThrow(
      "returned block 25981000 while loading block 25980999"
    );
  });

  it.each([
    [
      "missing hash",
      { number: 25_981_000n, hash: null, timestamp: 1_789_000_000n },
      "without a valid hash"
    ],
    [
      "short hash",
      { number: 25_981_000n, hash: "0x12", timestamp: 1_789_000_000n },
      "without a valid hash"
    ],
    [
      "unsafe number",
      {
        number: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        hash: HASH_A,
        timestamp: 1_789_000_000n
      },
      "block number is outside the JavaScript safe integer range"
    ],
    [
      "unsafe timestamp",
      {
        number: 25_981_000n,
        hash: HASH_A,
        timestamp: BigInt(Number.MAX_SAFE_INTEGER) + 1n
      },
      "block timestamp is outside the JavaScript safe integer range"
    ],
    [
      "timestamp outside Date range",
      {
        number: 25_981_000n,
        hash: HASH_A,
        timestamp: 8_640_000_000_001n
      },
      "block timestamp is outside the JavaScript Date range"
    ]
  ])("rejects a block with %s", async (_name, block, message) => {
    const setup = createPublicClientMock();
    setup.getBlock.mockResolvedValueOnce(block as never);

    await expect(createClient(setup).client.getBlock(25_981_000)).rejects.toThrow(
      message
    );
  });
});
