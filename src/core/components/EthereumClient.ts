import type { NodeInfo } from "@aztec/aztec.js";
import {
  getAddressFromPrivateKey,
  GSEContract,
  type ViemPublicClient,
} from "@aztec/ethereum";
import { GovernanceAbi, GSEAbi, RollupAbi } from "@aztec/l1-artifacts";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  getContract,
  http,
  type Address,
  type GetContractReturnType,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import {
  CuratedKeystoreData,
  MOCK_REGISTRY_ABI
} from "../../types.js";

const SUPPORTED_CHAINS = [sepolia, mainnet];

type RollupContract = GetContractReturnType<typeof RollupAbi, PublicClient>;

export interface EthereumClientConfig {
  rpcUrl: string;
  chainId: number;
  rollupAddress: Address;
}

export type CalldataExport = {
  address: string;
  calldata: ReturnType<typeof encodeFunctionData>;
};

export class EthereumClient {
  private readonly client: PublicClient;
  private readonly config: EthereumClientConfig;
  private rollupContract?: RollupContract;
  private stakingRegistryContract?: any;

  constructor(config: EthereumClientConfig) {
    this.config = config;

    const chain = SUPPORTED_CHAINS.find((c) => c.id === config.chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }

    this.client = createPublicClient({
      transport: http(config.rpcUrl),
      chain,
    });
  }

  /**
   * Get the underlying viem PublicClient
   */
  getPublicClient(): PublicClient {
    return this.client;
  }

  /**
   * Get the chain ID
   */
  getChainId(): number {
    return this.config.chainId;
  }

  /**
   * Get the rollup contract instance (lazy initialization)
   */
  getRollupContract(): RollupContract {
    if (!this.rollupContract) {
      this.rollupContract = getContract({
        address: this.config.rollupAddress,
        abi: RollupAbi,
        client: this.client,
      });
    }
    return this.rollupContract;
  }

  /**
   * Get the staking registry contract address for this chain
   */
  getStakingRegistryAddress(): Address {
    if (this.config.chainId === 11155111) {
      return getAddress("0xc3860c45e5F0b1eF3000dbF93149756f16928ADB");
    } else if (this.config.chainId === 1) {
      return getAddress("0x042dF8f42790d6943F41C25C2132400fd727f452");
    }
    throw new Error(`Unsupported chain ID: ${this.config.chainId}`);
  }

  /**
   * Get the staking registry contract instance (lazy initialization)
   */
  getStakingRegistryContract() {
    if (!this.stakingRegistryContract) {
      this.stakingRegistryContract = getContract({
        address: this.getStakingRegistryAddress(),
        abi: MOCK_REGISTRY_ABI,
        client: this.client,
      });
    }
    return this.stakingRegistryContract;
  }

  /**
   * Verify the client is connected to the expected chain
   */
  async verifyChainId(): Promise<void> {
    const actualChainId = await this.client.getChainId();
    if (actualChainId !== this.config.chainId) {
      throw new Error(
        `Chain ID mismatch: expected ${this.config.chainId}, got ${actualChainId}`,
      );
    }
  }

  /**
   * Get Etherscan address URL for the current chain
   */
  private getEtherscanAddressUrl(address: Address): string {
    const etherscanBaseUrl = this.client.chain?.blockExplorers?.default.url!;
    return `${etherscanBaseUrl}/address/${address}`;
  }

  /**
   * Print important contract information
   */
  async printImportantInfo(): Promise<void> {
    console.log(`Ethereum chain: ${this.client?.chain?.id} (${this.client?.chain?.name})
`);
    const rollupContract = this.getRollupContract();
    const gse = await rollupContract.read.getGSE();
    const governance = await getContract({
      address: gse,
      abi: GSEAbi,
      client: this.client,
    }).read.getGovernance();
    const governanceConfig = await getContract({
      address: governance,
      abi: GovernanceAbi,
      client: this.client,
    }).read.getConfiguration();
    // NOTE: withdrawal delay copied from https://github.com/AztecProtocol/l1-contracts/blob/f0b17231361e40b6802e927fda98b8d5f84c1c24/src/governance/libraries/ConfigurationLib.sol#L36
    const { votingDelay, votingDuration, executionDelay } = governanceConfig;
    const withdrawalDelayTimeStamp =
      votingDelay / 5n + votingDuration + executionDelay;
    const withdrawalDelayInHrs = Number(withdrawalDelayTimeStamp) / 60 / 60;
    console.log(`rollup contract (${this.getEtherscanAddressUrl(rollupContract.address)}):
  rewarddistributor: ${this.getEtherscanAddressUrl(await rollupContract.read.getRewardDistributor())}
  gse: ${this.getEtherscanAddressUrl(gse)}
  governance: ${this.getEtherscanAddressUrl(governance)}
  governance config: ${JSON.stringify(governanceConfig, (key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}
  withdrawal delay (in hrs): ${withdrawalDelayInHrs}
  isrewardsclaimable: ${await rollupContract.read.isRewardsClaimable()}
`);

    const feeTokenContract = getContract({
      address: await rollupContract.read.getFeeAsset(),
      abi: erc20Abi,
      client: this.client,
    });
    console.log(`Fee token(${this.getEtherscanAddressUrl(feeTokenContract.address)}):
name: ${await feeTokenContract.read.name()}
symbol: ${await feeTokenContract.read.symbol()}
supply: ${await feeTokenContract.read.totalSupply()}
`);
    const stakingAssetContract = getContract({
      address: await rollupContract.read.getStakingAsset(),
      abi: erc20Abi,
      client: this.client,
    });
    console.log(`Staking token(${this.getEtherscanAddressUrl(stakingAssetContract.address)}):
name: ${await stakingAssetContract.read.name()}
symbol: ${await stakingAssetContract.read.symbol()}
supply: ${await stakingAssetContract.read.totalSupply()}
`);
  }

  /**
   * Get provider ID for a given admin address
   * Iterates through provider registry until a match is found
   */
  async getProviderId(adminAddress: string): Promise<bigint> {
    const stakingReg = this.getStakingRegistryContract();
    let index = 0n;

    while (true) {
      try {
        const [admin, takeRate, rewardsRecipient] =
          await stakingReg.read.providerConfigurations([index]);
        if (admin.toLowerCase() === adminAddress.toLowerCase()) {
          console.log(
            `${index} - Admin: ${admin}, Take Rate: ${takeRate}, Rewards Recipient: ${rewardsRecipient}`,
          );
          return index;
        }
        index++;
      } catch (error) {
        // No more providers found
        return -1n;
      }
    }
  }

  /**
   * Get the queue length for a provider
   */
  async getProviderQueueLength(providerId: bigint): Promise<bigint> {
    const stakingReg = this.getStakingRegistryContract();
    return await stakingReg.read.getProviderQueueLength([providerId]);
  }

  /**
   * Get provider configuration
   */
  async getProviderConfiguration(providerId: bigint): Promise<{
    admin: Address;
    takeRate: number;
    rewardsRecipient: Address;
  }> {
    const stakingReg = this.getStakingRegistryContract();
    const [admin, takeRate, rewardsRecipient] =
      await stakingReg.read.providerConfigurations([providerId]);

    return { admin, takeRate, rewardsRecipient };
  }

  /**
   * Generate calldata for approving staking token spend
   */
  async getApproveStakeSpendCalldata(
    currentTokenHolderAddress: string,
    nbrOfAttesters: number = 1,
  ): Promise<CalldataExport> {
    const rollupContract = this.getRollupContract();
    const activationThreshold =
      await rollupContract.read.getActivationThreshold();
    console.log(`Activation threshold: ${activationThreshold}`);
    const stakingAssetAddress = await rollupContract.read.getStakingAsset();

    const currentTokenHoldings = await getContract({
      address: stakingAssetAddress,
      abi: erc20Abi,
      client: this.client,
    }).read.balanceOf([getAddress(currentTokenHolderAddress)]);

    const requiredAllowance = activationThreshold * BigInt(nbrOfAttesters);
    if (currentTokenHoldings < requiredAllowance) {
      console.warn(`
WARNING: Not enough staking tokens held by the rollup contract. Held: ${currentTokenHoldings}, required: ${requiredAllowance}
`);
    }

    return {
      address: stakingAssetAddress,
      calldata: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [rollupContract.address, requiredAllowance],
      }),
    };
  }

  /**
   * Generate calldata for depositing an attester
   */
  async getDepositCalldata(
    attesterAddress: string,
    withdrawerAddress: string,
    blsSecretKey: string,
    moveWithLatestRollup: boolean = true,
    nodeInfo: NodeInfo,
  ): Promise<CalldataExport> {
    const rollupContract = this.getRollupContract();

    const gse = new GSEContract(
      this.client as ViemPublicClient,
      await rollupContract.read.getGSE(),
    );
    const registrationTuple = await gse.makeRegistrationTuple(
      BigInt(blsSecretKey),
    );

    return {
      address: rollupContract.address,
      calldata: encodeFunctionData({
        abi: RollupAbi,
        functionName: "deposit",
        args: [
          getAddress(attesterAddress),
          getAddress(withdrawerAddress),
          registrationTuple.publicKeyInG1,
          registrationTuple.publicKeyInG2,
          registrationTuple.proofOfPossession,
          moveWithLatestRollup,
        ],
      }),
    };
  }

  /**
   * Log attesters calldata for multiple keystore entries
   */
  async logAttestersCalldata(
    keystoreData: CuratedKeystoreData[],
    withdrawerAddress: string,
    nodeInfo: NodeInfo,
  ): Promise<void> {
    for (const d of keystoreData) {
      const attesterAddress = getAddressFromPrivateKey(
        d.ethPrivateKey as `0x${string}`,
      );
      const calldatata = await this.getDepositCalldata(
        attesterAddress,
        withdrawerAddress,
        d.blsSecretKey,
        true,
        nodeInfo,
      );
      console.log(
        `✅ Deposit calldata for attester ${attesterAddress}:`,
        calldatata,
      );
    }
  }
}
