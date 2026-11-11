import type { PublicClient } from "viem";
import type { Env } from "../config/env.js";
import { AaveOnchainGovernanceAdapter } from "../onchain/aave/aaveOnchain.adapter.js";
import { AaveOnchainClient } from "../onchain/aave/aaveOnchain.client.js";
import type { GovernanceSourceValidation } from "../onchain/types.js";
import { aaveOnchainEventFixtures as events, aaveOnchainProposalFixture as proposal } from "./aaveOnchain.fixture.js";

// Only the timing is scripted: identities, vote totals, payloads and lifecycle logs are real.
export class ScriptedAaveOnchainDemoAdapter extends AaveOnchainGovernanceAdapter {
  private phase: "baseline" | "created" | "executed" = "baseline";

  constructor(env: Env) {
    const control = { phase: "baseline" as "baseline" | "created" | "executed" };
    const client = new AaveOnchainClient({ metadataEnabled: false, publicClient: {
      readContract: async () => ({ ...proposal,
        ...(control.phase === "created" ? { state: 1, votingDuration: 0, votingActivationTime: 0,
          queuingTime: 0, forVotes: 0n } : {}) }),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        const number = Number(blockNumber);
        const event = events.find((item) => item.blockNumber === number);
        return { number: blockNumber, hash: event?.blockHash ?? `0x${number.toString(16).padStart(64, "0")}`,
          timestamp: BigInt(number >= events[2].blockNumber ? proposal.queuingTime : proposal.creationTime) };
      }
    } as unknown as PublicClient });
    super(env, client);
    this.control = control;
  }
  private readonly control: { phase: "baseline" | "created" | "executed" };
  setPhase(phase: "baseline" | "created" | "executed"): void {
    this.phase = phase;
    this.control.phase = phase;
  }
  override async validateSource(): Promise<GovernanceSourceValidation> {
    const head = this.phase === "baseline" ? events[0].blockNumber - 1
      : this.phase === "created" ? events[0].blockNumber : events[3].blockNumber;
    return { chainId: 1, latestFinalizedBlock: await this.getBlock(head),
      implementationAddress: "0x58BcB647C4beFf253B4B6996c62F737B783f2cDd",
      initialProposalId: "0", proposalCount: this.phase === "baseline" ? "0" : "1",
      proposalIdScheme: "zero-based-count" };
  }
  override async getEvents(from: number, to: number) {
    const visible = this.phase === "baseline" ? [] : this.phase === "created" ? events.slice(0, 1) : events;
    return structuredClone(visible.filter((event) => event.blockNumber >= from && event.blockNumber <= to));
  }
}
