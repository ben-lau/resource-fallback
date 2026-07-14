import { afterEach, describe, expect, it, vi } from 'vitest';

import { installSwAdapter } from '../packages/core/src/runtime/adapter-sw';
import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';
import type { ResourceFallbackManifest } from '../packages/core/src/types';

const manifest: ResourceFallbackManifest = {
  version: 'rf-test',
  rules: [{ base: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/'] }],
  assets: [{ url: 'https://cdn.example.com/logo.png', type: 'image', owner: 'sw' }],
};

describe('sw adapter', () => {
  const originalNavigator = window.navigator;

  afterEach(() => {
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  it('does not register when serviceWorker is not enabled', () => {
    const register = vi.fn();
    mockServiceWorkerNavigator(register);

    installSwAdapter({
      config: {
        rules: manifest.rules,
        serviceWorker: false,
        serviceWorkerManifest: manifest,
      },
      bus: createHookBus({}, createLogger(false)),
      log: createLogger(false),
    });

    expect(register).not.toHaveBeenCalled();
  });

  it('unregisters stale SW when serviceWorker is disabled', async () => {
    const unregister = vi.fn(async () => true);
    const getRegistrations = vi.fn(async () => [
      { active: { scriptURL: 'https://example.com/rf-sw.js', postMessage: vi.fn() }, unregister },
      {
        active: { scriptURL: 'https://example.com/other-worker.js', postMessage: vi.fn() },
        unregister: vi.fn(),
      },
    ]);
    Object.defineProperty(window, 'navigator', {
      value: {
        serviceWorker: {
          register: vi.fn(),
          getRegistrations,
          addEventListener: () => {},
        },
      },
      configurable: true,
    });

    installSwAdapter({
      config: {
        rules: manifest.rules,
        serviceWorker: false,
        serviceWorkerManifest: manifest,
      },
      bus: createHookBus({}, createLogger(false)),
      log: createLogger(false),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(getRegistrations).toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('registers with normalized path/scope and posts manifest config', async () => {
    const postMessage = vi.fn();
    const register = vi.fn(async () => ({ active: { postMessage } }));
    mockServiceWorkerNavigator(register);

    installSwAdapter({
      config: {
        rules: manifest.rules,
        serviceWorker: true,
        serviceWorkerManifest: manifest,
      },
      bus: createHookBus({}, createLogger(false)),
      log: createLogger(false),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(register).toHaveBeenCalledWith('/rf-sw.js', { scope: '/', updateViaCache: 'none' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RF_SW_CONFIG',
        manifest,
        serviceWorker: expect.objectContaining({ enabled: true, path: '/rf-sw.js' }),
      }),
    );
  });

  it('bridges service worker messages to the existing hook bus', () => {
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    mockServiceWorkerNavigator(
      vi.fn(async () => ({ active: null })),
      (type, handler) => {
        if (type === 'message') messageHandler = handler as (event: MessageEvent) => void;
      },
    );
    const fallbacks: string[] = [];

    installSwAdapter({
      config: {
        rules: manifest.rules,
        serviceWorker: true,
        serviceWorkerManifest: manifest,
      },
      bus: createHookBus(
        { onFallback: (event) => fallbacks.push(String(event.to)) },
        createLogger(false),
      ),
      log: createLogger(false),
    });

    messageHandler?.({
      data: {
        type: 'RF_SW_EVENT',
        event: 'fallback',
        payload: { from: 'https://cdn.example.com/logo.png', to: '/logo.png' },
      },
    } as MessageEvent);

    expect(fallbacks).toEqual(['/logo.png']);
  });
});

function mockServiceWorkerNavigator(
  register: ReturnType<typeof vi.fn>,
  addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => void = () => {},
) {
  Object.defineProperty(window, 'navigator', {
    value: {
      serviceWorker: {
        register,
        addEventListener,
        ready: Promise.resolve({ active: undefined }),
      },
    },
    configurable: true,
  });
}
