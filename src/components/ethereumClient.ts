import type { NodeInfo } from "@aztec/aztec.js";
import { getAddressFromPrivateKey, GSEContract, type ViemPublicClient } from "@aztec/ethereum";
import { GovernanceAbi, GSEAbi, RollupAbi } from "@aztec/l1-artifacts";
import assert from "assert";
import { createPublicClient, encodeFunctionData, erc20Abi, formatEther, getAddress, getContract, http, parseEther, type Address, type GetContractReturnType, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { CuratedKeystoreData, DirData, HexString } from "../types.js";

const supportedChains = [
  sepolia,
  mainnet,
]

type RollupContract = GetContractReturnType<typeof RollupAbi, PublicClient>;

let client: PublicClient | undefined;
let rollupContract: RollupContract | undefined;

const getEthereumClient = (chainId?: number, url?: string): PublicClient => {
  if (!client) {
    if (!chainId) {
      throw new Error("Chain ID must be provided for the first initialization of the Ethereum client");
    }
    if (!url) {
      throw new Error("RPC URL must be provided for the first initialization of the Ethereum client");
    }
    client = createEthereumClient(chainId, url);
  }
  return client;
}

const createEthereumClient = (chainId: number, url: string) => {
  const chain = supportedChains.find(c => c.id === chainId);
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return createPublicClient({
    transport: http(url),
    chain: chain,
  });
};

const getRollupContract = () => {
  if (!rollupContract) {
    throw new Error("Rollup contract is not initialized. Call init() first.");
  }
  return rollupContract;
}

export const init = async (nodeInfo: NodeInfo, url: string): Promise<void> => {
  const client = getEthereumClient(nodeInfo.l1ChainId, url);
  const queriedChainId = await client.getChainId();
  assert(queriedChainId === nodeInfo.l1ChainId, `Mismatch between Aztec node L1 chain ID (${nodeInfo.l1ChainId}) and Ethereum client chain ID (${queriedChainId})`);
  console.log(`Ethereum chain: ${client?.chain?.id} (${client?.chain?.name})
`);
  const rollupAddressRaw = nodeInfo.l1ContractAddresses.rollupAddress;
  if (!rollupAddressRaw) {
    throw new Error("No rollup address found in node info");
  }
  const rollupAddress = getAddress(rollupAddressRaw.toString());
  rollupContract = getContract({
    address: rollupAddress,
    abi: RollupAbi,
    client,
  });
}

const getEtherscanAddressUrl = (client: PublicClient, address: Address) => {
  const etherscanBaseUrl = client.chain?.blockExplorers?.default.url!;
  return `${etherscanBaseUrl}/address/${address}`;
}

export const printImportantInfo = async (nodeInfo: NodeInfo): Promise<void> => {
  const client = getEthereumClient(nodeInfo.l1ChainId);
  rollupContract = getRollupContract();
  const gse = await rollupContract.read.getGSE();
  const governance = await getContract({
    address: gse,
    abi: GSEAbi,
    client,
  }).read.getGovernance();
  const governanceConfig = await getContract({
    address: governance,
    abi: GovernanceAbi,
    client,
  }).read.getConfiguration();
  // NOTE: withdrawal delay copied from https://github.com/AztecProtocol/l1-contracts/blob/f0b17231361e40b6802e927fda98b8d5f84c1c24/src/governance/libraries/ConfigurationLib.sol#L36
  const {
    votingDelay,
    votingDuration,
    executionDelay,
  } = governanceConfig;
  const withdrawalDelayTimeStamp = votingDelay / 5n + votingDuration + executionDelay;
  const withdrawalDelayInHrs = Number(withdrawalDelayTimeStamp) / 60 / 60;
  console.log(`rollup contract (${getEtherscanAddressUrl(client, rollupContract.address)}):
  rewarddistributor: ${getEtherscanAddressUrl(client, await rollupContract.read.getRewardDistributor())}
  gse: ${getEtherscanAddressUrl(client, gse)}
  governance: ${getEtherscanAddressUrl(client, governance)}
  governance config: ${JSON.stringify(governanceConfig, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}
  withdrawal delay (in hrs): ${withdrawalDelayInHrs}
  isrewardsclaimable: ${await rollupContract.read.isRewardsClaimable()}
`);

  const feeTokenContract = getContract({
    address: await rollupContract.read.getFeeAsset(),
    abi: erc20Abi,
    client,
  });
  console.log(`Fee token(${getEtherscanAddressUrl(client, feeTokenContract.address)}):
name: ${await feeTokenContract.read.name()}
symbol: ${await feeTokenContract.read.symbol()}
supply: ${await feeTokenContract.read.totalSupply()}
`);
  const stakingAssetContract = getContract({
    address: await rollupContract.read.getStakingAsset(),
    abi: erc20Abi,
    client,
  });
  console.log(`Staking token(${getEtherscanAddressUrl(client, stakingAssetContract.address)}):
name: ${await stakingAssetContract.read.name()}
symbol: ${await stakingAssetContract.read.symbol()}
supply: ${await stakingAssetContract.read.totalSupply()}
`);
};

type CalldataExport = {
  address: string,
  calldata: ReturnType<typeof encodeFunctionData>,
}

export const getApproveStakeSpendCalldata = async (
  currentTokenHolderAddress: string,
  nbrOfAttesters: number = 1,
): Promise<CalldataExport> => {
  const rollupContract = getRollupContract();
  const activationThreshold = await rollupContract.read.getActivationThreshold();
  console.log(`Activation threshold: ${activationThreshold}`);
  const stakingAssetAddress = await rollupContract.read.getStakingAsset();
  // const alreadyApproved = await getContract({
  //   address: stakingAssetAddress,
  //   abi: erc20Abi,
  //   client: getEthereumClient(),
  // }).read.allowance([getAddress(currentTokenHolderAddress), rollupContract.address]);
  const currentTokenHoldings = await getContract({
    address: stakingAssetAddress,
    abi: erc20Abi,
    client: getEthereumClient()
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
      functionName: 'approve',
      args: [
        getRollupContract().address,
        requiredAllowance
      ]
    })
  };
};

export const getDepositCalldata = async (
  attesterAddress: string,
  withdrawerAddress: string,
  blsSecretKey: string,
  moveWithLatestRollup: boolean = true,
  nodeInfo: NodeInfo
): Promise<CalldataExport> => {
  const client = getEthereumClient(nodeInfo.l1ChainId);
  const rollupContract = getRollupContract();
  // const attesterView = await rollupContract.read.getAttesterView([getAddress(attesterAddress)]);
  // const attesterConfig = await rollupContract.read.getConfig([getAddress(attesterAddress)]);
  // const attesterExit = await rollupContract.read.getExit([getAddress(attesterAddress)]);
  // const attesterStatus = await rollupContract.read.getStatus([getAddress(attesterAddress)]);
  //
  // console.log(`Attester view for ${attesterAddress}:`, {
  //   attesterView,
  //   attesterConfig,
  //   attesterExit,
  //   attesterStatus,
  // });

  const gse = new GSEContract(client as ViemPublicClient, await rollupContract.read.getGSE());
  const registrationTuple = await gse.makeRegistrationTuple(BigInt(blsSecretKey));

  return {
    address: rollupContract.address,
    calldata: encodeFunctionData({
      abi: RollupAbi,
      functionName: 'deposit',
      args: [
        getAddress(attesterAddress),
        getAddress(withdrawerAddress),
        registrationTuple.publicKeyInG1,
        registrationTuple.publicKeyInG2,
        registrationTuple.proofOfPossession,
        moveWithLatestRollup,
      ],
    })
  };
}
export const logAttestersCalldata = async (
  keystoreData: CuratedKeystoreData[],
  withdrawerAddress: string,
  nodeInfo: NodeInfo
): Promise<void> => {
  for (const d of keystoreData) {
    const attesterAddress = getAddressFromPrivateKey(d.ethPrivateKey as `0x${string}`);
    const calldatata = await getDepositCalldata(
      attesterAddress,
      withdrawerAddress,
      d.blsSecretKey,
      true,
      nodeInfo
    );
    console.log(`✅ Deposit calldata for attester ${attesterAddress}:`, calldatata);
  }
}

const RECOMMENDED_ETH_PER_ATTESTER = parseEther("0.1");

export const printPublisherETH = async (nodeInfo: NodeInfo, dirData: DirData) => {
  const client = getEthereumClient(nodeInfo.l1ChainId);
  const publishers: Record<HexString, {
    load: number,
    currentBalance: bigint,
    requiredTopUp: bigint
  }> = {};
  for (const keystore of dirData.keystores) {
    for (const validator of keystore.data.validators) {
      if (typeof validator.publisher === "string") {
        const pub = publishers[validator.publisher] || { load: 0, currentBalance: 0n, requiredTopUp: 0n };
        pub.load += 1;
        publishers[validator.publisher] = pub;
      } else {
        const loadFactor = 1 / validator.publisher.length;
        for (const pubPrivKey of validator.publisher) {
          const pub = publishers[pubPrivKey] || { load: 0, currentBalance: 0n, requiredTopUp: 0n };
          pub.load += loadFactor;
          publishers[pubPrivKey] = pub;
        }
      }
    }
  }
  console.log("Publisher ETH balances and required top-ups:");
  for (const [publisherPrivKey, info] of Object.entries(publishers)) {
    const privKey = publisherPrivKey as HexString;
    const pubAddr = getAddressFromPrivateKey(privKey);
    publishers[privKey]!.currentBalance = await client.getBalance({ address: pubAddr });
    publishers[privKey]!.requiredTopUp = BigInt(Math.ceil(info.load)) * RECOMMENDED_ETH_PER_ATTESTER - info.currentBalance;
    const requiresTopUpString = publishers[privKey]!.requiredTopUp > 0n ? ` REQUIRES TOP-UP OF: ${formatEther(publishers[privKey]!.requiredTopUp)} ETH` : ``;
    console.log(`${pubAddr} - load: ${info.load}, current balance: ${formatEther(publishers[privKey]!.currentBalance)} ETH${requiresTopUpString}`);
  }
}
