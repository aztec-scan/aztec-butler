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

/**
 * On-chain status of an attester from the rollup contract
 * Maps to the Status enum in the rollup contract
 */
export enum AttesterOnChainStatus {
  NONE = 0,
  VALIDATING = 1,
  ZOMBIE = 2,
  EXITING = 3,
}

/**
 * Full attester view from the rollup contract
 * Returned by getAttesterView() call
 */
export interface AttesterView {
  status: AttesterOnChainStatus;
  effectiveBalance: bigint;
  exit: {
    withdrawalId: bigint;
    amount: bigint;
    exitableAt: bigint;
    recipientOrWithdrawer: string;
    isRecipient: boolean;
    exists: boolean;
  };
  config: {
    publicKey: {
      x: bigint;
      y: bigint;
    };
    withdrawer: string;
  };
}

export const AttesterViewSchema = z.object({
  status: z.nativeEnum(AttesterOnChainStatus),
  effectiveBalance: z.bigint(),
  exit: z.object({
    withdrawalId: z.bigint(),
    amount: z.bigint(),
    exitableAt: z.bigint(),
    recipientOrWithdrawer: z.string(),
    isRecipient: z.boolean(),
    exists: z.boolean(),
  }),
  config: z.object({
    publicKey: z.object({
      x: z.bigint(),
      y: z.bigint(),
    }),
    withdrawer: z.string(),
  }),
});

export type AttesterViewData = z.infer<typeof AttesterViewSchema>;
