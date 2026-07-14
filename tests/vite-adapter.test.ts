import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';
import { installViteAdapter, setViteImportModule } from '../packages/core/src/runtime/adapter-vite';
import { createResolver } from '../packages/core/src/runtime/resolver';

const cdn1 = 'https://cdn1.example.com/';
const cdn2 = 'https://cdn2.example.com/';
const origin = '/';

interface RfGlobal {
  url?: (filename: string) => string;
  load?: (filename: string) => Promise<unknown>;
  [key: string]: unknown;
}

function getGlobal(): RfGlobal {
  const w = window as unknown as Record<string, unknown>;
  return (w.__RF__ || {}) as RfGlobal;
}

function setup(opts?: {
  retryMax?: number;
  circuitThreshold?: number;
  onRetry?: (e: unknown) => void;
  onFallback?: (e: unknown) => void;
  onError?: (e: unknown) => void;
  onSuccess?: (e: unknown) => void;
}) {
  const log = createLogger(false);
  const resolver = createResolver({
    rules: [
      {
        base: cdn1,
        urls: [cdn1, cdn2, origin],
        retry: {
          max: opts?.retryMax ?? 1,
          baseDelay: 0,
          maxDelay: 0,
          jitter: false,
        },
      },
    ],
    defaults: {
      circuit: {
        threshold: opts?.circuitThreshold ?? 100,
        cooldown: 60_000,
        shareAcrossTabs: false,
      },
    },
  });
  const bus = createHookBus(
    {
      onRetry: opts?.onRetry as ((e: { url: string; attempt: number }) => void) | undefined,
      onFallback: opts?.onFallback as
        | ((e: { from: string; to: string; reason?: unknown }) => void)
        | undefined,
      onError: opts?.onError as ((e: { url: string; reason?: unknown }) => void) | undefined,
      onSuccess: opts?.onSuccess as ((e: { url: string; attempts: number }) => void) | undefined,
    },
    log,
  );
  installViteAdapter({ resolver, bus, log });
  return { resolver, bus, log };
}

describe('vite-adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    (window as unknown as Record<string, unknown>).__RF__ = {};
    setViteImportModule(null);
  });

  afterEach(() => {
    setViteImportModule(null);
    delete (window as unknown as Record<string, unknown>).__RF__;
  });

  describe('__RF__.url', () => {
    it('returns resolveBuiltUrl result for a filename', () => {
      setup();
      const g = getGlobal();
      expect(g.url!('assets/chunk.js')).toBe(cdn1 + 'assets/chunk.js');
    });

    it('returns filename as-is when no rules', () => {
      const log = createLogger(false);
      const resolver = createResolver({ rules: [] });
      const bus = createHookBus({}, log);
      installViteAdapter({ resolver, bus, log });
      expect(getGlobal().url!('random-file.js')).toBe('random-file.js');
    });
  });

  describe('__RF__.load', () => {
    it('succeeds on first attempt without cache-busting', async () => {
      const successes: string[] = [];
      const importMock = vi.fn().mockResolvedValue({ default: 'module-content' });
      setViteImportModule(importMock);
      setup({ onSuccess: (e) => successes.push((e as { url: string }).url) });

      const g = getGlobal();
      const result = await g.load!('assets/chunk.js');
      expect(result).toEqual({ default: 'module-content' });
      expect(importMock).toHaveBeenCalledTimes(1);
      const calledUrl = importMock.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('__rf=');
    });

    it('adds cache-bust param on retry attempts', async () => {
      let callCount = 0;
      const importMock = vi.fn().mockImplementation((_url: string) => {
        callCount++;
        if (callCount <= 1) return Promise.reject(new Error('fail'));
        return Promise.resolve({ default: 'ok' });
      });
      setViteImportModule(importMock);
      setup({ retryMax: 2 });

      const g = getGlobal();
      await g.load!('assets/chunk.js');

      expect(importMock).toHaveBeenCalledTimes(2);
      const secondUrl = importMock.mock.calls[1][0] as string;
      expect(secondUrl).toContain('__rf=');
    });

    it('emits retry and fallback events through the chain', async () => {
      let callCount = 0;
      const events: string[] = [];
      const importMock = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.reject(new Error('fail'));
        return Promise.resolve({ default: 'ok' });
      });
      setViteImportModule(importMock);
      setup({
        retryMax: 1,
        onRetry: (e) => events.push('retry:' + (e as { url: string }).url),
        onFallback: (e) => events.push('fallback:' + (e as { to: string }).to),
        onSuccess: (e) => events.push('success:' + (e as { url: string }).url),
      });

      const g = getGlobal();
      await g.load!('assets/chunk.js');

      expect(events).toContain('retry:' + cdn1 + 'assets/chunk.js');
      expect(events).toContain('fallback:' + cdn2 + 'assets/chunk.js');
    });

    it('throws after all urls exhausted', async () => {
      const events: string[] = [];
      const importMock = vi.fn().mockRejectedValue(new Error('always fail'));
      setViteImportModule(importMock);
      setup({
        retryMax: 0,
        onError: (e) => events.push('error:' + (e as { url: string }).url),
      });

      const g = getGlobal();
      await expect(g.load!('assets/chunk.js')).rejects.toThrow('always fail');
      expect(events.some((e) => e.startsWith('error:'))).toBe(true);
    });
  });

  describe('vite:preloadError', () => {
    function dispatchPreloadError(payload: unknown): Event {
      const evt = new Event('vite:preloadError', { cancelable: true });
      (evt as Event & { payload?: unknown }).payload = payload;
      window.dispatchEvent(evt);
      return evt;
    }

    it('calls preventDefault so __vitePreload does not throw', () => {
      setup();
      const evt = dispatchPreloadError(
        new Error('Unable to preload CSS for https://cdn1.example.com/assets/chunk.css'),
      );
      expect(evt.defaultPrevented).toBe(true);
    });

    it('records failure from Error message containing URL', () => {
      const events: string[] = [];
      setup({
        onFallback: (e) => events.push('fallback:' + (e as { from: string }).from),
      });

      dispatchPreloadError(
        new Error('Unable to preload CSS for https://cdn1.example.com/assets/chunk.css'),
      );

      expect(events.some((e) => e.includes('cdn1.example.com'))).toBe(true);
    });

    it('handles preloadError with target.src', () => {
      const events: string[] = [];
      setup({
        onFallback: (e) => events.push('fallback:' + (e as { from: string }).from),
      });

      dispatchPreloadError({ target: { src: cdn1 + 'assets/chunk.js' } });

      expect(events).toContain('fallback:' + cdn1 + 'assets/chunk.js');
    });

    it('warns when URL cannot be extracted but still prevents default', () => {
      setup();
      const evt = dispatchPreloadError(null);
      expect(evt.defaultPrevented).toBe(true);
    });
  });
});
