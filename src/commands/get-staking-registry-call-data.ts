import { NodeInfo } from "@aztec/aztec.js";
import { getAddressFromPrivateKey } from "@aztec/ethereum";
import { formatEther, parseEther } from "viem";
import { getEthereumClient } from "../components/ethereumClient.js";
import { DirData, HexString } from "../types.js";

const command = async (nodeInfo: NodeInfo, dirData: DirData) => {
  // TODO
}

export default command;
