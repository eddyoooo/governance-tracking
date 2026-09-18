import type { Env } from "../../config/env.js";
import type {
  EvmGovernanceAdapter,
  GovernanceBlockReference,
  GovernanceContractEvent,
  GovernanceDecisionObservation,
  GovernanceSourceValidation,
  StoredGovernanceDecision
} from "../types.js";
import {
  UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK,
  UNISWAP_MAINNET_CHAIN_ID,
  UNISWAP_ONCHAIN_LOG_BLOCK_RANGE,
  UNISWAP_ONCHAIN_REORG_OVERLAP_BLOCKS,
  UniswapOnchainClient
} from "./uniswapOnchain.client.js";

export class UniswapOnchainGovernanceAdapter
  implements EvmGovernanceAdapter
{
  readonly sourceType = "onchain" as const;
  readonly protocol = "uniswap";
  readonly chainId = UNISWAP_MAINNET_CHAIN_ID;
  readonly deploymentBlock = UNISWAP_GOVERNOR_DEPLOYMENT_BLOCK;
  readonly maxLogBlockRange = UNISWAP_ONCHAIN_LOG_BLOCK_RANGE;
  readonly reorgOverlapBlocks = UNISWAP_ONCHAIN_REORG_OVERLAP_BLOCKS;
  readonly sourceKey: string;
  readonly contractAddress: string;
  readonly enabled: boolean;
  readonly notificationsEnabled: boolean;

  constructor(
    env: Env,
    private readonly client = new UniswapOnchainClient({
      rpcUrl: env.ethereumRpcUrl,
      governorAddress: env.uniswapGovernorAddress,
      timelockAddress: env.uniswapTimelockAddress,
      uniTokenAddress: env.uniswapUniTokenAddress
    })
  ) {
    this.sourceKey = client.sourceKey;
    this.contractAddress = client.governorAddress;
    this.enabled = env.uniswapOnchainEnabled;
    this.notificationsEnabled = env.uniswapOnchainNotificationsEnabled;
  }

  validateSource(): Promise<GovernanceSourceValidation> {
    return this.client.validateSource();
  }

  getBlock(blockNumber: number): Promise<GovernanceBlockReference> {
    return this.client.getBlock(blockNumber);
  }

  getEvents(
    fromBlock: number,
    toBlock: number
  ): Promise<GovernanceContractEvent[]> {
    return this.client.getEvents(fromBlock, toBlock);
  }

  getDecision(
    proposalId: string,
    events: GovernanceContractEvent[],
    existing: StoredGovernanceDecision | null,
    observedAtBlock: number
  ): Promise<GovernanceDecisionObservation> {
    return this.client.getDecision(
      proposalId,
      events,
      existing,
      observedAtBlock
    );
  }
}
