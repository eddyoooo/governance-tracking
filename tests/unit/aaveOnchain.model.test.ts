import { describe, expect, it } from "@jest/globals";
import { aaveMetadataCid, aaveStatus, assertAaveObservation } from "../../src/onchain/aave/aaveGovernance.model.js";
import { assertGovernanceDecisionObservation, deriveGovernanceTransitions, mergeGovernanceDecision } from "../../src/onchain/governanceDecision.js";
import { findMissingProposalIds, assertProposalCountCoversStoredDecisions, decisionsUpToProposalId } from "../../src/onchain/onchainGovernance.coverage.js";
import { trackedProposalEvents } from "../../src/onchain/onchainGovernance.validation.js";
import { aaveRpcFixture, aaveRawProposal, AAVE_IPFS_HASH } from "../helpers/aaveBuilders.js";
import { testEnv } from "../helpers/builders.js";
import { createGovernanceContractEvent } from "../helpers/onchainBuilders.js";

describe("Aave numbering and native lifecycle semantics", () => {
  it("leaves Aave tracking disabled by default and validates its enablement dependencies", () => {
    expect(testEnv()).toMatchObject({ aaveOnchainEnabled: false, aaveOnchainNotificationsEnabled: false });
    expect(() => testEnv({ AAVE_ONCHAIN_ENABLED: "true" })).toThrow("ETHEREUM_RPC_URL");
    expect(() => testEnv({ AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "true" })).toThrow("AAVE_ONCHAIN_ENABLED");
    expect(() => testEnv({ AAVE_ONCHAIN_ENABLED: "true", ETHEREUM_RPC_URL: "https://example.invalid",
      AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "true" })).toThrow("ENABLE_TELEGRAM_NOTIFICATIONS");
    expect(testEnv({ AAVE_ONCHAIN_ENABLED: "true", ETHEREUM_RPC_URL: "https://example.invalid",
      AAVE_ONCHAIN_NOTIFICATIONS_ENABLED: "true", ENABLE_TELEGRAM_NOTIFICATIONS: "true" }))
      .toMatchObject({ aaveOnchainEnabled: true, aaveOnchainNotificationsEnabled: true });
  });
  it("does not let persisted decisions switch their governance data model", async () => {
    const { client, block } = aaveRpcFixture();
    const first = mergeGovernanceDecision(null, await client.getDecision("0", [], null, block), "2026-01-01T00:00:00.000Z").decision;
    expect(() => mergeGovernanceDecision({ ...first, aave: undefined }, first, "2026-01-02T00:00:00.000Z")).toThrow("model cannot change");
    expect(() => assertGovernanceDecisionObservation({ ...first, proposalId: "1", aave: undefined }))
      .toThrow("Aave governance data is required");
  });
  it("uses native zero-based counts without changing Uniswap's exclusive initial ID", () => {
    expect(findMissingProposalIds([], "0", "0", "zero-based-count")).toEqual([]);
    expect(findMissingProposalIds([], "0", "1", "zero-based-count")).toEqual(["0"]);
    expect(findMissingProposalIds([{ proposalId: "0" }], "0", "1", "zero-based-count")).toEqual([]);
    expect(findMissingProposalIds([{ proposalId: "0" }, { proposalId: "2" }], "0", "3", "zero-based-count")).toEqual(["1"]);
    expect(findMissingProposalIds([], "8", "10")).toEqual(["9", "10"]);
    expect(() => assertProposalCountCoversStoredDecisions([{ proposalId: "1" }], "1", "zero-based-count")).toThrow("regressed");
    expect(() => assertProposalCountCoversStoredDecisions([], "0", "zero-based-count")).not.toThrow();
    expect(decisionsUpToProposalId([{ proposalId: "0" }, { proposalId: "1" }], "1", "zero-based-count")).toEqual([{ proposalId: "0" }]);
    const zero = createGovernanceContractEvent({ proposalId: "0" });
    expect(trackedProposalEvents([zero], "0", "1", "zero-based-count")).toEqual([zero]);
    expect(() => trackedProposalEvents([zero], "0", "0", "zero-based-count")).toThrow("above");
  });
  it("encodes real bytes32 metadata digests as CIDv0", () => {
    expect(aaveMetadataCid(AAVE_IPFS_HASH)).toBe("Qmf7DQqMY1L5wpW3KymVxBJQcB7AensPWqeYQUmfZPt5F1");
    expect(() => aaveMetadataCid("bad")).toThrow();
    expect(() => aaveMetadataCid(`0x${"00".repeat(32)}`)).toThrow();
    expect(() => aaveStatus(0)).toThrow();
    expect(() => aaveStatus(8)).toThrow();
  });
  it("rejects a settled result recorded after the finalized observation block", async () => {
    const { client, block } = aaveRpcFixture();
    const observation = await client.getDecision("0", [], null, block);
    expect(() => assertAaveObservation({ ...observation, aave: { ...observation.aave!,
      resultReceivedAt: "2024-01-09T21:41:11.000Z", resultBlockNumber: block + 1,
      resultTransactionHash: `0x${"11".repeat(32)}` } })).toThrow("exceeds its observation block");
  });
  it("rejects queue acceptance before the native voting window has ended", async () => {
    const { client, block, setProposal } = aaveRpcFixture();
    setProposal(aaveRawProposal({ state: 3, votingActivationTime: 1704575039,
      votingDuration: 259200, queuingTime: 1704575039 + 259200 }));
    await expect(client.getDecision("0", [], null, block)).rejects.toThrow("precedes its voting window");
  });
  it("does not fabricate a failed vote or successful queue when an unvoted proposal expires", async () => {
    const { client, block, setProposal } = aaveRpcFixture();
    const pending = await client.getDecision("0", [], null, block);
    const first = mergeGovernanceDecision(null, pending, "2026-01-01T00:00:00.000Z").decision;
    setProposal(aaveRawProposal({ state: 7 }));
    const expired = mergeGovernanceDecision(first, await client.getDecision("0", [], first, block), "2026-02-01T00:00:00.000Z").decision;
    expect(expired.voteOutcome).toBe("pending");
    expect(deriveGovernanceTransitions(first, expired)).toEqual(["expired"]);
    expect(deriveGovernanceTransitions(null, expired)).toEqual(["created", "expired"]);
  });
  it.each(["resultReceivedAt", "resultBlockNumber", "resultTransactionHash", "queuingTime", "cancelTimestamp"] as const)(
    "preserves established Aave %s evidence",
    async (field) => {
      const { client, block, setProposal } = aaveRpcFixture();
      setProposal(aaveRawProposal({ state: 6, votingActivationTime: 1704575039, votingDuration: 259200,
        queuingTime: 1704836471, cancelTimestamp: 1704836500 }));
      const observation = await client.getDecision("0", [], null, block);
      const data = { ...observation.aave!, resultReceivedAt: "2024-01-09T21:41:11.000Z",
        resultBlockNumber: block - 1, resultTransactionHash: `0x${"11".repeat(32)}` };
      const first = mergeGovernanceDecision(null, { ...observation, aave: data }, "2026-01-01T00:00:00.000Z").decision;
      const modified = { ...data, [field]: typeof data[field] === "number" ? data[field] + 1 :
        field === "resultReceivedAt" ? "2024-01-09T21:41:12.000Z" : `0x${"22".repeat(32)}` };
      expect(() => mergeGovernanceDecision(first, { ...first, aave: modified }, "2026-01-02T00:00:00.000Z"))
        .toThrow("Aave established lifecycle evidence");
    }
  );
  it("preserves pending-to-active native timestamps, then rejects changes to activated windows", async () => {
    const { client, block, setProposal } = aaveRpcFixture();
    const first = mergeGovernanceDecision(null, await client.getDecision("0", [], null, block), "2026-01-01T00:00:00.000Z").decision;
    setProposal(aaveRawProposal({ state: 2, votingActivationTime: 1704575039, votingDuration: 259200 }));
    const active = mergeGovernanceDecision(first, await client.getDecision("0", [], first, block), "2026-01-02T00:00:00.000Z").decision;
    const changed = { ...active, aave: { ...active.aave!, votingDuration: 259201 } };
    expect(() => mergeGovernanceDecision(active, changed, "2026-01-03T00:00:00.000Z")).toThrow("voting window");
  });
  it("allows previously absent queue and cancellation evidence to be acquired normally", async () => {
    const { client, block, setProposal } = aaveRpcFixture();
    const first = mergeGovernanceDecision(null, await client.getDecision("0", [], null, block), "2026-01-01T00:00:00.000Z").decision;
    const approved = { state: 3, votingActivationTime: 1704575039, votingDuration: 259200,
      queuingTime: 1704836471, forVotes: 500n };
    setProposal(aaveRawProposal(approved));
    const queued = mergeGovernanceDecision(first, await client.getDecision("0", [], first, block), "2026-01-02T00:00:00.000Z").decision;
    expect(deriveGovernanceTransitions(first, queued)).toEqual(["succeeded", "queued"]);
    setProposal(aaveRawProposal({ ...approved, state: 6, cancelTimestamp: 1704836500 }));
    const canceled = mergeGovernanceDecision(queued, await client.getDecision("0", [], queued, block), "2026-01-03T00:00:00.000Z").decision;
    expect(deriveGovernanceTransitions(queued, canceled)).toEqual(["canceled"]);
    expect(canceled.voteOutcome).toBe("succeeded");
  });
  it.each(["creationTime", "votingPortal", "ipfsHash", "payloads"] as const)("protects immutable %s", async (field) => {
    const { client, block } = aaveRpcFixture();
    const first = mergeGovernanceDecision(null, await client.getDecision("0", [], null, block), "2026-01-01T00:00:00.000Z").decision;
    const data = structuredClone(first.aave!);
    if (field === "creationTime") data.creationTime++;
    if (field === "votingPortal") data.votingPortal = `0x${"11".repeat(20)}`;
    if (field === "ipfsHash") data.ipfsHash = `0x${"11".repeat(32)}`;
    if (field === "payloads") data.payloads[0].payloadId = "44";
    expect(() => mergeGovernanceDecision(first, { ...first, aave: data }, "2026-01-02T00:00:00.000Z")).toThrow("immutable");
  });
  it.each([
    { protocol: "uniswap" }, { chainId: 137 }, { startBlock: 5 }, { endBlock: 10 }, { abstainVotes: "1" },
    { votingEndedAt: "2026-01-01T00:00:00.000Z" }, { proposalId: "01" }, { aave: undefined }
  ])("rejects incompatible model data: %o", async (override) => {
    const { client, block } = aaveRpcFixture();
    const original = await client.getDecision("0", [], null, block);
    expect(() => assertGovernanceDecisionObservation({ ...original, ...override })).toThrow();
  });
  it.each([
    { votingActivationTime: 1, votingDuration: 0 }, { nativeState: 2 },
    { resultBlockNumber: 100 }, { resultTransactionHash: `0x${"11".repeat(32)}` },
    { creationTime: -1 }, { payloads: [] }
  ])("rejects inconsistent Aave metadata: %o", async (override) => {
    const { client, block } = aaveRpcFixture();
    const original = await client.getDecision("0", [], null, block);
    expect(() => assertAaveObservation({ ...original, aave: { ...original.aave!, ...override } })).toThrow();
  });
  it.each([
    { resultReceivedAt: "2024-01-09T21:41:11.000Z" },
    { resultBlockNumber: 100, resultTransactionHash: `0x${"11".repeat(32)}` },
    { resultReceivedAt: "2024-01-09T21:41:11.000001Z", resultBlockNumber: 100,
      resultTransactionHash: `0x${"11".repeat(32)}` },
    { cancelTimestamp: 1704836471 },
    { queuingTime: 1704836471 }
  ])("rejects incomplete or impossible accepted-result evidence: %o", async (override) => {
    const { client, block } = aaveRpcFixture();
    const original = await client.getDecision("0", [], null, block);
    expect(() => assertAaveObservation({ ...original, aave: { ...original.aave!, ...override } })).toThrow();
  });
});
