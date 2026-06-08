import type {
  NormalizedServiceWorkerOptions,
  ResourceFallbackManifest,
  RuntimeConfig,
} from '../types';
import { normalizeServiceWorkerOptions } from '../service-worker';
import {
  cleanupOldFallbackCaches,
  createSwResolver,
  fetchWithFallback,
  postSwEventToClient,
  resolveSwResponseWithErrorBoundary,
  shouldHandleSwRequest,
} from './core';
import type { Resolver } from '../runtime/resolver';

interface SwConfigMessage {
  type: 'RF_SW_CONFIG';
  manifest: ResourceFallbackManifest;
  runtimeConfig: RuntimeConfig;
  serviceWorker: NormalizedServiceWorkerOptions;
}

interface ServiceWorkerLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  skipWaiting?: () => Promise<void>;
  clients?: {
    claim?: () => Promise<void>;
    get?: (id: string) => Promise<{ postMessage: (message: unknown) => void } | undefined>;
    matchAll?: (options?: {
      type?: string;
      includeUncontrolled?: boolean;
    }) => Promise<Array<{ postMessage: (message: unknown) => void }>>;
  };
  registration?: unknown;
}

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface MessageEventLike extends ExtendableEventLike {
  data?: unknown;
}

interface FetchEventLike {
  request: Request;
  clientId?: string;
  respondWith(response: Promise<Response>): void;
}

const sw = self as unknown as ServiceWorkerLike;
const corsVerifiedHosts = new Set<string>();

let manifest: ResourceFallbackManifest | null = null;
let runtimeConfig: RuntimeConfig | null = null;
let serviceWorkerOptions: NormalizedServiceWorkerOptions = normalizeServiceWorkerOptions(false);
let sharedResolver: Resolver | null = null;

function rebuildResolver(): void {
  if (manifest && runtimeConfig) {
    sharedResolver = createSwResolver(manifest, runtimeConfig);
  }
}

const preload = (self as unknown as { __RF_SW_PRELOAD__?: Partial<SwConfigMessage> })
  .__RF_SW_PRELOAD__;
if (preload?.manifest && preload.runtimeConfig) {
  manifest = preload.manifest;
  runtimeConfig = preload.runtimeConfig;
  serviceWorkerOptions = preload.serviceWorker || normalizeServiceWorkerOptions(true);
  rebuildResolver();
}

sw.addEventListener('install', (event: unknown) => {
  const ev = event as ExtendableEventLike;
  if (sw.skipWaiting) ev.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: unknown) => {
  const ev = event as ExtendableEventLike;
  ev.waitUntil(
    (async () => {
      if (manifest && typeof caches !== 'undefined') {
        await cleanupOldFallbackCaches(
          caches as unknown as Parameters<typeof cleanupOldFallbackCaches>[0],
          manifest,
        );
      }
      if (sw.clients?.claim) await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event: unknown) => {
  const ev = event as MessageEventLike;
  const data = ev.data as Partial<SwConfigMessage> | undefined;
  if (!data || data.type !== 'RF_SW_CONFIG' || !data.manifest || !data.runtimeConfig) return;
  manifest = data.manifest;
  runtimeConfig = data.runtimeConfig;
  serviceWorkerOptions = data.serviceWorker || normalizeServiceWorkerOptions(true);
  rebuildResolver();
});

sw.addEventListener('fetch', (event: unknown) => {
  const ev = event as FetchEventLike;
  if (!manifest || !runtimeConfig || !serviceWorkerOptions.enabled) return;
  if (!shouldHandleSwRequest(ev.request, manifest, serviceWorkerOptions)) return;

  let emittedError = false;
  const emitEvent = (type: 'retry' | 'fallback' | 'success' | 'error', payload: unknown) => {
    if (type === 'error') emittedError = true;
    void postSwEventToClient(sw.clients, ev.clientId, {
      type: 'RF_SW_EVENT',
      event: type,
      payload,
    });
  };
  // fallbackOnOpaque enables cors probe: try cors first to get inspectable
  // status codes, fall back to no-cors when CORS is unavailable.
  const upgradeCors = serviceWorkerOptions.fallbackOnOpaque === true;
  const response = fetchWithFallback(ev.request, {
    manifest,
    runtimeConfig,
    resolver: sharedResolver ?? undefined,
    cache: serviceWorkerOptions.cache,
    // HTTP error detection is handled by the cors-upgrade fetcher (cors mode
    // exposes real status codes). Core sees false so that an opaque response
    // from the no-cors fallback path is accepted as "server reachable".
    fallbackOnOpaque: false,
    caches:
      typeof caches === 'undefined'
        ? undefined
        : (caches as unknown as Parameters<typeof fetchWithFallback>[1]['caches']),
    fetcher: async (request) => {
      const req = request as Request;
      if (upgradeCors && req.mode === 'no-cors') {
        const host = new URL(req.url).host;
        if (corsVerifiedHosts.has(host)) {
          return fetch(new Request(req, { mode: 'cors', credentials: 'omit' }));
        }
        try {
          const res = await fetch(new Request(req, { mode: 'cors', credentials: 'omit' }));
          corsVerifiedHosts.add(host);
          return res;
        } catch {
          return fetch(req);
        }
      }
      return fetch(req);
    },
    emit: emitEvent,
  });
  ev.respondWith(
    resolveSwResponseWithErrorBoundary(
      ev.request,
      response,
      (_type, payload) => emitEvent('error', payload),
      () => emittedError,
    ),
  );
});
