import { RollupAbi } from "@aztec/l1-artifacts";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  SafeGlobalClient,
  type MultisigProposal,
} from "../../core/components/SafeGlobalClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { loadCoinbaseCache } from "../../core/utils/scraperConfigOperations.js";

const DEFAULT_SPLITS_WAREHOUSE_ADDRESS = getAddress(
  "0x8fb66f38cf86a3d5e8768f8f1754a24a6c661fb8",
);
const UNISWAP_V4_STATE_VIEW_ADDRESS = getAddress(
  "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
);
const AZTEC_ETH_POOL_ID =
  "0xce2899b16743cfd5a954d8122d5e07f410305b1aebee39fd73d9f3b9ebf10c2f";
const AZTEC_USDC_POOL_ID =
  "0xb9a92743434e0703a7801200aaa0d21432b15fbb6905a45a74e52f384caf6c23";
const ZERO_ADDRESS = getAddress("0x0000000000000000000000000000000000000000");
const LOG_RANGE_LIMIT = 50_000n;
const Q192 = 1n << 192n;
const AZTEC_DECIMALS_FACTOR = 10n ** 18n;
const BASIS_POINTS_DENOMINATOR = 10_000n;

const SPLIT_UPDATED_EVENT = parseAbiItem(
  "event SplitUpdated((address[] recipients,uint256[] allocations,uint256 totalAllocation,uint16 distributorFee) split)",
);

const PULL_SPLIT_ABI = [
  {
    type: "function",
    name: "distribute",
    inputs: [
      {
        name: "split",
        type: "tuple",
        components: [
          { name: "recipients", type: "address[]" },
          { name: "allocations", type: "uint256[]" },
          { name: "totalAllocation", type: "uint256" },
          { name: "distributorFee", type: "uint16" },
        ],
      },
      { name: "token", type: "address" },
      { name: "distributor", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const SPLITS_WAREHOUSE_ABI = [
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const UNISWAP_V4_STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
    stateMutability: "view",
  },
] as const;

interface EvaluateClaimRewardsOptions {
  network: string;
  rollup?: string;
  stakingAsset?: string;
  warehouse?: string;
  extraGas?: bigint;
  maxAcceptedPercentage?: string;
  maxAcceptedUsd?: string;
  proposeToSafe?: boolean;
  safeAddress?: string;
  json?: boolean;
}

type CoinbaseEntry = {
  coinbase: Address;
  firstBlock: bigint;
};

type SplitData = {
  recipients: Address[];
  allocations: bigint[];
  totalAllocation: bigint;
  distributorFee: number;
};

type EstimateResult =
  | { gas: bigint; error?: never }
  | { gas: 0n; error: string };

type AztecSpotPrices = {
  aztecEthWei: bigint;
  aztecUsdcUnits: bigint;
  ethUsdcUnits: bigint;
};

type ClaimRewardsEvaluationRow = {
  coinbase: Address;
  pendingRewards: string;
  recipientAllocation: string;
  totalAllocation: string;
  recipientRewards: string;
  claimGas: string;
  distributeGas: string;
  withdrawGas: string;
  extraGas: string;
  estimatedGas: string;
  gasPriceWei: string;
  gasCostWei: string;
  gasCostUsdc: string;
  gasCostPercentBps: string;
  rewardValueWei: string;
  rewardValueUsdc: string;
  netValueWei: string;
  netValueUsdc: string;
  acceptedByPercentage: boolean;
  acceptedByUsd: boolean;
  worthClaiming: boolean;
  errors: string[];
};

const formatEth = (value: bigint): string => `${formatEther(value)} ETH`;
const formatAztec = (value: bigint): string => `${formatEther(value)} AZTEC`;
const formatUsdc = (value: bigint): string => `$${formatUnits(value, 6)}`;
const formatPercentBps = (value: bigint): string =>
  `${formatUnits(value, 2)}%`;
const isString = (value: unknown): value is string => typeof value === "string";

const parseDecimalUnits = (
  value: string,
  decimals: number,
  label: string,
): bigint => {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${label} must be a non-negative decimal number`);
  }

  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`${label} supports at most ${decimals} decimal places`);
  }

  return BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
};

const estimateOrZero = async (
  estimate: () => Promise<bigint>,
): Promise<EstimateResult> => {
  try {
    return { gas: await estimate() };
  } catch (error) {
    return {
      gas: 0n,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const getUniqueCoinbases = async (network: string): Promise<CoinbaseEntry[]> => {
  const cache = await loadCoinbaseCache(network);
  if (!cache) {
    throw new Error(
      `No coinbase cache found for network "${network}". Run scrape-coinbases first.`,
    );
  }

  const byCoinbase = new Map<string, CoinbaseEntry>();
  for (const mapping of cache.mappings) {
    const coinbase = getAddress(mapping.coinbaseAddress);
    if (coinbase === ZERO_ADDRESS) {
      continue;
    }
    const key = coinbase.toLowerCase();
    const existing = byCoinbase.get(key);
    if (!existing || mapping.blockNumber < existing.firstBlock) {
      byCoinbase.set(key, { coinbase, firstBlock: mapping.blockNumber });
    }
  }

  return Array.from(byCoinbase.values());
};

const getLatestSplits = async (
  client: PublicClient,
  coinbases: CoinbaseEntry[],
  configuredFromBlock?: bigint,
  onProgress?: (message: string) => void,
): Promise<Map<string, SplitData>> => {
  if (coinbases.length === 0) {
    return new Map();
  }

  onProgress?.("Fetching latest block for SplitUpdated log scan...");
  const latestBlock = await client.getBlockNumber();
  const minCoinbaseBlock = coinbases.reduce(
    (min, entry) => entry.firstBlock < min ? entry.firstBlock : min,
    coinbases[0]!.firstBlock,
  );
  const fromBlock = configuredFromBlock && configuredFromBlock > minCoinbaseBlock
    ? minCoinbaseBlock
    : configuredFromBlock ?? minCoinbaseBlock;
  const addresses = coinbases.map((entry) => entry.coinbase);
  const splits = new Map<string, SplitData>();
  const totalRanges = (latestBlock - fromBlock) / LOG_RANGE_LIMIT + 1n;

  let cursor = fromBlock;
  let rangeIndex = 1n;
  while (cursor <= latestBlock) {
    const toBlock =
      cursor + LOG_RANGE_LIMIT - 1n > latestBlock
        ? latestBlock
        : cursor + LOG_RANGE_LIMIT - 1n;
    onProgress?.(
      `Scanning SplitUpdated logs ${rangeIndex}/${totalRanges}: blocks ${cursor}-${toBlock}`,
    );
    const logs = await client.getLogs({
      address: addresses,
      event: SPLIT_UPDATED_EVENT,
      fromBlock: cursor,
      toBlock,
    });

    for (const log of logs) {
      const split = log.args.split;
      if (!split) {
        continue;
      }
      splits.set(log.address.toLowerCase(), {
        recipients: split.recipients.map((recipient) => getAddress(recipient)),
        allocations: [...split.allocations],
        totalAllocation: split.totalAllocation,
        distributorFee: split.distributorFee,
      });
    }

    cursor = toBlock + 1n;
    rangeIndex += 1n;
  }

  onProgress?.(`Found latest split data for ${splits.size}/${coinbases.length} coinbases.`);
  return splits;
};

const getRecipientAllocation = (
  recipients: string[],
  allocations: bigint[],
  recipient: Address,
): bigint => {
  const recipientLower = recipient.toLowerCase();
  return recipients.reduce((sum, address, index) => {
    if (address.toLowerCase() !== recipientLower) {
      return sum;
    }
    return sum + (allocations[index] ?? 0n);
  }, 0n);
};

const getStakingAsset = async (
  client: PublicClient,
  ethClient: EthereumClient,
  configured?: string,
): Promise<Address> => {
  if (configured) {
    return getAddress(configured);
  }

  return await client.readContract({
    address: ethClient.getStakingRegistryAddress(),
    abi: [
      {
        type: "function",
        name: "STAKING_ASSET",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
      },
    ],
    functionName: "STAKING_ASSET",
  });
};

const getAztecPriceInToken0 = async (
  client: PublicClient,
  poolId: Hex,
): Promise<bigint> => {
  const [sqrtPriceX96] = await client.readContract({
    address: UNISWAP_V4_STATE_VIEW_ADDRESS,
    abi: UNISWAP_V4_STATE_VIEW_ABI,
    functionName: "getSlot0",
    args: [poolId],
  });
  const sqrtPrice = BigInt(sqrtPriceX96);

  if (sqrtPrice === 0n) {
    throw new Error(`Uniswap V4 pool ${poolId} returned zero sqrtPriceX96`);
  }

  // Pools are token0 (ETH/USDC) < token1 (AZTEC). This returns token0 raw
  // units for exactly 1 AZTEC (1e18 token1 raw units).
  return (AZTEC_DECIMALS_FACTOR * Q192) / (sqrtPrice * sqrtPrice);
};

const getAztecSpotPrices = async (
  client: PublicClient,
): Promise<AztecSpotPrices> => {
  const [aztecEthWei, aztecUsdcUnits] = await Promise.all([
    getAztecPriceInToken0(client, AZTEC_ETH_POOL_ID),
    getAztecPriceInToken0(client, AZTEC_USDC_POOL_ID),
  ]);

  if (aztecEthWei === 0n) {
    throw new Error("AZTEC/ETH spot price rounded to zero");
  }

  return {
    aztecEthWei,
    aztecUsdcUnits,
    ethUsdcUnits: (aztecUsdcUnits * 10n ** 18n) / aztecEthWei,
  };
};

const buildClaimRewardsSafeTransactions = ({
  rows,
  splits,
  rollup,
  stakingAsset,
  warehouse,
  rewardsRecipient,
}: {
  rows: ClaimRewardsEvaluationRow[];
  splits: Map<string, SplitData>;
  rollup: Address;
  stakingAsset: Address;
  warehouse: Address;
  rewardsRecipient: Address;
}): MultisigProposal[] => {
  const transactions: MultisigProposal[] = [];

  for (const row of rows.filter((entry) => entry.worthClaiming)) {
    const split = splits.get(row.coinbase.toLowerCase());
    if (!split) {
      throw new Error(
        `Cannot propose claim for ${row.coinbase}: no SplitUpdated event found`,
      );
    }

    transactions.push({
      to: rollup,
      value: "0",
      data: encodeFunctionData({
        abi: RollupAbi,
        functionName: "claimSequencerRewards",
        args: [row.coinbase],
      }),
    });
    transactions.push({
      to: row.coinbase,
      value: "0",
      data: encodeFunctionData({
        abi: PULL_SPLIT_ABI,
        functionName: "distribute",
        args: [
          {
            recipients: split.recipients,
            allocations: split.allocations,
            totalAllocation: split.totalAllocation,
            distributorFee: split.distributorFee,
          },
          stakingAsset,
          rewardsRecipient,
        ],
      }),
    });
    transactions.push({
      to: warehouse,
      value: "0",
      data: encodeFunctionData({
        abi: SPLITS_WAREHOUSE_ABI,
        functionName: "withdraw",
        args: [rewardsRecipient, stakingAsset],
      }),
    });
  }

  return transactions;
};

const proposeClaimRewardsToSafe = async ({
  config,
  safeAddress,
  transactions,
}: {
  config: ButlerConfig;
  safeAddress: Address;
  transactions: MultisigProposal[];
}) => {
  if (!config.MULTISIG_PROPOSER_PRIVATE_KEY) {
    throw new Error(
      "MULTISIG_PROPOSER_PRIVATE_KEY must be configured to propose to Safe.",
    );
  }
  if (!config.SAFE_API_KEY) {
    throw new Error("SAFE_API_KEY must be configured to propose to Safe.");
  }

  const safeClient = new SafeGlobalClient({
    safeAddress,
    chainId: config.ETHEREUM_CHAIN_ID,
    rpcUrl: config.ETHEREUM_NODE_URL,
    proposerPrivateKey: config.MULTISIG_PROPOSER_PRIVATE_KEY,
    safeApiKey: config.SAFE_API_KEY,
  });

  await safeClient.proposeTransactions(transactions);
};

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: EvaluateClaimRewardsOptions,
) => {
  const logProgress = (message: string) => {
    if (!options.json) {
      console.error(`[evaluate-claim-rewards] ${message}`);
    }
  };

  if (options.json && options.proposeToSafe) {
    throw new Error("--json cannot be combined with --propose-to-safe");
  }

  if (!config.AZTEC_STAKING_PROVIDER_REWARDS_RECIPIENT) {
    throw new Error(
      "AZTEC_STAKING_PROVIDER_REWARDS_RECIPIENT must be configured.",
    );
  }

  const client = ethClient.getPublicClient();
  const rewardsRecipient = getAddress(
    config.AZTEC_STAKING_PROVIDER_REWARDS_RECIPIENT,
  );
  const rollup = options.rollup
    ? getAddress(options.rollup)
    : (ethClient.getRollupContract().address as Address);
  const stakingAsset = await getStakingAsset(
    client,
    ethClient,
    options.stakingAsset,
  );
  const warehouse = getAddress(
    options.warehouse ?? DEFAULT_SPLITS_WAREHOUSE_ADDRESS,
  );
  const safeAddress = options.safeAddress ?? config.SAFE_ADDRESS;
  if (options.proposeToSafe && !safeAddress) {
    throw new Error("SAFE_ADDRESS or --safe-address must be set to propose to Safe.");
  }
  logProgress("Fetching gas price from RPC...");
  const gasPrice = await client.getGasPrice();
  const extraGas = options.extraGas ?? 0n;
  const maxAcceptedPercentageBps = parseDecimalUnits(
    options.maxAcceptedPercentage ?? "3",
    2,
    "max-accepted-percentage",
  );
  const maxAcceptedUsdUnits = parseDecimalUnits(
    options.maxAcceptedUsd ?? "0.1",
    6,
    "max-accepted-usd",
  );
  logProgress("Fetching AZTEC spot prices from Uniswap V4...");
  const spotPrices = await getAztecSpotPrices(client);
  logProgress("Loading cached coinbases...");
  const coinbases = await getUniqueCoinbases(options.network);
  logProgress(`Loaded ${coinbases.length} unique cached coinbases.`);
  const splits = await getLatestSplits(
    client,
    coinbases,
    config.STAKING_REWARDS_SPLIT_FROM_BLOCK,
    logProgress,
  );

  const rows: ClaimRewardsEvaluationRow[] = [];
  for (const [index, { coinbase }] of coinbases.entries()) {
    logProgress(
      `Evaluating coinbase ${index + 1}/${coinbases.length}: ${coinbase}`,
    );
    const pendingRewards = await client.readContract({
      address: rollup,
      abi: RollupAbi,
      functionName: "getSequencerRewards",
      args: [coinbase],
    });

    const split = splits.get(coinbase.toLowerCase()) ?? null;
    const totalAllocation =
      split?.totalAllocation && split.totalAllocation > 0n
        ? split.totalAllocation
        : 10_000n;
    const recipientAllocation = split
      ? getRecipientAllocation(
          split.recipients,
          split.allocations,
          rewardsRecipient,
        )
      : 0n;
    const recipientRewards =
      totalAllocation > 0n
        ? (pendingRewards * recipientAllocation) / totalAllocation
        : 0n;

    const claim = await estimateOrZero(() =>
      client.estimateContractGas({
        account: rewardsRecipient,
        address: rollup,
        abi: RollupAbi,
        functionName: "claimSequencerRewards",
        args: [coinbase],
      }),
    );

    const distribute = split
      ? await estimateOrZero(() =>
          client.estimateContractGas({
            account: rewardsRecipient,
            address: coinbase,
            abi: PULL_SPLIT_ABI,
            functionName: "distribute",
            args: [
              {
                recipients: split.recipients,
                allocations: split.allocations,
                totalAllocation: split.totalAllocation,
                distributorFee: split.distributorFee,
              },
              stakingAsset,
              rewardsRecipient,
            ],
          }),
        )
      : ({
          gas: 0n,
          error: "No SplitUpdated event found",
        } satisfies EstimateResult);

    const withdraw = await estimateOrZero(() =>
      client.estimateContractGas({
        account: rewardsRecipient,
        address: warehouse,
        abi: SPLITS_WAREHOUSE_ABI,
        functionName: "withdraw",
        args: [rewardsRecipient, stakingAsset],
      }),
    );

    const estimatedGas = claim.gas + distribute.gas + withdraw.gas + extraGas;
    const gasCostWei = estimatedGas * gasPrice;
    const rewardValueWei =
      (recipientRewards * spotPrices.aztecEthWei) / AZTEC_DECIMALS_FACTOR;
    const rewardValueUsdc =
      (recipientRewards * spotPrices.aztecUsdcUnits) / AZTEC_DECIMALS_FACTOR;
    const gasCostUsdc = (gasCostWei * spotPrices.ethUsdcUnits) / 10n ** 18n;
    const netValueWei = rewardValueWei - gasCostWei;
    const netValueUsdc = rewardValueUsdc - gasCostUsdc;
    const gasCostPercentBps =
      rewardValueWei > 0n
        ? (gasCostWei * BASIS_POINTS_DENOMINATOR) / rewardValueWei
        : 0n;
    const acceptedByPercentage =
      rewardValueWei > 0n && gasCostPercentBps <= maxAcceptedPercentageBps;
    const acceptedByUsd =
      rewardValueWei > 0n && gasCostUsdc <= maxAcceptedUsdUnits;
    rows.push({
      coinbase,
      pendingRewards: pendingRewards.toString(),
      recipientAllocation: recipientAllocation.toString(),
      totalAllocation: totalAllocation.toString(),
      recipientRewards: recipientRewards.toString(),
      claimGas: claim.gas.toString(),
      distributeGas: distribute.gas.toString(),
      withdrawGas: withdraw.gas.toString(),
      extraGas: extraGas.toString(),
      estimatedGas: estimatedGas.toString(),
      gasPriceWei: gasPrice.toString(),
      gasCostWei: gasCostWei.toString(),
      gasCostUsdc: gasCostUsdc.toString(),
      gasCostPercentBps: gasCostPercentBps.toString(),
      rewardValueWei: rewardValueWei.toString(),
      rewardValueUsdc: rewardValueUsdc.toString(),
      netValueWei: netValueWei.toString(),
      netValueUsdc: netValueUsdc.toString(),
      acceptedByPercentage,
      acceptedByUsd,
      worthClaiming: acceptedByPercentage || acceptedByUsd,
      errors: [claim.error, distribute.error, withdraw.error].filter(isString),
    });
  }

  logProgress("Sorting evaluation results...");
  rows.sort((a, b) =>
    BigInt(b.netValueWei) < BigInt(a.netValueWei) ? -1 : 1,
  );

  const totals = rows.reduce(
    (sum, row) => ({
      recipientRewards: sum.recipientRewards + BigInt(row.recipientRewards),
      gasCostWei: sum.gasCostWei + BigInt(row.gasCostWei),
      gasCostUsdc: sum.gasCostUsdc + BigInt(row.gasCostUsdc),
      rewardValueWei: sum.rewardValueWei + BigInt(row.rewardValueWei),
      rewardValueUsdc: sum.rewardValueUsdc + BigInt(row.rewardValueUsdc),
      netValueWei: sum.netValueWei + BigInt(row.netValueWei),
      netValueUsdc: sum.netValueUsdc + BigInt(row.netValueUsdc),
      worthClaiming: sum.worthClaiming + (row.worthClaiming ? 1 : 0),
    }),
    {
      recipientRewards: 0n,
      gasCostWei: 0n,
      gasCostUsdc: 0n,
      rewardValueWei: 0n,
      rewardValueUsdc: 0n,
      netValueWei: 0n,
      netValueUsdc: 0n,
      worthClaiming: 0,
    },
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          rewardsRecipient,
          rollup,
          stakingAsset,
          warehouse,
          spotPrices: {
            aztecEthWei: spotPrices.aztecEthWei.toString(),
            aztecUsdcUnits: spotPrices.aztecUsdcUnits.toString(),
            ethUsdcUnits: spotPrices.ethUsdcUnits.toString(),
          },
          thresholds: {
            maxAcceptedPercentageBps: maxAcceptedPercentageBps.toString(),
            maxAcceptedUsdUnits: maxAcceptedUsdUnits.toString(),
          },
          totals: {
            recipientRewards: totals.recipientRewards.toString(),
            gasCostWei: totals.gasCostWei.toString(),
            gasCostUsdc: totals.gasCostUsdc.toString(),
            rewardValueWei: totals.rewardValueWei.toString(),
            rewardValueUsdc: totals.rewardValueUsdc.toString(),
            netValueWei: totals.netValueWei.toString(),
            netValueUsdc: totals.netValueUsdc.toString(),
            worthClaiming: totals.worthClaiming,
          },
          rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("\n=== Claim Rewards Gas Evaluation ===\n");
  console.log(`Rewards recipient: ${rewardsRecipient}`);
  console.log(`Rollup: ${rollup}`);
  console.log(`Staking asset: ${stakingAsset}`);
  console.log(`Splits warehouse: ${warehouse}`);
  if (options.proposeToSafe && safeAddress) {
    console.log(`Proposal Safe: ${getAddress(safeAddress)}`);
  }
  console.log(`Gas price: ${gasPrice} wei (${Number(gasPrice) / 1e9} gwei)`);
  console.log(`AZTEC/ETH spot: ${formatEth(spotPrices.aztecEthWei)}`);
  console.log(`AZTEC/USDC spot: ${formatUsdc(spotPrices.aztecUsdcUnits)}`);
  console.log(`ETH/USDC implied: ${formatUsdc(spotPrices.ethUsdcUnits)}`);
  console.log(
    `Claim thresholds: gas/rewards <= ${formatPercentBps(maxAcceptedPercentageBps)} OR gas <= ${formatUsdc(maxAcceptedUsdUnits)}`,
  );
  if (extraGas > 0n) {
    console.log(`Extra gas buffer: ${extraGas}`);
  }
  console.log("");

  const printRow = (row: ClaimRewardsEvaluationRow) => {
    console.log(`${row.worthClaiming ? "CLAIM" : "SKIP"} ${row.coinbase}`);
    console.log(`  pending rewards: ${formatAztec(BigInt(row.pendingRewards))}`);
    console.log(`  recipient share: ${formatAztec(BigInt(row.recipientRewards))}`);
    console.log(
      `  reward value: ${formatEth(BigInt(row.rewardValueWei))} (${formatUsdc(BigInt(row.rewardValueUsdc))})`,
    );
    console.log(
      `  gas: ${row.estimatedGas} (${formatEth(BigInt(row.gasCostWei))}, ${formatUsdc(BigInt(row.gasCostUsdc))})`,
    );
    console.log(
      `  gas/rewards: ${formatPercentBps(BigInt(row.gasCostPercentBps))}`,
    );
    console.log(
      `  accepted by: ${row.acceptedByPercentage ? "percentage" : "-"}, ${row.acceptedByUsd ? "usd" : "-"}`,
    );
    console.log(
      `  net value: ${formatEth(BigInt(row.netValueWei))} (${formatUsdc(BigInt(row.netValueUsdc))})`,
    );
    if (row.errors.length > 0) {
      console.log(`  estimate warnings: ${row.errors.length}`);
    }
  };

  console.log("=== Skipped Coinbases ===\n");
  for (const row of rows.filter((row) => !row.worthClaiming)) {
    printRow(row);
  }

  console.log("\n=== Claimable Coinbases ===\n");
  for (const row of rows.filter((row) => row.worthClaiming)) {
    printRow(row);
  }

  console.log("\n=== Summary ===\n");
  console.log(`Total AZTEC received: ${formatAztec(totals.recipientRewards)}`);
  console.log(
    `Total gas cost: ${formatEth(totals.gasCostWei)} (${formatUsdc(totals.gasCostUsdc)})`,
  );
  console.log(
    `Total reward value: ${formatEth(totals.rewardValueWei)} (${formatUsdc(totals.rewardValueUsdc)})`,
  );
  console.log(
    `Total net value: ${formatEth(totals.netValueWei)} (${formatUsdc(totals.netValueUsdc)})`,
  );
  console.log(`Worth claiming: ${totals.worthClaiming}/${rows.length}`);

  if (options.proposeToSafe) {
    const transactions = buildClaimRewardsSafeTransactions({
      rows,
      splits,
      rollup,
      stakingAsset,
      warehouse,
      rewardsRecipient,
    });

    if (transactions.length === 0) {
      console.log("\nNo claimable rewards, skipping Safe proposal.");
      return;
    }

    console.log(
      `\nProposing ${transactions.length} Safe call(s) for ${totals.worthClaiming} claimable coinbase(s)...`,
    );
    await proposeClaimRewardsToSafe({
      config,
      safeAddress: getAddress(safeAddress!),
      transactions,
    });
    console.log(
      `Safe proposal submitted: https://app.safe.global/transactions/queue?safe=eth:${getAddress(safeAddress!)}`,
    );
  }
};

export default command;
