import { z } from "zod";
import { HexStringSchema } from "./common.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ValidatorSchema = z.object({
  attester: z.object({
    bls: HexStringSchema,
    eth: HexStringSchema,
  }),
  coinbase: HexStringSchema.refine((val) => val !== ZERO_ADDRESS, {
    message: "Coinbase cannot be zero address",
  }).optional(),
  publisher: z.union([HexStringSchema, z.array(HexStringSchema)]),
  feeRecipient: HexStringSchema,
});

export const KeystoreDataSchema = z.object({
  validators: z.array(ValidatorSchema),
});

export const KeystoreSchema = z.object({
  schemaVersion: z.number().optional(),
  remoteSigner: z.string().optional(),
  validators: z.array(ValidatorSchema),
});

export type Validator = z.infer<typeof ValidatorSchema>;
export type Keystore = z.infer<typeof KeystoreSchema>;
export type KeystoreData = z.infer<typeof KeystoreDataSchema>;

export const CuratedKeystoreDataSchema = z.object({
  blsSecretKey: z.string(),
  ethPrivateKey: z.string(),
});

export type CuratedKeystoreData = z.infer<typeof CuratedKeystoreDataSchema>;

// For use in prepare-deployment command
export type KeystoreValidator = Validator;
