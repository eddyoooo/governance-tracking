import { createPublicClient, getAddress, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { z } from "zod";
import type { Logger } from "pino";
import { hashObject } from "../../utils/hash.js";
import { safeErrorDetails } from "../../utils/errors.js";
import { createGovernanceDecisionId, outcomesForStatus } from "../governanceDecision.js";
import { blockReference } from "../uniswap/uniswapOnchain.codec.js";
import { validateGovernanceEvents } from "../onchainGovernance.validation.js";
import type { AaveGovernanceData, GovernanceContractEvent, GovernanceDecisionObservation,
  GovernanceSourceValidation, StoredGovernanceDecision } from "../types.js";
import { AAVE_GOVERNANCE_ABI, AAVE_GOVERNANCE_EVENTS } from "./aaveGovernance.abi.js";
import { aaveMetadataCid, aaveStatus, assertAaveObservation } from "./aaveGovernance.model.js";

export const AAVE_GOVERNANCE_ADDRESS = "0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7";
export const AAVE_GOVERNANCE_DEPLOYMENT_BLOCK = 18_119_225;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const uint = z.union([z.bigint().nonnegative(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .transform((value) => BigInt(value));
const safeUint = uint.refine((value) => value <= BigInt(Number.MAX_SAFE_INTEGER))
  .transform(Number);
const proposalSchema = z.object({
  state: z.number().int().min(1).max(7), accessLevel: z.number().int().min(1).max(2),
  creationTime: safeUint, votingDuration: safeUint, votingActivationTime: safeUint,
  queuingTime: safeUint, cancelTimestamp: safeUint, creator: address, votingPortal: address,
  snapshotBlockHash: hash, ipfsHash: hash, forVotes: uint, againstVotes: uint,
  payloads: z.array(z.object({ chain: uint, accessLevel: z.number().int().min(1).max(2),
    payloadsController: address, payloadId: uint })).min(1).max(100)
});
const logSchema = z.object({
  address, eventName: z.enum(["ProposalCreated", "VotingActivated", "ProposalQueued",
    "ProposalFailed", "ProposalCanceled", "ProposalExecuted"]),
  args: z.object({ proposalId: uint, creator: address.optional(), ipfsHash: hash.optional(),
    votesFor: uint.optional(), votesAgainst: uint.optional(),
    snapshotBlockHash: hash.optional(), votingDuration: safeUint.optional() }).passthrough(),
  blockNumber: safeUint, blockHash: hash, transactionHash: hash,
  logIndex: z.number().int().nonnegative(), removed: z.boolean().optional()
});
const EVENT_TYPES = {
  ProposalCreated: "created", VotingActivated: "activated", ProposalQueued: "queued",
  ProposalFailed: "defeated", ProposalCanceled: "canceled", ProposalExecuted: "executed"
} as const;

export interface AaveOnchainClientOptions {
  rpcUrl?: string;
  publicClient?: PublicClient;
  fetchImpl?: typeof fetch;
  metadataEnabled?: boolean;
  logger?: Pick<Logger, "warn">;
}

export class AaveOnchainClient {
  readonly governorAddress = AAVE_GOVERNANCE_ADDRESS;
  readonly sourceKey = `aave:onchain:1:${AAVE_GOVERNANCE_ADDRESS.toLowerCase()}`;
  private readonly client: PublicClient;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AaveOnchainClientOptions) {
    if (!options.publicClient && !options.rpcUrl) throw new Error("Aave requires an Ethereum RPC URL.");
    this.client = options.publicClient ?? createPublicClient({
      chain: mainnet, transport: http(options.rpcUrl, { timeout: 15_000, retryCount: 3, retryDelay: 500 })
    });
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async validateSource(): Promise<GovernanceSourceValidation> {
    const [chainId, block] = await Promise.all([
      this.client.getChainId(), this.client.getBlock({ blockTag: "finalized" })
    ]);
    if (chainId !== 1) throw new Error("Aave governance RPC must use Ethereum mainnet chain id 1.");
    const finalized = blockReference(block);
    if (finalized.number < AAVE_GOVERNANCE_DEPLOYMENT_BLOCK) throw new Error("Aave finalized head predates deployment.");
    const at = BigInt(finalized.number);
    const [code, implementationSlot, name, proposalCount] = await Promise.all([
      this.client.getCode({ address: this.governorAddress, blockNumber: at }),
      this.client.getStorageAt({ address: this.governorAddress, slot: IMPLEMENTATION_SLOT, blockNumber: at }),
      this.read("NAME", at), this.read("getProposalsCount", at)
    ]);
    if (!code || code === "0x" || name !== "Aave Governance v3" ||
        !implementationSlot || !/^0x[0-9a-fA-F]{64}$/.test(implementationSlot)) {
      throw new Error("Aave Governance V3 proxy identity validation failed.");
    }
    const implementation = getAddress(`0x${implementationSlot.slice(-40)}`);
    const implementationCode = await this.client.getCode({ address: implementation, blockNumber: at });
    if (!implementationCode || implementationCode === "0x") throw new Error("Aave implementation has no contract code.");
    return {
      chainId: 1, latestFinalizedBlock: finalized, implementationAddress: implementation,
      proposalCount: uint.parse(proposalCount).toString(), initialProposalId: "0",
      proposalIdScheme: "zero-based-count"
    };
  }

  async getBlock(number: number) {
    if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid Aave block number.");
    const block = blockReference(await this.client.getBlock({ blockNumber: BigInt(number) }));
    if (block.number !== number) throw new Error("Aave RPC returned the wrong block.");
    return block;
  }

  async getEvents(from: number, to: number): Promise<GovernanceContractEvent[]> {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
        from < AAVE_GOVERNANCE_DEPLOYMENT_BLOCK || to < from || to - from >= 10_000) {
      throw new Error("Invalid Aave governance log range (maximum 10,000 blocks).");
    }
    const logs = await this.client.getLogs({ address: this.governorAddress,
      events: AAVE_GOVERNANCE_EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to), strict: true });
    const events = logs.map((raw) => {
      const log = logSchema.parse(raw);
      if (log.removed || log.address.toLowerCase() !== this.governorAddress.toLowerCase()) {
        throw new Error("Aave RPC returned a removed log or the wrong emitter.");
      }
      if ((log.eventName === "ProposalCreated" && (!log.args.creator || !log.args.ipfsHash)) ||
          ((log.eventName === "ProposalQueued" || log.eventName === "ProposalFailed") &&
           (log.args.votesFor === undefined || log.args.votesAgainst === undefined)) ||
          (log.eventName === "VotingActivated" && (!log.args.snapshotBlockHash || !log.args.votingDuration))) {
        throw new Error("Aave lifecycle event arguments are incomplete.");
      }
      return {
        id: `${log.transactionHash}:${log.logIndex}`, type: EVENT_TYPES[log.eventName],
        proposalId: log.args.proposalId.toString(), blockNumber: log.blockNumber,
        blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.logIndex,
        ...(log.args.creator ? { proposer: getAddress(log.args.creator) } : {}),
        ...(log.args.ipfsHash ? { metadataHash: log.args.ipfsHash } : {}),
        ...(log.args.votesFor !== undefined ? { forVotes: log.args.votesFor.toString(),
          againstVotes: log.args.votesAgainst!.toString() } : {}),
        ...(log.args.snapshotBlockHash ? { snapshotBlockHash: log.args.snapshotBlockHash } : {}),
        ...(log.args.votingDuration !== undefined ? { votingDuration: log.args.votingDuration } : {})
      };
    });
    return validateGovernanceEvents(events, from, to, "zero-based-count");
  }

  async getDecision(id: string, events: GovernanceContractEvent[], existing: StoredGovernanceDecision | null,
    observedAtBlock: number, options?: { historical: boolean }): Promise<GovernanceDecisionObservation> {
    if (!/^(?:0|[1-9]\d*)$/.test(id) || !Number.isSafeInteger(observedAtBlock) ||
        observedAtBlock < AAVE_GOVERNANCE_DEPLOYMENT_BLOCK ||
        events.some((event) => event.proposalId !== id || event.blockNumber > observedAtBlock)) {
      throw new Error("Invalid Aave proposal request.");
    }
    const byType = new Map<GovernanceContractEvent["type"], GovernanceContractEvent>();
    for (const event of events) {
      if (byType.has(event.type)) {
        throw new Error(`Aave proposal ${id} returned multiple ${event.type} events.`);
      }
      byType.set(event.type, event);
    }
    const p = proposalSchema.parse(await this.client.readContract({ address: this.governorAddress,
      abi: AAVE_GOVERNANCE_ABI, functionName: "getProposal", args: [BigInt(id)], blockNumber: BigInt(observedAtBlock) }));
    const status = aaveStatus(p.state);
    const created = byType.get("created");
    const queued = byType.get("queued");
    const executed = byType.get("executed");
    const canceled = byType.get("canceled");
    const activated = byType.get("activated");
    const defeated = byType.get("defeated");
    if ((created?.proposer && created.proposer.toLowerCase() !== p.creator.toLowerCase()) ||
        (executed && status !== "executed") || (canceled && status !== "canceled") ||
        (defeated && status !== "defeated") ||
        (queued && p.queuingTime === 0) ||
        (activated && p.votingActivationTime === 0)) {
      throw new Error("Aave proposal state conflicts with its lifecycle logs.");
    }
    const result = queued ?? defeated;
    if ((created?.metadataHash && created.metadataHash.toLowerCase() !== p.ipfsHash.toLowerCase()) ||
        (result?.forVotes !== undefined &&
         (result.forVotes !== p.forVotes.toString() || result.againstVotes !== p.againstVotes.toString())) ||
        (activated?.votingDuration !== undefined && activated.votingDuration !== p.votingDuration) ||
        (activated?.snapshotBlockHash && activated.snapshotBlockHash.toLowerCase() !== p.snapshotBlockHash.toLowerCase())) {
      throw new Error("Aave proposal metadata, voting snapshot, duration, or totals conflict with its canonical logs.");
    }
    const aave: AaveGovernanceData = {
      nativeState: p.state, creationTime: p.creationTime, votingActivationTime: p.votingActivationTime,
      votingDuration: p.votingDuration, queuingTime: p.queuingTime, cancelTimestamp: p.cancelTimestamp,
      votingPortal: getAddress(p.votingPortal), snapshotBlockHash: p.snapshotBlockHash,
      ipfsHash: p.ipfsHash, metadataCid: aaveMetadataCid(p.ipfsHash),
      payloads: p.payloads.map((payload) => ({ chain: payload.chain.toString(), accessLevel: payload.accessLevel,
        payloadsController: getAddress(payload.payloadsController), payloadId: payload.payloadId.toString() })),
      executionScope: "governance-core",
      ...(existing?.aave?.resultReceivedAt ? { resultReceivedAt: existing.aave.resultReceivedAt,
        resultBlockNumber: existing.aave.resultBlockNumber,
        resultTransactionHash: existing.aave.resultTransactionHash } : {}),
      ...(result ? await this.readResultEvidence(result, p) : {})
    };
    const outcomes = status === "expired" && p.queuingTime === 0
      ? { voteOutcome: "pending" as const, executionOutcome: "expired" as const }
      : status === "canceled" && p.queuingTime > 0
        ? { voteOutcome: "succeeded" as const, executionOutcome: "canceled" as const }
        : outcomesForStatus(status);
    const metadata = await this.getMetadata(aave.metadataCid, id, existing, options?.historical ?? false, status);
    const observation: GovernanceDecisionObservation = {
      id: createGovernanceDecisionId({ protocol: "aave", chainId: 1, governorAddress: this.governorAddress, proposalId: id }),
      sourceKey: this.sourceKey, protocol: "aave", sourceType: "onchain", chainId: 1,
      governorAddress: this.governorAddress, proposalId: id, proposer: getAddress(p.creator),
      ...metadata, sourceUrl: `https://vote.onaave.com/proposal/?proposalId=${id}`,
      status, ...outcomes, aave, eta: null,
      forVotes: p.forVotes.toString(), againstVotes: p.againstVotes.toString(), abstainVotes: "0", actions: [],
      ...(created ? { createdBlockNumber: created.blockNumber, createdTransactionHash: created.transactionHash } : {}),
      ...(queued ? { queuedBlockNumber: queued.blockNumber, queuedTransactionHash: queued.transactionHash } : {}),
      ...(executed ? { executedBlockNumber: executed.blockNumber, executedTransactionHash: executed.transactionHash } : {}),
      ...(canceled ? { canceledBlockNumber: canceled.blockNumber, canceledTransactionHash: canceled.transactionHash } : {}),
      lastObservedBlockNumber: observedAtBlock, rawHash: hashObject(aave)
    };
    assertAaveObservation(observation);
    return observation;
  }

  private async readResultEvidence(
    result: GovernanceContractEvent,
    proposal: Pick<z.infer<typeof proposalSchema>, "votingActivationTime" | "votingDuration" | "queuingTime">
  ): Promise<Pick<AaveGovernanceData, "resultReceivedAt" | "resultBlockNumber" | "resultTransactionHash">> {
    const block = await this.getBlock(result.blockNumber);
    if (block.hash.toLowerCase() !== result.blockHash.toLowerCase()) {
      throw new Error(`Aave result block hash does not match its log at block ${result.blockNumber}.`);
    }
    const settledAt = Date.parse(block.timestamp) / 1_000;
    if (settledAt <= proposal.votingActivationTime + proposal.votingDuration) {
      throw new Error("Aave result settlement is not after its voting window.");
    }
    if (result.type === "queued" && settledAt !== proposal.queuingTime) {
      throw new Error("Aave result block time does not match the on-chain queue timestamp.");
    }
    return {
      resultReceivedAt: block.timestamp,
      resultBlockNumber: result.blockNumber,
      resultTransactionHash: result.transactionHash
    };
  }

  private read(functionName: "NAME" | "getProposalsCount", blockNumber: bigint) {
    return this.client.readContract({ address: this.governorAddress, abi: AAVE_GOVERNANCE_ABI, functionName, blockNumber });
  }

  private async getMetadata(cid: string, id: string, existing: StoredGovernanceDecision | null, historical: boolean,
    status: GovernanceDecisionObservation["status"]) {
    const fallback = `Aave governance proposal #${id}`;
    if (existing && (existing.title !== fallback || existing.status === status)) {
      return { title: existing.title, description: existing.description };
    }
    if (!historical && this.options.metadataEnabled !== false) {
      try {
        const response = await this.fetchImpl(`https://ipfs.io/ipfs/${cid}`, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error(`Metadata gateway returned ${response.status}.`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Metadata gateway returned no body.");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 200_000) throw new Error("Aave metadata exceeds 200 KB.");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const metadata = z.object({ title: z.string().trim().min(1).max(300),
          description: z.string().max(150_000).optional() }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        return { title: metadata.title, description: metadata.description ?? "" };
      } catch (error) {
        this.options.logger?.warn({ proposalId: id, error: safeErrorDetails(error) },
          "Aave metadata unavailable; retaining on-chain identity and proposal link");
      }
    }
    return { title: existing?.title ?? fallback, description: existing?.description ?? "" };
  }
}
