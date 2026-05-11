import { RollupAbi } from "@aztec/l1-artifacts";
import {
  formatEther,
  getAddress,
  parseAbiItem,
  type Address,
  type PublicClient,
} from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { loadCoinbaseCache } from "../../core/utils/scraperConfigOperations.js";

const DEFAULT_SPLITS_WAREHOUSE_ADDRESS = getAddress(
  "0x8fb66f38cf86a3d5e8768f8f1754a24a6c661fb8",
);
const ZERO_ADDRESS = getAddress("0x0000000000000000000000000000000000000000");
const LOG_RANGE_LIMIT = 50_000n;

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

interface EvaluateClaimRewardsOptions {
  network: string;
  rollup?: string;
  stakingAsset?: string;
  warehouse?: string;
  gasPriceGwei?: string;
  extraGas?: bigint;
  minNetWei?: bigint;
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

const formatWei = (value: bigint): string => `${formatEther(value)} ETH`;

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
): Promise<Map<string, SplitData>> => {
  if (coinbases.length === 0) {
    return new Map();
  }

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

  let cursor = fromBlock;
  while (cursor <= latestBlock) {
    const toBlock =
      cursor + LOG_RANGE_LIMIT - 1n > latestBlock
        ? latestBlock
        : cursor + LOG_RANGE_LIMIT - 1n;
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
  }

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

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: EvaluateClaimRewardsOptions,
) => {
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
  const gasPrice = options.gasPriceGwei
    ? BigInt(Math.round(Number(options.gasPriceGwei) * 1_000_000_000))
    : await client.getGasPrice();
  const extraGas = options.extraGas ?? 0n;
  const minNetWei = options.minNetWei ?? 0n;
  const coinbases = await getUniqueCoinbases(options.network);
  const splits = await getLatestSplits(
    client,
    coinbases,
    config.STAKING_REWARDS_SPLIT_FROM_BLOCK,
  );

  const rows = [];
  for (const { coinbase } of coinbases) {
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
    const netWei = recipientRewards - gasCostWei;
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
      netWei: netWei.toString(),
      worthClaiming: netWei >= minNetWei,
      errors: [claim.error, distribute.error, withdraw.error].filter(Boolean),
    });
  }

  rows.sort((a, b) =>
    BigInt(b.netWei) < BigInt(a.netWei) ? -1 : 1,
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        { rewardsRecipient, rollup, stakingAsset, warehouse, rows },
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
  console.log(`Gas price: ${gasPrice} wei (${Number(gasPrice) / 1e9} gwei)`);
  if (extraGas > 0n) {
    console.log(`Extra gas buffer: ${extraGas}`);
  }
  console.log("");

  for (const row of rows) {
    console.log(`${row.worthClaiming ? "CLAIM" : "SKIP"} ${row.coinbase}`);
    console.log(`  pending rewards: ${formatWei(BigInt(row.pendingRewards))}`);
    console.log(`  recipient share: ${formatWei(BigInt(row.recipientRewards))}`);
    console.log(`  gas: ${row.estimatedGas} (${formatWei(BigInt(row.gasCostWei))})`);
    console.log(`  net: ${formatWei(BigInt(row.netWei))}`);
    if (row.errors.length > 0) {
      console.log(`  estimate warnings: ${row.errors.length}`);
    }
  }
};

export default command;
