import type { Env } from "../../config/env.js";
import type { Logger } from "pino";
import type { EvmGovernanceAdapter, GovernanceContractEvent, StoredGovernanceDecision } from "../types.js";
import { AAVE_GOVERNANCE_DEPLOYMENT_BLOCK, AaveOnchainClient } from "./aaveOnchain.client.js";

export class AaveOnchainGovernanceAdapter implements EvmGovernanceAdapter {
  readonly protocol = "aave";
  readonly sourceType = "onchain" as const;
  readonly chainId = 1;
  readonly deploymentBlock = AAVE_GOVERNANCE_DEPLOYMENT_BLOCK;
  readonly maxLogBlockRange = 10_000;
  readonly reorgOverlapBlocks = 64;
  readonly proposalIdScheme = "zero-based-count" as const;
  readonly sourceKey: string;
  readonly contractAddress: string;
  readonly enabled: boolean;
  readonly notificationsEnabled: boolean;
  private readonly client: AaveOnchainClient;

  constructor(env: Env, client?: AaveOnchainClient, logger?: Pick<Logger, "warn">) {
    this.client = client ?? new AaveOnchainClient({ rpcUrl: env.ethereumRpcUrl, logger });
    this.sourceKey = this.client.sourceKey;
    this.contractAddress = this.client.governorAddress;
    this.enabled = env.aaveOnchainEnabled;
    this.notificationsEnabled = env.aaveOnchainNotificationsEnabled;
  }

  validateSource() { return this.client.validateSource(); }
  getBlock(number: number) { return this.client.getBlock(number); }
  getEvents(from: number, to: number) { return this.client.getEvents(from, to); }
  getDecision(id: string, events: GovernanceContractEvent[], existing: StoredGovernanceDecision | null, block: number,
    options?: { historical: boolean }) {
    return this.client.getDecision(id, events, existing, block, options);
  }
}
