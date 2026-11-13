import { describe, expect, it, jest } from "@jest/globals";
import type { PublicClient } from "viem";
import { AaveOnchainClient, AAVE_GOVERNANCE_DEPLOYMENT_BLOCK } from "../../src/onchain/aave/aaveOnchain.client.js";
import { aaveMetadataCid } from "../../src/onchain/aave/aaveGovernance.model.js";
import { mergeGovernanceDecision } from "../../src/onchain/governanceDecision.js";
import { aaveRawProposal, aaveRpcFixture, aaveLog, AAVE_IPFS_HASH } from "../helpers/aaveBuilders.js";

describe("Aave Governance V3 RPC client", () => {
  it("requires an RPC or injected client", () => {
    expect(() => new AaveOnchainClient({})).toThrow("Ethereum RPC");
  });
  it("validates mainnet, proxy bytecode, implementation, identity and zero-based count at one finalized block", async () => {
    const { rpc, client, block } = aaveRpcFixture();
    await expect(client.validateSource()).resolves.toMatchObject({
      chainId: 1, proposalCount: "1", initialProposalId: "0", proposalIdScheme: "zero-based-count"
    });
    for (const [request] of rpc.readContract.mock.calls) expect(request).toMatchObject({ blockNumber: BigInt(block) });
  });
  it.each([2, 137, 43114])("rejects chain %s", async (chain) => {
    const { rpc, client } = aaveRpcFixture();
    rpc.getChainId.mockResolvedValue(chain);
    await expect(client.validateSource()).rejects.toThrow("mainnet");
  });
  it.each(["code", "identity", "slot", "implementation", "head", "count"])("rejects invalid %s", async (kind) => {
    const { rpc, client } = aaveRpcFixture();
    if (kind === "code") rpc.getCode.mockResolvedValue("0x");
    if (kind === "identity") rpc.readContract.mockImplementation(async () => "Other Governor");
    if (kind === "slot") rpc.getStorageAt.mockResolvedValue("0x");
    if (kind === "implementation") rpc.getCode.mockResolvedValueOnce("0x1234").mockResolvedValueOnce("0x");
    if (kind === "head") rpc.getBlock.mockResolvedValue({ number: 1n, hash: `0x${"11".repeat(32)}`, timestamp: 1n });
    if (kind === "count") rpc.readContract.mockImplementation(async ({ functionName }) => functionName === "NAME" ? "Aave Governance v3" : -1n);
    await expect(client.validateSource()).rejects.toThrow();
  });
  it("rejects malformed/wrong blocks", async () => {
    const { rpc, client } = aaveRpcFixture();
    await expect(client.getBlock(-1)).rejects.toThrow();
    rpc.getBlock.mockResolvedValue({ number: 1n, hash: `0x${"11".repeat(32)}`, timestamp: 1n });
    await expect(client.getBlock(2)).rejects.toThrow("wrong block");
  });
  it.each([
    [1, 2], [AAVE_GOVERNANCE_DEPLOYMENT_BLOCK, AAVE_GOVERNANCE_DEPLOYMENT_BLOCK - 1],
    [AAVE_GOVERNANCE_DEPLOYMENT_BLOCK, AAVE_GOVERNANCE_DEPLOYMENT_BLOCK + 10_000], [NaN, Infinity]
  ])("rejects log range %s..%s", async (from, to) => {
    await expect(aaveRpcFixture().client.getEvents(from, to)).rejects.toThrow("log range");
  });
  it.each([
    ["ProposalCreated", "created"], ["VotingActivated", "activated"], ["ProposalQueued", "queued"],
    ["ProposalFailed", "defeated"], ["ProposalCanceled", "canceled"], ["ProposalExecuted", "executed"]
  ])("maps %s without losing proposal zero", async (name, type) => {
    const { rpc, client, block } = aaveRpcFixture();
    rpc.getLogs.mockResolvedValue([aaveLog(name)]);
    await expect(client.getEvents(block - 100, block)).resolves.toMatchObject([{ proposalId: "0", type }]);
  });
  it.each([
    { removed: true }, { address: `0x${"11".repeat(20)}` }, { transactionHash: "bad" },
    { blockNumber: 1n }, { logIndex: -1 }, { eventName: "Unknown" }
  ])("rejects malformed or untrusted logs: %o", async (overrides) => {
    const { rpc, client, block } = aaveRpcFixture();
    rpc.getLogs.mockResolvedValue([aaveLog("ProposalCreated", overrides)]);
    await expect(client.getEvents(block - 100, block)).rejects.toThrow();
  });
  it("deduplicates identical log entries", async () => {
    const { rpc, client, block } = aaveRpcFixture();
    rpc.getLogs.mockResolvedValue([aaveLog(), aaveLog()]);
    await expect(client.getEvents(block - 100, block)).resolves.toHaveLength(1);
  });
  it("rejects two distinct creation events rather than trusting the first", async () => {
    const { rpc, client, block } = aaveRpcFixture();
    rpc.getLogs.mockResolvedValue([aaveLog(), aaveLog("ProposalCreated", { logIndex: 1 })]);
    const events = await client.getEvents(block - 100, block);
    await expect(client.getDecision("0", events, null, block)).rejects.toThrow("multiple created events");
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("cross-checks the voting snapshot hash from activation against proposal state", async () => {
    const { rpc, client, block, setProposal } = aaveRpcFixture();
    setProposal(aaveRawProposal({ state: 2, votingActivationTime: 1704575039,
      votingDuration: 259200, snapshotBlockHash: `0x${"aa".repeat(32)}` }));
    rpc.getLogs.mockResolvedValue([aaveLog("VotingActivated")]);
    const events = await client.getEvents(block - 100, block);
    await expect(client.getDecision("0", events, null, block)).rejects.toThrow("snapshot");
  });

  it.each([
    { event: "ProposalQueued", state: 3, timestamp: 1704836471n, wrongHash: true, error: "block hash" },
    { event: "ProposalQueued", state: 3, timestamp: 1704836472n, wrongHash: false, error: "queue timestamp" },
    { event: "ProposalFailed", state: 5, timestamp: 1704834239n, wrongHash: false, error: "voting window" }
  ])("rejects inconsistent $event evidence: $error", async ({ event, state, timestamp, wrongHash, error }) => {
    const { rpc, client, block, setProposal } = aaveRpcFixture();
    setProposal(aaveRawProposal({ state, votingActivationTime: 1704575039,
      votingDuration: 259200, queuingTime: state === 3 ? 1704836471 : 0 }));
    const log = aaveLog(event);
    rpc.getLogs.mockResolvedValue([log]);
    const events = await client.getEvents(block - 100, block);
    rpc.getBlock.mockResolvedValueOnce({
      number: log.blockNumber,
      hash: wrongHash ? `0x${"aa".repeat(32)}` : log.blockHash,
      timestamp
    });
    await expect(client.getDecision("0", events, null, block)).rejects.toThrow(error);
  });

  it.each([["ProposalQueued", 3], ["ProposalFailed", 5]] as const)(
    "records canonical %s settlement without inventing a remote voting end time",
    async (event, state) => {
      const { rpc, client, block, setProposal } = aaveRpcFixture();
      setProposal(aaveRawProposal({ state, votingActivationTime: 1704575039,
        votingDuration: 259200, queuingTime: state === 3 ? 1704836471 : 0 }));
      const log = aaveLog(event);
      rpc.getLogs.mockResolvedValue([log]);
      const events = await client.getEvents(block - 100, block);
      const decision = await client.getDecision("0", events, null, block);
      expect(decision.aave).toMatchObject({
        resultReceivedAt: "2024-01-09T21:41:11.000Z",
        resultBlockNumber: Number(log.blockNumber),
        resultTransactionHash: log.transactionHash
      });
      expect(decision.votingEndedAt).toBeUndefined();
    }
  );
  it.each(["ProposalCreated", "VotingActivated", "ProposalQueued", "ProposalFailed"])("rejects incomplete %s arguments", async (name) => {
    const { rpc, client, block } = aaveRpcFixture();
    rpc.getLogs.mockResolvedValue([aaveLog(name, { args: { proposalId: 0n } })]);
    await expect(client.getEvents(block - 100, block)).rejects.toThrow("arguments are incomplete");
  });
  it.each(["identity", "future", "proposer", "metadata", "executed", "queued", "defeated", "activated", "votes", "duration"])(
    "fails closed on conflicting proposal/log %s", async (kind) => {
      const { client, block, setProposal } = aaveRpcFixture();
      const events = [{ id: "unused", type: "created" as const, proposalId: "0", blockNumber: block,
        blockHash: `0x${"11".repeat(32)}`, transactionHash: `0x${"22".repeat(32)}`, logIndex: 0 }];
      const event: Record<string, unknown> = events[0];
      if (kind === "identity") event.proposalId = "1";
      if (kind === "future") event.blockNumber = block + 1;
      if (kind === "proposer") event.proposer = `0x${"11".repeat(20)}`;
      if (kind === "metadata") event.metadataHash = `0x${"22".repeat(32)}`;
      if (["executed", "queued", "defeated", "activated"].includes(kind)) event.type = kind;
      if (kind === "votes") {
        setProposal(aaveRawProposal({ state: 3, votingActivationTime: 1704575039, votingDuration: 259200,
          queuingTime: 1704836471, forVotes: 100n }));
        event.type = "queued";
        event.forVotes = "99";
        event.againstVotes = "0";
      }
      if (kind === "duration") {
        setProposal(aaveRawProposal({ state: 2, votingActivationTime: 1704575039, votingDuration: 259200 }));
        event.type = "activated";
        event.votingDuration = 1;
      }
      await expect(client.getDecision("0", events, null, block)).rejects.toThrow();
    }
  );
  it("keeps an accepted result when a queued proposal is canceled", async () => {
    const { client, block, setProposal } = aaveRpcFixture();
    setProposal(aaveRawProposal({ state: 6, votingActivationTime: 1704575039, votingDuration: 259200,
      queuingTime: 1704836471, cancelTimestamp: 1704836500 }));
    await expect(client.getDecision("0", [], null, block)).resolves.toMatchObject({ status: "canceled", voteOutcome: "succeeded" });
  });
  it("avoids IPFS requests during historical seeding", async () => {
    const { rpc, block } = aaveRpcFixture();
    const fetchImpl = jest.fn<typeof fetch>();
    const client = new AaveOnchainClient({ publicClient: rpc as unknown as PublicClient, fetchImpl });
    await expect(client.getDecision("0", [], null, block, { historical: true })).resolves.toMatchObject({ title: "Aave governance proposal #0" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("captures native timestamp-based creation, payload identities and CID without inventing blocks or abstain", async () => {
    const { client, block } = aaveRpcFixture();
    const decision = await client.getDecision("0", [], null, block);
    expect(decision).toMatchObject({ protocol: "aave", proposalId: "0", status: "pending", abstainVotes: "0",
      title: "Aave governance proposal #0", aave: { executionScope: "governance-core", creationTime: 1704488567 },
      sourceUrl: "https://app.aave.com/governance/v3/proposal/?proposalId=0" });
    expect(decision.startBlock).toBeUndefined();
    expect(decision.endBlock).toBeUndefined();
    expect(decision.votingEndedAt).toBeUndefined();
    expect(decision.aave?.metadataCid).toBe(aaveMetadataCid(AAVE_IPFS_HASH));
  });
  it("links proposal 542 to its detail page in the current Aave app", async () => {
    const { client, block } = aaveRpcFixture();
    await expect(client.getDecision("542", [], null, block)).resolves.toMatchObject({
      sourceUrl: "https://app.aave.com/governance/v3/proposal/?proposalId=542"
    });
  });
  it.each([
    ["https://vote.onaave.com/proposal/?proposalId=1", "https://app.aave.com/governance/v3/proposal/?proposalId=0"],
    ["https://vote.onaave.com/proposal/?proposalId=0", "https://app.aave.com/governance/v3/proposal/?proposalId=1"],
    ["https://app.aave.com/governance/v3/proposal/?proposalId=0", "https://vote.onaave.com/proposal/?proposalId=0"]
  ])("rejects unrelated or reverse URL changes (%s -> %s)", async (before, after) => {
    const { client, block } = aaveRpcFixture();
    const observation = await client.getDecision("0", [], null, block);
    const now = "2026-11-13T09:00:00.000Z";
    const existing = mergeGovernanceDecision(null, { ...observation, sourceUrl: before }, now).decision;
    expect(() => mergeGovernanceDecision(existing, { ...observation, sourceUrl: after }, now))
      .toThrow("Governance proposal source URL cannot change.");
  });
  it.each([
    [2, "active"], [3, "queued"], [4, "executed"], [5, "defeated"], [6, "canceled"], [7, "expired"]
  ] as const)("maps native state %s to %s", async (state, status) => {
    const { client, block, setProposal } = aaveRpcFixture();
    setProposal(aaveRawProposal({ state, votingActivationTime: 1704575039, votingDuration: 259200,
      queuingTime: state === 3 || state === 4 ? 1704836471 : 0,
      cancelTimestamp: state === 6 ? 1704836471 : 0 }));
    const decision = await client.getDecision("0", [], null, block);
    expect(decision.status).toBe(status);
    if (state === 7) expect(decision.voteOutcome).toBe("pending");
  });
  it.each(["-1", "01", "abc", "1.5"])("rejects invalid proposal %s", async (id) => {
    const { client, block } = aaveRpcFixture();
    await expect(client.getDecision(id, [], null, block)).rejects.toThrow();
  });
  it.each([0, 8, -1])("rejects null/unknown native state %s", async (state) => {
    const { client, block, setProposal } = aaveRpcFixture();
    setProposal(aaveRawProposal({ state }));
    await expect(client.getDecision("0", [], null, block)).rejects.toThrow();
  });
  it("rejects unsafe numeric vote totals rather than silently losing precision", async () => {
    const { client, block, setProposal } = aaveRpcFixture();
    setProposal(aaveRawProposal({ forVotes: Number.MAX_SAFE_INTEGER + 1 }));
    await expect(client.getDecision("0", [], null, block)).rejects.toThrow();
  });
  it("retains settled-result identity and avoids reloading known title metadata", async () => {
    const { client, block } = aaveRpcFixture();
    const created = await client.getDecision("0", [], null, block);
    const stored = mergeGovernanceDecision(null, { ...created, title: "Known title" }, "2026-01-01T00:00:00.000Z").decision;
    await expect(client.getDecision("0", [], stored, block)).resolves.toMatchObject({ title: "Known title" });
  });
  it("loads bounded IPFS metadata only as presentation data", async () => {
    const { rpc, block } = aaveRpcFixture();
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ title: "Proposal title", description: "Proposal body" })));
    const client = new AaveOnchainClient({ publicClient: rpc as unknown as PublicClient, fetchImpl });
    await expect(client.getDecision("0", [], null, block)).resolves.toMatchObject({ title: "Proposal title", description: "Proposal body" });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://ipfs.io/ipfs/${aaveMetadataCid(AAVE_IPFS_HASH)}`);
  });
  it.each(["http", "json", "schema", "oversized", "empty", "network"])("keeps on-chain tracking working after metadata %s failure", async (failure) => {
    const { rpc, block } = aaveRpcFixture();
    const response = failure === "http" ? new Response("unavailable", { status: 503 })
      : failure === "json" ? new Response("invalid")
      : failure === "oversized" ? new Response("a".repeat(200_001))
      : failure === "empty" ? new Response(null) : new Response("{}");
    const fetchImpl = jest.fn<typeof fetch>();
    if (failure === "network") fetchImpl.mockRejectedValue(new Error("timeout"));
    else fetchImpl.mockResolvedValue(response);
    const logger = { warn: jest.fn() };
    const client = new AaveOnchainClient({ publicClient: rpc as unknown as PublicClient, fetchImpl, logger });
    await expect(client.getDecision("0", [], null, block)).resolves.toMatchObject({ title: "Aave governance proposal #0", status: "pending" });
    expect(logger.warn).toHaveBeenCalled();
  });
});
