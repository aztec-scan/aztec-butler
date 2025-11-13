import fs from "fs/promises";
import { createRequire } from "module";
import path, { join } from "path";
import { AttesterRegistration, CuratedKeystoreData, DirData, KeystoreData } from "../types.js";
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
}

const parseEnvFile = (content: string): Partial<DirData> => {
  return content.split("\n").reduce((acc, line) => {
    if (line.trim() && !line.startsWith("ETHEREUM_HOSTS")) {
      if (line.includes("https")) {
        acc.l1RpcUrl = line.split("=")[1]?.replaceAll('"', "").split(",")[0];
      }
      // NOTE: assuming docker-urls and using default instead
    }
    if (line.trim() && line.startsWith("AZTEC_PORT")) {
      acc.l2RpcUrl = "localhost:" + line.split("=")[1]?.replaceAll('"', "");
    }
    return acc;
  }, {} as Partial<DirData>);
}

const getJsonFileData = async (fullPath: string): Promise<DirData["keystores"] | DirData["attesterRegistrations"]> => {
  const files = await fs.readdir(fullPath);
  return await Promise.all(files.map(async (jsonFile) => {
    const fullFullPath = join(fullPath, jsonFile);
    return {
      name: fullFullPath,
      data: JSON.parse(await fs.readFile(fullFullPath, "utf8"))
    };
  }));
}

export const getDockerDirData = async (dockerDirPath: string) => {
  const files = await fs.readdir(dockerDirPath);
  let dirData: Partial<DirData> = {};
  for (const file of files) {
    const fullPath = join(dockerDirPath, file);
    const stats = await fs.stat(fullPath);
    if (file === ".env" && stats.isFile()) {
      dirData = {
        ...dirData,
        ...parseEnvFile(await fs.readFile(fullPath, "utf8")),
      };
    } else if (stats.isDirectory() && file === "keys") {
      dirData.keystores = await getJsonFileData(fullPath) as DirData["keystores"];
    } else if (stats.isDirectory() && file === "attester-registrations") {
      dirData.attesterRegistrations = await getJsonFileData(fullPath) as DirData["attesterRegistrations"];
    } else {
      console.log(`SKIPPING ${file} - ${stats.isDirectory() ? "Directory" : "File"}`);
    }
  }
  return dirData as DirData;
}
