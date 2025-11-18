import {
  getAddressFromPrivateKey,
  GSEContract,
  ViemPublicClient,
} from "@aztec/ethereum";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import { AttesterRegistration, DirData, HexString } from "../../types.js";
import fs from "fs/promises";

const get0xString = (bn: bigint): HexString => {
  return `0x${bn.toString(16).padStart(64, "0")}`;
};

const ATTESTER_REGISTRATION_FILE_PREFIX = "regs";

const command = async (
  ethClient: EthereumClient,
  dirData: DirData,
  attesterDirPath: string,
): Promise<DirData["attesterRegistrations"]> => {
  const client = ethClient.getPublicClient();
  const rollupContract = ethClient.getRollupContract();
  const keystoresMissingRegistrationFiles: DirData["keystores"] =
    dirData.keystores.filter((ks) => {
      if (dirData.attesterRegistrations.find((ar) => ar.id === ks.id)) {
        return false;
      }
      return true;
    });
  const gse = new GSEContract(
    client as ViemPublicClient,
    await rollupContract.read.getGSE(),
  );
  const newAttesterRegistrations: DirData["attesterRegistrations"] = [];
  for (const keystore of keystoresMissingRegistrationFiles) {
    const attesterRegistrations: AttesterRegistration[] = [];
    for (const validator of keystore.data.validators) {
      const registrationTuple = await gse.makeRegistrationTuple(
        BigInt(validator.attester.bls),
      );
      attesterRegistrations.push({
        attester: getAddressFromPrivateKey(
          validator.attester.eth as `0x${string}`,
        ),
        publicKeyG1: {
          x: get0xString(registrationTuple.publicKeyInG1.x),
          y: get0xString(registrationTuple.publicKeyInG1.y),
        },
        publicKeyG2: {
          x0: get0xString(registrationTuple.publicKeyInG2.x0),
          x1: get0xString(registrationTuple.publicKeyInG2.x1),
          y0: get0xString(registrationTuple.publicKeyInG2.y0),
          y1: get0xString(registrationTuple.publicKeyInG2.y1),
        },
        proofOfPossession: {
          x: get0xString(registrationTuple.proofOfPossession.x),
          y: get0xString(registrationTuple.proofOfPossession.y),
        },
      });
    }
    const path = `${attesterDirPath}/${ATTESTER_REGISTRATION_FILE_PREFIX}${keystore.id}.json`;
    await fs.writeFile(
      path,
      JSON.stringify(attesterRegistrations, null, 2),
      "utf8",
    );
    newAttesterRegistrations.push({
      id: keystore.id,
      path,
      data: attesterRegistrations,
    });
  }
  return [...dirData.attesterRegistrations, ...newAttesterRegistrations];
};
// TODO: add another command-file where you go through ALL attester-files and checks on chain status and print calldata if not already registered on staking registry

export default command;
