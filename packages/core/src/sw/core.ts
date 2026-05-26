import type {
  ErrorEvent,
  FallbackRule,
  FallbackEvent,
  ResourceFallbackManifest,
  RetryEvent,
  RuntimeConfig,
  SuccessEvent,
} from '../types';
import { createResolver } from '../runtime/resolver';

type SwEventType = 'retry' | 'fallback' | 'success' | 'error';
type SwEvent = RetryEvent | FallbackEvent | SuccessEvent | ErrorEvent;

export interface SwRequestLike {
  url: string;
  method?: string;
  destination?: RequestDestination | '';
  referrer?: string;
}

export interface SwCacheOptions {
  enabled: boolean;
  cacheOpaque: boolean;
}

export interface CacheStorageLike {
  open(name: string): Promise<{
    match(request: SwRequestLike): Promise<Response | undefined>;
    put(request: SwRequestLike, response: Response): Promise<void>;
  }>;
  keys?(): Promise<string[]>;
  delete?(name: string): Promise<boolean>;
}

export interface SwClientLike {
  postMessage(message: unknown): void;
}

export interface SwClientsLike {
  get?(id: string): Promise<SwClientLike | undefined>;
  matchAll?(options?: { type?: string; includeUncontrolled?: boolean }): Promise<SwClientLike[]>;
}

export interface FetchWithFallbackOptions {
  manifest: ResourceFallbackManifest;
  runtimeConfig?: Omit<RuntimeConfig, 'rules'>;
  cache: SwCacheOptions;
  fallbackOnOpaque?: boolean;
  fetcher: (request: SwRequestLike) => Promise<Response>;
  caches?: CacheStorageLike;
  emit: (type: SwEventType, event: SwEvent) => void;
}

export function createFallbackCacheName(manifest: ResourceFallbackManifest): string {
  return 'resource-fallback-' + manifest.version;
}

export async function postSwEventToClient(
  clients: SwClientsLike | undefined,
  clientId: string | undefined,
  message: unknown,
): Promise<void> {
  if (!clients) return;
  if (clientId && clients.get) {
    const client = await clients.get(clientId);
    if (client) client.postMessage(message);
    return;
  }
  if (!clientId && clients.matchAll) {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      client.postMessage(message);
    }
  }
}

export async function resolveSwResponseWithErrorBoundary(
  request: SwRequestLike,
  response: Promise<Response>,
  emit: (type: 'error', event: ErrorEvent) => void,
  hasEmittedError: () => boolean,
): Promise<Response> {
  try {
    return await response;
  } catch (err) {
    if (!hasEmittedError()) {
      emit('error', { url: request.url, reason: err });
    }
    return Response.error();
  }
}

export function shouldHandleSwRequest(
  request: SwRequestLike,
  manifest: ResourceFallbackManifest,
  options: { includeStyleImports: boolean },
): boolean {
  if ((request.method || 'GET').toUpperCase() !== 'GET') return false;
  const destination = request.destination || '';
  if (destination === 'script' || destination === 'worker' || destination === 'sharedworker') {
    return false;
  }
  if (destination === 'image' || destination === 'font' || destination === 'video' || destination === 'audio' || destination === 'track') {
    return isSwOwnedAsset(request.url, manifest);
  }
  if (destination === 'style') {
    return !!options.includeStyleImports && isCssManifestReferrer(request.referrer || '', manifest);
  }
  return false;
}

export async function fetchWithFallback(
  request: SwRequestLike,
  options: FetchWithFallbackOptions,
): Promise<Response> {
  const resolver = createResolver({
    ...options.runtimeConfig,
    rules: forceMemoryCircuit(options.manifest.rules),
    defaults: {
      ...options.runtimeConfig?.defaults,
      circuit: {
        ...options.runtimeConfig?.defaults?.circuit,
        shareAcrossTabs: false,
      },
    },
  });
  let currentRequest = request;
  let attempt = 1;
  let isFallback = false;
  let usedFallback = false;
  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (;;) {
    try {
      const response = await options.fetcher(currentRequest);
      // Only enforce fallbackOnOpaque for the primary CDN (non-fallback).
      // Fallback CDNs without CORS return opaque responses that should be
      // accepted as best-effort; rejecting them would cascade endlessly.
      const effectiveFallbackOnOpaque = !isFallback && options.fallbackOnOpaque === true;
      if (isUsableNetworkResponse(response, currentRequest.url, effectiveFallbackOnOpaque)) {
        resolver.recordSuccess(currentRequest.url);
        options.emit('success', { url: currentRequest.url, attempts: attempt });
        if (usedFallback) await putFallbackCache(request, response, options);
        return response;
      }
      lastResponse = response;
      lastError = new Error('HTTP ' + response.status);
      // Opaque responses cannot improve on retry (same no-cors → same opaque);
      // skip directly to fallback by exhausting the retry budget.
      if (response.type === 'opaque' && effectiveFallbackOnOpaque) {
        attempt = Infinity;
      }
    } catch (err) {
      lastError = err;
    }

    const result = resolver.resolve(currentRequest.url, attempt, isFallback);
    if (result.kind === 'giveup') {
      options.emit('error', { url: currentRequest.url, reason: result.reason });
      const cached = await readFallbackCache(request, options);
      if (cached) return cached;
      if (lastResponse) return lastResponse;
      throw lastError instanceof Error ? lastError : new Error(String(lastError || 'resource failed'));
    }

    if (result.kind === 'retry') {
      options.emit('retry', { url: result.url, attempt: result.attempt });
      attempt = result.attempt + 1;
    } else {
      usedFallback = true;
      isFallback = true;
      attempt = 1;
      options.emit('fallback', { from: result.from, to: result.url, reason: 'retry-budget-exhausted' });
    }

    if (result.delay > 0) await new Promise((resolve) => setTimeout(resolve, result.delay));
    currentRequest = cloneRequestWithUrl(request, result.url);
  }
}

export async function cleanupOldFallbackCaches(
  caches: CacheStorageLike,
  manifest: ResourceFallbackManifest,
): Promise<void> {
  if (!caches.keys || !caches.delete) return;
  const current = createFallbackCacheName(manifest);
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.indexOf('resource-fallback-') === 0 && key !== current)
      .map((key) => caches.delete!(key)),
  );
}

function isSwOwnedAsset(url: string, manifest: ResourceFallbackManifest): boolean {
  return manifest.assets.some((asset) => asset.owner === 'sw' && sameUrl(asset.url, url));
}

function forceMemoryCircuit(rules: FallbackRule[]): FallbackRule[] {
  return rules.map((rule) => ({
    ...rule,
    circuit: {
      ...rule.circuit,
      shareAcrossTabs: false,
    },
  }));
}

function isCssManifestReferrer(referrer: string, manifest: ResourceFallbackManifest): boolean {
  if (!referrer) return false;
  return manifest.assets.some((asset) => asset.type === 'style' && sameUrl(asset.url, referrer));
}

function sameUrl(left: string, right: string): boolean {
  return stripHash(left) === stripHash(right);
}

function stripHash(url: string): string {
  const idx = url.indexOf('#');
  return idx === -1 ? url : url.slice(0, idx);
}

function isUsableNetworkResponse(response: Response, url: string, fallbackOnOpaque: boolean): boolean {
  if (response.type === 'opaque') return !(fallbackOnOpaque && !isSameOriginUrl(url));
  return response.ok;
}

function isSameOriginUrl(url: string): boolean {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    return new URL(url, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

async function putFallbackCache(
  originalRequest: SwRequestLike,
  response: Response,
  options: FetchWithFallbackOptions,
): Promise<void> {
  if (!options.cache.enabled || !options.caches) return;
  if (response.type === 'opaque' && !options.cache.cacheOpaque) return;
  if (response.type !== 'opaque' && !response.ok) return;
  const cache = await options.caches.open(createFallbackCacheName(options.manifest));
  await cache.put(originalRequest, response.clone());
}

async function readFallbackCache(
  originalRequest: SwRequestLike,
  options: FetchWithFallbackOptions,
): Promise<Response | undefined> {
  if (!options.cache.enabled || !options.caches) return undefined;
  const cache = await options.caches.open(createFallbackCacheName(options.manifest));
  return cache.match(originalRequest);
}

function cloneRequestWithUrl(original: SwRequestLike, url: string): SwRequestLike {
  if (typeof Request !== 'undefined' && original instanceof Request) {
    return new Request(url, original);
  }
  return {
    ...original,
    url,
  };
}
