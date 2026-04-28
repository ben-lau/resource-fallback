import type { HookBus } from './hooks';
import type { Logger } from './logger';
import type { Resolver } from './resolver';

interface AdapterDeps {
  resolver: Resolver;
  bus: HookBus;
  log: Logger;
}

interface VitePreloadErrorPayload {
  reason?: unknown;
  payload?: { reason?: unknown };
}

/**
 * Vite 特有的运行时钩子。
 *
 * Vite 构建后的动态 import() 使用相对路径（`import("./chunk.js")`），
 * `experimental.renderBuiltUrl` 不控制这些 specifier（仅影响 `__vite__mapDeps`）。
 * 插件通过 Rollup 的 `renderDynamicImport` hook 将 `import(spec)` 替换为
 * `window.__RF__.load("assets/chunk.js", spec)`，其中第一个参数是 Rollup 提供的
 * `targetChunk.fileName`。`__RF__.load` 使用 `resolveBuiltUrl(filename)` 确定
 * 首次请求 URL，再执行与 webpack adapter 一致的 retry/fallback 循环。
 *
 * `__RF__.url` 仍供 `__vite__mapDeps` 中的 modulepreload 使用。
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
          ? appendCacheBust(currentUrl, totalAttempts)
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
    const detail = (event as CustomEvent<VitePreloadErrorPayload>).detail;
    const reason = detail?.payload?.reason ?? detail?.reason ?? detail;
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

function appendCacheBust(url: string, attempt: number): string {
  const clean = url.replace(/([?&])__rf=[^&#]*&?/g, (_m, sep) => sep).replace(/[?&]$/, '');
  const nonce = attempt + '-' + Math.floor(Math.random() * 1e6).toString(36);
  return clean + (clean.indexOf('?') === -1 ? '?' : '&') + '__rf=' + nonce;
}
