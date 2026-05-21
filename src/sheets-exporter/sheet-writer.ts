/**
 * Google Sheets writer for the rewards ledger.
 *
 * Self-contained: service-account auth + write helpers —
 *  - `readSheet`: fetch a tab's current rows;
 *  - `appendRows`: add rows after the existing data (the catch-up's hot path —
 *    cost is independent of how large the tab has already grown);
 *  - `overwriteSheet`: replace a tab's contents (write first, then clear any
 *    stale trailing rows — safe to interrupt, never loses covered rows);
 *  - `spliceSheet`: replace only a date window, preserving every other row
 *    (crash-repair of one day, and ranged `--backfill` corrections).
 */

import fs from "node:fs/promises";
import { GoogleAuth, type JWTInput } from "google-auth-library";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const normalizePrivateKey = (key: string): string =>
  key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;

/** Read a service-account key file and obtain a Sheets access token. */
export const getSheetsAccessToken = async (keyFile: string): Promise<string> => {
  const raw = await fs.readFile(keyFile, "utf-8");
  let parsed: JWTInput;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse Google service account key JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Google service account key missing client_email/private_key.");
  }
  const auth = new GoogleAuth({
    credentials: { ...parsed, private_key: normalizePrivateKey(parsed.private_key) },
    scopes: [SHEETS_SCOPE],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token?.token) {
    throw new Error("Failed to obtain a Google access token.");
  }
  return token.token;
};

const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const sheetNameOf = (range: string): string => {
  const bang = range.indexOf("!");
  return bang === -1 ? range : range.slice(0, bang);
};

/**
 * Replace a tab's contents with `rows` (header + data). Writes from the origin
 * first, then clears any stale rows left below the new data. Constructive write
 * before destructive clear — an interrupted call never loses covered rows.
 */
export const overwriteSheet = async (
  spreadsheetId: string,
  range: string,
  rows: string[][],
  token: string,
): Promise<void> => {
  const sheetName = sheetNameOf(range);

  const putRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ range, majorDimension: "ROWS", values: rows }),
    },
  );
  if (!putRes.ok) {
    throw new Error(`Failed to write "${range}" (${putRes.status}): ${await putRes.text()}`);
  }

  // Clear rows left over below the new data (when the tab shrank). A range past
  // the grid returns 400 — tolerated, same as an already-empty tail.
  const tail = `${sheetName}!A${rows.length + 1}:ZZ`;
  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tail)}:clear`,
    { method: "POST", headers: authHeaders(token), body: "{}" },
  );
  if (!clearRes.ok && clearRes.status !== 400 && clearRes.status !== 404) {
    throw new Error(
      `Failed to clear stale rows in "${sheetName}" (${clearRes.status}): ${await clearRes.text()}`,
    );
  }
};

/** Fetch every row of a tab (header included, if present). Returns [] when empty. */
export const readSheet = async (
  spreadsheetId: string,
  range: string,
  token: string,
): Promise<string[][]> => {
  const sheetName = sheetNameOf(range);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`,
    { method: "GET", headers: authHeaders(token) },
  );
  if (res.status === 400 || res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`Failed to read "${sheetName}" (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { values?: string[][] };
  return body.values ?? [];
};

/**
 * Merge `replacement` into `existing` (both header-less data rows): drop every
 * existing row whose date (column 0) falls in [fromDate, toDate], keep the rest,
 * and return the union sorted ascending by date. Pure — unit-tested.
 *
 * ISO `YYYY-MM-DD` dates sort lexically, so a string compare is chronological.
 */
export const spliceRows = (
  existing: string[][],
  replacement: string[][],
  fromDate: string,
  toDate: string,
): string[][] => {
  const kept = existing.filter((row) => {
    const date = row[0] ?? "";
    return date < fromDate || date > toDate;
  });
  return [...kept, ...replacement].sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
};

/**
 * Replace only the [fromDate, toDate] window of a tab, preserving every row
 * outside it. Reads the current tab, splices `replacement` in, and rewrites it.
 * Returns how many rows were preserved vs. replaced.
 */
export const spliceSheet = async (
  spreadsheetId: string,
  range: string,
  header: string[],
  replacement: string[][],
  fromDate: string,
  toDate: string,
  token: string,
): Promise<{ preserved: number; replaced: number }> => {
  const existing = await readSheet(spreadsheetId, range, token);
  const hasHeader = existing.length > 0 && existing[0]?.[0] === header[0];
  const dataRows = hasHeader ? existing.slice(1) : existing;
  const merged = spliceRows(dataRows, replacement, fromDate, toDate);
  await overwriteSheet(spreadsheetId, range, [header, ...merged], token);
  return { preserved: merged.length - replacement.length, replaced: replacement.length };
};

/**
 * Append `rows` after the existing data in the range's tab. O(rows added) — the
 * cost does not grow with the tab, which is what lets the catch-up scale.
 */
export const appendRows = async (
  spreadsheetId: string,
  range: string,
  rows: string[][],
  token: string,
): Promise<void> => {
  if (rows.length === 0) return;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ range, majorDimension: "ROWS", values: rows }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to append to "${range}" (${res.status}): ${await res.text()}`);
  }
};
