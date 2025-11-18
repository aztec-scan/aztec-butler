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

const mode = process.argv[2] || "cli";

const main = async () => {
  checkNodeVersion();
  switch (mode) {
    case "cli":
      const { runCli } = await import("./cli/index.js");
      await runCli();
      break;

    case "serve":
      const { startServer } = await import("./server/index.js");
      await startServer();
      break;

    default:
      console.error(`Unknown mode: ${mode}`);
      console.error("Available modes: cli, prometheus");
      process.exit(1);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
