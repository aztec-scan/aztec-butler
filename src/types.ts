import { z } from "zod";

// Base schemas
export const HexStringSchema = z.string().regex(/^0x[0-9a-fA-F]+$/);

// Keep the original template literal type for compile-time type safety
// while using the schema for runtime validation
export type HexString = `0x${string}`;

export const KeystoreDataSchema = z.object({
  validators: z.array(
    z.object({
      attester: z.object({
        bls: HexStringSchema,
        eth: HexStringSchema,
      }),
      coinbase: HexStringSchema.optional(),
      publisher: z.union([HexStringSchema, z.array(HexStringSchema)]),
      feeRecipient: HexStringSchema,
    }),
  ),
});

export type KeystoreData = z.infer<typeof KeystoreDataSchema>;

export const CuratedKeystoreDataSchema = z.object({
  blsSecretKey: z.string(),
  ethPrivateKey: z.string(),
});

export type CuratedKeystoreData = z.infer<typeof CuratedKeystoreDataSchema>;

export const AttesterRegistrationSchema = z.object({
  attester: z.string(),
  publicKeyG1: z.object({
    x: z.string(),
    y: z.string(),
  }),
  publicKeyG2: z.object({
    x0: z.string(),
    y0: z.string(),
    x1: z.string(),
    y1: z.string(),
  }),
  proofOfPossession: z.object({
    x: z.string(),
    y: z.string(),
  }),
});

export type AttesterRegistration = z.infer<typeof AttesterRegistrationSchema>;

export const StakingProviderDataSchema = z.object({
  providerId: z.bigint(),
  admin: HexStringSchema,
  takeRate: z.number(),
  rewardsRecipient: HexStringSchema,
});

export type StakingProviderData = z.infer<typeof StakingProviderDataSchema>;

export const DirDataSchema = z.object({
  l1RpcUrl: z.string().url().optional(),
  l2RpcUrl: z.string().url().optional(),
  keystores: z.array(
    z.object({
      path: z.string(),
      id: z.string(),
      data: KeystoreDataSchema,
    }),
  ),
  attesterRegistrations: z.array(
    z.object({
      path: z.string(),
      id: z.string(),
      data: z.array(AttesterRegistrationSchema),
    }),
  ),
});

export type DirData = z.infer<typeof DirDataSchema>;

export const MOCK_REGISTRY_ABI = [
  {
    name: "registerProvider",
    type: "function",
    inputs: [
      { type: "address", name: "providerAdmin" },
      { type: "uint16", name: "commissionRate" },
      { type: "address", name: "rewardsRecipient" },
    ],
    outputs: [{ type: "uint256", name: "providerIdentifier" }],
    stateMutability: "nonpayable",
  },
  {
    name: "addKeysToProvider",
    type: "function",
    inputs: [
      { type: "uint256", name: "providerIdentifier" },
      {
        type: "tuple[]",
        name: "keyStores",
        components: [
          { type: "address", name: "attester" },
          {
            type: "tuple",
            name: "publicKeyG1",
            components: [
              { type: "uint256", name: "x" },
              { type: "uint256", name: "y" },
            ],
          },
          {
            type: "tuple",
            name: "publicKeyG2",
            components: [
              { type: "uint256", name: "x0" },
              { type: "uint256", name: "x1" },
              { type: "uint256", name: "y0" },
              { type: "uint256", name: "y1" },
            ],
          },
          {
            type: "tuple",
            name: "proofOfPossession",
            components: [
              { type: "uint256", name: "x" },
              { type: "uint256", name: "y" },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getProviderQueueLength",
    type: "function",
    inputs: [{ type: "uint256", name: "providerIdentifier" }],
    outputs: [{ type: "uint256", name: "queueLength" }],
    stateMutability: "view",
  },
  {
    name: "updateProviderAdmin",
    type: "function",
    inputs: [
      { type: "uint256", name: "providerIdentifier" },
      { type: "address", name: "newAdmin" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "updateProviderRewardsRecipient",
    type: "function",
    inputs: [
      { type: "uint256", name: "providerIdentifier" },
      { type: "address", name: "newRewardsRecipient" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "updateProviderTakeRate",
    type: "function",
    inputs: [
      { type: "uint256", name: "providerIdentifier" },
      { type: "uint16", name: "newTakeRate" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "providerConfigurations",
    type: "function",
    inputs: [{ type: "uint256", name: "providerIdentifier" }],
    outputs: [
      { type: "address", name: "admin" },
      { type: "uint16", name: "takeRate" },
      { type: "address", name: "rewardsRecipient" },
    ],
    stateMutability: "view",
  },
  {
    name: "ProviderRegistered",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "address", name: "providerAdmin", indexed: true },
      { type: "uint16", name: "providerTakeRate", indexed: true },
    ],
  },
  {
    name: "ProviderAdminUpdateInitiated",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "address", name: "newAdmin", indexed: true },
    ],
  },
  {
    name: "ProviderAdminUpdated",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "address", name: "newAdmin", indexed: true },
    ],
  },
  {
    name: "ProviderTakeRateUpdated",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "uint16", name: "newTakeRate", indexed: false },
    ],
  },
  {
    name: "ProviderRewardsRecipientUpdated",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "address", name: "newRewardsRecipient", indexed: true },
    ],
  },
  {
    name: "ProviderQueueDripped",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "address", name: "attester", indexed: true },
    ],
  },
  {
    name: "AttestersAddedToProvider",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "address[]", name: "attesters", indexed: false },
    ],
  },
  {
    name: "StakedWithProvider",
    type: "event",
    inputs: [
      { type: "uint256", name: "providerIdentifier", indexed: true },
      { type: "address", name: "rollupAddress", indexed: true },
      { type: "address", name: "attester", indexed: true },
      { type: "address", name: "coinbaseSplitContractAddress", indexed: false },
      { type: "address", name: "stakerImplementation", indexed: false },
    ],
  },
] as const;
