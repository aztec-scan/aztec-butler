/**
 * Rate-limit-aware RPC retry machinery, shared across every chain caller.
 *
 * Retry policy — deliberately narrow:
 *   - ONLY rate-limiting / throttling errors are retried. A throttled call
 *     becomes slow, not fatal, so long scans (rewards backfill, coinbase
 *     discovery) ride out a free RPC tier's limits instead of crashing.
 *   - EVERY other failure fails loud: 5xx server errors, "data not found",
 *     reverts, malformed requests, and network failures all propagate
 *     immediately. Retrying those would only mask a real problem.
 *
 * Two entry points share the same policy:
 *   - {@link withRetry} — retry a single call (used inside EthereumClient).
 *   - {@link RateLimiter} — retry + self-pacing for bulk historical scans.
 */

/** Exponential-backoff delays, each capped at `maxBackoffMs` (pure — unit tested). */
export const backoffSchedule = (
  maxRetries: number,
  baseMs: number,
  maxBackoffMs = Infinity,
): number[] =>
  Array.from({ length: maxRetries }, (_, i) => Math.min(baseMs * 2 ** i, maxBackoffMs));

/** Flatten an error and its `cause` chain into one lowercased string. */
const errorText = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return parts.join(" | ").toLowerCase();
};

/**
 * True ONLY for rate-limiting / throttling errors — the single failure class
 * that is safe to retry.
 *
 * Everything else returns false on purpose: HTTP 5xx, "data not found",
 * execution reverts, invalid params, and network errors (ECONNRESET, fetch
 * failed, timeouts) are all genuine failures the caller must surface, not
 * silently retry.
 */
export const isRateLimitError = (error: unknown): boolean => {
  const text = errorText(error);
  return (
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("rate-limit") ||
    text.includes("ratelimit") ||
    text.includes("throttl") // throttle / throttled / throttling
  );
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Retries before giving up (default 10). */
  maxRetries?: number;
  /** Base backoff in ms; doubles each retry (default 1000). */
  baseBackoffMs?: number;
  /** Cap on a single backoff delay in ms (default 30_000). */
  maxBackoffMs?: number;
  /** Short label for the retry log line. */
  label?: string;
}

/**
 * Run `fn`, retrying ONLY on rate-limiting (see {@link isRateLimitError}).
 * Any other error propagates immediately. Throws the last error once the
 * retry budget is exhausted.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const delays = backoffSchedule(
    options.maxRetries ?? 10,
    options.baseBackoffMs ?? 1000,
    options.maxBackoffMs ?? 30_000,
  );
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !isRateLimitError(error)) throw error;
      console.warn(
        `[rpc] ${options.label ?? "call"} rate-limited ` +
          `(attempt ${attempt + 1}/${delays.length}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
};

export interface RateLimiterOptions {
  /** Requests per second cap (self-rate-limit). 0 disables pacing. */
  maxRps: number;
  /** Retries for one call before giving up (default 40 — ~1h of waiting out throttling). */
  maxRetries?: number;
  /** Base backoff in ms; doubles each retry (default 1000). */
  baseBackoffMs?: number;
  /** Cap on a single backoff delay in ms (default 120_000). */
  maxBackoffMs?: number;
}

/** A gate that runs an async fn — decouples bulk callers from this module. */
export type RpcGate = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Self-pacing, rate-limit-retrying gate for bulk historical scans.
 *
 * A free archive endpoint throttles hard under the ~100k historical calls a
 * cold-start backfill makes, so this enforces a minimum interval between calls
 * and waits out throttling generously. Only rate-limiting is retried; a
 * genuine error (or a truly unreachable endpoint) propagates.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private readonly delays: number[];
  private nextAllowedAt = 0;

  constructor(options: RateLimiterOptions) {
    this.minIntervalMs = options.maxRps > 0 ? 1000 / options.maxRps : 0;
    this.delays = backoffSchedule(
      options.maxRetries ?? 40,
      options.baseBackoffMs ?? 1000,
      options.maxBackoffMs ?? 120_000,
    );
  }

  /** Run `fn` under the rate limit, retrying rate-limiting failures with backoff. */
  run: RpcGate = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const wait = this.nextAllowedAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAllowedAt = Date.now() + this.minIntervalMs;

      try {
        return await fn();
      } catch (error) {
        const delay = this.delays[attempt];
        if (delay === undefined || !isRateLimitError(error)) {
          throw error;
        }
        console.warn(
          `[sheets-exporter] RPC call rate-limited (attempt ${attempt + 1}), retrying in ${delay}ms: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(delay);
      }
    }
  };
}
