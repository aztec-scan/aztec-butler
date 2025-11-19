import { z } from "zod";
import { HexStringSchema } from "./common.js";

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
