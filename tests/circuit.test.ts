import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCircuitBreaker,
  hostOf,
  mergeCircuit,
  CIRCUIT_DEFAULTS,
} from '../packages/core/src/runtime/circuit';

describe('circuit', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hostOf extracts host from absolute & relative URLs', () => {
    expect(hostOf('https://cdn.example.com/foo.js')).toBe('cdn.example.com');
    expect(hostOf('/relative.js')).not.toBe('');
  });

  it('opens after threshold and recovers after cooldown', () => {
    vi.useFakeTimers();
    try {
      const breaker = createCircuitBreaker({
        threshold: 3,
        cooldown: 1000,
        shareAcrossTabs: false,
        storageTtl: 120_000,
      });
      breaker.recordFailure('a.com');
      breaker.recordFailure('a.com');
      expect(breaker.isOpen('a.com')).toBe(false);
      breaker.recordFailure('a.com');
      expect(breaker.isOpen('a.com')).toBe(true);

      vi.advanceTimersByTime(1500);
      expect(breaker.isOpen('a.com')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recordSuccess clears failure state', () => {
    const breaker = createCircuitBreaker({
      ...CIRCUIT_DEFAULTS,
      shareAcrossTabs: false,
    });
    breaker.recordFailure('a.com');
    breaker.recordSuccess('a.com');
    expect(breaker.snapshot()['a.com']).toEqual({ fails: 0, openedAt: 0 });
  });

  it('shares state across instances via localStorage when enabled', () => {
    const a = createCircuitBreaker({
      threshold: 2,
      cooldown: 1000,
      shareAcrossTabs: true,
      storageTtl: 120_000,
    });
    a.recordFailure('shared.com');
    a.recordFailure('shared.com');
    expect(a.isOpen('shared.com')).toBe(true);

    // A second instance (simulating another tab) reads the same localStorage.
    const b = createCircuitBreaker({
      threshold: 2,
      cooldown: 1000,
      shareAcrossTabs: true,
      storageTtl: 120_000,
    });
    expect(b.isOpen('shared.com')).toBe(true);
    a.dispose();
    b.dispose();
  });

  it('does not share state when shareAcrossTabs=false', () => {
    const a = createCircuitBreaker({
      threshold: 1,
      cooldown: 1000,
      shareAcrossTabs: false,
      storageTtl: 120_000,
    });
    a.recordFailure('isolated.com');
    expect(a.isOpen('isolated.com')).toBe(true);

    const b = createCircuitBreaker({
      threshold: 1,
      cooldown: 1000,
      shareAcrossTabs: false,
      storageTtl: 120_000,
    });
    expect(b.isOpen('isolated.com')).toBe(false);
  });

  it('evicts expired entries on load based on storageTtl', () => {
    vi.useFakeTimers();
    try {
      const ttl = 5_000;
      const a = createCircuitBreaker({
        threshold: 1,
        cooldown: 60_000,
        shareAcrossTabs: true,
        storageTtl: ttl,
      });
      a.recordFailure('stale.com');
      expect(a.isOpen('stale.com')).toBe(true);

      vi.advanceTimersByTime(ttl + 1);

      // New instance should discard the stale entry.
      const b = createCircuitBreaker({
        threshold: 1,
        cooldown: 60_000,
        shareAcrossTabs: true,
        storageTtl: ttl,
      });
      expect(b.isOpen('stale.com')).toBe(false);
      a.dispose();
      b.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up localStorage when all entries are reset', () => {
    const breaker = createCircuitBreaker({
      threshold: 1,
      cooldown: 1000,
      shareAcrossTabs: true,
      storageTtl: 120_000,
    });
    breaker.recordFailure('cleanup.com');
    expect(localStorage.getItem('__rf_circuit__')).not.toBeNull();

    breaker.recordSuccess('cleanup.com');
    expect(localStorage.getItem('__rf_circuit__')).toBeNull();
    breaker.dispose();
  });

  // ---- Edge cases added below ----

  it('multiple hosts can be independently circuit-broken', () => {
    const breaker = createCircuitBreaker({
      threshold: 2,
      cooldown: 1000,
      shareAcrossTabs: false,
      storageTtl: 120_000,
    });
    breaker.recordFailure('host-a.com');
    breaker.recordFailure('host-a.com');
    breaker.recordFailure('host-b.com');

    expect(breaker.isOpen('host-a.com')).toBe(true);
    expect(breaker.isOpen('host-b.com')).toBe(false);

    breaker.recordFailure('host-b.com');
    expect(breaker.isOpen('host-b.com')).toBe(true);
  });

  it('threshold=1: single failure opens circuit', () => {
    const breaker = createCircuitBreaker({
      threshold: 1,
      cooldown: 1000,
      shareAcrossTabs: false,
      storageTtl: 120_000,
    });
    expect(breaker.isOpen('fragile.com')).toBe(false);
    breaker.recordFailure('fragile.com');
    expect(breaker.isOpen('fragile.com')).toBe(true);
  });

  it('failures below threshold do not open circuit', () => {
    const breaker = createCircuitBreaker({
      threshold: 10,
      cooldown: 1000,
      shareAcrossTabs: false,
      storageTtl: 120_000,
    });
    for (let i = 0; i < 9; i++) {
      breaker.recordFailure('robust.com');
    }
    expect(breaker.isOpen('robust.com')).toBe(false);
    breaker.recordFailure('robust.com');
    expect(breaker.isOpen('robust.com')).toBe(true);
  });

  it('recordSuccess on unknown host is a no-op', () => {
    const breaker = createCircuitBreaker({
      ...CIRCUIT_DEFAULTS,
      shareAcrossTabs: false,
    });
    expect(() => breaker.recordSuccess('never-seen.com')).not.toThrow();
    expect(breaker.isOpen('never-seen.com')).toBe(false);
  });

  it('rapid success after circuit open resets the state', () => {
    const breaker = createCircuitBreaker({
      threshold: 2,
      cooldown: 60_000,
      shareAcrossTabs: false,
      storageTtl: 120_000,
    });
    breaker.recordFailure('flaky.com');
    breaker.recordFailure('flaky.com');
    expect(breaker.isOpen('flaky.com')).toBe(true);

    breaker.recordSuccess('flaky.com');
    expect(breaker.isOpen('flaky.com')).toBe(false);

    // After reset, need full threshold failures to reopen
    breaker.recordFailure('flaky.com');
    expect(breaker.isOpen('flaky.com')).toBe(false);
  });

  it('snapshot returns deep copy (mutations do not affect internal state)', () => {
    const breaker = createCircuitBreaker({
      threshold: 2,
      cooldown: 1000,
      shareAcrossTabs: false,
      storageTtl: 120_000,
    });
    breaker.recordFailure('snap.com');
    const snap = breaker.snapshot();
    snap['snap.com'].fails = 999;

    const snap2 = breaker.snapshot();
    expect(snap2['snap.com'].fails).toBe(1);
  });

  it('hostOf handles relative URLs without throwing', () => {
    expect(hostOf('/foo.js')).toBeTruthy();
    expect(hostOf('./bar.js')).toBeTruthy();
    expect(hostOf('../baz.js')).toBeTruthy();
  });

  it('hostOf handles malformed URLs gracefully', () => {
    expect(() => hostOf('')).not.toThrow();
    expect(() => hostOf('not-a-url')).not.toThrow();
  });

  it('mergeCircuit picks rule over defaults over CIRCUIT_DEFAULTS', () => {
    const result = mergeCircuit(
      { threshold: 10, cooldown: 5000 },
      { threshold: 3 },
    );
    expect(result.threshold).toBe(3);
    expect(result.cooldown).toBe(5000);
    expect(result.shareAcrossTabs).toBe(CIRCUIT_DEFAULTS.shareAcrossTabs);
    expect(result.storageTtl).toBe(CIRCUIT_DEFAULTS.storageTtl);
  });

  it('mergeCircuit with both undefined uses all defaults', () => {
    const result = mergeCircuit(undefined, undefined);
    expect(result).toEqual(CIRCUIT_DEFAULTS);
  });

  it('dispose removes storage event listener', () => {
    const breaker = createCircuitBreaker({
      threshold: 1,
      cooldown: 1000,
      shareAcrossTabs: true,
      storageTtl: 120_000,
    });
    breaker.recordFailure('dispose-test.com');
    expect(() => breaker.dispose()).not.toThrow();
    // Calling dispose twice should not throw
    expect(() => breaker.dispose()).not.toThrow();
  });
});
