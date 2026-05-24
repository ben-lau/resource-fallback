import { describe, expect, it, vi } from 'vitest';

import {
  cleanupOldFallbackCaches,
  createFallbackCacheName,
  fetchWithFallback,
  postSwEventToClient,
  resolveSwResponseWithErrorBoundary,
  shouldHandleSwRequest,
} from '../packages/core/src/sw/core';
import type { ResourceFallbackManifest } from '../packages/core/src/types';

const cdn = 'https://cdn.example.com/';
const origin = 'https://origin.example.com/';

const manifest: ResourceFallbackManifest = {
  version: 'rf-test',
  rules: [
    {
      match: cdn,
      urls: [cdn, origin],
      retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
    },
  ],
  assets: [
    { url: cdn + 'assets/app.js', type: 'script', owner: 'page' },
    { url: cdn + 'assets/app.css', type: 'style', owner: 'page' },
    { url: cdn + 'assets/logo.png', type: 'image', owner: 'sw' },
    { url: cdn + 'assets/font.woff2', type: 'font', owner: 'sw' },
  ],
};

function requestLike(
  url: string,
  destination: RequestDestination,
  referrer = '',
): Request & { destination: RequestDestination; referrer: string } {
  return {
    url,
    method: 'GET',
    destination,
    referrer,
  } as Request & { destination: RequestDestination; referrer: string };
}

function createMemoryCaches(seed?: Response) {
  const store = new Map<string, Response>();
  if (seed) store.set(cdn + 'assets/logo.png', seed);
  return {
    store,
    async open() {
      return {
        match: async (request: Request) => store.get(request.url),
        put: async (request: Request, response: Response) => {
          store.set(request.url, response);
        },
      };
    },
    async keys() {
      return [createFallbackCacheName(manifest)];
    },
    async delete() {
      return true;
    },
    async match(request: Request) {
      return store.get(request.url);
    },
  };
}

describe('sw core', () => {
  it('handles only sw-owned subresources and controlled css imports', () => {
    expect(shouldHandleSwRequest(requestLike(cdn + 'assets/logo.png', 'image'), manifest, {
      includeStyleImports: true,
    })).toBe(true);
    expect(shouldHandleSwRequest(requestLike(cdn + 'assets/font.woff2', 'font'), manifest, {
      includeStyleImports: true,
    })).toBe(true);
    expect(shouldHandleSwRequest(requestLike(cdn + 'assets/app.js', 'script'), manifest, {
      includeStyleImports: true,
    })).toBe(false);
    expect(shouldHandleSwRequest(requestLike(cdn + 'assets/import.css', 'style', cdn + 'assets/app.css'), manifest, {
      includeStyleImports: true,
    })).toBe(true);
    expect(shouldHandleSwRequest(requestLike(cdn + 'assets/import.css', 'style'), manifest, {
      includeStyleImports: true,
    })).toBe(false);
  });

  it('falls back over the network and caches only the fallback success response', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      if (request.url.startsWith(origin)) return new Response('fallback', { status: 200 });
      throw new TypeError('network failed');
    });
    const caches = createMemoryCaches();
    const events: string[] = [];

    const response = await fetchWithFallback(requestLike(cdn + 'assets/logo.png', 'image'), {
      manifest,
      cache: { enabled: true, cacheOpaque: false },
      fetcher,
      caches,
      emit: (type, event) => events.push(type + ':' + ('to' in event ? event.to : event.url)),
    });

    expect(await response.text()).toBe('fallback');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(events).toContain('fallback:' + origin + 'assets/logo.png');
    expect(await caches.store.get(cdn + 'assets/logo.png')?.text()).toBe('fallback');
  });

  it('reads the current manifest cache only after the network chain is exhausted', async () => {
    const cached = new Response('cached-fallback', { status: 200 });
    const caches = createMemoryCaches(cached);
    const fetcher = vi.fn(async () => {
      throw new TypeError('offline');
    });

    const response = await fetchWithFallback(requestLike(cdn + 'assets/logo.png', 'image'), {
      manifest,
      cache: { enabled: true, cacheOpaque: false },
      fetcher,
      caches,
      emit: () => {},
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await response.text()).toBe('cached-fallback');
  });

  it('keeps Request instances when cloning to fallback URLs', async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (request: Request) => {
      expect(request).toBeInstanceOf(Request);
      seen.push(request.url);
      if (request.url.startsWith(origin)) return new Response('fallback', { status: 200 });
      throw new TypeError('network failed');
    });

    await fetchWithFallback(new Request(cdn + 'assets/logo.png'), {
      manifest,
      cache: { enabled: false, cacheOpaque: false },
      fetcher,
      emit: () => {},
    });

    expect(seen).toEqual([cdn + 'assets/logo.png', origin + 'assets/logo.png']);
  });

  it('can treat cross-origin opaque responses as fallback failures', async () => {
    const opaque = new Response('', { status: 200 });
    Object.defineProperty(opaque, 'type', { value: 'opaque' });
    const fetcher = vi.fn(async (request: Request) => {
      if (request.url.startsWith(origin)) return new Response('origin-image', { status: 200 });
      return opaque;
    });

    const response = await fetchWithFallback(new Request(cdn + 'assets/logo.png'), {
      manifest,
      cache: { enabled: false, cacheOpaque: false },
      fallbackOnOpaque: true,
      fetcher,
      emit: () => {},
    });

    expect(await response.text()).toBe('origin-image');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('posts sw events only to the fetch client when clientId is available', async () => {
    const target = { postMessage: vi.fn() };
    const other = { postMessage: vi.fn() };
    const clients = {
      get: vi.fn(async (id: string) => (id === 'target-client' ? target : undefined)),
      matchAll: vi.fn(async () => [target, other]),
    };

    await postSwEventToClient(clients, 'target-client', { type: 'RF_SW_EVENT' });

    expect(target.postMessage).toHaveBeenCalledWith({ type: 'RF_SW_EVENT' });
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(clients.matchAll).not.toHaveBeenCalled();
  });

  it('falls back to broadcasting sw events only when no clientId is available', async () => {
    const first = { postMessage: vi.fn() };
    const second = { postMessage: vi.fn() };
    const clients = {
      matchAll: vi.fn(async () => [first, second]),
    };

    await postSwEventToClient(clients, '', { type: 'RF_SW_EVENT' });

    expect(first.postMessage).toHaveBeenCalledWith({ type: 'RF_SW_EVENT' });
    expect(second.postMessage).toHaveBeenCalledWith({ type: 'RF_SW_EVENT' });
  });

  it('turns final sw fetch rejections into Response.error and emits one error event', async () => {
    const events: Array<{ type: string; url: string; reason: unknown }> = [];

    const response = await resolveSwResponseWithErrorBoundary(
      requestLike(cdn + 'assets/logo.png', 'image'),
      Promise.reject(new TypeError('boom')),
      (type, event) => events.push({ type, url: event.url, reason: event.reason }),
      () => false,
    );

    expect(response.type).toBe('error');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', url: cdn + 'assets/logo.png' });
    expect(events[0].reason).toBeInstanceOf(TypeError);
  });

  it('does not duplicate error events already emitted by fetchWithFallback', async () => {
    const events: string[] = [];

    await resolveSwResponseWithErrorBoundary(
      requestLike(cdn + 'assets/logo.png', 'image'),
      Promise.reject(new TypeError('boom')),
      (type) => events.push(type),
      () => true,
    );

    expect(events).toEqual([]);
  });

  it('cleans fallback caches that do not match the current manifest version', async () => {
    const deleted: string[] = [];
    const current = createFallbackCacheName(manifest);
    const old = 'resource-fallback-rf-old';

    await cleanupOldFallbackCaches({
      async open() {
        throw new Error('not used');
      },
      async keys() {
        return [current, old, 'other-cache'];
      },
      async delete(name: string) {
        deleted.push(name);
        return true;
      },
    }, manifest);

    expect(deleted).toEqual([old]);
  });

  it('keeps sw circuit breaker in memory even when page defaults share across tabs', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    await expect(fetchWithFallback(requestLike(cdn + 'assets/logo.png', 'image'), {
      manifest,
      runtimeConfig: {
        defaults: {
          circuit: {
            threshold: 1,
            shareAcrossTabs: true,
          },
        },
      },
      cache: { enabled: false, cacheOpaque: false },
      fetcher: vi.fn(async () => {
        throw new TypeError('offline');
      }),
      emit: () => {},
    })).rejects.toThrow('offline');

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
