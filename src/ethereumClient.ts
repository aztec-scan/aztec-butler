import type { NodeInfo } from "@aztec/aztec.js";
import { getAddressFromPrivateKey, GSEContract, type ViemPublicClient } from "@aztec/ethereum";
import { RollupAbi } from "@aztec/l1-artifacts";
import assert from "assert";
import "dotenv/config";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, getContract, http, type Address, type GetContractReturnType, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";
import type { CuratedKeystoreData } from "./fileUtils.js";

const ETHEREUM_NODE_URL = process.env.ETHEREUM_NODE_URL;

const supportedChains = [
  sepolia,
  mainnet,
]

type RollupContract = GetContractReturnType<typeof RollupAbi, PublicClient>;

let client: PublicClient | undefined;
let rollupContract: RollupContract | undefined;

const getEthereumClient = (chainId?: number): PublicClient => {
  if (!client) {
    if (!chainId) {
      throw new Error("Chain ID must be provided for the first initialization of the Ethereum client");
    }
    client = createEthereumClient(chainId);
  }
  return client;
}

const createEthereumClient = (chainId: number) => {
  if (!ETHEREUM_NODE_URL) {
    throw new Error("ETHEREUM_NODE_URL is not defined in environment variables");
  }
  const chain = supportedChains.find(c => c.id === chainId);
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return createPublicClient({
    transport: http(ETHEREUM_NODE_URL),
    chain: chain,
  });
};

const getRollupContract = () => {
  if (!rollupContract) {
    throw new Error("Rollup contract is not initialized. Call init() first.");
  }
  return rollupContract;
}

export const init = async (nodeInfo: NodeInfo): Promise<void> => {
  const client = getEthereumClient(nodeInfo.l1ChainId);
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

export const printLinks = async (nodeInfo: NodeInfo): Promise<void> => {
  const client = getEthereumClient(nodeInfo.l1ChainId);
  rollupContract = getRollupContract();
  console.log(`rollup contract (${getEtherscanAddressUrl(client, rollupContract.address)}):
  rewarddistributor: ${getEtherscanAddressUrl(client, await rollupContract.read.getRewardDistributor())}
  gse: ${getEtherscanAddressUrl(client, await rollupContract.read.getGSE())}
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
