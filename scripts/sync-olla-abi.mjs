#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const corePath = path.resolve(
  process.cwd(),
  process.env.OLLA_CORE_PATH || "../olla-core",
);
const artifactPath = path.join(
  corePath,
  "contracts",
  "out",
  "StakingProviderRegistry.sol",
  "StakingProviderRegistry.json",
);
const outputPath = path.join(
  process.cwd(),
  "src",
  "types",
  "generated",
  "olla-staking-provider-registry-abi.ts",
);

if (!fs.existsSync(artifactPath)) {
  console.error(`Error: Olla artifact not found at ${artifactPath}`);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
if (!Array.isArray(artifact.abi)) {
  console.error(`Error: ABI missing in artifact ${artifactPath}`);
  process.exit(1);
}

const outputDir = path.dirname(outputPath);
fs.mkdirSync(outputDir, { recursive: true });

const fileBody = `export const OLLA_STAKING_PROVIDER_REGISTRY_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
fs.writeFileSync(outputPath, fileBody, "utf8");

console.log(`Synced Olla ABI to ${outputPath}`);
