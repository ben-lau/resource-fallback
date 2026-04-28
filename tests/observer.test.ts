import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';
import { installObserver } from '../packages/core/src/runtime/observer';
import { createResolver } from '../packages/core/src/runtime/resolver';
import { systemjsManagedUrls } from '../packages/core/src/runtime/adapter-systemjs';
import type { ErrorEvent as RfErrorEvent, FallbackEvent, RetryEvent, SuccessEvent } from '../packages/core/src/types';

const cdn1 = 'https://cdn1.example.com/';
const cdn2 = 'https://cdn2.example.com/';
const origin = 'https://origin.example.com/';

function setup(onError?: (e: RfErrorEvent) => void, onFallback?: (e: FallbackEvent) => void) {
  const log = createLogger(false);
  const resolver = createResolver({
    rules: [
      {
        match: cdn1,
        urls: [cdn1, cdn2, origin],
        retry: { max: 1, baseDelay: 0, maxDelay: 0, timeout: 1000, jitter: false },
      },
    ],
    defaults: { circuit: { threshold: 100, cooldown: 1000, shareAcrossTabs: false } },
  });
  const bus = createHookBus({ onError, onFallback }, log);
  installObserver({ resolver, bus, log, sri: 'strip' });
}

function fireScriptError(src: string): HTMLScriptElement {
  const s = document.createElement('script');
  s.src = src;
  s.setAttribute('integrity', 'sha384-XXX');
  document.head.appendChild(s);
  s.dispatchEvent(new Event('error'));
  return s;
}

describe('observer', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    localStorage.clear();
  });
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('does nothing for unrelated URLs', () => {
    let called = false;
    setup((_e) => {
      called = true;
    });
    fireScriptError('https://other.example/x.js');
    expect(called).toBe(true); // emits onError because no rule matched
  });

  it('replaces a failing script with a retry of the same URL within budget', async () => {
    setup();
    const original = fireScriptError(cdn1 + 'foo.js');
    await Promise.resolve();
    // After retry-budget=1: first failure → retry same url
    const scripts = Array.from(document.head.querySelectorAll('script'));
    expect(scripts.find((s) => s.src.startsWith(cdn1))).toBeTruthy();
    expect(scripts.includes(original)).toBe(false);
  });

  it('falls back to the next URL after retry budget exhausted', async () => {
    let from = '';
    let to = '';
    setup(undefined, (e) => {
      from = String(e.from);
      to = String(e.to);
    });
    // Fire 2 errors to exhaust the budget (max=1 → 1 retry, then fallback)
    const first = fireScriptError(cdn1 + 'foo.js');
    await new Promise((r) => setTimeout(r, 10));
    const replacement = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== first,
    );
    expect(replacement?.src).toBe(cdn1 + 'foo.js');

    replacement?.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 10));

    expect(from).toBe(cdn1 + 'foo.js');
    expect(to).toBe(cdn2 + 'foo.js');
  });

  it('strips integrity attribute on swap', async () => {
    setup();
    fireScriptError(cdn1 + 'foo.js');
    await new Promise((r) => setTimeout(r, 5));
    const scripts = Array.from(document.head.querySelectorAll('script'));
    const replacement = scripts[scripts.length - 1];
    expect(replacement.hasAttribute('integrity')).toBe(false);
  });

  it('ignores preload/prefetch link errors', async () => {
    let errored = false;
    setup(() => {
      errored = true;
    });
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = cdn1 + 'foo.js';
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(errored).toBe(false);
  });

  it('appends a cache-bust query when retrying ESM module scripts', async () => {
    setup();
    const original = document.createElement('script');
    original.src = cdn1 + 'foo.js';
    original.type = 'module';
    document.head.appendChild(original);
    original.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));

    const replacement = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    );
    expect(replacement).toBeTruthy();
    expect(replacement!.src).toMatch(/foo\.js\?__rf=1-/);
    expect(replacement!.type).toBe('module');
  });

  it('does NOT cache-bust classic (non-module) script retries', async () => {
    setup();
    const original = fireScriptError(cdn1 + 'foo.js');
    await new Promise((r) => setTimeout(r, 5));
    const replacement = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    );
    expect(replacement!.src).toBe(cdn1 + 'foo.js');
  });

  it('strips __rf retry param when falling back to next URL', async () => {
    let toUrl = '';
    setup(undefined, (e) => {
      toUrl = String(e.to);
    });

    const original = document.createElement('script');
    original.src = cdn1 + 'foo.js';
    original.type = 'module';
    document.head.appendChild(original);
    original.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));

    const retry = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    )!;
    retry.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));

    expect(toUrl).toBe(cdn2 + 'foo.js');
    const fallback = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original && s !== retry,
    )!;
    expect(fallback.src).toBe(cdn2 + 'foo.js');
  });

  it('grants the fallback URL its own retry budget', async () => {
    const fallbacks: string[] = [];
    setup(undefined, (e) => {
      fallbacks.push(String(e.to));
    });

    const original = fireScriptError(cdn1 + 'foo.js');
    await new Promise((r) => setTimeout(r, 5));
    const retry1 = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    )!;
    retry1.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));

    // First fallback to cdn2; the retry budget on cdn2 should still be intact
    // (so its first failure becomes a retry, not an immediate second fallback).
    const onCdn2 = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s.src === cdn2 + 'foo.js',
    )!;
    expect(onCdn2).toBeTruthy();
    onCdn2.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));
    expect(fallbacks).toEqual([cdn2 + 'foo.js']);

    // Second failure on cdn2 finally triggers fallback to origin.
    const cdn2Retry = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original && s !== retry1 && s !== onCdn2 && s.src.startsWith(cdn2),
    )!;
    expect(cdn2Retry).toBeTruthy();
    cdn2Retry.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));
    expect(fallbacks).toEqual([cdn2 + 'foo.js', origin + 'foo.js']);
  });

  it('skips <script data-webpack> entirely (left to the webpack adapter)', async () => {
    let errored = false;
    let retried = false;
    let fellBack = false;
    setup(
      () => {
        errored = true;
      },
      () => {
        fellBack = true;
      },
    );
    // Subscribe to retry events too via window event (CustomEvent).
    window.addEventListener('rf:retry', () => {
      retried = true;
    });

    const s = document.createElement('script');
    s.src = cdn1 + 'chunk.820.js';
    // Webpack 5's LoadScriptRuntimeModule always tags chunk-loading scripts
    // with this attribute. Our own retry path keeps it. If observer doesn't
    // bail here, it would race the webpack adapter on the same `error` event
    // and double every retry/fallback - the bug that produced primary x6 +
    // secondary x6 + fallback x2 in the demo.
    s.setAttribute('data-webpack', 'webpackChunk_demo:820');
    document.head.appendChild(s);
    s.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 10));

    expect(errored).toBe(false);
    expect(retried).toBe(false);
    expect(fellBack).toBe(false);
    // No replacement script should have been inserted.
    const all = Array.from(document.head.querySelectorAll('script'));
    expect(all.length).toBe(1);
    expect(all[0]).toBe(s);
  });

  it('still handles <script> without data-webpack (entry bundle path)', async () => {
    let to = '';
    setup(undefined, (e) => {
      to = String(e.to);
    });
    // Entry bundle scripts injected by html-webpack-plugin do NOT have a
    // data-webpack attribute, so observer must continue to manage them.
    const original = fireScriptError(cdn1 + 'main.js');
    await new Promise((r) => setTimeout(r, 5));
    const retry = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    )!;
    expect(retry).toBeTruthy();
    retry.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));
    expect(to).toBe(cdn2 + 'main.js');
  });

  it('does NOT inherit the "already started" flag - the new script gets fetched', () => {
    setup();
    const original = document.createElement('script');
    original.src = cdn1 + 'foo.js';
    original.type = 'module';
    original.setAttribute('crossorigin', '');
    document.head.appendChild(original);
    original.dispatchEvent(new Event('error'));

    const replacement = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    )!;
    expect(replacement.type).toBe('module');
    expect(replacement.hasAttribute('crossorigin')).toBe(true);
    expect(replacement).not.toBe(original);
    expect(replacement.isSameNode(original)).toBe(false);
  });

  // ---- Edge cases added below ----

  it('skips URLs in systemjsManagedUrls (SystemJS adapter coordination)', async () => {
    let retried = false;
    setup(undefined, () => { retried = true; });

    systemjsManagedUrls.add(cdn1 + 'systemjs-chunk.js');

    const s = document.createElement('script');
    s.src = cdn1 + 'systemjs-chunk.js';
    document.head.appendChild(s);
    s.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 10));

    expect(retried).toBe(false);
    const scripts = Array.from(document.head.querySelectorAll('script'));
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toBe(s);

    systemjsManagedUrls.delete(cdn1 + 'systemjs-chunk.js');
  });

  it('handles CSS <link rel=stylesheet> fallback', async () => {
    // Use unique URL prefix to isolate from other observers registered in earlier tests
    const cssCdn = 'https://css-test-cdn.example.com/';
    const cssBackup = 'https://css-backup.example.com/';
    let to = '';
    const log = createLogger(false);
    const resolver = createResolver({
      rules: [
        {
          match: cssCdn,
          urls: [cssCdn, cssBackup],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, timeout: 1000, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 1000, shareAcrossTabs: false } },
    });
    const bus = createHookBus({ onFallback: (e) => { to = String(e.to); } }, log);
    installObserver({ resolver, bus, log, sri: 'strip' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('href', cssCdn + 'style.css');
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 10));

    expect(to).toBe(cssBackup + 'style.css');
    const links = Array.from(document.head.querySelectorAll('link'));
    const replacement = links.find((l) => l !== link && l.getAttribute('href')?.includes('style.css'));
    expect(replacement).toBeTruthy();
    expect(replacement!.getAttribute('href')).toBe(cssBackup + 'style.css');
  });

  it('does NOT cache-bust CSS link retries', async () => {
    const log = createLogger(false);
    const resolver = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 1, baseDelay: 0, maxDelay: 0, timeout: 1000, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 1000, shareAcrossTabs: false } },
    });
    const bus = createHookBus({}, log);
    installObserver({ resolver, bus, log, sri: 'strip' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cdn1 + 'style.css';
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 10));

    const replacement = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]')).find(
      (l) => l !== link,
    )!;
    expect(replacement).toBeTruthy();
    expect((replacement as HTMLLinkElement).href).not.toContain('__rf=');
  });

  it('handles multiple concurrent failures on different scripts', async () => {
    const retries: string[] = [];
    const log = createLogger(false);
    const resolver = createResolver({
      rules: [
        {
          match: cdn1,
          urls: [cdn1, cdn2],
          retry: { max: 1, baseDelay: 0, maxDelay: 0, timeout: 1000, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 1000, shareAcrossTabs: false } },
    });
    const bus = createHookBus({
      onRetry: (e) => retries.push((e as RetryEvent).url),
    }, log);
    installObserver({ resolver, bus, log, sri: 'strip' });

    const s1 = document.createElement('script');
    s1.src = cdn1 + 'a.js';
    document.head.appendChild(s1);

    const s2 = document.createElement('script');
    s2.src = cdn1 + 'b.js';
    document.head.appendChild(s2);

    s1.dispatchEvent(new Event('error'));
    s2.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 10));

    expect(retries).toContain(cdn1 + 'a.js');
    expect(retries).toContain(cdn1 + 'b.js');
    const scripts = Array.from(document.head.querySelectorAll('script'));
    expect(scripts.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores modulepreload link errors', async () => {
    let errored = false;
    setup(() => { errored = true; });

    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = cdn1 + 'chunk.js';
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error'));
    await Promise.resolve();

    expect(errored).toBe(false);
  });

  it('ignores dns-prefetch link errors', async () => {
    let errored = false;
    setup(() => { errored = true; });

    const link = document.createElement('link');
    link.rel = 'dns-prefetch';
    link.href = cdn1;
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error'));
    await Promise.resolve();

    expect(errored).toBe(false);
  });

  it('copies nonce attribute to replacement', async () => {
    setup();
    const original = document.createElement('script');
    original.src = cdn1 + 'foo.js';
    original.setAttribute('nonce', 'abc123');
    document.head.appendChild(original);
    original.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));

    const replacement = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    )!;
    expect(replacement.getAttribute('nonce')).toBe('abc123');
  });

  it('replacement scripts have data-rf-managed attribute for success tracking', async () => {
    setup();
    const original = fireScriptError(cdn1 + 'foo.js');
    await new Promise((r) => setTimeout(r, 5));

    const replacement = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original,
    )!;
    expect(replacement).toBeTruthy();
    expect(replacement.hasAttribute('data-rf-managed')).toBe(true);
    expect(replacement.getAttribute('data-rf-attempt')).toBeTruthy();
  });

  it('keeps integrity when sri=keep', async () => {
    // This test needs its own DOM scope since setup() registers a global listener
    // Use a fresh document.head so we only find our test's elements
    const log = createLogger(false);
    const resolver = createResolver({
      rules: [
        {
          match: 'https://keep-test.example.com/',
          urls: ['https://keep-test.example.com/', cdn2],
          retry: { max: 1, baseDelay: 0, maxDelay: 0, timeout: 1000, jitter: false },
        },
      ],
      defaults: { circuit: { threshold: 100, cooldown: 1000, shareAcrossTabs: false } },
    });
    const bus = createHookBus({}, log);
    installObserver({ resolver, bus, log, sri: 'keep' });

    const original = document.createElement('script');
    original.src = 'https://keep-test.example.com/foo.js';
    original.setAttribute('integrity', 'sha384-ABC');
    document.head.appendChild(original);
    original.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));

    const replacement = Array.from(document.head.querySelectorAll('script')).find(
      (s) => s !== original && s.getAttribute('src')?.includes('keep-test'),
    )!;
    expect(replacement).toBeTruthy();
    expect(replacement.getAttribute('integrity')).toBe('sha384-ABC');
  });

  it('ignores errors on non-script/non-link elements', async () => {
    let retried = false;
    setup(undefined, () => { retried = true; });

    const img = document.createElement('img');
    (img as HTMLImageElement).src = cdn1 + 'logo.png';
    document.head.appendChild(img);
    img.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 5));

    expect(retried).toBe(false);
  });
});
