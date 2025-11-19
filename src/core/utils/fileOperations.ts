import fs from "fs/promises";
import { createRequire } from "module";
import path, { join } from "path";
import { z } from "zod";
import { DirDataSchema, type DirData } from "../../types/index.js";

const require = createRequire(import.meta.url);
export const ATTESTER_REGISTRATIONS_DIR_NAME = "attester-registrations";

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

const parseEnvFile = (content: string): Partial<DirData> => {
  return content.split("\n").reduce((acc, line) => {
    if (line.trim() && !line.startsWith("ETHEREUM_HOSTS")) {
      if (line.includes("https")) {
        acc.l1RpcUrl = line.split("=")[1]?.replaceAll('"', "").split(",")[0];
      }
      // NOTE: assuming docker-urls and using default instead
    }
    if (line.trim() && line.startsWith("AZTEC_PORT")) {
      acc.l2RpcUrl =
        "http://localhost:" + line.split("=")[1]?.replaceAll('"', "");
    }
    return acc;
  }, {} as Partial<DirData>);
};

const notNumbers = /[^0-9]/g;
const getJsonFileData = async (
  fullPath: string,
): Promise<DirData["keystores"] | DirData["attesterRegistrations"]> => {
  const files = await fs.readdir(fullPath);
  return await Promise.all(
    files.map(async (jsonFile) => {
      const fullFullPath = join(fullPath, jsonFile);
      return {
        path: fullFullPath,
        id: jsonFile.replace(notNumbers, ""),
        data: JSON.parse(await fs.readFile(fullFullPath, "utf8")),
      };
    }),
  );
};

export const getDockerDirData = async (dockerDirPath: string) => {
  const files = await fs.readdir(dockerDirPath);
  let dirData: Partial<DirData> = {};
  if (
    !files.includes(ATTESTER_REGISTRATIONS_DIR_NAME) &&
    files.includes("keys")
  ) {
    console.log("Creating attester-registrations directory...");
    await fs.mkdir(join(dockerDirPath, ATTESTER_REGISTRATIONS_DIR_NAME));
    files.push(ATTESTER_REGISTRATIONS_DIR_NAME);
  }
  for (const reqFile of [".env", "keys", ATTESTER_REGISTRATIONS_DIR_NAME]) {
    if (!files.includes(reqFile)) {
      throw new Error(`Missing required file or directory: ${reqFile}`);
    }
  }
  for (const file of files) {
    const fullPath = join(dockerDirPath, file);
    const stats = await fs.stat(fullPath);
    if (file === ".env" && stats.isFile()) {
      dirData = {
        ...dirData,
        ...parseEnvFile(await fs.readFile(fullPath, "utf8")),
      };
    } else if (stats.isDirectory() && file === "keys") {
      dirData.keystores = (await getJsonFileData(
        fullPath,
      )) as DirData["keystores"];
    } else if (
      stats.isDirectory() &&
      file === ATTESTER_REGISTRATIONS_DIR_NAME
    ) {
      dirData.attesterRegistrations = (await getJsonFileData(
        fullPath,
      )) as DirData["attesterRegistrations"];
    } else {
      console.log(
        `SKIPPING ${file} - ${stats.isDirectory() ? "Directory" : "File"}`,
      );
    }
  }

  // Validate before returning
  try {
    return DirDataSchema.parse(dirData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Invalid data directory structure:");
      for (const err of error.errors) {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      }
    }
    throw new Error(`Invalid Docker directory data: ${error}`);
  }
};
