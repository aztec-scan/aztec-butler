import { NodeInfo } from "@aztec/aztec.js";
import { getAddressFromPrivateKey } from "@aztec/ethereum";
import { encodeFunctionData, formatEther, getAddress, parseEther } from "viem";
import { getEthereumClient, getStakingRegistryAddress } from "../components/ethereumClient.js";
import { DirData, HexString, MOCK_REGISTRY_ABI } from "../types.js";

// cast send [STAKING_REGISTRY_ADDRESS] \
//   "registerProvider(address,uint16,address)" \
//   [PROVIDER_ADMIN_ADDRESS] \
//   500 \
//   [REWARDS_RECIPIENT_ADDRESS] \
//   --rpc-url [RPC_URL] \
//   --private-key [YOUR_PRIVATE_KEY]

const DEFAULT_COMISSION_RATE_PERCENTAGE = 10;

const command = async (nodeInfo: NodeInfo, dirData: DirData, providerAdmin: string) => {
  const stakingRegistryAddress = getStakingRegistryAddress(nodeInfo)
  const providerAdminAddress = getAddress(providerAdmin);
  const rewardsRecipientAddress = providerAdminAddress; // For simplicity, using the same address
  const comissionBasisPoints = DEFAULT_COMISSION_RATE_PERCENTAGE * 100; // Convert percentage to basis points
  const callData = {
    contractToCall: stakingRegistryAddress,
    callData: encodeFunctionData({
      abi: MOCK_REGISTRY_ABI,
      functionName: "registerProvider",
      args: [
        providerAdminAddress,
        comissionBasisPoints,
        rewardsRecipientAddress,
      ]
    })
  };
  // TODO: when real ABI is available: check if provider is already registered
  console.log("REGISTER PROVIDER CALL DATA:", JSON.stringify(callData, null, 2));
}

export default command;
