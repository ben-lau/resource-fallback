import type { HookBus } from './hooks';
import type { Logger } from './logger';
import type { Resolver } from './resolver';
import { appendRetryParam } from './utils';

interface AdapterDeps {
  resolver: Resolver;
  bus: HookBus;
  log: Logger;
}

interface VitePreloadErrorEvent extends Event {
  payload?: unknown;
}

/**
 * Vite 特有的运行时钩子。
 *
 * 插件通过 `writeBundle` hook（在 Vite 完成 `__vitePreload` / `__vite__mapDeps`
 * 生成之后）将 `import("./chunk.js")` 替换为
 * `window.__RF__.load("assets/chunk.js")`。这保证了：
 * - `__vitePreload` 的 CSS deps 正常生成（异步组件的 CSS 不丢失）
 * - `__RF__.load` 对 JS 动态 import 提供 retry/fallback 能力
 *
 * `__RF__.url` 可选，用于外部代码将 filename 解析为完整 URL。
 */
export function installViteAdapter(deps: AdapterDeps): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown> & { __RF__?: Record<string, unknown> };

  if (!w.__RF__) w.__RF__ = {};
  w.__RF__.url = (filename: string) => deps.resolver.resolveBuiltUrl(filename);

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = Function('u', 'return import(u)') as (url: string) => Promise<unknown>;

  w.__RF__.load = async (filename: string) => {
    let currentUrl = deps.resolver.resolveBuiltUrl(filename);
    let isFallback = false;
    let attempt = 1;
    let totalAttempts = 0;

    for (;;) {
      try {
        // 浏览器 ES Module Map 会缓存失败的 import() 结果：
        // 对同一 URL 的后续 import() 直接返回缓存的失败，不发网络请求。
        // 添加 cache-busting 参数（与 observer 的 appendRetryParam 格式一致）
        // 强制浏览器将其视为新的 module record。
        const importUrl = totalAttempts > 0
          ? appendRetryParam(currentUrl, totalAttempts)
          : currentUrl;
        const mod = await dynamicImport(importUrl);
        deps.resolver.recordSuccess(currentUrl);
        deps.bus.emitSuccess({ url: currentUrl, attempts: attempt });
        return mod;
      } catch (err) {
        totalAttempts++;
        const result = deps.resolver.resolve(currentUrl, attempt, isFallback);

        if (result.kind === 'giveup') {
          deps.bus.emitError({ url: currentUrl, reason: result.reason });
          throw err;
        }

        if (result.kind === 'retry') {
          attempt = result.attempt + 1;
          deps.bus.emitRetry({ url: result.url, attempt: result.attempt });
        } else {
          isFallback = true;
          attempt = 1;
          deps.bus.emitFallback({ from: result.from, to: result.url, reason: 'retry-budget-exhausted' });
        }

        currentUrl = result.url;
        if (result.delay > 0) {
          await new Promise<void>(r => setTimeout(r, result.delay));
        }
      }
    }
  };

  window.addEventListener('vite:preloadError', (event: Event) => {
    // Vite 的 __vitePreload 在 CSS 预加载失败时调用:
    //   const e = new Event('vite:preloadError', { cancelable: true });
    //   e.payload = error;
    //   dispatchEvent(e);
    //   if (!e.defaultPrevented) throw error;
    //
    // 必须 preventDefault，否则 throw 会阻断后续的 __RF__.load() 调用，
    // 导致 JS 模块永远不加载。CSS 由 observer 通过 <link> error 事件重试。
    event.preventDefault();

    const reason = (event as VitePreloadErrorEvent).payload;
    const url = extractUrlFromError(reason);
    if (!url) {
      deps.log.warn('vite:preloadError 无法解析出 URL', reason);
      return;
    }
    deps.bus.emitFallback({ from: url, to: '<deferred>', reason: 'vite-preload-failure' });
    deps.resolver.recordFailure(url);
  });
}

function extractUrlFromError(reason: unknown): string | null {
  if (!reason) return null;
  if (typeof reason === 'string') return matchUrl(reason);
  const r = reason as { message?: string; target?: { src?: string; href?: string } };
  if (r.target && (r.target.src || r.target.href)) return r.target.src || r.target.href || null;
  if (r.message) return matchUrl(r.message);
  return null;
}

function matchUrl(text: string): string | null {
  const m = text.match(/(https?:\/\/\S+|\/[\w./?=&%-]+)/);
  return m ? m[1] : null;
}
