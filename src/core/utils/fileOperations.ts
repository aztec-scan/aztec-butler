import fs from "fs/promises";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

export const getPackageVersion = async (pkgName: string): Promise<string> => {
  try {
    const entryPath = require.resolve(pkgName);

    let dir = path.dirname(entryPath);
    while (dir !== path.parse(dir).root) {
      const candidate = path.join(dir, "package.json");
      if (await fs.stat(candidate)) {
        const pkg = JSON.parse(await fs.readFile(candidate, "utf8"));
        return pkg.version;
      }
      dir = path.dirname(dir);
    }

    throw new Error(`No package.json found for ${pkgName}`);
  } catch (err) {
    console.warn(`⚠️ Could not resolve version for package "${pkgName}":`, err);
    return "unknown";
  }
};
