/**
 * Rate-limit-aware RPC retry machinery, shared across every chain caller.
 *
 * Retry policy — deliberately narrow:
 *   - Rate-limiting / throttling AND transient transport failures (connection
 *     resets, socket hang-ups, DNS hiccups) are retried. Both resolve on their
 *     own, so long scans (rewards backfill, coinbase discovery) ride them out
 *     instead of crashing on a single blip.
 *   - EVERY genuine failure fails loud: 5xx server errors (including a 504
 *     "Gateway Timeout"), "data not found", reverts, and malformed requests
 *     all propagate immediately. Retrying those would only mask a real problem.
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
 * True for rate-limiting / throttling errors specifically (HTTP 429, "too many
 * requests", explicit throttle messages). See {@link isRetryableError} for the
 * full retry predicate.
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

/**
 * True for transient transport-level failures — connection resets, socket
 * hang-ups, DNS hiccups, fetch failures. These never reached a server response,
 * resolve on their own, and are safe to retry.
 *
 * Deliberately matches no bare "timeout" token: a 5xx response such as "504
 * Gateway Timeout" is a server response and must fail loud, not be retried.
 */
export const isTransientNetworkError = (error: unknown): boolean => {
  const text = errorText(error);
  return (
    text.includes("econnreset") ||
    text.includes("econnrefused") ||
    text.includes("etimedout") ||
    text.includes("enetunreach") ||
    text.includes("eai_again") || // transient DNS failure
    text.includes("socket hang up") ||
    text.includes("fetch failed") ||
    text.includes("network error") ||
    text.includes("request timed out") ||
    text.includes("connection timed out") ||
    text.includes("took too long") // viem TimeoutError
  );
};

/**
 * The retry predicate: true ONLY for failures that resolve on their own —
 * rate-limiting and transient transport errors. Genuine failures (5xx, missing
 * data, reverts, bad params) return false and must be surfaced, not retried.
 */
export const isRetryableError = (error: unknown): boolean =>
  isRateLimitError(error) || isTransientNetworkError(error);

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
 * Run `fn`, retrying ONLY on retryable failures (see {@link isRetryableError}:
 * rate-limiting and transient transport errors). Any genuine error propagates
 * immediately. Throws the last error once the retry budget is exhausted.
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
      if (delay === undefined || !isRetryableError(error)) throw error;
      console.warn(
        `[rpc] ${options.label ?? "call"} failed (retryable, ` +
          `attempt ${attempt + 1}/${delays.length}), retrying in ${delay}ms`,
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
        if (delay === undefined || !isRetryableError(error)) {
          throw error;
        }
        console.warn(
          `[sheets-exporter] RPC call failed (retryable, attempt ${attempt + 1}), retrying in ${delay}ms: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(delay);
      }
    }
  };
}
