import fs from "fs/promises";
import { GoogleAuth, type JWTInput } from "google-auth-library";
import type { ButlerConfig } from "../config/index.js";

let cachedCredentials: JWTInput | null = null;
let cachedSource: string | null = null;

const normalizePrivateKey = (key: string): string =>
  key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;

const parseServiceAccountKey = (raw: string): JWTInput => {
  let parsed: JWTInput;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse Google service account key JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "Google service account key is missing required fields client_email/private_key",
    );
  }

  return {
    ...parsed,
    private_key: normalizePrivateKey(parsed.private_key),
  };
};

export const getServiceAccountCredentials = async (
  config: ButlerConfig,
): Promise<JWTInput> => {
  const keyFile = config.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const cacheKey = `file:${keyFile ?? "none"}`;

  if (cachedCredentials && cachedSource === cacheKey) {
    return cachedCredentials;
  }

  if (!keyFile) {
    throw new Error(
      "Google service account key not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE to the JSON key path.",
    );
  }

  const rawKey = await fs.readFile(keyFile, "utf8");

  cachedCredentials = parseServiceAccountKey(rawKey);
  cachedSource = cacheKey;
  return cachedCredentials;
};

export const getServiceAccountAuth = async (
  config: ButlerConfig,
  scopes: string[],
) => {
  const credentials = await getServiceAccountCredentials(config);
  return new GoogleAuth({
    credentials,
    scopes,
  });
};
