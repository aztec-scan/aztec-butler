import {
  getAddressFromPrivateKey,
  GSEContract,
  type ViemPublicClient,
} from "@aztec/ethereum";
import {
  GovernanceAbi,
  GSEAbi,
  RegistryAbi,
  RollupAbi,
} from "@aztec/l1-artifacts";
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
  StakingRegistryTarget,
  type StakingProviderData,
  type AttesterRegistration,
  type HexString,
  type AttesterView,
  AttesterOnChainStatus,
} from "../../types/index.js";
import { OLLA_STAKING_PROVIDER_REGISTRY_ABI } from "../../types/generated/olla-staking-provider-registry-abi.js";

const SUPPORTED_CHAINS = [sepolia, mainnet];

type RollupContract = GetContractReturnType<typeof RollupAbi, PublicClient>;
type GovernanceContract = GetContractReturnType<
  typeof GovernanceAbi,
  PublicClient
>;
type GSEContractType = GetContractReturnType<typeof GSEAbi, PublicClient>;
type ERC20Contract = GetContractReturnType<typeof erc20Abi, PublicClient>;
type OllaStakingProviderRegistryContract = GetContractReturnType<
  typeof OLLA_STAKING_PROVIDER_REGISTRY_ABI,
  PublicClient
>;
type AnyStakingRegistryContract = any;

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

export type RollupTimelineEntry = {
  version: bigint;
  rollup: Address;
  // First L1 block number at which the rollup contract has bytecode.
  firstBlock: bigint;
};

const SPLIT_UPDATED_EVENT = parseAbiItem(
  "event SplitUpdated((address[] recipients,uint256[] allocations,uint256 totalAllocation,uint16 distributorFee) split)",
);
const OLLA_KEYS_ADDED_EVENT = parseAbiItem(
  "event KeysAddedToProvider(address[] attesters)",
);
const OLLA_QUEUE_DRIPPED_EVENT = parseAbiItem(
  "event QueueDripped(address indexed attester)",
);
const ZERO_ADDRESS = getAddress("0x0000000000000000000000000000000000000000");
const ADDRESS_MASK = (1n << 160n) - 1n;
const LOG_RANGE_LIMIT = 50_000n;
const OLLA_QUEUE_SCAN_START_BLOCK_BY_CHAIN_ID: Record<number, bigint> = {
  [sepolia.id]: 10421273n,
  [mainnet.id]: 24690544n,
};

export interface EthereumClientConfig {
  rpcUrl: string;
  archiveRpcUrl?: string;
  chainId: number;
  rollupAddress: Address;
  ollaStakingRegistryAddress?: Address;
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
  // Per-address cached rollup contracts. Used when different historical
  // blocks require different rollup addresses (e.g. after a rollup
  // upgrade registered via the Aztec Registry).
  private rollupContractsByAddress: Map<string, RollupContract> = new Map();
  private archiveRollupContractsByAddress: Map<string, RollupContract> =
    new Map();
  private nativeStakingRegistryContract?: StakingRegistryContract;
  private ollaStakingRegistryContract?: OllaStakingProviderRegistryContract;
  private providerDataCache: Map<string, StakingProviderData | null> =
    new Map();
  private ollaQueueCache: { latestBlock: bigint; queue: string[] } | null =
    null;

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
   * Build (or return cached) rollup contract pointing at a specific address.
   * Used by the staking-rewards scraper to call historical rollups by block.
   * Both branches assume the rollup ABI is shared across versions.
   */
  getRollupContractAt(
    rollupAddress: Address,
    useArchive: boolean,
  ): RollupContract {
    const key = rollupAddress.toLowerCase();
    const cache =
      useArchive && this.archiveClient
        ? this.archiveRollupContractsByAddress
        : this.rollupContractsByAddress;
    const client =
      useArchive && this.archiveClient ? this.archiveClient : this.client;

    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const contract = getContract({
      address: rollupAddress,
      abi: RollupAbi,
      client,
    });
    cache.set(key, contract);
    return contract;
  }

  /**
   * Fetch the full rollup version timeline from the Aztec Registry and,
   * for each rollup, binary-search the L1 block at which the rollup
   * contract was first deployed. The result is sorted ascending by
   * firstBlock, so entries[i].firstBlock..entries[i+1].firstBlock defines
   * the block range over which that rollup is queryable.
   */
  async getRollupTimeline(
    registryAddress: Address,
  ): Promise<RollupTimelineEntry[]> {
    const registry = getContract({
      address: registryAddress,
      abi: RegistryAbi,
      client: this.client,
    });

    const numVersions = (await registry.read.numberOfVersions()) as bigint;
    const entries: RollupTimelineEntry[] = [];

    const latestBlock = await this.client.getBlockNumber();

    for (let i = 0n; i < numVersions; i++) {
      const version = (await registry.read.getVersion([i])) as bigint;
      const rollup = (await registry.read.getRollup([version])) as Address;
      const firstBlock = await this.findFirstCodeBlock(
        rollup,
        latestBlock,
      );
      entries.push({ version, rollup, firstBlock });
    }

    entries.sort((a, b) =>
      a.firstBlock < b.firstBlock ? -1 : a.firstBlock > b.firstBlock ? 1 : 0,
    );

    return entries;
  }

  /**
   * Binary-search the earliest L1 block number at which `address` has
   * non-empty bytecode. Assumes the contract is still deployed at
   * `upperBound` — throws if not. ~log2(N) eth_getCode calls.
   */
  private async findFirstCodeBlock(
    address: Address,
    upperBound: bigint,
  ): Promise<bigint> {
    const client = this.archiveClient ?? this.client;
    const top = await client.getCode({ address, blockNumber: upperBound });
    if (!top || top === "0x") {
      throw new Error(
        `Contract ${address} has no code at block ${upperBound}; cannot determine deployment block`,
      );
    }

    let low = 0n;
    let high = upperBound;
    while (low < high) {
      const mid = (low + high) / 2n;
      const code = await client.getCode({ address, blockNumber: mid });
      if (!code || code === "0x") {
        low = mid + 1n;
      } else {
        high = mid;
      }
    }
    return low;
  }

  /**
   * Get the staking registry contract address for this chain
   */
  getStakingRegistryAddress(target: StakingRegistryTarget = "native"): Address {
    if (target === "olla") {
      if (!this.config.ollaStakingRegistryAddress) {
        throw new Error(
          "Registry target 'olla' selected but OLLA_AZTEC_STAKING_REGISTRY_ADDRESS is not configured.",
        );
      }
      return this.config.ollaStakingRegistryAddress;
    }

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
  getStakingRegistryContract(target: "native"): StakingRegistryContract;
  getStakingRegistryContract(
    target: "olla",
  ): OllaStakingProviderRegistryContract;
  getStakingRegistryContract(
    target: StakingRegistryTarget = "native",
  ): AnyStakingRegistryContract {
    if (target === "olla") {
      if (!this.ollaStakingRegistryContract) {
        this.ollaStakingRegistryContract = getContract({
          address: this.getStakingRegistryAddress("olla"),
          abi: OLLA_STAKING_PROVIDER_REGISTRY_ABI,
          client: this.client,
        }) as OllaStakingProviderRegistryContract;
      }
      return this.ollaStakingRegistryContract;
    }

    if (!this.nativeStakingRegistryContract) {
      this.nativeStakingRegistryContract = getContract({
        address: this.getStakingRegistryAddress("native"),
        abi: STAKING_REGISTRY_ABI,
        client: this.client,
      });
    }

    return this.nativeStakingRegistryContract;
  }

  private getNativeStakingRegistryContract(): StakingRegistryContract {
    return this.getStakingRegistryContract("native") as StakingRegistryContract;
  }

  private getOllaStakingRegistryContract(): OllaStakingProviderRegistryContract {
    return this.getStakingRegistryContract(
      "olla",
    ) as OllaStakingProviderRegistryContract;
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
    target: StakingRegistryTarget = "native",
  ): Promise<StakingProviderData | null> {
    const cacheKey = `${target}:${adminAddress.toLowerCase()}`;
    // Check cache first
    if (this.providerDataCache.has(cacheKey)) {
      return this.providerDataCache.get(cacheKey)!;
    }

    if (target === "olla") {
      const stakingReg = this.getOllaStakingRegistryContract();
      const providerConfig = await stakingReg.read.getStakingProviderConfig();

      let providerAdmin: string;
      const providerConfigWithOptionalAdmin = providerConfig as {
        admin?: string;
        rewardsRecipient: string;
      };

      if (providerConfigWithOptionalAdmin.admin) {
        providerAdmin = getAddress(providerConfigWithOptionalAdmin.admin);
        if (providerAdmin.toLowerCase() !== adminAddress.toLowerCase()) {
          this.providerDataCache.set(cacheKey, null);
          return null;
        }
      } else {
        // New Olla ABIs expose only rewardsRecipient in provider config.
        // Verify the configured admin by checking STAKING_PROVIDER_ADMIN_ROLE.
        const stakingProviderAdminRole =
          await stakingReg.read.STAKING_PROVIDER_ADMIN_ROLE();
        const normalizedAdminAddress = getAddress(adminAddress);
        const isStakingProviderAdmin = await stakingReg.read.hasRole([
          stakingProviderAdminRole,
          normalizedAdminAddress,
        ]);

        if (!isStakingProviderAdmin) {
          this.providerDataCache.set(cacheKey, null);
          return null;
        }

        providerAdmin = normalizedAdminAddress;
      }

      const providerData: StakingProviderData = {
        providerId: 0n,
        admin: providerAdmin,
        takeRate: 0,
        rewardsRecipient: providerConfig.rewardsRecipient,
      };
      this.providerDataCache.set(cacheKey, providerData);
      return providerData;
    }

    const stakingReg = this.getNativeStakingRegistryContract();
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
          this.providerDataCache.set(cacheKey, providerData);
          return providerData;
        }
        index++;
      } catch {
        this.providerDataCache.set(cacheKey, null);
        return null;
      }
    }
  }

  /**
   * Validate that staking-registry ABI bindings used by read paths are compatible.
   * Throws a descriptive error when ABI drift is detected.
   */
  async validateStakingRegistryReadAbi(
    target: StakingRegistryTarget = "native",
  ): Promise<void> {
    if (target === "olla") {
      const stakingReg = this.getOllaStakingRegistryContract();

      let providerConfig: unknown;
      try {
        providerConfig = await stakingReg.read.getStakingProviderConfig();
      } catch (error) {
        throw new Error(
          `Failed to call Olla getStakingProviderConfig(): ${error instanceof Error ? error.message : String(error)}. This usually means your Olla registry ABI is stale; run 'npm run sync:olla-abi'.`,
        );
      }

      if (
        !providerConfig ||
        typeof providerConfig !== "object" ||
        !("rewardsRecipient" in providerConfig) ||
        typeof (providerConfig as { rewardsRecipient?: unknown })
          .rewardsRecipient !== "string"
      ) {
        throw new Error(
          "Incompatible Olla registry ABI: getStakingProviderConfig() must return an object with a string rewardsRecipient field. Run 'npm run sync:olla-abi'.",
        );
      }

      if (
        "admin" in providerConfig &&
        (providerConfig as { admin?: unknown }).admin !== undefined &&
        typeof (providerConfig as { admin?: unknown }).admin !== "string"
      ) {
        throw new Error(
          "Incompatible Olla registry ABI: getStakingProviderConfig().admin must be a string address when present. Run 'npm run sync:olla-abi'.",
        );
      }

      if (!("admin" in providerConfig)) {
        try {
          const stakingProviderAdminRole =
            await stakingReg.read.STAKING_PROVIDER_ADMIN_ROLE();
          if (typeof stakingProviderAdminRole !== "string") {
            throw new Error(
              "STAKING_PROVIDER_ADMIN_ROLE() did not return a bytes32 value",
            );
          }
          const hasRoleResult = await stakingReg.read.hasRole([
            stakingProviderAdminRole,
            ZERO_ADDRESS,
          ]);
          if (typeof hasRoleResult !== "boolean") {
            throw new Error("hasRole() did not return a boolean");
          }
        } catch (error) {
          throw new Error(
            `Incompatible Olla registry ABI for admin verification path: ${error instanceof Error ? error.message : String(error)}. Run 'npm run sync:olla-abi'.`,
          );
        }
      }

      return;
    }

    const nativeRead = this.getNativeStakingRegistryContract().read as Record<
      string,
      unknown
    >;
    const requiredReadMethods = [
      "providerConfigurations",
      "getProviderQueueLength",
      "getFirstIndexInQueue",
      "getLastIndexInQueue",
      "attesterInfo",
    ];

    const missingMethods = requiredReadMethods.filter(
      (methodName) => typeof nativeRead[methodName] !== "function",
    );
    if (missingMethods.length > 0) {
      throw new Error(
        `Incompatible native staking registry ABI: missing read method(s): ${missingMethods.join(", ")}.`,
      );
    }
  }

  /**
   * Get the queue length for a provider
   */
  async getProviderQueueLength(
    providerId: bigint,
    target: StakingRegistryTarget = "native",
  ): Promise<bigint> {
    if (target === "olla") {
      const stakingReg = this.getOllaStakingRegistryContract();
      return await stakingReg.read.getQueueLength();
    }

    const stakingReg = this.getNativeStakingRegistryContract();
    return await stakingReg.read.getProviderQueueLength([providerId]);
  }

  /**
   * Get the full queue of attesters for a provider
   * Iterates through queue indices to fetch all attester addresses
   */
  async getProviderQueue(
    providerId: bigint,
    target: StakingRegistryTarget = "native",
  ): Promise<string[]> {
    if (target === "olla") {
      return await this.getOllaProviderQueueFromEvents();
    }

    const stakingReg = this.getNativeStakingRegistryContract();

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

  private async getLogsWithArchiveFallback(params: {
    address: Address;
    event: any;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<any[]> {
    try {
      return await this.client.getLogs(params);
    } catch (err) {
      if (!this.archiveClient) {
        throw err;
      }
      console.warn(
        "[EthereumClient] Primary RPC getLogs failed, trying archive client...",
        err,
      );
      return await this.archiveClient.getLogs(params);
    }
  }

  private async getLogsChunked(params: {
    address: Address;
    event: any;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<any[]> {
    const logs: any[] = [];
    let cursor = params.fromBlock;
    while (cursor <= params.toBlock) {
      const end =
        cursor + LOG_RANGE_LIMIT - 1n > params.toBlock
          ? params.toBlock
          : cursor + LOG_RANGE_LIMIT - 1n;
      const chunkLogs = await this.getLogsWithArchiveFallback({
        address: params.address,
        event: params.event,
        fromBlock: cursor,
        toBlock: end,
      });
      logs.push(...chunkLogs);
      cursor = end + 1n;
    }
    return logs;
  }

  private async getOllaProviderQueueFromEvents(): Promise<string[]> {
    const latestBlock = await this.client.getBlockNumber();
    if (
      this.ollaQueueCache &&
      this.ollaQueueCache.latestBlock === latestBlock
    ) {
      return [...this.ollaQueueCache.queue];
    }

    const registryAddress = this.getStakingRegistryAddress("olla");
    const queueScanStartBlock =
      OLLA_QUEUE_SCAN_START_BLOCK_BY_CHAIN_ID[this.config.chainId] ?? 0n;
    const [addedLogs, drippedLogs] = await Promise.all([
      this.getLogsChunked({
        address: registryAddress,
        event: OLLA_KEYS_ADDED_EVENT,
        fromBlock: queueScanStartBlock,
        toBlock: latestBlock,
      }),
      this.getLogsChunked({
        address: registryAddress,
        event: OLLA_QUEUE_DRIPPED_EVENT,
        fromBlock: queueScanStartBlock,
        toBlock: latestBlock,
      }),
    ]);

    const timeline: {
      blockNumber: bigint;
      logIndex: bigint;
      kind: "add" | "drip";
      attesters?: string[];
      attester?: string;
    }[] = [];

    for (const log of addedLogs) {
      timeline.push({
        blockNumber:
          typeof log.blockNumber === "bigint"
            ? log.blockNumber
            : BigInt(log.blockNumber ?? 0),
        logIndex:
          typeof log.logIndex === "bigint"
            ? log.logIndex
            : BigInt(log.logIndex ?? 0),
        kind: "add",
        attesters: (log.args?.attesters ?? []) as string[],
      });
    }
    for (const log of drippedLogs) {
      timeline.push({
        blockNumber:
          typeof log.blockNumber === "bigint"
            ? log.blockNumber
            : BigInt(log.blockNumber ?? 0),
        logIndex:
          typeof log.logIndex === "bigint"
            ? log.logIndex
            : BigInt(log.logIndex ?? 0),
        kind: "drip",
        attester: log.args?.attester as string,
      });
    }

    timeline.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber < b.blockNumber ? -1 : 1;
      }
      if (a.logIndex === b.logIndex) {
        return 0;
      }
      return a.logIndex < b.logIndex ? -1 : 1;
    });

    const queue: string[] = [];
    for (const event of timeline) {
      if (event.kind === "add") {
        for (const attester of event.attesters ?? []) {
          queue.push(attester);
        }
        continue;
      }

      const dripped = event.attester;
      const shifted = queue.shift();
      if (!shifted || !dripped) {
        continue;
      }
      if (shifted.toLowerCase() !== dripped.toLowerCase()) {
        console.warn(
          `[EthereumClient] Olla queue replay mismatch: expected ${shifted}, dripped ${dripped}`,
        );
      }
    }

    this.ollaQueueCache = { latestBlock, queue };
    return [...queue];
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
    const providerData = await this.getStakingProvider(adminAddress, "native");
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
      this.client as unknown as ViemPublicClient,
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
      this.client as unknown as ViemPublicClient,
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
    target: StakingRegistryTarget = "native",
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
      address: this.getStakingRegistryAddress(target),
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

  /**
   * Get how many validators can be flushed from queue now
   */
  async getAvailableValidatorFlushes(): Promise<bigint> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getAvailableValidatorFlushes();
  }

  /**
   * Get the next epoch when flush can occur
   */
  async getNextFlushableEpoch(): Promise<bigint> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getNextFlushableEpoch();
  }

  /**
   * Get max number of validators that can be added from queue
   */
  async getEntryQueueFlushSize(): Promise<bigint> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getEntryQueueFlushSize();
  }

  /**
   * Check if bootstrap phase is complete
   */
  async getIsBootstrapped(): Promise<boolean> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getIsBootstrapped();
  }

  /**
   * Get epoch duration from rollup config (in seconds)
   */
  async getEpochDuration(): Promise<bigint> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getEpochDuration();
  }

  /**
   * Get current epoch number
   */
  async getCurrentEpoch(): Promise<bigint> {
    const rollupContract = this.getRollupContract();
    return await rollupContract.read.getCurrentEpoch();
  }
}
