import { z } from "zod";
import { HexStringSchema } from "./common.js";

export const StakingProviderDataSchema = z.object({
  providerId: z.bigint(),
  admin: HexStringSchema,
  takeRate: z.number(),
  rewardsRecipient: HexStringSchema,
});

export type StakingProviderData = z.infer<typeof StakingProviderDataSchema>;
