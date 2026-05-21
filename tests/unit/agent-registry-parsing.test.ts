import assert from "node:assert/strict";
import test from "node:test";
import {
  isRegisteredKeysFilename,
  parseRegistryFromFilename,
} from "../../src/agent/keys/local-key-loader.js";

test("parses native registry from filename", () => {
  assert.equal(parseRegistryFromFilename("native-registered-keys.json"), "native");
});

test("parses olla registry from filename", () => {
  assert.equal(parseRegistryFromFilename("olla-registered-keys.json"), "olla");
});

test("rejects unknown registry prefixes", () => {
  assert.throws(
    () => parseRegistryFromFilename("rocketpool-registered-keys.json"),
    /Unknown registry prefix "rocketpool"/,
  );
});

test("rejects non registered-keys files", () => {
  assert.throws(
    () => parseRegistryFromFilename("mainnet-keys-beast-3-v1.json"),
    /Not a registered-keys file/,
  );
});

test("isRegisteredKeysFilename is true only for known registries", () => {
  assert.equal(isRegisteredKeysFilename("native-registered-keys.json"), true);
  assert.equal(isRegisteredKeysFilename("olla-registered-keys.json"), true);
  assert.equal(isRegisteredKeysFilename("rocketpool-registered-keys.json"), false);
  assert.equal(isRegisteredKeysFilename("attester-state.json"), false);
});
