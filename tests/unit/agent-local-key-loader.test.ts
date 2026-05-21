import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectLocalPublishers,
  loadLocalRegisteredKeys,
} from "../../src/agent/keys/local-key-loader.js";

interface ValidatorInput {
  attester: string;
  publisher: string | string[];
  coinbase?: string;
}

async function writeRegistryFile(
  dataDir: string,
  network: string,
  host: string,
  registry: string,
  validators: ValidatorInput[],
): Promise<void> {
  const dir = path.join(dataDir, network, host);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${registry}-registered-keys.json`),
    JSON.stringify({
      schemaVersion: 1,
      validators: validators.map((v) => ({
        attester: { eth: v.attester, bls: "0x01" },
        ...(v.coinbase ? { coinbase: v.coinbase } : {}),
        feeRecipient: "0x03",
        publisher: v.publisher,
      })),
    }),
  );
}

test("preserves host and registry placement per attester", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-keys-"));
  await writeRegistryFile(dataDir, "mainnet", "beast-3", "native", [
    { attester: "0xaa01", publisher: "0xbb01", coinbase: "0xcc01" },
  ]);
  await writeRegistryFile(dataDir, "mainnet", "beast-3", "olla", [
    { attester: "0xaa02", publisher: ["0xbb02", "0xbb03"] },
  ]);

  const { keys, filesLoaded } = await loadLocalRegisteredKeys("mainnet", "beast-3", dataDir);

  assert.equal(keys.length, 2);
  assert.equal(filesLoaded.length, 2);

  const native = keys.find((k) => k.attesterAddress === "0xaa01");
  assert.ok(native);
  assert.equal(native.network, "mainnet");
  assert.equal(native.host, "beast-3");
  assert.equal(native.registry, "native");
  assert.equal(native.coinbase, "0xcc01");
  assert.deepEqual(native.publishers, ["0xbb01"]);

  const olla = keys.find((k) => k.attesterAddress === "0xaa02");
  assert.ok(olla);
  assert.equal(olla.registry, "olla");
  assert.equal(olla.coinbase, undefined);
  assert.deepEqual(olla.publishers, ["0xbb02", "0xbb03"]);
});

test("reads only the configured host's directory", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-keys-"));
  await writeRegistryFile(dataDir, "mainnet", "beast-3", "native", [
    { attester: "0xaa01", publisher: "0xbb01" },
  ]);
  await writeRegistryFile(dataDir, "mainnet", "beast-4", "native", [
    { attester: "0xaa99", publisher: "0xbb99" },
  ]);

  const { keys } = await loadLocalRegisteredKeys("mainnet", "beast-3", dataDir);

  assert.equal(keys.length, 1);
  assert.equal(keys[0]?.attesterAddress, "0xaa01");
  assert.equal(keys[0]?.host, "beast-3");
});

test("skips files with unknown registry prefixes", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-keys-"));
  await writeRegistryFile(dataDir, "mainnet", "beast-3", "native", [
    { attester: "0xaa01", publisher: "0xbb01" },
  ]);
  await writeRegistryFile(dataDir, "mainnet", "beast-3", "rocketpool", [
    { attester: "0xaa02", publisher: "0xbb02" },
  ]);

  const { keys, filesSkipped } = await loadLocalRegisteredKeys("mainnet", "beast-3", dataDir);

  assert.equal(keys.length, 1);
  assert.equal(keys[0]?.registry, "native");
  assert.deepEqual(filesSkipped, ["rocketpool-registered-keys.json"]);
});

test("returns empty result when host directory is absent", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-keys-"));
  const { keys, filesLoaded } = await loadLocalRegisteredKeys("mainnet", "ghost-host", dataDir);
  assert.deepEqual(keys, []);
  assert.deepEqual(filesLoaded, []);
});

test("collectLocalPublishers deduplicates case-insensitively", () => {
  const publishers = collectLocalPublishers([
    {
      network: "mainnet",
      host: "beast-3",
      registry: "native",
      attesterAddress: "0xaa01",
      publishers: ["0xBB01", "0xbb02"],
      filePath: "x",
    },
    {
      network: "mainnet",
      host: "beast-3",
      registry: "olla",
      attesterAddress: "0xaa02",
      publishers: ["0xbb01"],
      filePath: "y",
    },
  ]);
  assert.equal(publishers.length, 2);
});
