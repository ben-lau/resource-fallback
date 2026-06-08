import type {
  ErrorEvent,
  FallbackRule,
  FallbackEvent,
  ResourceFallbackManifest,
  RetryEvent,
  RuntimeConfig,
  SuccessEvent,
} from '../types';
import { createResolver, type Resolver } from '../runtime/resolver';

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
  resolver?: Resolver;
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

export interface ManifestLookupSets {
  swOwnedUrls: Set<string>;
  cssReferrerUrls: Set<string>;
}

export function buildManifestLookupSets(manifest: ResourceFallbackManifest): ManifestLookupSets {
  const swOwnedUrls = new Set<string>();
  const cssReferrerUrls = new Set<string>();
  for (const asset of manifest.assets) {
    const url = stripHash(asset.url);
    if (asset.owner === 'sw') swOwnedUrls.add(url);
    if (asset.type === 'style') cssReferrerUrls.add(url);
  }
  return { swOwnedUrls, cssReferrerUrls };
}

const manifestLookupCache = new WeakMap<ResourceFallbackManifest, ManifestLookupSets>();

function getManifestLookup(manifest: ResourceFallbackManifest): ManifestLookupSets {
  let sets = manifestLookupCache.get(manifest);
  if (!sets) {
    sets = buildManifestLookupSets(manifest);
    manifestLookupCache.set(manifest, sets);
  }
  return sets;
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
  const lookup = getManifestLookup(manifest);
  if (
    destination === 'image' ||
    destination === 'font' ||
    destination === 'video' ||
    destination === 'audio' ||
    destination === 'track'
  ) {
    return lookup.swOwnedUrls.has(stripHash(request.url));
  }
  if (destination === 'style') {
    const referrer = request.referrer || '';
    return (
      !!options.includeStyleImports && !!referrer && lookup.cssReferrerUrls.has(stripHash(referrer))
    );
  }
  return false;
}

export function createSwResolver(
  manifest: ResourceFallbackManifest,
  runtimeConfig?: Omit<RuntimeConfig, 'rules'>,
): Resolver {
  return createResolver({
    ...runtimeConfig,
    rules: forceMemoryCircuit(manifest.rules),
    defaults: {
      ...runtimeConfig?.defaults,
      circuit: {
        ...runtimeConfig?.defaults?.circuit,
        shareAcrossTabs: false,
      },
    },
  });
}

export async function fetchWithFallback(
  request: SwRequestLike,
  options: FetchWithFallbackOptions,
): Promise<Response> {
  const resolver = options.resolver ?? createSwResolver(options.manifest, options.runtimeConfig);
  let currentRequest = request;
  let attempt = 1;
  let isFallback = false;
  let usedFallback = false;
  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (;;) {
    try {
      const response = await options.fetcher(currentRequest);
      if (
        isUsableNetworkResponse(response, currentRequest.url, options.fallbackOnOpaque === true)
      ) {
        resolver.recordSuccess(currentRequest.url);
        options.emit('success', { url: currentRequest.url, attempts: attempt });
        if (usedFallback) await putFallbackCache(request, response, options);
        return response;
      }
      lastResponse = response;
      lastError = new Error('HTTP ' + response.status);
    } catch (err) {
      lastError = err;
    }

    const result = resolver.resolve(currentRequest.url, attempt, isFallback);
    if (result.kind === 'giveup') {
      options.emit('error', { url: currentRequest.url, reason: result.reason });
      const cached = await readFallbackCache(request, options);
      if (cached) return cached;
      if (lastResponse) return lastResponse;
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError || 'resource failed'));
    }

    if (result.kind === 'retry') {
      options.emit('retry', { url: result.url, attempt: result.attempt });
      attempt = result.attempt + 1;
    } else {
      usedFallback = true;
      isFallback = true;
      attempt = 1;
      options.emit('fallback', {
        from: result.from,
        to: result.url,
        reason: 'retry-budget-exhausted',
      });
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

function forceMemoryCircuit(rules: FallbackRule[]): FallbackRule[] {
  return rules.map((rule) => ({
    ...rule,
    circuit: {
      ...rule.circuit,
      shareAcrossTabs: false,
    },
  }));
}

function stripHash(url: string): string {
  const idx = url.indexOf('#');
  return idx === -1 ? url : url.slice(0, idx);
}

function isUsableNetworkResponse(
  response: Response,
  url: string,
  fallbackOnOpaque: boolean,
): boolean {
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
