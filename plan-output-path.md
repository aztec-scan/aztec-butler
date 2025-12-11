# Plan: Output Path Support

## Goal

Allow users to specify custom output path for cache files instead of always using default data directory.

## Current Behavior

- All cache files saved to `~/.local/share/aztec-butler/{network}-mapped-coinbases.json`
- `outputPath` option exists but is never passed from CLI

## Proposed Changes

### 1. Add `--output` flag to CLI

```bash
npm run cli -- scrape-coinbases --output ./custom-cache.json
```

### 2. Update `cli.ts`

Parse `--output` flag and pass to command:

```typescript
const outputIndex = args.indexOf("--output");
const outputPath =
  outputIndex !== -1 && args[outputIndex + 1]
    ? args[outputIndex + 1]
    : undefined;

await command.scrapeCoinbases(ethClient, config, {
  // ...
  outputPath,
});
```

### 3. Update Help Text

Add `--output <path>` to examples.

### 4. Update `scripts/scrape-coinbases.sh`

Support passing `--output` flag through to npm command.

## Use Cases

- Testing with temporary cache files
- Exporting cache to specific location for deployment
- Multiple network caches in same directory
