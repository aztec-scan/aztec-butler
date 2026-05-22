import assert from "node:assert/strict";
import test from "node:test";
import {
  RateLimiter,
  backoffSchedule,
  isRateLimitError,
  isRetryableError,
  isTransientNetworkError,
  withRetry,
} from "../../src/core/components/rpc-retry.js";

// ── backoffSchedule ─────────────────────────────────────────────────────────

test("backoffSchedule — exponential delays", () => {
  assert.deepEqual(backoffSchedule(4, 100), [100, 200, 400, 800]);
  assert.deepEqual(backoffSchedule(0, 100), []);
});

test("backoffSchedule — delays are capped at maxBackoffMs", () => {
  assert.deepEqual(backoffSchedule(6, 1000, 4000), [1000, 2000, 4000, 4000, 4000, 4000]);
});

// ── isRateLimitError ────────────────────────────────────────────────────────

test("isRateLimitError — true ONLY for rate-limiting / throttling", () => {
  assert.equal(isRateLimitError(new Error("HTTP 429 Too Many Requests")), true);
  assert.equal(isRateLimitError(new Error("rate limit exceeded")), true);
  assert.equal(isRateLimitError(new Error("Request was throttled")), true);
  assert.equal(isRateLimitError(new Error("Status: 429")), true);
});

test("isRateLimitError — false for anything that is not a rate limit", () => {
  assert.equal(isRateLimitError(new Error("500 Internal Server Error")), false);
  assert.equal(isRateLimitError(new Error("503 Service Unavailable")), false);
  assert.equal(isRateLimitError(new Error("data not found")), false);
  assert.equal(isRateLimitError(new Error("execution reverted")), false);
  assert.equal(isRateLimitError(new Error("fetch failed")), false);
});

// ── isTransientNetworkError ─────────────────────────────────────────────────

test("isTransientNetworkError — true for transport-level failures", () => {
  assert.equal(isTransientNetworkError(new Error("read ECONNRESET")), true);
  assert.equal(isTransientNetworkError(new Error("socket hang up")), true);
  assert.equal(isTransientNetworkError(new Error("fetch failed")), true);
  assert.equal(isTransientNetworkError(new Error("connect ETIMEDOUT")), true);
  assert.equal(
    isTransientNetworkError(new Error("The request took too long to respond.")),
    true,
  );
});

test("isTransientNetworkError — false for server responses and logic errors", () => {
  assert.equal(isTransientNetworkError(new Error("500 Internal Server Error")), false);
  assert.equal(isTransientNetworkError(new Error("503 Service Unavailable")), false);
  // a 504 is a server response — must fail loud, never matched as transient
  assert.equal(isTransientNetworkError(new Error("504 Gateway Timeout")), false);
  assert.equal(isTransientNetworkError(new Error("data not found")), false);
  assert.equal(isTransientNetworkError(new Error("execution reverted")), false);
});

// ── isRetryableError ────────────────────────────────────────────────────────

test("isRetryableError — true for rate limits and transient network errors", () => {
  assert.equal(isRetryableError(new Error("HTTP 429 Too Many Requests")), true);
  assert.equal(isRetryableError(new Error("read ECONNRESET")), true);
  assert.equal(isRetryableError(new Error("fetch failed")), true);
});

test("isRetryableError — false for genuine failures, so they fail loud", () => {
  assert.equal(isRetryableError(new Error("500 Internal Server Error")), false);
  assert.equal(isRetryableError(new Error("503 Service Unavailable")), false);
  assert.equal(isRetryableError(new Error("504 Gateway Timeout")), false);
  assert.equal(isRetryableError(new Error("data not found")), false);
  assert.equal(isRetryableError(new Error("execution reverted")), false);
});

test("isRateLimitError — inspects the error cause chain", () => {
  const wrapped = new Error("RPC request failed", {
    cause: new Error("HTTP 429: too many requests"),
  });
  assert.equal(isRateLimitError(wrapped), true);
});

// ── withRetry ───────────────────────────────────────────────────────────────

const fastRetry = { maxRetries: 4, baseBackoffMs: 1 };

test("withRetry — retries rate-limiting until it succeeds", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error("429 throttled");
    return "ok";
  }, fastRetry);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry — retries a transient network error", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error("read ECONNRESET");
    return "ok";
  }, fastRetry);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry — fails loud immediately on a genuine error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new Error("500 Internal Server Error");
    }, fastRetry),
    /500/,
  );
  assert.equal(calls, 1);
});

test("withRetry — a 504 Gateway Timeout fails loud (not retried as a timeout)", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new Error("504 Gateway Timeout");
    }, fastRetry),
    /504/,
  );
  assert.equal(calls, 1);
});

test("withRetry — throws after exhausting the retry budget", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new Error("rate limit exceeded");
    }, fastRetry),
    /rate limit/,
  );
  assert.equal(calls, 5); // 1 initial attempt + 4 retries
});

// ── RateLimiter.run ─────────────────────────────────────────────────────────

const fastLimiter = () =>
  new RateLimiter({ maxRps: 1000, maxRetries: 4, baseBackoffMs: 1 });

test("RateLimiter — succeeds after retrying rate-limiting failures", async () => {
  let calls = 0;
  const result = await fastLimiter().run(async () => {
    calls++;
    if (calls < 3) throw new Error("429 throttled");
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(calls, 3);
});

test("RateLimiter — throws after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    fastLimiter().run(async () => {
      calls++;
      throw new Error("429 throttled");
    }),
    /429/,
  );
  // 1 initial attempt + 4 retries
  assert.equal(calls, 5);
});

test("RateLimiter — a non-rate-limit error fails immediately", async () => {
  let calls = 0;
  await assert.rejects(
    fastLimiter().run(async () => {
      calls++;
      throw new Error("execution reverted");
    }),
    /reverted/,
  );
  assert.equal(calls, 1);
});
