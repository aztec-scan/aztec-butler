import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverKeysFiles,
  getDataDir,
  loadAndMergeKeysFiles,
} from "../../src/core/utils/keysFileOperations.js";
import { isRegisteredKeysFile } from "../../src/server/file-watcher.js";

async function writeKeysFile(
  dataDir: string,
  network: string,
  host: string,
  source: string,
  attester: string,
  publisher: string,
): Promise<void> {
  const dir = path.join(dataDir, network, host);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${source}-registered-keys.json`),
    JSON.stringify({
      schemaVersion: 1,
      validators: [
        {
          attester: { eth: attester, bls: "0x01" },
          coinbase: "0x02",
          feeRecipient: "0x03",
          publisher,
        },
      ],
    }),
  );
}

test("discovers nested registered-key sources and ignores flat legacy files", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aztec-butler-"));
  await fs.writeFile(
    path.join(dataDir, "mainnet-keys-beast-3-v99.json"),
    JSON.stringify({ validators: [] }),
  );
  await writeKeysFile(
    dataDir,
    "mainnet",
    "beast-3",
    "native",
    "0x1001",
    "0x2001",
  );

  const sources = await discoverKeysFiles("mainnet", dataDir);

  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.serverId, "beast-3");
  assert.equal(sources[0]?.host, "beast-3");
  assert.equal(sources[0]?.source, "native");
  assert.equal(sources[0]?.format, "registered-nested");
});

test("loads native and Olla sources as separate server IDs", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aztec-butler-"));
  await writeKeysFile(
    dataDir,
    "testnet",
    "beast-5",
    "native",
    "0x1001",
    "0x2001",
  );
  await writeKeysFile(
    dataDir,
    "testnet",
    "beast-5",
    "olla",
    "0x1002",
    "0x2002",
  );

  const result = await loadAndMergeKeysFiles("testnet", dataDir);
  const publisherServerIds = result.publishers.map((p) => p.serverId).sort();

  assert.equal(result.attesters.length, 2);
  assert.deepEqual(publisherServerIds, ["beast-5", "beast-5-olla"]);
  assert.deepEqual(result.filesLoaded.sort(), [
    path.join("testnet", "beast-5", "native-registered-keys.json"),
    path.join("testnet", "beast-5", "olla-registered-keys.json"),
  ]);
});

test("watcher recognizes only nested registered-key files", () => {
  const dataDir = getDataDir();

  assert.equal(
    isRegisteredKeysFile(
      "testnet",
      path.join(dataDir, "testnet", "beast-5", "olla-registered-keys.json"),
    ),
    true,
  );
  assert.equal(
    isRegisteredKeysFile(
      "testnet",
      path.join(dataDir, "testnet-keys-beast-5-v1.json"),
    ),
    false,
  );
});
