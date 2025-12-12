import { Command } from "commander";
import { PACKAGE_VERSION } from "./core/config/index.js";

/**
 * Check Node.js version meets minimum requirements
 */
const checkNodeVersion = () => {
  const minVersion = 22;
  const currentVersion = process.versions.node;
  const versionParts = currentVersion.split(".");
  const majorVersion = parseInt(versionParts[0] ?? "0");

  if (majorVersion < minVersion) {
    console.error(
      `❌ ERROR: Node.js version ${minVersion}.x or higher is required`,
    );
    console.error(`   Current version: ${currentVersion}`);
    console.error(`   Please upgrade Node.js to continue.`);
    process.exit(1);
  }
};

const program = new Command();

program
  .name("aztec-butler")
  .description("Aztec staking provider management tool")
  .version(PACKAGE_VERSION);

program
  .command("serve")
  .description("Start the metrics server and scrapers")
  .option(
    "--network <network>",
    "Run server for a specific network only (e.g., mainnet, testnet)",
  )
  .action(async (options: { network?: string }) => {
    checkNodeVersion();
    const { startServer } = await import("./server/index.js");
    await startServer(options.network);
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parseAsync(process.argv).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
