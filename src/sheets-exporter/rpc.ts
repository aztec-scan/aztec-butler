/**
 * Rate-limited, retrying RPC gate for the rewards backfill.
 *
 * A free archive endpoint will throttle under the thousands of historical calls
 * a full backfill makes, so this:
 *   - self-rate-limits: enforces a minimum interval between calls (maxRps);
 *   - retries with exponential backoff on throttle / transient errors.
 *
 * The recurring exporter makes only tens of calls per run and can use a
 * pass-through gate.
 */

export interface RateLimiterOptions {
  /** Requests per second cap (self-rate-limit). 0 disables pacing. */
  maxRps: number;
  maxRetries?: number;
  baseBackoffMs?: number;
}

/** Exponential-backoff delay schedule (pure — unit tested). */
export const backoffSchedule = (maxRetries: number, baseMs: number): number[] =>
  Array.from({ length: maxRetries }, (_, i) => baseMs * 2 ** i);

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
    this.delays = backoffSchedule(options.maxRetries ?? 6, options.baseBackoffMs ?? 1000);
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
