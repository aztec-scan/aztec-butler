import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, type Address } from "viem";
import { EthereumClient } from "../../src/core/components/EthereumClient.js";

type ProviderConfig = readonly [
  admin: string,
  takeRate: number,
  rewardsRecipient: string,
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Build an EthereumClient with a stubbed native staking registry contract.
 *
 * `providers` is the list of registered provider configurations, indexed by
 * provider id. The stub mimics a Solidity *mapping* getter: reading an
 * out-of-range id returns a zero-struct — it does NOT revert. This is the
 * behaviour that made the old `while (true)` scan loop forever.
 */
function buildClientWithProviders(providers: ProviderConfig[]) {
  const client = new EthereumClient({
    rpcUrl: "http://localhost:8545",
    chainId: 11155111,
    rollupAddress: "0x0000000000000000000000000000000000000001" as Address,
  });

  const reads = { providerConfigurations: [] as bigint[], nextProviderIdentifier: 0 };
  // Hard cap so a regression to an unbounded scan fails fast with a clear
  // message instead of hanging the test suite.
  const MAX_READS = 100;

  const stub = {
    read: {
      nextProviderIdentifier: async (): Promise<bigint> => {
        reads.nextProviderIdentifier++;
        return BigInt(providers.length);
      },
      providerConfigurations: async ([id]: [bigint]): Promise<ProviderConfig> => {
        reads.providerConfigurations.push(id);
        if (reads.providerConfigurations.length > MAX_READS) {
          throw new Error(
            `providerConfigurations called ${reads.providerConfigurations.length} times — scan is not bounded`,
          );
        }
        // Mapping semantics: an out-of-range id yields a zero-struct, no revert.
        return providers[Number(id)] ?? [ZERO_ADDRESS, 0, ZERO_ADDRESS];
      },
    },
  };

  (
    client as unknown as { nativeStakingRegistryContract: unknown }
  ).nativeStakingRegistryContract = stub;

  return { client, reads };
}

test(
  "native lookup terminates and returns null when the admin owns no provider",
  { timeout: 10_000 },
  async () => {
    const { client, reads } = buildClientWithProviders([
      [getAddress("0x1111111111111111111111111111111111111111"), 100, ZERO_ADDRESS],
      [getAddress("0x2222222222222222222222222222222222222222"), 200, ZERO_ADDRESS],
      [getAddress("0x3333333333333333333333333333333333333333"), 300, ZERO_ADDRESS],
    ]);

    const result = await client.getStakingProvider(
      "0x9999999999999999999999999999999999999999",
      "native",
    );

    assert.equal(result, null);
    // The scan must be bounded by nextProviderIdentifier (3) and never read an
    // out-of-range id. A regression to the old `while (true)` loop would read
    // id 3, 4, 5, ... forever against mapping semantics.
    assert.deepEqual(reads.providerConfigurations, [0n, 1n, 2n]);
  },
);

test("native lookup returns null without scanning when the registry is empty", async () => {
  const { client, reads } = buildClientWithProviders([]);

  const result = await client.getStakingProvider(
    "0x9999999999999999999999999999999999999999",
    "native",
  );

  assert.equal(result, null);
  assert.deepEqual(reads.providerConfigurations, []);
});

test("native lookup matches the admin address case-insensitively", async () => {
  const checksummedAdmin = getAddress(
    "0xabcdef0123456789abcdef0123456789abcdef01",
  );
  const rewardsRecipient = getAddress(
    "0x00000000000000000000000000000000deadbeef",
  );
  const { client } = buildClientWithProviders([
    [getAddress("0x1111111111111111111111111111111111111111"), 100, ZERO_ADDRESS],
    [checksummedAdmin, 250, rewardsRecipient],
  ]);

  // Operator supplies the admin in all-lowercase (common for env-var config);
  // the on-chain value returned by viem is EIP-55 checksummed.
  const result = await client.getStakingProvider(
    checksummedAdmin.toLowerCase(),
    "native",
  );

  assert.notEqual(result, null);
  assert.equal(result?.providerId, 1n);
  assert.equal(result?.admin, checksummedAdmin);
  assert.equal(result?.takeRate, 250);
  assert.equal(result?.rewardsRecipient, rewardsRecipient);
});
