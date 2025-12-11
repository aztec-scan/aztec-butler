import { Command } from "commander";

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
  .version("2.0.0");

program
  .command("serve")
  .description("Start the metrics server and scrapers")
  .action(async () => {
    checkNodeVersion();
    const { startServer } = await import("./server/index.js");
    await startServer();
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parseAsync(process.argv).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
