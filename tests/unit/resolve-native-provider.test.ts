import assert from "node:assert/strict";
import test from "node:test";
import type { EthereumClient } from "../../src/core/components/EthereumClient.js";
import {
  describeNativeProvider,
  resolveNativeProvider,
} from "../../src/core/components/staking-provider.js";
import type { StakingProviderData } from "../../src/types/index.js";

const ADMIN = `0x${"a".repeat(40)}`;

const providerData = (providerId: bigint): StakingProviderData => ({
  providerId,
  admin: ADMIN,
  takeRate: 100,
  rewardsRecipient: `0x${"b".repeat(40)}`,
});

/**
 * Minimal EthereumClient stub — only the two registry reads `resolveNativeProvider`
 * uses. Records which path was taken.
 */
function fakeEthClient(opts: {
  byId?: StakingProviderData | null;
  byAdmin?: StakingProviderData | null;
}) {
  const calls: string[] = [];
  const client = {
    getStakingProviderById: async (id: bigint) => {
      calls.push(`byId:${id}`);
      return opts.byId ?? null;
    },
    getStakingProvider: async (admin: string, target: string) => {
      calls.push(`byAdmin:${admin}:${target}`);
      return opts.byAdmin ?? null;
    },
  };
  return { client: client as unknown as EthereumClient, calls };
}

test("describeNativeProvider — id form and admin form", () => {
  assert.equal(describeNativeProvider({ providerId: 4n }), "id=4");
  assert.equal(describeNativeProvider({ adminAddress: ADMIN }), `admin ${ADMIN}`);
});

test("resolveNativeProvider — uses the id read when a provider id is set", async () => {
  const { client, calls } = fakeEthClient({ byId: providerData(4n) });

  const result = await resolveNativeProvider(client, { providerId: 4n });

  assert.equal(result?.providerId, 4n);
  assert.deepEqual(calls, ["byId:4"]);
});

test("resolveNativeProvider — falls back to admin-address resolution", async () => {
  const { client, calls } = fakeEthClient({ byAdmin: providerData(7n) });

  const result = await resolveNativeProvider(client, { adminAddress: ADMIN });

  assert.equal(result?.providerId, 7n);
  assert.deepEqual(calls, [`byAdmin:${ADMIN}:native`]);
});

test("resolveNativeProvider — prefers the id when both id and admin are set", async () => {
  const { client, calls } = fakeEthClient({
    byId: providerData(4n),
    byAdmin: providerData(7n),
  });

  const result = await resolveNativeProvider(client, {
    providerId: 4n,
    adminAddress: ADMIN,
  });

  assert.equal(result?.providerId, 4n);
  assert.deepEqual(calls, ["byId:4"]);
});

test("resolveNativeProvider — resolves provider id 0 via the id read", async () => {
  const { client, calls } = fakeEthClient({ byId: providerData(0n) });

  const result = await resolveNativeProvider(client, { providerId: 0n });

  assert.equal(result?.providerId, 0n);
  assert.deepEqual(calls, ["byId:0"]);
});

test("resolveNativeProvider — returns null when the underlying read finds nothing", async () => {
  const { client } = fakeEthClient({ byAdmin: null });

  const result = await resolveNativeProvider(client, { adminAddress: ADMIN });

  assert.equal(result, null);
});

test("resolveNativeProvider — throws when the selector is empty", async () => {
  const { client } = fakeEthClient({});

  await assert.rejects(
    () => resolveNativeProvider(client, {}),
    /neither a provider id nor an admin address/,
  );
});
