import assert from "node:assert/strict";
import test from "node:test";
import { buildSheetsExporterConfig } from "../../src/sheets-exporter/config.js";

function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ETHEREUM_CHAIN_ID: "1",
    ETHEREUM_NODE_URL: "https://eth.example.com",
    AZTEC_NODE_URL: "http://aztec.example.com:8080",
    AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS: `0x${"1".repeat(40)}`,
    STAKING_REWARDS_SPLIT_FROM_BLOCK: "23083526",
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: "/etc/aztec-butler/sa.json",
    GOOGLE_SHEETS_SPREADSHEET_ID: "sheet-abc",
    ETHEREUM_ARCHIVE_NODE_URL: "https://archive.example.com",
    ...overrides,
  };
}

test("builds a valid sheets-exporter config", () => {
  const config = buildSheetsExporterConfig(validEnv(), "mainnet");
  assert.equal(config.network, "mainnet");
  assert.equal(config.stakingRewardsSplitFromBlock, 23083526n);
  assert.equal(config.spreadsheetId, "sheet-abc");
  assert.equal(config.archiveRpcUrl, "https://archive.example.com");
});

test("SHEETS_EXPORTER_ARCHIVE_RPC_URL overrides ETHEREUM_ARCHIVE_NODE_URL", () => {
  const config = buildSheetsExporterConfig(
    validEnv({ SHEETS_EXPORTER_ARCHIVE_RPC_URL: "https://drpc.example.com" }),
    "mainnet",
  );
  assert.equal(config.archiveRpcUrl, "https://drpc.example.com");
});

test("requires GOOGLE_SHEETS_SPREADSHEET_ID", () => {
  const env = validEnv();
  delete env.GOOGLE_SHEETS_SPREADSHEET_ID;
  assert.throws(() => buildSheetsExporterConfig(env, "mainnet"), /GOOGLE_SHEETS_SPREADSHEET_ID/);
});

test("requires STAKING_REWARDS_SPLIT_FROM_BLOCK", () => {
  const env = validEnv();
  delete env.STAKING_REWARDS_SPLIT_FROM_BLOCK;
  assert.throws(() => buildSheetsExporterConfig(env, "mainnet"), /STAKING_REWARDS_SPLIT_FROM_BLOCK/);
});

test("requires the provider admin address", () => {
  const env = validEnv();
  delete env.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS;
  assert.throws(
    () => buildSheetsExporterConfig(env, "mainnet"),
    /AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS/,
  );
});

test("fails closed on a private key in the env", () => {
  assert.throws(
    () => buildSheetsExporterConfig(validEnv({ MULTISIG_PROPOSER_PRIVATE_KEY: "0xabc" }), "mainnet"),
    /private key/i,
  );
});
