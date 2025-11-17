const mode = process.argv[2] || "cli";

const main = async () => {
  switch (mode) {
    case "cli":
      const { runCli } = await import("./cli/index.js");
      await runCli();
      break;

    case "serve":
      const { startServer } = await import(
        "./server/index.js"
      );
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
