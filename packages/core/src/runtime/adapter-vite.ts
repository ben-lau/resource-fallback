import type { RecoveryCoordinator, RecoveryTransport } from '../internal/coordinator';
import type { PreparedRuntimeConfig } from '../internal/config';
import type { OwnershipRegistry } from '../internal/ownership';
import type { Logger } from './logger';
import { appendRetryParam } from './utils';

export interface ViteAdapterDeps {
  config: PreparedRuntimeConfig;
  coordinator: RecoveryCoordinator;
  ownership: OwnershipRegistry;
  log: Logger;
  target: Record<string, unknown>;
  resolveUrl(filename: string): string;
}

export type ImportModule = (url: string) => Promise<unknown>;

interface VitePreloadErrorEvent extends Event {
  payload?: unknown;
}

let importModule: ImportModule = (url) => import(/* @vite-ignore */ /* webpackIgnore: true */ url);

/** @internal 仅供测试替换动态 import。传入 null 恢复默认。 */
export function setViteImportModule(fn: ImportModule | null): void {
  importModule = fn || ((url) => import(/* @vite-ignore */ /* webpackIgnore: true */ url));
}

export function createViteTransport(importer: ImportModule): RecoveryTransport<unknown> {
  return {
    async attempt(input, signal) {
      if (signal.aborted) return { ok: false, failure: { kind: 'aborted' } };

      const importUrl =
        input.attempt > 1 ? appendRetryParam(input.url, input.attempt - 1) : input.url;
      try {
        return { ok: true, value: await importer(importUrl) };
      } catch (error) {
        return { ok: false, failure: { kind: 'load-error', error } };
      }
    },
  };
}

/**
 * Vite 产物将动态 import 改写为 window.__RF__.load(filename)。
 * 这里仅连接全局函数、原生 importer 和 RecoveryCoordinator。
 */
export function installViteAdapter(deps: ViteAdapterDeps): { dispose(): void } {
  if (typeof window === 'undefined') return { dispose() {} };

  const target = deps.target;
  const installedUrl = (filename: string) => deps.resolveUrl(filename);
  const transport = createViteTransport((url) => importModule(url));
  const installedLoad = (filename: string): Promise<unknown> => {
    const initialUrl = deps.resolveUrl(filename);
    const logicalKey = 'url:' + initialUrl;
    const lease = deps.ownership.claim('vite', logicalKey);

    let recovery: Promise<unknown>;
    try {
      recovery = deps.coordinator.recover({
        owner: 'vite',
        logicalKey,
        initialUrl,
        transport,
      });
    } catch (error) {
      lease?.release();
      return Promise.reject(error);
    }

    if (lease) {
      void recovery
        .finally(() => lease.release())
        .catch(() => {
          // load() 的返回 promise 负责把原生失败交给调用方。
        });
    }

    return recovery.catch((reason) => Promise.reject(unwrapFailure(reason)));
  };

  target.url = installedUrl;
  target.load = installedLoad;

  const onPreloadError = (event: Event) => {
    const reason = (event as VitePreloadErrorEvent).payload;
    const url = extractUrlFromError(reason);
    if (!url) {
      deps.log.warn('vite:preloadError could not extract URL', reason);
      return;
    }
    if (!matchesPreparedRule(deps.config, url)) return;

    // CSS 实体仍由 Observer 处理；这里只阻止 Vite 在后续 __RF__.load() 之前抛错。
    event.preventDefault();
  };

  window.addEventListener('vite:preloadError', onPreloadError);

  return {
    dispose() {
      window.removeEventListener('vite:preloadError', onPreloadError);
      deps.coordinator.cancelOwner('vite');
      if (target.url === installedUrl) delete target.url;
      if (target.load === installedLoad) delete target.load;
    },
  };
}

function matchesPreparedRule(config: PreparedRuntimeConfig, url: string): boolean {
  return config.rules.some(
    (rule) => url.startsWith(rule.base) || rule.urls.some((candidate) => url.startsWith(candidate)),
  );
}

function unwrapFailure(reason: unknown): unknown {
  if (!reason || typeof reason !== 'object') return reason;
  const error = (reason as { error?: unknown }).error;
  return error === undefined ? reason : error;
}

function extractUrlFromError(reason: unknown): string | null {
  if (!reason) return null;
  if (typeof reason === 'string') return matchUrl(reason);

  const value = reason as {
    message?: string;
    target?: { src?: string; href?: string };
  };
  if (value.target && (value.target.src || value.target.href)) {
    return value.target.src || value.target.href || null;
  }
  if (value.message) return matchUrl(value.message);
  return null;
}

function matchUrl(text: string): string | null {
  const match = text.match(/(https?:\/\/\S+|\/[\w./?=&%-]+)/);
  return match ? match[1] : null;
}
