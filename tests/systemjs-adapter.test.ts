import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';
import { installObserver } from '../packages/core/src/runtime/observer';
import { installSystemJSAdapter, systemjsManagedUrls } from '../packages/core/src/runtime/adapter-systemjs';
import { createResolver } from '../packages/core/src/runtime/resolver';

const cdn1 = 'https://cdn1.example.com/';
const cdn2 = 'https://cdn2.example.com/';
const origin = 'https://origin.example.com/';

type InstantiateResult = [deps: string[], declare: unknown];

function createFakeSystem(behavior: {
  shouldFail?: (url: string) => boolean;
  registration?: InstantiateResult;
}) {
  const registration: InstantiateResult = behavior.registration ?? [[], () => ({})];
  const scriptRequests: string[] = [];

  function SystemConstructor() {}
  SystemConstructor.prototype = {
    instantiate(url: string) {
      scriptRequests.push(url);
      if (behavior.shouldFail?.(url)) {
        return Promise.reject(new Error('load failed: ' + url));
      }
      return Promise.resolve(registration);
    },
    getRegister() {
      return registration;
    },
  };

  const proto = SystemConstructor.prototype as {
    instantiate: (url: string, parentUrl?: string) => Promise<InstantiateResult>;
    getRegister: (url?: string) => InstantiateResult;
    __rfHooked?: boolean;
  };

  const system = Object.create(proto);
  system.constructor = SystemConstructor;
  system.import = (id: string) => proto.instantiate(id);
  system.getRegister = () => registration;

  return { system, proto, scriptRequests, SystemConstructor };
}

function setup(opts?: {
  onRetry?: (e: unknown) => void;
  onFallback?: (e: unknown) => void;
  onError?: (e: unknown) => void;
  onSuccess?: (e: unknown) => void;
  retryMax?: number;
  circuitThreshold?: number;
}) {
  const log = createLogger(false);
  const resolver = createResolver({
    rules: [
      {
        match: cdn1,
        urls: [cdn1, cdn2, origin],
        retry: { max: opts?.retryMax ?? 1, baseDelay: 0, maxDelay: 0, timeout: 1000, jitter: false },
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
      onFallback: opts?.onFallback as ((e: { from: string; to: string; reason?: unknown }) => void) | undefined,
      onError: opts?.onError as ((e: { url: string; reason?: unknown }) => void) | undefined,
      onSuccess: opts?.onSuccess as ((e: { url: string; attempts: number }) => void) | undefined,
    },
    log,
  );
  return { resolver, bus, log };
}

describe('systemjs-adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    systemjsManagedUrls.clear();
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).System;
  });

  afterEach(() => {
    systemjsManagedUrls.clear();
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).System;
  });

  describe('hookInstantiate (delegation)', () => {
    it('delegates to origInstantiate and returns registration on success', async () => {
      const deps = setup();
      const { system, proto, scriptRequests } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      const result = await proto.instantiate(cdn1 + 'chunk.js');
      expect(result).toEqual([[], expect.any(Function)]);
      expect(scriptRequests).toContain(cdn1 + 'chunk.js');
    });

    it('retries via origInstantiate on failure then succeeds', async () => {
      let failCount = 0;
      const events: string[] = [];
      const deps = setup({
        retryMax: 2,
        onRetry: () => events.push('retry'),
        onSuccess: () => events.push('success'),
      });
      const { system, proto, scriptRequests } = createFakeSystem({
        shouldFail: (url) => {
          if (url.startsWith(cdn1)) {
            failCount++;
            return failCount <= 1;
          }
          return false;
        },
      });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      const result = await proto.instantiate(cdn1 + 'chunk.js');
      expect(result).toBeTruthy();
      expect(scriptRequests.filter((u) => u.startsWith(cdn1))).toHaveLength(2);
      expect(events).toContain('retry');
      expect(events).toContain('success');
    });

    it('walks the full fallback chain: cdn1 -> cdn2 -> origin -> giveup', async () => {
      const events: string[] = [];
      const deps = setup({
        retryMax: 0,
        onRetry: (e) => events.push('retry:' + (e as { url: string }).url),
        onFallback: (e) => events.push('fallback:' + (e as { to: string }).to),
        onError: (e) => events.push('error:' + (e as { url: string }).url),
      });
      const { system, proto, scriptRequests } = createFakeSystem({
        shouldFail: () => true,
      });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      await expect(proto.instantiate(cdn1 + 'chunk.js')).rejects.toThrow();

      expect(scriptRequests).toContain(cdn1 + 'chunk.js');
      expect(scriptRequests).toContain(cdn2 + 'chunk.js');
      expect(scriptRequests).toContain(origin + 'chunk.js');
      expect(events).toContain('fallback:' + cdn2 + 'chunk.js');
      expect(events).toContain('fallback:' + origin + 'chunk.js');
      expect(events.some((e) => e.startsWith('error:'))).toBe(true);
    });

    it('skips unmatched URLs — delegates directly without retry logic', async () => {
      const events: string[] = [];
      const deps = setup({ onRetry: () => events.push('retry') });
      const { system, proto, scriptRequests } = createFakeSystem({
        shouldFail: () => false,
      });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      const result = await proto.instantiate('https://other.example.com/lib.js');
      expect(result).toBeTruthy();
      expect(scriptRequests).toContain('https://other.example.com/lib.js');
      expect(events).toHaveLength(0);
    });

    it('does not double-hook when called twice (__rfHooked guard)', async () => {
      const deps = setup();
      const { system, proto } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));
      expect(proto.__rfHooked).toBe(true);

      // Save reference to the hooked instantiate
      const hookedInstantiate = proto.instantiate;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      // Should be the same function (not wrapped again)
      expect(proto.instantiate).toBe(hookedInstantiate);
    });
  });

  describe('systemjsManagedUrls (observer coordination)', () => {
    it('cleans URL from managedUrls after success', async () => {
      const deps = setup();
      const { system, proto } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      await proto.instantiate(cdn1 + 'chunk.js');
      expect(systemjsManagedUrls.has(cdn1 + 'chunk.js')).toBe(false);
    });

    it('cleans URL from managedUrls after giveup', async () => {
      const deps = setup({ retryMax: 0 });
      const { system, proto } = createFakeSystem({ shouldFail: () => true });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      try {
        await proto.instantiate(cdn1 + 'chunk.js');
      } catch {
        // expected
      }
      expect(systemjsManagedUrls.has(cdn1 + 'chunk.js')).toBe(false);
      expect(systemjsManagedUrls.has(cdn2 + 'chunk.js')).toBe(false);
      expect(systemjsManagedUrls.has(origin + 'chunk.js')).toBe(false);
    });

    it('observer skips URLs present in systemjsManagedUrls', async () => {
      const deps = setup();
      installObserver({ resolver: deps.resolver, bus: deps.bus, log: deps.log, sri: 'strip' });

      systemjsManagedUrls.add(cdn1 + 'test.js');

      const s = document.createElement('script');
      s.src = cdn1 + 'test.js';
      document.head.appendChild(s);
      s.dispatchEvent(new Event('error'));
      await new Promise((r) => setTimeout(r, 10));

      // Observer should NOT have replaced the script
      const scripts = Array.from(document.head.querySelectorAll('script'));
      expect(scripts).toHaveLength(1);
      expect(scripts[0]).toBe(s);

      systemjsManagedUrls.delete(cdn1 + 'test.js');
    });
  });

  describe('polling for System global', () => {
    it('hooks System when it becomes available later', async () => {
      const deps = setup();
      installSystemJSAdapter(deps);

      await new Promise((r) => setTimeout(r, 30));

      const { system, proto } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      await new Promise((r) => setTimeout(r, 250));
      expect(proto.__rfHooked).toBe(true);
    });
  });

  describe('replayDeferredEntries', () => {
    it('replays script[data-src] elements after System is hooked', async () => {
      const importedSrcs: string[] = [];
      const { system, proto } = createFakeSystem({ shouldFail: () => false });
      system.import = (id: string) => {
        importedSrcs.push(id);
        return Promise.resolve();
      };

      const entry = document.createElement('script');
      entry.setAttribute('data-src', cdn1 + 'legacy-entry.js');
      document.body.appendChild(entry);

      const deps = setup();
      (window as unknown as Record<string, unknown>).System = system;
      installSystemJSAdapter(deps);

      await new Promise((r) => setTimeout(r, 150));

      expect(importedSrcs).toContain(cdn1 + 'legacy-entry.js');
      expect(proto.__rfHooked).toBe(true);

      document.body.removeChild(entry);
    });

    it('skips script[data-src] with empty src', async () => {
      const importedSrcs: string[] = [];
      const { system } = createFakeSystem({ shouldFail: () => false });
      system.import = (id: string) => {
        importedSrcs.push(id);
        return Promise.resolve();
      };

      const entry = document.createElement('script');
      entry.setAttribute('data-src', '');
      document.body.appendChild(entry);

      const deps = setup();
      (window as unknown as Record<string, unknown>).System = system;
      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      expect(importedSrcs).toHaveLength(0);
      document.body.removeChild(entry);
    });
  });

  describe('edge cases', () => {
    it('records success to resolver on successful load', async () => {
      const successes: string[] = [];
      const deps = setup({
        onSuccess: (e) => successes.push((e as { url: string }).url),
      });
      const { system, proto } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      await proto.instantiate(cdn1 + 'ok.js');
      expect(successes).toContain(cdn1 + 'ok.js');
    });

    it('correctly propagates the original error on giveup', async () => {
      const deps = setup({ retryMax: 0 });
      const { system, proto } = createFakeSystem({ shouldFail: () => true });
      (window as unknown as Record<string, unknown>).System = system;

      installSystemJSAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      try {
        await proto.instantiate(cdn1 + 'fail.js');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('load failed');
      }
    });

    it('handles System without proper constructor gracefully', () => {
      (window as unknown as Record<string, unknown>).System = { version: '1.0' };
      const deps = setup();
      expect(() => installSystemJSAdapter(deps)).not.toThrow();
    });

    it('handles System.constructor.prototype without instantiate gracefully', () => {
      function BadConstructor() {}
      BadConstructor.prototype = {};
      const badSystem = Object.create(BadConstructor.prototype);
      badSystem.constructor = BadConstructor;
      (window as unknown as Record<string, unknown>).System = badSystem;
      const deps = setup();
      expect(() => installSystemJSAdapter(deps)).not.toThrow();
    });
  });
});
