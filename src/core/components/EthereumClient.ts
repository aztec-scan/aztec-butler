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
  HttpTransportConfig,
  parseAbiItem,
  type Address,
  type GetContractReturnType,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import {
  CuratedKeystoreData,
  STAKING_REGISTRY_ABI,
  StakingRegistryContract,
  type StakingProviderData,
  type AttesterRegistration,
  type HexString,
  type AttesterView,
  AttesterOnChainStatus,
} from "../../types/index.js";

const SUPPORTED_CHAINS = [sepolia, mainnet];

type RollupContract = GetContractReturnType<typeof RollupAbi, PublicClient>;
type GovernanceContract = GetContractReturnType<
  typeof GovernanceAbi,
  PublicClient
>;
type GSEContractType = GetContractReturnType<typeof GSEAbi, PublicClient>;
type ERC20Contract = GetContractReturnType<typeof erc20Abi, PublicClient>;

type EntryQueueData = {
  attester: string;
  withdrawer: string;
  publicKeyInG1: { x: bigint; y: bigint };
  publicKeyInG2: { x0: bigint; x1: bigint; y0: bigint; y1: bigint };
  proofOfPossession: { x: bigint; y: bigint };
  moveWithLatestRollup: boolean;
};

type SplitAllocationData = {
  recipients: string[];
  allocations: bigint[];
  totalAllocation: bigint;
};

const SPLIT_UPDATED_EVENT = parseAbiItem(
  "event SplitUpdated((address[] recipients,uint256[] allocations,uint256 totalAllocation,uint16 distributorFee) split)",
);
const ADDRESS_MASK = (1n << 160n) - 1n;
const LOG_RANGE_LIMIT = 50_000n;

export interface EthereumClientConfig {
  rpcUrl: string;
  archiveRpcUrl?: string;
  chainId: number;
  rollupAddress: Address;
}

export type CalldataExport = {
  address: string;
  calldata: ReturnType<typeof encodeFunctionData>;
};

export class EthereumClient {
  private readonly client: PublicClient;
  private readonly archiveClient?: PublicClient;
  private readonly config: EthereumClientConfig;
  private rollupContract?: RollupContract;
  private archiveRollupContract?: RollupContract;
  private stakingRegistryContract?: StakingRegistryContract;
  private providerDataCache: Map<string, StakingProviderData | null> =
    new Map();

  constructor(config: EthereumClientConfig) {
    this.config = config;

    const chain = SUPPORTED_CHAINS.find((c) => c.id === config.chainId);
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }

    const httpConf: HttpTransportConfig = {
      onFetchRequest: async (request) => {
        // TODO: make this available through debug-flag
        // const clonedRequest = request.clone();
        // const body = await clonedRequest.text();
        // console.log(body);
      },
    };
    this.client = createPublicClient({
      transport: http(config.rpcUrl, httpConf),
      chain,
    });

    if (config.archiveRpcUrl) {
      this.archiveClient = createPublicClient({
        transport: http(config.archiveRpcUrl),
        chain,
      });
    }
  }

  /**
   * Get the underlying viem PublicClient
   */
  getPublicClient(): PublicClient {
    return this.client;
  }

  /**
   * Get archive client (if configured)
   */
  getArchiveClient(): PublicClient | null {
    return this.archiveClient ?? null;
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
   * Get rollup contract using archive client when available (for historical calls)
   */
  getRollupContractForHistorical(): RollupContract {
    if (this.archiveClient) {
      if (!this.archiveRollupContract) {
        this.archiveRollupContract = getContract({
          address: this.config.rollupAddress,
          abi: RollupAbi,
          client: this.archiveClient,
        });
      }
      return this.archiveRollupContract;
    }
    return this.getRollupContract();
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
  getStakingRegistryContract(): StakingRegistryContract {
    if (!this.stakingRegistryContract) {
      this.stakingRegistryContract = getContract({
        address: this.getStakingRegistryAddress(),
        abi: STAKING_REGISTRY_ABI,
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
    const primaryClient = this.client;
    console.log(`Ethereum chain: ${primaryClient?.chain?.id} (${primaryClient?.chain?.name})
`);
    const rollupContract = this.getRollupContract();
    const gse = await rollupContract.read.getGSE();
    const governance = await getContract({
      address: gse,
      abi: GSEAbi,
      client: primaryClient,
    }).read.getGovernance();
    const governanceConfig = await getContract({
      address: governance,
      abi: GovernanceAbi,
      client: primaryClient,
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
      client: primaryClient,
    });
    console.log(`Fee token(${this.getEtherscanAddressUrl(feeTokenContract.address)}):
name: ${await feeTokenContract.read.name()}
symbol: ${await feeTokenContract.read.symbol()}
supply: ${await feeTokenContract.read.totalSupply()}
`);
    const stakingAssetContract = getContract({
      address: await rollupContract.read.getStakingAsset(),
      abi: erc20Abi,
      client: primaryClient,
    });
    console.log(`Staking token(${this.getEtherscanAddressUrl(stakingAssetContract.address)}):
name: ${await stakingAssetContract.read.name()}
symbol: ${await stakingAssetContract.read.symbol()}
supply: ${await stakingAssetContract.read.totalSupply()}
`);
  }

  /**
   * Get staking provider data for a given admin address
   * Iterates through staking provider registry until a match is found
   * Results are memoized per admin address
   */
  async getStakingProvider(
    adminAddress: string,
  ): Promise<StakingProviderData | null> {
    // Check cache first
    if (this.providerDataCache.has(adminAddress)) {
      return this.providerDataCache.get(adminAddress)!;
    }

    const stakingReg = this.getStakingRegistryContract();
    let index = 0n;

    while (true) {
      try {
        const [admin, takeRate, rewardsRecipient] =
          await stakingReg.read.providerConfigurations([index]);
        if (admin === adminAddress) {
          const providerData: StakingProviderData = {
            providerId: index,
            admin,
            takeRate,
            rewardsRecipient,
          };
          // Cache the result
          this.providerDataCache.set(adminAddress, providerData);
          return providerData;
        }
        index++;
      } catch (error) {
        // No more providers found
        this.providerDataCache.set(adminAddress, null);
        return null;
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
   * Get the full queue of attesters for a provider
   * Iterates through queue indices to fetch all attester addresses
   */
  async getProviderQueue(providerId: bigint): Promise<string[]> {
    const stakingReg = this.getStakingRegistryContract();

    const firstIndex = await stakingReg.read.getFirstIndexInQueue([providerId]);
    const lastIndex = await stakingReg.read.getLastIndexInQueue([providerId]);

    const queue: string[] = [];

    // Iterate through queue indices
    for (let i = firstIndex; i < lastIndex; i++) {
      try {
        const entry = await stakingReg.read.getValueAtIndexInQueue([
          providerId,
          i,
        ]);
        // Extract attester address from the tuple (first element)
        queue.push(entry.attester);
      } catch (error) {
        console.warn(`Failed to fetch queue entry at index ${i}:`, error);
        // Continue with next index
      }
    }

    return queue;
  }

  /**
   * Fetch the latest SplitUpdated event data for a split (coinbase) contract
   */
  async getLatestSplitAllocations(
    splitAddress: string,
    fromBlock?: bigint,
    toBlock?: bigint,
  ): Promise<SplitAllocationData | null> {
    const address = getAddress(splitAddress);
    const latestBlock = toBlock ?? (await this.client.getBlockNumber());
    const lowerBound = fromBlock ?? 0n;

    const fetchLogs = async (
      rangeFrom: bigint,
      rangeTo: bigint,
    ): Promise<any[]> => {
      try {
        return await this.client.getLogs({
          address,
          event: SPLIT_UPDATED_EVENT,
          fromBlock: rangeFrom,
          toBlock: rangeTo,
        });
      } catch (err) {
        if (!this.archiveClient) {
          throw err;
        }
        console.warn(
          "[EthereumClient] Primary RPC getLogs failed, trying archive client...",
          err,
        );
        return await this.archiveClient.getLogs({
          address,
          event: SPLIT_UPDATED_EVENT,
          fromBlock: rangeFrom,
          toBlock: rangeTo,
        });
      }
    };

    let logs: any[] = [];
    let windowEnd = latestBlock;
    while (windowEnd >= lowerBound) {
      const windowStart =
        windowEnd > LOG_RANGE_LIMIT ? windowEnd - LOG_RANGE_LIMIT + 1n : 0n;
      const rangeFrom = windowStart < lowerBound ? lowerBound : windowStart;
      logs = await fetchLogs(rangeFrom, windowEnd);
      if (logs.length > 0) {
        break;
      }
      if (rangeFrom === 0n || rangeFrom === lowerBound) {
        break;
      }
      windowEnd = rangeFrom - 1n;
    }

    if (!logs.length) {
      return null;
    }

    const latestLog = logs[logs.length - 1];
    if (!latestLog) {
      return null;
    }
    return this.decodeSplitUpdatedData(latestLog.data);
  }

  /**
   * Get staking provider configuration using memoized staking provider data
   * This method uses the cached providerId from getStakingProvider
   */
  async getProviderConfiguration(adminAddress: string): Promise<{
    takeRate: number;
    rewardsRecipient: Address;
  } | null> {
    const providerData = await this.getStakingProvider(adminAddress);
    if (!providerData) {
      return null;
    }

    return {
      takeRate: providerData.takeRate,
      rewardsRecipient: providerData.rewardsRecipient as `0x${string}`,
    };
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
  ): Promise<CalldataExport> {
    const rollupContract = this.getRollupContract();

    const gseAddress = getAddress(await rollupContract.read.getGSE());
    const gse = new GSEContract(
      this.client as ViemPublicClient,
      gseAddress as any,
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
      );
      console.log(
        `✅ Deposit calldata for attester ${attesterAddress}:`,
        calldatata,
      );
    }
  }

  /**
   * Convert bigint to 0x-prefixed hex string (for JSON serialization)
   * @private
   */
  private bigintToHexString(bn: bigint): HexString {
    return `0x${bn.toString(16).padStart(64, "0")}`;
  }

  /**
   * Generate attester registration data from keystore BLS private key
   * @param attesterAddress - Ethereum address of the attester
   * @param blsSecretKey - BLS private key as string
   * @returns AttesterRegistration with public keys and proof of possession as bigint strings
   */
  async generateAttesterRegistrationData(
    attesterAddress: string,
    blsSecretKey: string,
  ): Promise<AttesterRegistration> {
    const rollupContract = this.getRollupContract();
    const gseAddress = getAddress(await rollupContract.read.getGSE());
    const gse = new GSEContract(
      this.client as ViemPublicClient,
      gseAddress as any,
    );

    const registrationTuple = await gse.makeRegistrationTuple(
      BigInt(blsSecretKey),
    );

    return {
      attester: attesterAddress,
      publicKeyG1: {
        x: this.bigintToHexString(registrationTuple.publicKeyInG1.x),
        y: this.bigintToHexString(registrationTuple.publicKeyInG1.y),
      },
      publicKeyG2: {
        x0: this.bigintToHexString(registrationTuple.publicKeyInG2.x0),
        x1: this.bigintToHexString(registrationTuple.publicKeyInG2.x1),
        y0: this.bigintToHexString(registrationTuple.publicKeyInG2.y0),
        y1: this.bigintToHexString(registrationTuple.publicKeyInG2.y1),
      },
      proofOfPossession: {
        x: this.bigintToHexString(registrationTuple.proofOfPossession.x),
        y: this.bigintToHexString(registrationTuple.proofOfPossession.y),
      },
    };
  }

  /**
   * Generate calldata for adding attester keys to staking provider
   * @param providerId - The staking provider ID
   * @param attesterRegistrations - Array of attester registration data
   * @returns CalldataExport with contract address and encoded calldata
   */
  async generateAddKeysToProviderCalldata(
    providerId: bigint,
    attesterRegistrations: AttesterRegistration[],
  ): Promise<CalldataExport> {
    // Transform attester data to match ABI structure
    const keyStores = attesterRegistrations.map((attesterData) => ({
      attester: getAddress(attesterData.attester),
      publicKeyG1: {
        x: BigInt(attesterData.publicKeyG1.x),
        y: BigInt(attesterData.publicKeyG1.y),
      },
      publicKeyG2: {
        x0: BigInt(attesterData.publicKeyG2.x0),
        x1: BigInt(attesterData.publicKeyG2.x1),
        y0: BigInt(attesterData.publicKeyG2.y0),
        y1: BigInt(attesterData.publicKeyG2.y1),
      },
      proofOfPossession: {
        x: BigInt(attesterData.proofOfPossession.x),
        y: BigInt(attesterData.proofOfPossession.y),
      },
    }));

    return {
      address: this.getStakingRegistryAddress(),
      calldata: encodeFunctionData({
        abi: STAKING_REGISTRY_ABI,
        functionName: "addKeysToProvider",
        args: [providerId, keyStores],
      }),
    };
  }

  /**
   * Get attester view from the rollup contract
   * This returns the on-chain state of an attester including their status
   * @param attesterAddress - The attester's Ethereum address
   * @returns AttesterView with status and other on-chain data, or null if not found/error
   */
  async getAttesterView(attesterAddress: string): Promise<AttesterView | null> {
    try {
      const rollupContract = this.getRollupContract();
      const result = await rollupContract.read.getAttesterView([
        getAddress(attesterAddress),
      ]);

      return {
        status: result.status as AttesterOnChainStatus,
        effectiveBalance: result.effectiveBalance,
        exit: {
          withdrawalId: result.exit.withdrawalId,
          amount: result.exit.amount,
          exitableAt: result.exit.exitableAt,
          recipientOrWithdrawer: result.exit.recipientOrWithdrawer,
          isRecipient: result.exit.isRecipient,
          exists: result.exit.exists,
        },
        config: {
          publicKey: {
            x: result.config.publicKey.x,
            y: result.config.publicKey.y,
          },
          withdrawer: result.config.withdrawer,
        },
      };
    } catch (error) {
      // If attester is not found on-chain, the call may revert or return default values
      // We'll return null to indicate the attester is not on-chain
      console.debug(
        `Attester ${attesterAddress} not found on-chain or error occurred:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get the number of active attesters
   * @returns Number of currently active attesters
   */
  async getActiveAttesterCount(): Promise<bigint> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getActiveAttesterCount();
  }

  /**
   * Get attester address at given index in active attesters array
   * @param index - Index in the active attesters array (0-based)
   * @returns Attester address at the given index
   */
  async getAttesterAtIndex(index: bigint): Promise<string> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getAttesterAtIndex([index]);
  }

  /**
   * Get all active attester addresses
   * Iterates through all active attesters using getActiveAttesterCount and getAttesterAtIndex
   * @returns Array of active attester addresses
   */
  async getAllActiveAttesters(): Promise<string[]> {
    const count = await this.getActiveAttesterCount();
    const attesters: string[] = [];

    console.log(`Fetching ${count} attesters...`);
    for (let i = 0n; i < count; i++) {
      try {
        const attester = await this.getAttesterAtIndex(i);
        attesters.push(attester);
      } catch (error) {
        console.warn(`Failed to fetch attester at index ${i}:`, error);
      }
    }

    return attesters;
  }

  /**
   * Get the length of the entry queue (attesters waiting to become active)
   * @returns Number of attesters in the entry queue
   */
  async getEntryQueueLength(): Promise<bigint> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getEntryQueueLength();
  }

  /**
   * Get entry queue data at given index
   * @param index - Index in the entry queue (0-based)
   * @returns DepositArgs containing attester address and registration data
   */
  async getEntryQueueAt(index: bigint): Promise<EntryQueueData> {
    const rollupContract = this.getRollupContract();
    const result = await rollupContract.read.getEntryQueueAt([index]);

    return {
      attester: result.attester,
      withdrawer: result.withdrawer,
      publicKeyInG1: {
        x: result.publicKeyInG1.x,
        y: result.publicKeyInG1.y,
      },
      publicKeyInG2: {
        x0: result.publicKeyInG2.x0,
        x1: result.publicKeyInG2.x1,
        y0: result.publicKeyInG2.y0,
        y1: result.publicKeyInG2.y1,
      },
      proofOfPossession: {
        x: result.proofOfPossession.x,
        y: result.proofOfPossession.y,
      },
      moveWithLatestRollup: result.moveWithLatestRollup,
    };
  }

  /**
   * Get all queued attester addresses
   * Iterates through entry queue to get all attesters waiting to become active
   * @returns Array of queued attester addresses
   */
  async getAllQueuedAttesters(): Promise<string[]> {
    const queueLength = await this.getEntryQueueLength();
    const attesters: string[] = [];

    console.log(`Fetching ${queueLength} queued attesters...`);
    for (let i = 0n; i < queueLength; i++) {
      try {
        const entry = await this.getEntryQueueAt(i);
        attesters.push(entry.attester);
      } catch (error) {
        console.warn(`Failed to fetch queue entry at index ${i}:`, error);
      }
    }

    return attesters;
  }

  private decodeSplitUpdatedData(data: Hex): SplitAllocationData {
    const payload = data.startsWith("0x") ? data.slice(2) : data;
    if (!payload || payload.length % 64 !== 0) {
      throw new Error("Invalid SplitUpdated payload");
    }

    const words: bigint[] = [];
    for (let i = 0; i < payload.length; i += 64) {
      words.push(BigInt(`0x${payload.slice(i, i + 64)}`));
    }

    if (words.length === 0) {
      throw new Error("Empty SplitUpdated payload");
    }

    const tupleBaseWord = words[0];
    if (tupleBaseWord === undefined) {
      throw new Error("Invalid SplitUpdated payload");
    }

    const tupleBaseIndex = Number(tupleBaseWord / 32n);
    const addressesOffsetBytes = words[tupleBaseIndex] ?? 0n;
    const allocationsOffsetBytes = words[tupleBaseIndex + 1] ?? 0n;
    const totalAllocation = words[tupleBaseIndex + 2] ?? 0n;

    const addressesIndex = tupleBaseIndex + Number(addressesOffsetBytes / 32n);
    const allocationsIndex =
      tupleBaseIndex + Number(allocationsOffsetBytes / 32n);

    const recipientCount = Number(words[addressesIndex] ?? 0n);
    const allocationCount = Number(words[allocationsIndex] ?? 0n);

    if (recipientCount !== allocationCount) {
      throw new Error(
        "SplitUpdated payload mismatch in recipient/allocation length",
      );
    }

    const recipients: string[] = [];
    const allocations: bigint[] = [];

    for (let i = 0; i < recipientCount; i++) {
      const word = words[addressesIndex + 1 + i];
      if (word === undefined) {
        throw new Error("Incomplete SplitUpdated payload (recipients)");
      }
      const masked = word & ADDRESS_MASK;
      const hexValue = masked.toString(16).padStart(40, "0");
      recipients.push(getAddress(`0x${hexValue}`));
    }

    for (let i = 0; i < allocationCount; i++) {
      const word = words[allocationsIndex + 1 + i];
      if (word === undefined) {
        throw new Error("Incomplete SplitUpdated payload (allocations)");
      }
      allocations.push(word);
    }

    return {
      recipients,
      allocations,
      totalAllocation,
    };
  }
}
