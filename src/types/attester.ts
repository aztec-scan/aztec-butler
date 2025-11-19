import { z } from "zod";

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
