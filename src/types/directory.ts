import { z } from "zod";
import { KeystoreDataSchema } from "./keystore.js";
import { AttesterRegistrationSchema } from "./attester.js";

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
