/**
 * Shared environment-variable parsing and validation helpers.
 *
 * Used by the lightweight per-mode config builders (`agent`, `sheets-exporter`)
 * that read a flat env map rather than the legacy `ButlerConfig` schema in
 * {@link ./index.ts}. Keeping these primitives in one place stops the agent and
 * sheets-exporter config layers from drifting apart.
 */

import { z } from "zod";

/** Parse a boolean-ish env var. Unset/empty → `defaultValue`. */
export const parseBool = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value === "") return defaultValue;
  return value === "true" || value === "1";
};

/** Optional 0x-prefixed, 42-char address. Unset/empty → `undefined`. */
export const optionalAddress = (
  label: string,
  value: string | undefined,
): string | undefined => {
  const v = value?.trim();
  if (!v) return undefined;
  if (!z.string().startsWith("0x").length(42).safeParse(v).success) {
    throw new Error(
      `Invalid configuration for ${label}: expected a 0x-prefixed 42-char address, got "${value}"`,
    );
  }
  return v;
};

/** Required URL. */
export const requiredUrl = (label: string, value: string | undefined): string => {
  const result = z.string().url().safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid configuration for ${label}: a valid URL is required (got "${value ?? "<unset>"}")`,
    );
  }
  return result.data;
};

/** Required non-empty string (trimmed). */
export const requiredStr = (label: string, value: string | undefined): string => {
  const v = value?.trim();
  if (!v) throw new Error(`${label} is required.`);
  return v;
};

/** Positive integer. Unset/empty → `defaultValue` (returned without validation). */
export const positiveInt = (
  label: string,
  value: string | undefined,
  defaultValue: number,
): number => {
  if (!value?.trim()) return defaultValue;
  const result = z.coerce.number().int().positive().safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid configuration for ${label}: a positive integer is required (got "${value}")`,
    );
  }
  return result.data;
};

/** Optional non-negative bigint. Unset/empty → `undefined`. */
export const optionalNonNegativeBigint = (
  label: string,
  value: string | undefined,
): bigint | undefined => {
  const raw = value?.trim();
  if (!raw) return undefined;
  const parsed = z.coerce.bigint().nonnegative().safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration for ${label}: a non-negative integer is required (got "${raw}")`,
    );
  }
  return parsed.data;
};

/** Required non-negative bigint. */
export const requiredNonNegativeBigint = (
  label: string,
  value: string | undefined,
): bigint => {
  const result = optionalNonNegativeBigint(label, value);
  if (result === undefined) throw new Error(`${label} is required.`);
  return result;
};

/**
 * Fail closed on unsafe/mutating configuration. Read-only modes (agent,
 * sheets-exporter) must never be given write-path credentials or be allowed to
 * broadcast/propose.
 */
export const assertReadOnlyEnv = (env: Record<string, string | undefined>): void => {
  const violations: string[] = [];

  if (parseBool(env.SAFE_PROPOSALS_ENABLED, false)) {
    violations.push("SAFE_PROPOSALS_ENABLED is true — a read-only mode never proposes Safe transactions.");
  }
  if (env.MULTISIG_PROPOSER_PRIVATE_KEY) {
    violations.push("MULTISIG_PROPOSER_PRIVATE_KEY is set — a read-only mode must not be given private keys.");
  }
  if (env.SAFE_API_KEY) {
    violations.push("SAFE_API_KEY is set — a read-only mode does not use the Safe API.");
  }

  if (violations.length > 0) {
    throw new Error(
      "Refusing to start: this mode is read-only and must not receive mutating or key-bearing config.\n" +
        violations.map((v) => `  - ${v}`).join("\n") +
        "\n\nUse a dedicated, minimal env file (see docs/agent-deployment.md).",
    );
  }
};
