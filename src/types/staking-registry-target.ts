export const STAKING_REGISTRY_TARGETS = ["native", "olla"] as const;

export type StakingRegistryTarget = (typeof STAKING_REGISTRY_TARGETS)[number];
