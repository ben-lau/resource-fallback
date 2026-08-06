import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type CircuitRegistry,
} from '../packages/core/src/internal/coordinator';
import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';
import { urlResourceKey } from '../packages/core/src/internal/resource-identity';
import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';
import { installObserver } from '../packages/core/src/runtime/observer';
import { installSystemJSAdapter } from '../packages/core/src/runtime/adapter-systemjs';

const cdn1 = 'https://cdn1.example.com/';
const cdn2 = 'https://cdn2.example.com/';
const origin = 'https://origin.example.com/';

let disposeFns: Array<() => void> = [];

function createCircuit(): CircuitRegistry {
  return {
    isOpen: () => false,
    recordFailure: () => {},
    recordSuccess: () => {},
    dispose: () => {},
  };
}

type InstantiateResult = [deps: string[], declare: unknown];

function createFakeSystem(behavior: {
  shouldFail?: (url: string) => boolean;
  registration?: InstantiateResult;
}) {
  const registration: InstantiateResult = behavior.registration ?? [[], () => ({})];
  const scriptRequests: string[] = [];
  const instantiateCalls: Array<{ url: string; parentUrl?: string }> = [];

  function SystemConstructor() {}
  SystemConstructor.prototype = {
    instantiate(url: string, parentUrl?: string) {
      scriptRequests.push(url);
      instantiateCalls.push({ url, parentUrl });
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

  return { system, proto, scriptRequests, instantiateCalls, SystemConstructor };
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
  const config = compileRuntimeConfig({
    rules: [
      {
        base: cdn1,
        urls: [cdn1, cdn2, origin],
        retry: { max: opts?.retryMax ?? 1, baseDelay: 0, maxDelay: 0, jitter: false },
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
  const coordinator = createRecoveryCoordinator({ config, bus, circuit: createCircuit() });
  return { config, coordinator, ownership: createOwnershipRegistry(), bus, log };
}

function installAdapter(deps: ReturnType<typeof setup>) {
  const control = installSystemJSAdapter(deps);
  disposeFns.push(() => control.dispose());
  return control;
}

describe('systemjs-adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    disposeFns = [];
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).System;
  });

  afterEach(() => {
    for (const dispose of disposeFns) dispose();
    disposeFns = [];
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).System;
  });

  describe('hookInstantiate (delegation)', () => {
    it('delegates to origInstantiate and returns registration on success', async () => {
      const deps = setup();
      const { system, proto, scriptRequests } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      const result = await proto.instantiate(cdn1 + 'chunk.js');
      expect(result).toEqual([[], expect.any(Function)]);
      expect(scriptRequests).toContain(cdn1 + 'chunk.js');
    });

    it('forwards the original parentUrl through acquired and denied paths', async () => {
      const deps = setup();
      const { system, proto, instantiateCalls } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      const acquiredUrl = cdn1 + 'acquired.js';
      const acquiredParentUrl = 'https://app.example.com/acquired-parent.js';
      await proto.instantiate(acquiredUrl, acquiredParentUrl);

      const deniedUrl = cdn1 + 'denied.js';
      const deniedParentUrl = 'https://app.example.com/denied-parent.js';
      const admission = deps.ownership.admit('observer', urlResourceKey(deniedUrl));
      expect(admission.kind).toBe('acquired');

      try {
        await proto.instantiate(deniedUrl, deniedParentUrl);
      } finally {
        if (admission.kind === 'acquired') admission.lease.release();
      }

      expect(instantiateCalls).toEqual([
        { url: acquiredUrl, parentUrl: acquiredParentUrl },
        { url: deniedUrl, parentUrl: deniedParentUrl },
      ]);
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

      installAdapter(deps);
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

      installAdapter(deps);
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

      installAdapter(deps);
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

      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));
      expect(proto.__rfHooked).toBe(true);

      // Save reference to the hooked instantiate
      const hookedInstantiate = proto.instantiate;

      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      // Should be the same function (not wrapped again)
      expect(proto.instantiate).toBe(hookedInstantiate);
    });
  });

  describe('ownership coordination', () => {
    it('releases the URL lease after success', async () => {
      const deps = setup();
      const { system, proto } = createFakeSystem({ shouldFail: () => false });
      (window as unknown as Record<string, unknown>).System = system;

      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      await proto.instantiate(cdn1 + 'chunk.js');
      expect(deps.ownership.isClaimed(urlResourceKey(cdn1 + 'chunk.js'))).toBe(false);
    });

    it('releases every candidate lease after giveup', async () => {
      const deps = setup({ retryMax: 0 });
      const { system, proto } = createFakeSystem({ shouldFail: () => true });
      (window as unknown as Record<string, unknown>).System = system;

      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      try {
        await proto.instantiate(cdn1 + 'chunk.js');
      } catch {
        // expected
      }
      expect(deps.ownership.isClaimed(urlResourceKey(cdn1 + 'chunk.js'))).toBe(false);
      expect(deps.ownership.isClaimed(urlResourceKey(cdn2 + 'chunk.js'))).toBe(false);
      expect(deps.ownership.isClaimed(urlResourceKey(origin + 'chunk.js'))).toBe(false);
    });

    it('observer skips a URL leased by SystemJS', async () => {
      const deps = setup();
      const observerControl = installObserver({
        coordinator: deps.coordinator,
        ownership: deps.ownership,
        log: deps.log,
        sri: 'strip',
      });
      disposeFns.push(() => observerControl.dispose());
      const admission = deps.ownership.admit('systemjs', urlResourceKey(cdn1 + 'test.js'));
      expect(admission.kind).toBe('acquired');

      const s = document.createElement('script');
      s.src = cdn1 + 'test.js';
      document.head.appendChild(s);
      s.dispatchEvent(new Event('error'));
      await new Promise((r) => setTimeout(r, 10));

      // Observer should NOT have replaced the script
      const scripts = Array.from(document.head.querySelectorAll('script'));
      expect(scripts).toHaveLength(1);
      expect(scripts[0]).toBe(s);
      if (admission.kind === 'acquired') admission.lease.release();
    });
  });

  describe('polling for System global', () => {
    it('hooks System when it becomes available later', async () => {
      const deps = setup();
      installAdapter(deps);

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
      installAdapter(deps);

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
      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      expect(importedSrcs).toHaveLength(0);
      document.body.removeChild(entry);
    });
  });

  describe('edge cases', () => {
    it('emits success only after a SystemJS recovery', async () => {
      const successes: string[] = [];
      const deps = setup({
        onSuccess: (e) => successes.push((e as { url: string }).url),
      });
      let attempts = 0;
      const { system, proto } = createFakeSystem({
        shouldFail: () => {
          attempts++;
          return attempts === 1;
        },
      });
      (window as unknown as Record<string, unknown>).System = system;

      installAdapter(deps);
      await new Promise((r) => setTimeout(r, 100));

      await proto.instantiate(cdn1 + 'ok.js');
      expect(successes).toContain(cdn1 + 'ok.js');
    });

    it('correctly propagates the original error on giveup', async () => {
      const deps = setup({ retryMax: 0 });
      const { system, proto } = createFakeSystem({ shouldFail: () => true });
      (window as unknown as Record<string, unknown>).System = system;

      installAdapter(deps);
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
      expect(() => installAdapter(deps)).not.toThrow();
    });

    it('handles System.constructor.prototype without instantiate gracefully', () => {
      function BadConstructor() {}
      BadConstructor.prototype = {};
      const badSystem = Object.create(BadConstructor.prototype);
      badSystem.constructor = BadConstructor;
      (window as unknown as Record<string, unknown>).System = badSystem;
      const deps = setup();
      expect(() => installAdapter(deps)).not.toThrow();
    });
  });
});
