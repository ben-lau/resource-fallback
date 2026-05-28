import type {
  FallbackRule,
  NormalizedServiceWorkerOptions,
  ResourceFallbackAssetOwner,
  ResourceFallbackAssetType,
  ResourceFallbackManifest,
  RuntimeConfig,
  ServiceWorkerOptions,
} from './types';

export interface ManifestInputAsset {
  url: string;
  type: ResourceFallbackAssetType;
}

export interface ManifestInput {
  versionSeed: string;
  rules: FallbackRule[];
  assets: ManifestInputAsset[];
  versionSalt?: unknown;
}

export interface ServiceWorkerAssets {
  path: string;
  scope: string;
  code: string;
  manifest: ResourceFallbackManifest;
}

export interface ServiceWorkerAssetInput {
  versionSeed: string;
  assets: ManifestInputAsset[];
  code?: string;
}

export function normalizeServiceWorkerOptions(
  input: boolean | ServiceWorkerOptions | undefined,
): NormalizedServiceWorkerOptions {
  if (input === true) return withDefaults({ enabled: true });
  if (!input) return withDefaults({ enabled: false });
  return withDefaults({ ...input, enabled: input.enabled !== false });
}

export function buildResourceFallbackManifest(input: ManifestInput): ResourceFallbackManifest {
  const assets = input.assets.map((asset) => ({
    ...asset,
    owner: defaultOwnerForType(asset.type),
  }));
  return {
    version: 'rf-' + stableHash(stableStringify({
      seed: input.versionSeed,
      rules: input.rules,
      assets,
      versionSalt: input.versionSalt,
    })),
    rules: input.rules,
    assets,
  };
}

export function buildServiceWorkerAssets(
  options: RuntimeConfig,
  input: ServiceWorkerAssetInput,
): ServiceWorkerAssets | null {
  const serviceWorker = normalizeServiceWorkerOptions(options.serviceWorker);
  if (!serviceWorker.enabled) return null;
  const fullManifest = buildResourceFallbackManifest({
    versionSeed: input.versionSeed,
    rules: options.rules,
    assets: input.assets,
    versionSalt: {
      cache: serviceWorker.cache,
      fallbackOnOpaque: serviceWorker.fallbackOnOpaque,
    },
  });
  // Strip assets that SW never uses (scripts, source maps, etc.) to reduce
  // preload size. Keep image/font/media (sw-owned) and style (CSS @import).
  const manifest: ResourceFallbackManifest = {
    ...fullManifest,
    assets: fullManifest.assets.filter((a) => a.owner === 'sw' || a.type === 'style'),
  };
  return {
    path: serviceWorker.path,
    scope: serviceWorker.scope,
    code: withPreloadedConfig(input.code || '/* resource-fallback service worker: RF_SW_CONFIG */', {
      manifest,
      runtimeConfig: stripSwRuntimeConfig(options),
      serviceWorker,
    }),
    manifest,
  };
}

export function inferResourceFallbackAssetType(fileName: string): ResourceFallbackAssetType {
  const clean = fileName.split(/[?#]/)[0].toLowerCase();
  if (/\.(m?js|cjs)$/.test(clean)) return 'script';
  if (/\.css$/.test(clean)) return 'style';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(clean)) return 'image';
  if (/\.(woff2?|ttf|otf|eot)$/.test(clean)) return 'font';
  if (/\.(mp4|webm|ogg|mp3|wav|flac|aac|m4a)$/.test(clean)) return 'media';
  return 'asset';
}

function withDefaults(input: ServiceWorkerOptions & { enabled: boolean }): NormalizedServiceWorkerOptions {
  const scope = normalizeScope(input.scope || '/');
  return {
    enabled: input.enabled,
    path: input.path || defaultPathForScope(scope),
    scope,
    includeStyleImports: input.includeStyleImports !== false,
    fallbackOnOpaque: input.fallbackOnOpaque === true,
    cache: {
      enabled: input.cache?.enabled !== false,
      cacheOpaque: input.cache?.cacheOpaque === true,
    },
  };
}

function normalizeScope(scope: string): string {
  if (!scope) return '/';
  const withLeadingSlash = scope[0] === '/' ? scope : '/' + scope;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : withLeadingSlash + '/';
}

function defaultPathForScope(scope: string): string {
  return scope === '/' ? '/rf-sw.js' : scope + 'rf-sw.js';
}

function withPreloadedConfig(
  code: string,
  preload: {
    manifest: ResourceFallbackManifest;
    runtimeConfig: RuntimeConfig;
    serviceWorker: NormalizedServiceWorkerOptions;
  },
): string {
  return `self.__RF_SW_PRELOAD__=${stringifyJs(preload)};\n${code}`;
}

function stripSwRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return {
    rules: config.rules,
    defaults: config.defaults,
    debug: config.debug,
    sri: config.sri,
    serviceWorker: config.serviceWorker,
    serviceWorkerManifest: config.serviceWorkerManifest,
    disableGlobals: config.disableGlobals,
    disableQueryParam: config.disableQueryParam,
    disableCookie: config.disableCookie,
  };
}

function defaultOwnerForType(type: ResourceFallbackAssetType): ResourceFallbackAssetOwner {
  if (type === 'image' || type === 'font' || type === 'media') return 'sw';
  return 'page';
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function stringifyJs(value: unknown): string {
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) return '[' + value.map(stringifyJs).join(',') + ']';
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj)) {
      const item = obj[key];
      if (item === undefined || typeof item === 'function') continue;
      parts.push(JSON.stringify(key) + ':' + stringifyJs(item));
    }
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function stableStringify(value: unknown): string {
  if (value instanceof RegExp) {
    return JSON.stringify({ __type: 'RegExp', source: value.source, flags: value.flags });
  }
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      const item = obj[key];
      if (item === undefined || typeof item === 'function') continue;
      parts.push(JSON.stringify(key) + ':' + stableStringify(item));
    }
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(value);
}
