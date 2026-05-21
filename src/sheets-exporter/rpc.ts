/**
 * Rate-limited, retrying RPC gate for the rewards backfill / catch-up.
 *
 * A free archive endpoint will throttle hard under the ~100k historical calls a
 * cold-start backfill makes, so this:
 *   - self-rate-limits: enforces a minimum interval between calls (maxRps);
 *   - retries throttle / transient errors with capped exponential backoff,
 *     generously enough to WAIT throttling OUT rather than fail — a throttled
 *     call becomes slow, not a hard error, so the backfill still completes.
 *
 * Only a genuinely unreachable endpoint exhausts the retry budget and throws.
 */

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

/** Exponential-backoff delays, each capped at `maxBackoffMs` (pure — unit tested). */
export const backoffSchedule = (
  maxRetries: number,
  baseMs: number,
  maxBackoffMs = Infinity,
): number[] =>
  Array.from({ length: maxRetries }, (_, i) => Math.min(baseMs * 2 ** i, maxBackoffMs));

/** True when an error looks like rate-limiting or a transient RPC failure (pure). */
export const isRetryableError = (error: unknown): boolean => {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("503") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A gate that runs an async fn — used to decouple the ledger from this module. */
export type RpcGate = <T>(fn: () => Promise<T>) => Promise<T>;

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

  /** Run `fn` under the rate limit, retrying retryable failures with backoff. */
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
          `[sheets-exporter] RPC call failed (attempt ${attempt + 1}), retrying in ${delay}ms: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(delay);
      }
    }
  };
}

/** A pass-through gate (no pacing, no retry) — for the recurring exporter. */
export const passThroughGate: RpcGate = (fn) => fn();
