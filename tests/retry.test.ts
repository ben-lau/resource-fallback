import { describe, expect, it } from 'vitest';

import { backoff, mergeRetry, RETRY_DEFAULTS } from '../packages/core/src/runtime/retry';

describe('retry', () => {
  it('mergeRetry uses the deepest non-undefined value', () => {
    expect(mergeRetry(undefined, undefined)).toEqual(RETRY_DEFAULTS);
    expect(mergeRetry({ max: 5 }, undefined).max).toBe(5);
    expect(mergeRetry({ max: 5 }, { max: 1 }).max).toBe(1);
    expect(mergeRetry({ baseDelay: 100 }, { max: 1 }).baseDelay).toBe(100);
  });

  it('backoff is exponential when jitter disabled', () => {
    const opts = { max: 5, baseDelay: 100, maxDelay: 1000, jitter: false };
    expect(backoff(1, opts)).toBe(100);
    expect(backoff(2, opts)).toBe(200);
    expect(backoff(3, opts)).toBe(400);
  });

  it('backoff respects maxDelay cap', () => {
    const opts = { max: 5, baseDelay: 100, maxDelay: 250, jitter: false };
    expect(backoff(10, opts)).toBe(250);
  });

  it('backoff with jitter stays within ±25% of base', () => {
    const opts = { max: 5, baseDelay: 100, maxDelay: 1000, jitter: true };
    for (let i = 0; i < 50; i++) {
      const v = backoff(2, opts);
      expect(v).toBeGreaterThanOrEqual(150);
      expect(v).toBeLessThanOrEqual(250);
    }
  });
});
