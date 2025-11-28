import fs from "fs/promises";
import crypto from "node:crypto";
import {
  getAttesterCoinbaseInfo,
  getStakingRewardsHistory,
} from "../state/index.js";
import type { ButlerConfig } from "../../core/config/index.js";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const base64Url = (input: Buffer | string) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const createJwt = (
  serviceAccount: ServiceAccount,
  scope: string,
): string => {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const claims = {
    iss: serviceAccount.client_email,
    scope,
    aud: TOKEN_URL,
    exp,
    iat,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  return `${unsigned}.${base64Url(signature)}`;
};

const getAccessToken = async (serviceAccount: ServiceAccount) => {
  const assertion = createJwt(serviceAccount, SHEETS_SCOPE);
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to obtain Google access token (${res.status}): ${text}`,
    );
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
};

const formatDailyRows = () => {
  // One end-of-day row per date (latest snapshot per coinbase per day, summed)
  const snapshots = getStakingRewardsHistory().slice();
  snapshots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const header = [
    "date",
    "totalPendingRewards",
    "totalOurShare",
    "totalOtherShare",
  ];

  if (!snapshots.length) {
    return [header];
  }

  const latestPerDateCoinbase = new Map<string, Map<string, typeof snapshots[0]>>();

  for (const snap of snapshots) {
    const date = snap.timestamp.toISOString().slice(0, 10);
    if (!latestPerDateCoinbase.has(date)) {
      latestPerDateCoinbase.set(date, new Map());
    }
    const byCoinbase = latestPerDateCoinbase.get(date)!;
    const key = snap.coinbase.toLowerCase();
    const existing = byCoinbase.get(key);
    if (!existing || snap.timestamp > existing.timestamp) {
      byCoinbase.set(key, snap);
    }
  }
  const rows = Array.from(latestPerDateCoinbase.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([date, byCoinbase]) => {
      let totalPending = 0n;
      let totalOur = 0n;
      let totalOther = 0n;
      byCoinbase.forEach((snap) => {
        totalPending += snap.pendingRewards;
        totalOur += snap.ourShare;
        totalOther += snap.otherShare;
      });
      if (totalPending === 0n && totalOur === 0n && totalOther === 0n) {
        return [] as string[][];
      }
      return [
        [
          date,
          totalPending.toString(),
          totalOur.toString(),
          totalOther.toString(),
        ],
      ];
    });

  return [header, ...rows];
};

const formatDailyPerCoinbaseRows = () => {
  const snapshots = getStakingRewardsHistory().slice();
  snapshots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const header = [
    "date",
    "coinbase",
    "totalPendingRewards",
    "totalOurShare",
    "totalOtherShare",
  ];

  if (!snapshots.length) {
    return [header];
  }

  const latestPerDateCoinbase = new Map<string, Map<string, typeof snapshots[0]>>();

  for (const snap of snapshots) {
    const date = snap.timestamp.toISOString().slice(0, 10);
    if (!latestPerDateCoinbase.has(date)) {
      latestPerDateCoinbase.set(date, new Map());
    }
    const byCoinbase = latestPerDateCoinbase.get(date)!;
    const key = snap.coinbase.toLowerCase();
    const existing = byCoinbase.get(key);
    if (!existing || snap.timestamp > existing.timestamp) {
      byCoinbase.set(key, snap);
    }
  }
  const rows: string[][] = [];
  Array.from(latestPerDateCoinbase.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .forEach(([date, byCoinbase]) => {
      Array.from(byCoinbase.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .forEach(([, snap]) => {
          if (
            snap.pendingRewards === 0n &&
            snap.ourShare === 0n &&
            snap.otherShare === 0n
          ) {
            return;
          }
          rows.push([
            date,
            snap.coinbase,
            snap.pendingRewards.toString(),
            snap.ourShare.toString(),
            snap.otherShare.toString(),
          ]);
        });
    });

  return [header, ...rows];
};

const formatDailyEarnedRows = () => {
  const snapshots = getStakingRewardsHistory().slice();
  snapshots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const perCoinbase = new Map<
    string,
    Map<
      string,
      {
        firstPending: bigint;
        firstOurShare: bigint;
        firstOtherShare: bigint;
        lastPending: bigint;
        lastOurShare: bigint;
        lastOtherShare: bigint;
        sampleCount: number;
      }
    >
  >();

  for (const snap of snapshots) {
    const key = snap.coinbase.toLowerCase();
    const date = snap.timestamp.toISOString().slice(0, 10);

    if (!perCoinbase.has(key)) {
      perCoinbase.set(key, new Map());
    }
    const byDate = perCoinbase.get(key)!;

    const entry = byDate.get(date);
    if (!entry) {
      byDate.set(date, {
        firstPending: snap.pendingRewards,
        firstOurShare: snap.ourShare,
        firstOtherShare: snap.otherShare,
        lastPending: snap.pendingRewards,
        lastOurShare: snap.ourShare,
        lastOtherShare: snap.otherShare,
        sampleCount: 1,
      });
    } else {
      byDate.set(date, {
        ...entry,
        lastPending: snap.pendingRewards,
        lastOurShare: snap.ourShare,
        lastOtherShare: snap.otherShare,
        sampleCount: entry.sampleCount + 1,
      });
    }
  }

  // Aggregate intra-day flows per date across all coinbases
  const perDateTotals = new Map<
    string,
    {
      accruedPending: bigint;
      accruedOur: bigint;
      accruedOther: bigint;
      withdrawalPending: bigint;
      withdrawalOur: bigint;
      withdrawalOther: bigint;
      netPending: bigint;
      netOur: bigint;
      netOther: bigint;
    }
  >();

  for (const [, byDate] of perCoinbase.entries()) {
    for (const [date, entry] of byDate.entries()) {
      const deltaPending = entry.lastPending - entry.firstPending;
      const deltaOur = entry.lastOurShare - entry.firstOurShare;
      const deltaOther = entry.lastOtherShare - entry.firstOtherShare;

      const accruedPending = deltaPending > 0n ? deltaPending : 0n;
      const accruedOur = deltaOur > 0n ? deltaOur : 0n;
      const accruedOther = deltaOther > 0n ? deltaOther : 0n;

      const withdrawalPending = deltaPending < 0n ? -deltaPending : 0n;
      const withdrawalOur = deltaOur < 0n ? -deltaOur : 0n;
      const withdrawalOther = deltaOther < 0n ? -deltaOther : 0n;

      const netPending = accruedPending - withdrawalPending;
      const netOur = accruedOur - withdrawalOur;
      const netOther = accruedOther - withdrawalOther;

      const agg =
        perDateTotals.get(date) ?? {
          accruedPending: 0n,
          accruedOur: 0n,
          accruedOther: 0n,
          withdrawalPending: 0n,
          withdrawalOur: 0n,
          withdrawalOther: 0n,
          netPending: 0n,
          netOur: 0n,
          netOther: 0n,
          sampleCount: 0,
        };
      perDateTotals.set(date, {
        accruedPending: agg.accruedPending + accruedPending,
        accruedOur: agg.accruedOur + accruedOur,
        accruedOther: agg.accruedOther + accruedOther,
        withdrawalPending: agg.withdrawalPending + withdrawalPending,
        withdrawalOur: agg.withdrawalOur + withdrawalOur,
        withdrawalOther: agg.withdrawalOther + withdrawalOther,
        netPending: agg.netPending + netPending,
        netOur: agg.netOur + netOur,
        netOther: agg.netOther + netOther,
      });
    }
  }

  const header = [
    "date",
    "accruedPending",
    "accruedOurShare",
    "accruedOtherShare",
    "withdrawalPending",
    "withdrawalOurShare",
    "withdrawalOtherShare",
    "netPending",
    "netOurShare",
    "netOtherShare",
  ];

  const rows = Array.from(perDateTotals.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([date, totals]) => {
      const isZero =
        totals.accruedPending === 0n &&
        totals.accruedOur === 0n &&
        totals.accruedOther === 0n &&
        totals.withdrawalPending === 0n &&
        totals.withdrawalOur === 0n &&
        totals.withdrawalOther === 0n &&
        totals.netPending === 0n &&
        totals.netOur === 0n &&
        totals.netOther === 0n;

      if (isZero) {
        return [] as string[][];
      }

      return [
        [
          date,
          totals.accruedPending.toString(),
          totals.accruedOur.toString(),
          totals.accruedOther.toString(),
          totals.withdrawalPending.toString(),
          totals.withdrawalOur.toString(),
          totals.withdrawalOther.toString(),
          totals.netPending.toString(),
          totals.netOur.toString(),
          totals.netOther.toString(),
        ],
      ];
    });

  return [header, ...rows];
};

const formatCoinbaseRows = () => {
  const coinbaseInfo = getAttesterCoinbaseInfo();
  const header = ["coinbase", "attesterCount", "attesters"];

  const rows = Array.from(coinbaseInfo.entries())
    .reduce((acc, [attester, coinbase]) => {
      if (!coinbase) return acc;
      const lower = coinbase.toLowerCase();
      if (!acc.has(lower)) {
        acc.set(lower, new Set<string>());
      }
      acc.get(lower)!.add(attester.toLowerCase());
      return acc;
    }, new Map<string, Set<string>>())
    .entries();

  const formatted = Array.from(rows)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([coinbase, attesters]) => [
      coinbase,
      attesters.size.toString(),
      Array.from(attesters).join(","),
    ]);

  return [header, ...formatted];
};

export const exportStakingRewardsDailyToSheets = async (
  config: ButlerConfig,
): Promise<void> => {
  if (
    !config.GOOGLE_SHEETS_SPREADSHEET_ID ||
    !config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  ) {
    return;
  }

  const range = config.GOOGLE_SHEETS_RANGE || "Daily!A1";

  const keyRaw = await fs.readFile(
    config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    "utf-8",
  );
  const keyJson = JSON.parse(keyRaw) as ServiceAccount;

  if (!keyJson.client_email || !keyJson.private_key) {
    throw new Error(
      "Invalid service account key: missing client_email or private_key",
    );
  }

  const token = await getAccessToken(keyJson);
  const rows = formatDailyRows();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: rows,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to update Google Sheet (${res.status}): ${text}`,
    );
  }

  console.log(
    `[sheets] Updated sheet ${config.GOOGLE_SHEETS_SPREADSHEET_ID} at range ${range} with ${rows.length - 1} daily rows`,
  );
};

export const exportStakingRewardsDailyPerCoinbaseToSheets = async (
  config: ButlerConfig,
): Promise<void> => {
  if (
    !config.GOOGLE_SHEETS_SPREADSHEET_ID ||
    !config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  ) {
    return;
  }

  const range =
    config.GOOGLE_SHEETS_DAILY_PER_COINBASE_RANGE || "DailyPerCoinbase!A1";

  const keyRaw = await fs.readFile(
    config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    "utf-8",
  );
  const keyJson = JSON.parse(keyRaw) as ServiceAccount;

  if (!keyJson.client_email || !keyJson.private_key) {
    throw new Error(
      "Invalid service account key: missing client_email or private_key",
    );
  }

  const token = await getAccessToken(keyJson);
  const rows = formatDailyPerCoinbaseRows();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: rows,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to update Google Sheet DailyPerCoinbase (${res.status}): ${text}`,
    );
  }

  console.log(
    `[sheets] Updated per-coinbase daily sheet ${config.GOOGLE_SHEETS_SPREADSHEET_ID} at range ${range} with ${rows.length - 1} rows`,
  );
};

export const exportStakingRewardsDailyEarnedToSheets = async (
  config: ButlerConfig,
): Promise<void> => {
  if (
    !config.GOOGLE_SHEETS_SPREADSHEET_ID ||
    !config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  ) {
    return;
  }

  const range =
    config.GOOGLE_SHEETS_DAILY_EARNED_RANGE || "DailyEarned!A1";

  const keyRaw = await fs.readFile(
    config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    "utf-8",
  );
  const keyJson = JSON.parse(keyRaw) as ServiceAccount;

  if (!keyJson.client_email || !keyJson.private_key) {
    throw new Error(
      "Invalid service account key: missing client_email or private_key",
    );
  }

  const token = await getAccessToken(keyJson);
  const rows = formatDailyEarnedRows();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: rows,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to update Google Sheet DailyEarned (${res.status}): ${text}`,
    );
  }

  console.log(
    `[sheets] Updated daily earned sheet ${config.GOOGLE_SHEETS_SPREADSHEET_ID} at range ${range} with ${rows.length - 1} rows`,
  );
};

export const exportCoinbasesToSheets = async (
  config: ButlerConfig,
): Promise<void> => {
  if (
    !config.GOOGLE_SHEETS_SPREADSHEET_ID ||
    !config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  ) {
    return;
  }

  const range = config.GOOGLE_SHEETS_COINBASES_RANGE || "Coinbases!A1";

  const keyRaw = await fs.readFile(
    config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    "utf-8",
  );
  const keyJson = JSON.parse(keyRaw) as ServiceAccount;

  if (!keyJson.client_email || !keyJson.private_key) {
    throw new Error(
      "Invalid service account key: missing client_email or private_key",
    );
  }

  const token = await getAccessToken(keyJson);
  const rows = formatCoinbaseRows();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: rows,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to update Google Sheet coinbases (${res.status}): ${text}`,
    );
  }

  console.log(
    `[sheets] Updated coinbases sheet ${config.GOOGLE_SHEETS_SPREADSHEET_ID} at range ${range} with ${rows.length - 1} rows`,
  );
};
