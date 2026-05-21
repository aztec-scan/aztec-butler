import assert from "node:assert/strict";
import test from "node:test";
import { globalAttributes, localAttributes } from "../../src/agent/metrics/agent-metrics.js";

test("local metric attributes carry network and host", () => {
  const attrs = localAttributes("mainnet", "beast-3", {
    registry: "olla",
    attester_address: "0xabc",
  });
  assert.equal(attrs.network, "mainnet");
  assert.equal(attrs.host, "beast-3");
  assert.equal(attrs.registry, "olla");
  assert.equal(attrs.attester_address, "0xabc");
});

test("global metric attributes carry network but never host", () => {
  const attrs = globalAttributes("mainnet", { registry: "olla" });
  assert.equal(attrs.network, "mainnet");
  assert.equal(attrs.registry, "olla");
  assert.ok(!("host" in attrs), "global attributes must not contain a host label");
});

test("global metric attributes work without extras", () => {
  const attrs = globalAttributes("mainnet");
  assert.deepEqual(Object.keys(attrs), ["network"]);
});

test("globalAttributes rejects an explicit host extra", () => {
  assert.throws(
    () => globalAttributes("mainnet", { host: "beast-3" } as Record<string, string>),
    /must not carry a `host` attribute/,
  );
});
