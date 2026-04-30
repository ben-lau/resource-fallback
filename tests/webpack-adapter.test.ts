import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';
import { installObserver } from '../packages/core/src/runtime/observer';
import { installWebpackAdapter } from '../packages/core/src/runtime/adapter-webpack';
import { createResolver } from '../packages/core/src/runtime/resolver';

const cdn1 = 'https://cdn1.example.com/';
const cdn2 = 'https://cdn2.example.com/';

function setup(globals: string[]) {
  const log = createLogger(false);
  const resolver = createResolver({
    rules: [
      {
        match: cdn1,
        urls: [cdn1, cdn2],
        retry: { max: 1, baseDelay: 0, maxDelay: 0, jitter: false },
      },
    ],
    defaults: { circuit: { threshold: 100, cooldown: 1000, shareAcrossTabs: false } },
  });
  const bus = createHookBus({}, log);
  installWebpackAdapter({ resolver, bus, log, chunkLoadingGlobals: globals });
}

describe('webpack adapter', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    localStorage.clear();
    delete (window as unknown as Record<string, unknown>).webpackChunk_demo;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).webpackChunk_demo;
  });

  it('pre-creates the chunk array if missing', () => {
    setup(['webpackChunk_demo']);
    const arr = (window as unknown as Record<string, unknown>).webpackChunk_demo;
    expect(Array.isArray(arr)).toBe(true);
  });

  it('wraps chunk[2] runtime function so we can intercept require.l', () => {
    setup(['webpackChunk_demo']);
    const arr = (window as unknown as Record<string, unknown[][]>).webpackChunk_demo;

    let originalCalled = false;
    const fakeRuntime = (req: { l: (...args: unknown[]) => void }) => {
      originalCalled = true;
      req.l = (_url, done: any) => done({ type: 'load' });
    };

    arr.push([['1'], {}, fakeRuntime]);

    const stored = arr[arr.length - 1] as unknown[];
    expect(typeof stored[2]).toBe('function');
    expect(stored[2]).not.toBe(fakeRuntime);

    const fakeReq: { l?: (url: string, done: (e: unknown) => void) => void } = {};
    (stored[2] as (req: typeof fakeReq) => void)(fakeReq);
    expect(originalCalled).toBe(true);
    expect(typeof fakeReq.l).toBe('function');
  });

  it('observer + webpack adapter coexist without double-handling chunk errors', async () => {
    // Reproduces the demo bug where a single lazy chunk produced primary x6
    // + secondary x6 + fallback x2 because both observer (window error
    // capture) and the webpack adapter (`script.onerror`) raced on every
    // failed `<script data-webpack>`. With the observer fix the chunk is
    // owned exclusively by the adapter, so the per-attempt event count is
    // exactly 1 (no doubling).
    const log = createLogger(false);
    const resolver = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 1, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 1000, shareAcrossTabs: false } },
    });
    let retries = 0;
    let fallbacks = 0;
    const eventLog: string[] = [];
    const bus = createHookBus(
      {
        onRetry: (e) => {
          retries++;
          eventLog.push(`retry ${(e as { url: string }).url}`);
        },
        onFallback: (e) => {
          fallbacks++;
          eventLog.push(`fallback ${(e as { from: string; to: string }).from} -> ${(e as { from: string; to: string }).to}`);
        },
      },
      log,
    );
    installObserver({ resolver, bus, log, sri: 'strip' });
    installWebpackAdapter({ resolver, bus, log, chunkLoadingGlobals: ['webpackChunk_demo'] });
    const arr = (window as unknown as Record<string, unknown[][]>).webpackChunk_demo;

    // fakeRuntime stands in for webpack's LoadScriptRuntimeModule. It creates
    // a <script data-webpack> (just like real webpack), waits for the error
    // event to bubble through the window-capture observer, then forwards the
    // failure to `done`. retryWith does the same thing for retries.
    const fakeRuntime = (req: { l: (url: string, done: (e: unknown) => void) => void }) => {
      req.l = (url, done) => {
        const s = document.createElement('script');
        s.setAttribute('data-webpack', 'webpackChunk_demo:820');
        s.src = url;
        s.addEventListener('error', () => done({ type: 'error' }));
        document.head.appendChild(s);
        setTimeout(() => s.dispatchEvent(new Event('error')), 0);
      };
    };
    arr.push([['1'], {}, fakeRuntime]);

    const fakeReq: { l?: (url: string, done: (e: unknown) => void) => void } = {};
    (arr[arr.length - 1][2] as (req: typeof fakeReq) => void)(fakeReq);

    // Mirror real network failures for any retry-script that the adapter
    // appends to head.
    const seen = new WeakSet<HTMLElement>();
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          const s = n as HTMLElement;
          if (s.tagName !== 'SCRIPT' || !s.hasAttribute('data-webpack')) return;
          if (seen.has(s)) return;
          seen.add(s);
          setTimeout(() => s.dispatchEvent(new Event('error')), 0);
        });
      }
    });
    obs.observe(document.head, { childList: true });

    let outerDone = false;
    // `key` matters: webpack-adapter only stamps data-webpack on retry/fallback
    // scripts when a key is provided (real webpack always passes it).
    (fakeReq.l as (url: string, done: () => void, key: string, chunkId: string) => void)!(
      cdn1 + 'chunk.js',
      () => {
        outerDone = true;
      },
      'webpackChunk_demo:820',
      '820',
    );

    await new Promise((r) => setTimeout(r, 80));
    obs.disconnect();

    // Expected with retry.max=1 across [cdn1, cdn2]:
    //   cdn1 initial -> retry cdn1 (retries=1) -> fallback cdn2 (fallbacks=1)
    //                -> retry cdn2 (retries=2) -> giveup
    // The pre-fix bug, where observer also handled each error, would emit
    // each event twice (retries=4, fallbacks=2). Strict equality here is the
    // assertion of "no doubling".
    expect(eventLog).toEqual([
      `retry ${cdn1}chunk.js`,
      `fallback ${cdn1}chunk.js -> ${cdn2}chunk.js`,
      `retry ${cdn2}chunk.js`,
    ]);
    expect(retries).toBe(2);
    expect(fallbacks).toBe(1);
    expect(outerDone).toBe(true);
  });

  it('progresses through primary -> secondary -> origin instead of looping on the original URL', async () => {
    setup(['webpackChunk_demo']);
    const arr = (window as unknown as Record<string, unknown[][]>).webpackChunk_demo;

    // Simulate webpack's loadScript: every script we create errors out
    // synchronously so we drive the wrapper through its full chain.
    const requested: string[] = [];
    const fakeRuntime = (req: { l: (url: string, done: (e: unknown) => void) => void }) => {
      req.l = (url, done) => {
        requested.push(url);
        // Mock both webpack's original loader (for the very first call) and
        // any subsequent retries that go through our DOM script appender.
        // The DOM scripts created by retryWith in adapter-webpack will be
        // observed via the script tag append below.
        Promise.resolve().then(() => done({ type: 'error' }));
      };
    };
    arr.push([['1'], {}, fakeRuntime]);

    // Drive the chunk[2] runtime so .l gets wrapped, then call .l ourselves.
    const fakeReq: { l?: (url: string, done: (e: unknown) => void) => void } = {};
    (arr[arr.length - 1][2] as (req: typeof fakeReq) => void)(fakeReq);

    // Our wrapper appends new <script> tags via document.head.appendChild for
    // retries. JSDOM doesn't actually fetch them, so we need to wire onerror
    // ourselves. Use a MutationObserver to immediately fail any new script.
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if ((n as HTMLElement).tagName === 'SCRIPT') {
            const s = n as HTMLScriptElement;
            requested.push(s.src);
            // Schedule async error to mimic real network failure.
            setTimeout(() => s.dispatchEvent(new Event('error')), 0);
          }
        });
      }
    });
    obs.observe(document.head, { childList: true });

    let outerDoneCalled = false;
    let outerDoneArg: unknown = null;
    fakeReq.l!(cdn1 + 'chunk.js', (e) => {
      outerDoneCalled = true;
      outerDoneArg = e;
    });

    await new Promise((r) => setTimeout(r, 50));
    obs.disconnect();

    // We MUST see secondary requested at some point - if the closed-over
    // `url` bug regresses, only cdn1 will ever appear in `requested`.
    expect(requested.some((u) => u.startsWith(cdn2))).toBe(true);
    // And the chain must terminate (eventually reaches `done(event)` after
    // exhausting both candidates with retry+fallback).
    expect(outerDoneCalled).toBe(true);
    expect(outerDoneArg).toEqual({ type: 'error' });
  });
});
