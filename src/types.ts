export type HexString = `0x${string}`;
export type KeystoreData = {
  validators:
  {
    attester: {
      bls: HexString,
      eth: HexString
    },
    coinbase?: HexString,
    publisher: HexString | HexString[],
    feeRecipient: HexString
  }[],
}

export type CuratedKeystoreData = {
  blsSecretKey: string,
  ethPrivateKey: string
}

export type AttesterRegistration = {
  attester: string,
  publicKeyG1: {
    x: string,
    y: string
  }
  publicKeyG2: {
    x0: string,
    y0: string
    x1: string,
    y1: string
  }
  proofOfPossession: {
    x: string,
    y: string
  }

}
export type DirData = {
  l1RpcUrl: string | undefined,
  l2RpcUrl: string | undefined,
  keystores: {
    name: string,
    data: KeystoreData,
  }[],
  attesterRegistrations: {
    name: string,
    data: AttesterRegistration[]
  }
}
