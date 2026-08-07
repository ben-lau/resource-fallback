import type {
  AttemptResult,
  RecoveryCoordinator,
  RecoveryTransport,
} from '../internal/coordinator';
import type { OwnershipRegistry } from '../internal/ownership';
import { webpackResourceKey } from '../internal/resource-identity';
import type { Logger } from './logger';

export interface WebpackRequireLike {
  l?: (
    url: string,
    done: (event?: WebpackEvent) => void,
    key?: string,
    chunkId?: string | number,
  ) => void;
  __rfWrapped?: boolean;
  __rf_wrapped?: boolean;
  nc?: string;
  crossOrigin?: string;
  referrerPolicy?: string;
  charset?: string;
  trustedScriptUrl?: unknown;
}

export type WebpackEvent = Event | { type: string } | undefined;

type ChunkPushArg = [
  chunkIds: Array<string | number>,
  modules: Record<string, unknown>,
  runtimeFn?: (req: WebpackRequireLike) => unknown,
];

interface ChunkArrayLike extends Array<ChunkPushArg> {
  __rfHooked?: boolean;
}

export interface WebpackLoadMetadata {
  readonly key?: string;
  readonly chunkId?: string | number;
  readonly nonce?: string;
  readonly crossOrigin?: string;
  readonly referrerPolicy?: string;
  readonly charset?: string;
  readonly trustedScriptUrl?: unknown;
}

export interface WebpackAdapterDeps {
  coordinator: RecoveryCoordinator;
  ownership: OwnershipRegistry;
  log: Logger;
  chunkLoadingGlobals?: string[];
}

interface ArrayPatch {
  array: ChunkArrayLike;
  originalPush: ChunkArrayLike['push'];
  wrapper: ChunkArrayLike['push'];
  hadMarker: boolean;
  markerValue: boolean | undefined;
}

interface RuntimePatch {
  chunk: ChunkPushArg;
  original: NonNullable<ChunkPushArg[2]>;
  wrapper: NonNullable<ChunkPushArg[2]>;
}

interface RequirePatch {
  require: WebpackRequireLike;
  originalL: NonNullable<WebpackRequireLike['l']>;
  wrapper: NonNullable<WebpackRequireLike['l']>;
  hadMarker: boolean;
  markerValue: boolean | undefined;
}

export function createWebpackScriptTransport(
  firstAttempt: (url: string, done: (event?: WebpackEvent) => void) => void,
  metadata: WebpackLoadMetadata,
): RecoveryTransport<WebpackEvent> {
  return {
    attempt(input, signal) {
      if (signal.aborted) return Promise.resolve({ ok: false, failure: { kind: 'aborted' } });

      if (input.attempt === 1) {
        return new Promise((resolve) => {
          let settled = false;
          const settle = (result: AttemptResult<WebpackEvent>) => {
            if (settled) return;
            settled = true;
            resolve(result);
          };
          try {
            firstAttempt(input.url, (event) => settle(classifyWebpackEvent(event)));
          } catch (error) {
            settle({ ok: false, failure: { kind: 'unknown', error } });
          }
        });
      }

      return loadFreshWebpackScript(input.url, metadata, signal);
    },
  };
}

/**
 * 包装 webpack 的 chunk array 与 __webpack_require__.l。
 * 恢复决策全部委托给 RecoveryCoordinator；本文件只保留原生 loader 和新 script
 * 的回调/属性语义。
 */
export function installWebpackAdapter(deps: WebpackAdapterDeps): { dispose(): void } {
  if (typeof window === 'undefined') return { dispose() {} };

  const w = window as unknown as Record<string, unknown>;
  const arrayPatches: ArrayPatch[] = [];
  const runtimePatches: RuntimePatch[] = [];
  const requirePatches: RequirePatch[] = [];
  const createdGlobals: Array<{ name: string; array: ChunkArrayLike }> = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let active = true;

  const knownGlobals = deps.chunkLoadingGlobals || [];
  for (const name of knownGlobals) {
    const existing = w[name] as ChunkArrayLike | undefined;
    const array = existing || ([] as ChunkArrayLike);
    if (!existing) {
      w[name] = array;
      createdGlobals.push({ name, array });
    }
    hookArray(array);
  }

  scanAndHook();
  for (const delay of [50, 150, 400, 1000]) {
    timers.push(setTimeout(scanAndHook, delay));
  }

  return {
    dispose() {
      if (!active) return;
      active = false;
      for (const timer of timers) clearTimeout(timer);
      deps.coordinator.cancelOwner('webpack');

      for (let i = requirePatches.length - 1; i >= 0; i--) {
        const patch = requirePatches[i];
        if (patch.require.l === patch.wrapper) patch.require.l = patch.originalL;
        if (patch.hadMarker) patch.require.__rfWrapped = patch.markerValue;
        else delete patch.require.__rfWrapped;
      }

      for (let i = runtimePatches.length - 1; i >= 0; i--) {
        const patch = runtimePatches[i];
        if (patch.chunk[2] === patch.wrapper) patch.chunk[2] = patch.original;
      }

      for (let i = arrayPatches.length - 1; i >= 0; i--) {
        const patch = arrayPatches[i];
        if (patch.array.push === patch.wrapper) patch.array.push = patch.originalPush;
        if (patch.hadMarker) patch.array.__rfHooked = patch.markerValue;
        else delete patch.array.__rfHooked;
      }

      for (const created of createdGlobals) {
        if (w[created.name] === created.array) delete w[created.name];
      }
    },
  };

  function scanAndHook(): void {
    if (!active) return;
    for (const key in w) {
      if (!key.startsWith('webpackChunk')) continue;
      try {
        const candidate = w[key];
        if (Array.isArray(candidate)) hookArray(candidate as ChunkArrayLike);
      } catch {
        // 某些 window 属性可能因跨域访问而抛异常。
      }
    }
  }

  function hookArray(array: ChunkArrayLike): void {
    if (!active || array.__rfHooked) return;

    const originalPush = array.push;
    const hadMarker = Object.prototype.hasOwnProperty.call(array, '__rfHooked');
    const markerValue = array.__rfHooked;
    const wrapper = function (this: ChunkArrayLike, ...args: ChunkPushArg[]) {
      const chunk = args[0];
      if (chunk && typeof chunk[2] === 'function') {
        const originalRuntime = chunk[2];
        const runtimeWrapper = function (req: WebpackRequireLike) {
          const result = originalRuntime(req);
          wrapRequire(req);
          return result;
        };
        chunk[2] = runtimeWrapper;
        runtimePatches.push({ chunk, original: originalRuntime, wrapper: runtimeWrapper });
      }
      return originalPush.apply(this, args);
    };

    array.__rfHooked = true;
    array.push = wrapper;
    arrayPatches.push({ array, originalPush, wrapper, hadMarker, markerValue });
  }

  function wrapRequire(req: WebpackRequireLike): void {
    if (!active || !req || req.__rfWrapped) return;
    if (typeof req.l !== 'function') {
      deps.log.warn('webpack runtime detected but .l is missing — skip chunk hook');
      return;
    }
    if ((req.l as NonNullable<WebpackRequireLike['l']> & { __rf_wrapped?: boolean }).__rf_wrapped) {
      deps.log.debug('webpack plugin already wrapped .l; chunk-array adapter yields');
      return;
    }

    const originalL = req.l;
    const hadMarker = Object.prototype.hasOwnProperty.call(req, '__rfWrapped');
    const markerValue = req.__rfWrapped;
    const wrapper = function (
      url: string,
      done: (event?: WebpackEvent) => void,
      key?: string,
      chunkId?: string | number,
    ): void {
      const logicalKey = webpackResourceKey(url, { key, chunkId });
      const admission = deps.ownership.admit('webpack', logicalKey);
      if (admission.kind === 'denied') {
        originalL(url, done, key, chunkId);
        return;
      }

      const metadata: WebpackLoadMetadata = {
        key,
        chunkId,
        nonce: req.nc,
        crossOrigin: req.crossOrigin,
        referrerPolicy: req.referrerPolicy,
        charset: req.charset,
        trustedScriptUrl: req.trustedScriptUrl,
      };
      const transport = createWebpackScriptTransport(
        (firstUrl, complete) => originalL(firstUrl, complete, key, chunkId),
        metadata,
      );

      let recovery: Promise<WebpackEvent>;
      try {
        recovery = deps.coordinator.recover({
          owner: 'webpack',
          logicalKey,
          initialUrl: url,
          transport,
        });
      } catch (error) {
        if (admission.kind === 'acquired') admission.lease.release();
        if (active) done(error as WebpackEvent);
        return;
      }

      if (admission.kind === 'acquired') {
        void recovery
          .finally(() => admission.lease.release())
          .catch(() => {
            // callback 分支会把终端错误交回 webpack。
          });
      }

      void recovery.then(
        (event) => {
          if (active) done(event);
        },
        (reason) => {
          if (active) done(toWebpackFailure(reason));
        },
      );
    };

    (wrapper as NonNullable<WebpackRequireLike['l']> & { __rf_wrapped?: boolean }).__rf_wrapped =
      true;
    req.__rfWrapped = true;
    req.l = wrapper;
    requirePatches.push({ require: req, originalL, wrapper, hadMarker, markerValue });
  }
}

function classifyWebpackEvent(event: WebpackEvent): AttemptResult<WebpackEvent> {
  if (event && (event.type === 'error' || event.type === 'timeout')) {
    return { ok: false, failure: { kind: 'load-error', error: event } };
  }
  return { ok: true, value: event };
}

function toWebpackFailure(reason: unknown): WebpackEvent {
  if (reason && typeof reason === 'object') {
    const error = (reason as { error?: unknown }).error;
    if (error !== undefined) return error as WebpackEvent;
  }
  return { type: 'error' };
}

function loadFreshWebpackScript(
  url: string,
  metadata: WebpackLoadMetadata,
  signal: AbortSignal,
): Promise<AttemptResult<WebpackEvent>> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ ok: false, failure: { kind: 'aborted' } });
      return;
    }

    const script = document.createElement('script');
    script.charset = metadata.charset || 'utf-8';
    script.async = true;
    if (metadata.key) script.setAttribute('data-webpack', metadata.key);
    if (metadata.nonce) script.nonce = metadata.nonce;
    if (metadata.crossOrigin) script.crossOrigin = metadata.crossOrigin;
    if (metadata.referrerPolicy) script.referrerPolicy = metadata.referrerPolicy;

    const trustedUrl = metadata.trustedScriptUrl === undefined ? url : metadata.trustedScriptUrl;
    (script as unknown as { src: unknown }).src = trustedUrl;
    let settled = false;

    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
      signal.removeEventListener('abort', onAbort);
    };
    const settle = (result: AttemptResult<WebpackEvent>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onLoad = (event: Event) => settle({ ok: true, value: event });
    const onError = () =>
      settle({ ok: false, failure: { kind: 'load-error', error: { type: 'error' } } });
    const onAbort = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      settle({ ok: false, failure: { kind: 'aborted' } });
    };

    script.onload = onLoad;
    script.onerror = onError;
    signal.addEventListener('abort', onAbort, { once: true });
    (document.head || document.body || document.documentElement).appendChild(script);
  });
}
