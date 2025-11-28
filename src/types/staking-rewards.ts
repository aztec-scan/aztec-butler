import { z } from "zod";
import { HexStringSchema } from "./common.js";

export const StakingRewardsRecipientSchema = z.object({
  address: HexStringSchema,
  allocation: z.bigint(),
});

export const StakingRewardsEntrySchema = z.object({
  coinbase: HexStringSchema,
  attesters: z.array(HexStringSchema),
  pendingRewards: z.bigint(),
  ourShare: z.bigint(),
  otherShare: z.bigint(),
  totalAllocation: z.bigint(),
  ourAllocation: z.bigint(),
  recipients: z.array(StakingRewardsRecipientSchema),
  lastUpdated: z.date(),
});

export type StakingRewardsRecipient = z.infer<
  typeof StakingRewardsRecipientSchema
>;
export type StakingRewardsEntry = z.infer<typeof StakingRewardsEntrySchema>;
export type StakingRewardsMap = Map<string, StakingRewardsEntry>;

export const StakingRewardsSnapshotSchema =
  StakingRewardsEntrySchema.extend({
    blockNumber: z.bigint(),
    timestamp: z.date(),
  });

export const StakingRewardsDailyAggregateSchema = z.object({
  date: z.string(), // YYYY-MM-DD (UTC)
  coinbase: HexStringSchema,
  totalPendingRewards: z.bigint(),
  totalOurShare: z.bigint(),
  totalOtherShare: z.bigint(),
  sampleCount: z.number().int().nonnegative(),
});

export type StakingRewardsSnapshot = z.infer<
  typeof StakingRewardsSnapshotSchema
>;
export type StakingRewardsDailyAggregate = z.infer<
  typeof StakingRewardsDailyAggregateSchema
>;
