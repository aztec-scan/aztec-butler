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
    path: string,
    id: string,
    data: KeystoreData,
  }[],
  attesterRegistrations: {
    path: string,
    id: string,
    data: AttesterRegistration[]
  }[]
}

export const MOCK_REGISTRY_ABI = [
  {
    name: 'registerProvider',
    type: 'function',
    inputs: [
      { type: 'address', name: 'providerAdmin' },
      { type: 'uint16', name: 'commissionRate' },
      { type: 'address', name: 'rewardsRecipient' },
    ],
    outputs: [
      { type: 'uint256', name: 'providerIdentifier' }
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'addKeysToProvider',
    type: 'function',
    inputs: [
      { type: 'uint256', name: 'providerIdentifier' },
      {
        type: 'tuple[]',
        name: 'keyStores',
        components: [
          { type: 'address', name: 'attester' },
          {
            type: 'tuple',
            name: 'publicKeyG1',
            components: [
              { type: 'uint256', name: 'x' },
              { type: 'uint256', name: 'y' }
            ]
          },
          {
            type: 'tuple',
            name: 'publicKeyG2',
            components: [
              { type: 'uint256', name: 'x0' },
              { type: 'uint256', name: 'x1' },
              { type: 'uint256', name: 'y0' },
              { type: 'uint256', name: 'y1' }
            ]
          },
          {
            type: 'tuple',
            name: 'proofOfPossession',
            components: [
              { type: 'uint256', name: 'x' },
              { type: 'uint256', name: 'y' }
            ]
          }
        ]
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getProviderQueueLength',
    type: 'function',
    inputs: [
      { type: 'uint256', name: 'providerIdentifier' }
    ],
    outputs: [
      { type: 'uint256', name: 'queueLength' }
    ],
    stateMutability: 'view',
  },
  {
    name: 'updateProviderAdmin',
    type: 'function',
    inputs: [
      { type: 'uint256', name: 'providerIdentifier' },
      { type: 'address', name: 'newAdmin' }
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'updateProviderRewardsRecipient',
    type: 'function',
    inputs: [
      { type: 'uint256', name: 'providerIdentifier' },
      { type: 'address', name: 'newRewardsRecipient' }
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'updateProviderTakeRate',
    type: 'function',
    inputs: [
      { type: 'uint256', name: 'providerIdentifier' },
      { type: 'uint16', name: 'newTakeRate' }
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'providerConfigurations',
    type: 'function',
    inputs: [
      { type: 'uint256', name: 'providerIdentifier' }
    ],
    outputs: [
      { type: 'address', name: 'admin' },
      { type: 'uint16', name: 'takeRate' },
      { type: 'address', name: 'rewardsRecipient' }
    ],
    stateMutability: 'view',
  },
];
