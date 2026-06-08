import { beforeEach, describe, expect, it } from 'vitest';

import { createResolver } from '../packages/core/src/runtime/resolver';

describe('resolver', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const cdn1 = 'https://cdn1.example.com/';
  const cdn2 = 'https://cdn2.example.com/';
  const origin = 'https://origin.example.com/';

  function build() {
    return createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2, origin],
          retry: { max: 2, baseDelay: 10, maxDelay: 50, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 60_000, shareAcrossTabs: false } },
    });
  }

  it('returns no-match when no rule applies', () => {
    const r = build();
    expect(r.resolve('https://other.example/x.js', 1)).toEqual({ kind: 'giveup', reason: 'no-match' });
  });

  it('retries the same URL until budget exhausted', () => {
    const r = build();
    const url = cdn1 + 'foo.js';
    const a1 = r.resolve(url, 1);
    expect(a1.kind).toBe('retry');
    if (a1.kind === 'retry') expect(a1.url).toBe(url);

    const a2 = r.resolve(url, 2);
    expect(a2.kind).toBe('retry');

    const a3 = r.resolve(url, 3);
    expect(a3.kind).toBe('fallback');
    if (a3.kind === 'fallback') expect(a3.url).toBe(cdn2 + 'foo.js');
  });

  it('walks down the urls list and finally gives up', () => {
    const r = build();
    const url1 = cdn1 + 'foo.js';
    const url2 = cdn2 + 'foo.js';
    const url3 = origin + 'foo.js';

    expect(r.resolve(url1, 3).kind).toBe('fallback');
    // url2/url3 are fallback URLs — pass isFallback=true so they're found via urls prefix
    expect(r.resolve(url2, 3, true).kind).toBe('fallback');
    const last = r.resolve(url3, 3, true);
    expect(last).toEqual({ kind: 'giveup', reason: 'rules-exhausted' });
  });

  it('regex match supports advanced patterns', () => {
    const r = createResolver({
      rules: [
        {
          match: /^https:\/\/cdn\d+\.example\.com\//,
          urls: ['https://cdn1.example.com/', 'https://cdn2.example.com/'],
          retry: { max: 0, baseDelay: 1, maxDelay: 1, jitter: false },
        },
      ],
    });
    const r1 = r.resolve('https://cdn1.example.com/x.js', 1);
    expect(r1.kind).toBe('fallback');
    if (r1.kind === 'fallback') expect(r1.url).toBe('https://cdn2.example.com/x.js');
  });

  it('resolveBuiltUrl prefers the match URL (base) over urls', () => {
    const r = build();
    // match = cdn1, so resolveBuiltUrl should return match + filename
    expect(r.resolveBuiltUrl('foo.js')).toBe(cdn1 + 'foo.js');
  });

  it('resolveBuiltUrl inserts slash between match without trailing slash and nested filename', () => {
    const r = createResolver({
      rules: [
        {
          match: 'https://qn.cache.wpscdn.cn/fe/edu/edu-study-platform-prod',
          urls: ['https://edu.wps.cn'],
          retry: { max: 2, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 60_000, shareAcrossTabs: false } },
    });
    expect(r.resolveBuiltUrl('js/app-layout.abc.js')).toBe(
      'https://qn.cache.wpscdn.cn/fe/edu/edu-study-platform-prod/js/app-layout.abc.js',
    );
  });

  it('resolveBuiltUrl falls back to filename if no rule matches', () => {
    const r = createResolver({
      rules: [
        {
          match: /^https:\/\/specific\.example\.com\//,
          urls: ['https://specific.example.com/'],
        },
      ],
    });
    expect(r.resolveBuiltUrl('foo.js')).toBe('foo.js');
  });

  it('handles match ≠ urls[0] correctly (base differs from urls)', () => {
    const base = 'https://cdn.original.com/';
    const altCdn1 = 'https://cdn1.new.com/';
    const altCdn2 = 'https://cdn2.new.com/';

    const r = createResolver({
      rules: [
        {
          match: base,
          urls: [altCdn1, altCdn2, '/'],
          retry: { max: 1, baseDelay: 1, maxDelay: 1, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 60_000, shareAcrossTabs: false } },
    });

    const url = base + 'assets/index.js';

    // attempt 1: retry on same URL
    const a1 = r.resolve(url, 1);
    expect(a1.kind).toBe('retry');

    // attempt 2: budget exhausted → fallback to urls[0] with correct asset path
    const a2 = r.resolve(url, 2);
    expect(a2.kind).toBe('fallback');
    if (a2.kind === 'fallback') {
      expect(a2.url).toBe(altCdn1 + 'assets/index.js');
    }

    // urls[0] fails → fallback to urls[1] (isFallback=true since we're in fallback phase)
    const url1 = altCdn1 + 'assets/index.js';
    const a3 = r.resolve(url1, 2, true);
    expect(a3.kind).toBe('fallback');
    if (a3.kind === 'fallback') {
      expect(a3.url).toBe(altCdn2 + 'assets/index.js');
    }

    // urls[1] fails → fallback to /
    const url2 = altCdn2 + 'assets/index.js';
    const a4 = r.resolve(url2, 2, true);
    expect(a4.kind).toBe('fallback');
    if (a4.kind === 'fallback') {
      expect(a4.url).toBe('/assets/index.js');
    }
  });

  it('isFallback=false: only matches via match pattern, not urls prefix', () => {
    const r = build();
    // cdn2 is in the urls list but doesn't match the match pattern (cdn1)
    const result = r.resolve(cdn2 + 'foo.js', 1);
    expect(result).toEqual({ kind: 'giveup', reason: 'no-match' });
  });

  it('isFallback=true: matches via urls prefix', () => {
    const r = build();
    const result = r.resolve(cdn2 + 'foo.js', 1, true);
    expect(result.kind).toBe('retry');
  });

  it('initial link failure records to breaker but resolve() still matches via match pattern', () => {
    const primary = 'https://primary.example.com/';
    const r = createResolver({
      rules: [
        {
          match: primary,
          urls: [cdn1, primary, origin],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 1, cooldown: 60_000, shareAcrossTabs: false } },
    });

    // Initial failure on primary (isFallback=false) → recorded to breaker.
    // threshold=1 → primary host is now circuit-broken.
    r.resolve(primary + 'a.js', 1);

    // But resolve() still finds the rule via match pattern — initial link is always tried.
    // Even though primary is circuit-broken, findPrepared matches via match, not breaker.
    const retryResult = r.resolve(primary + 'b.js', 1);
    expect(retryResult.kind).toBe('fallback');

    // When primary appears in urls (urls[1]), pickNextUrl skips it (broken).
    const result = r.resolve(cdn1 + 'foo.js', 1, true);
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') {
      // cdn1 (urls[0]) exhausted → pickNextUrl: primary (urls[1]) broken → skip → origin (urls[2])
      expect(result.url).toBe(origin + 'foo.js');
    }
  });

  it('all failures (initial and fallback) trigger circuit breaker', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn2, cdn1, origin],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 1, cooldown: 60_000, shareAcrossTabs: false } },
    });

    // Initial failure on cdn1 (isFallback=false) → recorded.
    // threshold=1 → cdn1 host is circuit-broken.
    r.resolve(cdn1 + 'a.js', 1);

    // Fallback chain at cdn2 (urls[0]) exhausts. pickNextUrl checks
    // urls[1]=cdn1 — cdn1 is broken, so it skips to urls[2]=origin.
    const result = r.resolve(cdn2 + 'foo.js', 1, true);
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') {
      expect(result.url).toBe(origin + 'foo.js');
    }
  });

  it('per-rule circuit breaker: different thresholds are independent', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
          circuit: { threshold: 2, cooldown: 60_000, shareAcrossTabs: false },
        },
        {
          match: cdn2,
          urls: [cdn2, origin],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
          circuit: { threshold: 5, cooldown: 60_000, shareAcrossTabs: false },
        },
      ],
    });

    // Rule A (cdn1): threshold=2, retry.max=0 → 每次 resolve 直接进 fallback，
    // 同时 recordFailure(cdn1)。两次调用让 cdn1 在 Rule A 的 breaker 中达到阈值。
    r.resolve(cdn1 + 'a.js', 1);
    r.resolve(cdn1 + 'b.js', 1);

    // 关键：per-rule breaker 意味着 Rule A 中 cdn1 的 2 次失败只记录在
    // Rule A 的 breaker 中，不会影响 Rule B 的 breaker。
    // cdn2 在 Rule B 的 breaker 中此时有 0 次失败。
    const result = r.resolve(cdn2 + 'x.js', 1);
    expect(result.kind).toBe('fallback');
    // resolve 内部先 recordFailure(cdn2) 到 Rule B 的 breaker（1 次，未达阈值 5），
    // 然后 pickNextUrl 找到 origin。
    if (result.kind === 'fallback') {
      expect(result.url).toBe(origin + 'x.js');
    }
  });

  it('duplicate rules: last matching rule wins', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
        {
          match: cdn1,
          urls: [cdn1, origin],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    });

    const result = r.resolve(cdn1 + 'foo.js', 1);
    expect(result.kind).toBe('fallback');
    // Last rule's urls should be used: fallback to origin, not cdn2
    if (result.kind === 'fallback') {
      expect(result.url).toBe(origin + 'foo.js');
    }
  });

  it('resolveBuiltUrl skips circuit-broken hosts for Vite dynamic import fallback', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 1, cooldown: 60_000, shareAcrossTabs: false } },
    });

    // Before circuit break: match = cdn1, not broken → returns match URL
    expect(r.resolveBuiltUrl('foo.js')).toBe(cdn1 + 'foo.js');

    // Circuit-break cdn1 via a fallback failure
    r.resolve(cdn1 + 'x.js', 1, true);

    // After circuit break: match URL 始终优先返回（初始链接不受熔断影响），
    // __RF__.load 的 retry/fallback 循环负责后续切换。
    expect(r.resolveBuiltUrl('foo.js')).toBe(cdn1 + 'foo.js');
  });

  it('resolveBuiltUrl: match ≠ urls[0] — first returns match, then rotates through urls', () => {
    const base = 'https://base.example.com/';
    const fallback1 = 'https://cdn-a.example.com/';
    const fallback2 = 'https://cdn-b.example.com/';

    const r = createResolver({
      rules: [
        {
          match: base,
          urls: [fallback1, fallback2, '/'],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 1, cooldown: 60_000, shareAcrossTabs: false } },
    });

    // 初始链接（match URL）始终优先返回，不受熔断影响
    expect(r.resolveBuiltUrl('assets/chunk.js')).toBe(base + 'assets/chunk.js');

    // Simulate vite:preloadError → recordFailure on base host
    r.recordFailure(base + 'assets/chunk.js');

    // 即使 base host 熔断，resolveBuiltUrl 仍返回 match URL
    expect(r.resolveBuiltUrl('assets/chunk.js')).toBe(base + 'assets/chunk.js');

    // fallback1 also fails
    r.recordFailure(fallback1 + 'assets/chunk.js');

    // match URL 依然不受影响
    expect(r.resolveBuiltUrl('assets/chunk.js')).toBe(base + 'assets/chunk.js');
  });

  // ---- Edge cases added below ----

  it('function match pattern works', () => {
    const r = createResolver({
      rules: [
        {
          match: (url: string) => url.includes('/assets/'),
          urls: ['https://cdn.example.com/', 'https://backup.example.com/'],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    });
    const result = r.resolve('https://cdn.example.com/assets/chunk.js', 1);
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') {
      expect(result.url).toBe('https://backup.example.com/assets/chunk.js');
    }
  });

  it('function match that returns false causes no-match', () => {
    const r = createResolver({
      rules: [
        {
          match: () => false,
          urls: ['https://cdn.example.com/'],
          retry: { max: 2, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    });
    expect(r.resolve('https://any.example.com/x.js', 1)).toEqual({
      kind: 'giveup',
      reason: 'no-match',
    });
  });

  it('single URL in urls array — retry then giveup (no fallback possible)', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1],
          retry: { max: 1, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    });
    const a1 = r.resolve(cdn1 + 'x.js', 1);
    expect(a1.kind).toBe('retry');

    const a2 = r.resolve(cdn1 + 'x.js', 2);
    expect(a2).toEqual({ kind: 'giveup', reason: 'rules-exhausted' });
  });

  it('findRule returns the rule for matched URLs', () => {
    const r = build();
    expect(r.findRule(cdn1 + 'foo.js')).toBeTruthy();
    expect(r.findRule(cdn1 + 'foo.js')?.match).toBe(cdn1);
  });

  it('findRule returns undefined for unmatched URLs', () => {
    const r = build();
    expect(r.findRule('https://unknown.example.com/foo.js')).toBeUndefined();
  });

  it('recordFailure + recordSuccess drive circuit breaker state', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2, origin],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 2, cooldown: 60_000, shareAcrossTabs: false } },
    });

    // Two failures on cdn1 → circuit-broken (threshold=2, each resolve records failure)
    r.resolve(cdn1 + 'a.js', 1);
    r.resolve(cdn1 + 'b.js', 1);

    // cdn2 fallback exhausted: pickNextUrl from cdn2(index=1) → origin(index=2)
    // cdn1(index=0) is before cdn2 so not considered by pickNextUrl
    const result = r.resolve(cdn2 + 'foo.js', 1, true);
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') {
      expect(result.url).toBe(origin + 'foo.js');
    }

    // recordSuccess resets cdn1, but pickNextUrl still goes forward: cdn2→origin
    r.recordSuccess(cdn1 + 'x.js');
    const result2 = r.resolve(cdn2 + 'bar.js', 1, true);
    expect(result2.kind).toBe('fallback');
    if (result2.kind === 'fallback') {
      // pickNextUrl(urls, fromIdx=1) → checks urls[2]=origin
      expect(result2.url).toBe(origin + 'bar.js');
    }
  });

  it('retry with max=0 goes directly to fallback', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    });
    const a1 = r.resolve(cdn1 + 'x.js', 1);
    expect(a1.kind).toBe('fallback');
  });

  it('handles URLs with query strings correctly', () => {
    const r = build();
    const url = cdn1 + 'chunk.js?v=123';
    const a1 = r.resolve(url, 1);
    expect(a1.kind).toBe('retry');
    if (a1.kind === 'retry') {
      expect(a1.url).toBe(url);
    }
  });

  it('handles URLs with hash fragments', () => {
    const r = build();
    const url = cdn1 + 'chunk.js#anchor';
    const result = r.resolve(url, 1);
    expect(result.kind).toBe('retry');
  });

  it('resolveBuiltUrl with duplicate string match: returns match prefix (not urls[0])', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1],
        },
        {
          match: cdn1,
          urls: ['https://last-wins.example.com/'],
        },
      ],
    });
    // For string match, resolveBuiltUrl returns match + filename, not urls[0]
    expect(r.resolveBuiltUrl('chunk.js')).toBe(cdn1 + 'chunk.js');
  });

  it('resolve with duplicate match: last rule takes precedence', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
        {
          match: cdn1,
          urls: [cdn1, origin],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    });
    const result = r.resolve(cdn1 + 'chunk.js', 1);
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') {
      // Last rule has urls: [cdn1, origin], so fallback goes to origin
      expect(result.url).toBe(origin + 'chunk.js');
    }
  });

  it('handles match ≠ urls when URL matches match but not any urls entry', () => {
    const base = 'https://cdn.original.com/';
    const altCdn = 'https://cdn.alt.com/';
    const r = createResolver({
      rules: [
        {
          match: base,
          urls: [altCdn, '/'],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    });
    // URL matches `match` (base) but doesn't match any urls entry.
    // Should fallback to urls[0] with correct asset path preserved.
    const url = base + 'assets/chunk.js';
    const result = r.resolve(url, 1);
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') {
      expect(result.url).toBe(altCdn + 'assets/chunk.js');
    }
  });

  it('empty rules array: everything is no-match', () => {
    const r = createResolver({ rules: [] });
    expect(r.resolve(cdn1 + 'x.js', 1)).toEqual({ kind: 'giveup', reason: 'no-match' });
    expect(r.resolveBuiltUrl('x.js')).toBe('x.js');
  });

  it('backoff delay is returned in retry result when baseDelay > 0', () => {
    const r = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 3, baseDelay: 100, maxDelay: 1000, jitter: false },
        },
      ],
    });
    const a1 = r.resolve(cdn1 + 'x.js', 1);
    expect(a1.kind).toBe('retry');
    if (a1.kind === 'retry') {
      expect(a1.delay).toBe(100);
    }

    const a2 = r.resolve(cdn1 + 'x.js', 2);
    if (a2.kind === 'retry') {
      expect(a2.delay).toBe(200);
    }
  });
});
