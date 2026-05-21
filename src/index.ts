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

program
  .command("agent")
  .description(
    "Run the local, read-only sequencer telemetry agent (OTLP export, no HTTP server)",
  )
  .requiredOption(
    "--network <network>",
    "Network to run the agent for (e.g., mainnet, testnet)",
  )
  .option(
    "--once",
    "Run a single scrape + export cycle then exit (for local testing)",
  )
  .option(
    "--dry-run",
    "Print metrics to stdout instead of pushing OTLP (for local testing)",
  )
  .option(
    "--config <path>",
    "Override the per-network base env file path",
  )
  .action(
    async (options: {
      network: string;
      once?: boolean;
      dryRun?: boolean;
      config?: string;
    }) => {
      checkNodeVersion();
      const { startAgent } = await import("./agent/index.js");
      await startAgent({
        network: options.network,
        ...(options.once ? { once: true } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.config ? { configFilePath: options.config } : {}),
      });
    },
  );

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parseAsync(process.argv).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
