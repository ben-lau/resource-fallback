import type { HookBus } from './hooks';
import type { Logger } from './logger';
import type { Resolver } from './resolver';

export interface AdapterDeps {
  resolver: Resolver;
  bus: HookBus;
  log: Logger;
}

/**
 * 正在被 SystemJS adapter 管理的 URL 集合。
 * observer 通过此 Set 判断是否跳过某个 script error，
 * 避免与 adapter 双重处理。
 */
export const systemjsManagedUrls = new Set<string>();

interface SystemJSLike {
  constructor: { prototype: SystemJSProto };
  import: (id: string, parentUrl?: string) => Promise<unknown>;
  getRegister: (url?: string) => unknown;
}

interface SystemJSProto {
  instantiate: (url: string, parentUrl?: string) => Promise<unknown>;
  getRegister: (url?: string) => unknown;
  __rfHooked?: boolean;
}

/**
 * SystemJS adapter —— 类似 adapter-webpack 的思路。
 *
 * `@vitejs/plugin-legacy` 使用 SystemJS (s.js) 在旧浏览器中加载 legacy chunk。
 * 其模块加载通过 `System.constructor.prototype.instantiate` 创建 `<script>`
 * 元素并监听 onload/onerror。observer 的 DOM 替换方式与 SystemJS 的内部追踪冲突：
 * 替换后的脚本虽然加载成功，但 SystemJS 的 Promise 已因原始脚本的 onerror 而 reject。
 *
 * 策略（方案 B — 委托式）：
 *  1. 轮询等待 System 全局变量可用（polyfill 可能需要通过 observer 回退加载）
 *  2. 覆写 `instantiate`，但每次尝试都**委托给原始 `origInstantiate`**，
 *     保留 SystemJS 全部的脚本创建逻辑（crossOrigin、插入位置等），
 *     仅在 `.catch()` 中加入 retry/fallback 循环
 *  3. 重放所有 `<script data-src="...">` 的延迟导入（polyfill 异步加载导致的
 *     `System is not defined` 错误会使这些调用失败）
 *
 * 通过 `systemjsManagedUrls` 共享 Set 通知 observer 跳过正在被
 * adapter 管理的 URL，避免双重 retry/fallback。
 */
export function installSystemJSAdapter(deps: AdapterDeps): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;

  let hooked = false;

  function tryHook(): boolean {
    if (hooked) return true;

    const S = w.System as SystemJSLike | undefined;
    if (!S || typeof S.constructor !== 'function') return false;

    const proto = S.constructor.prototype as SystemJSProto;
    if (!proto || typeof proto.instantiate !== 'function') return false;
    if (proto.__rfHooked) return true;

    proto.__rfHooked = true;
    hooked = true;

    hookInstantiate(proto, deps);
    replayDeferredEntries(deps);

    return true;
  }

  if (!tryHook()) {
    const intervals = [50, 100, 200, 500, 1000, 2000, 5000];
    for (let i = 0; i < intervals.length; i++) {
      setTimeout(() => {
        if (!hooked) tryHook();
      }, intervals[i]);
    }
  }
}

function hookInstantiate(proto: SystemJSProto, deps: AdapterDeps): void {
  const origInstantiate = proto.instantiate;

  proto.instantiate = function (
    this: SystemJSLike,
    url: string,
    parentUrl?: string,
  ) {
    if (!deps.resolver.findRule(url)) {
      return origInstantiate.call(this, url, parentUrl);
    }

    const self = this;
    let currentUrl = url;
    let attempt = 1;
    let isFallback = false;

    function tryLoad(): Promise<unknown> {
      systemjsManagedUrls.add(currentUrl);
      return origInstantiate.call(self, currentUrl, parentUrl).then(
        (registration) => {
          systemjsManagedUrls.delete(currentUrl);
          deps.resolver.recordSuccess(currentUrl);
          deps.bus.emitSuccess({ url: currentUrl, attempts: attempt });
          return registration;
        },
        (err) => {
          systemjsManagedUrls.delete(currentUrl);
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
            deps.bus.emitFallback({
              from: result.from,
              to: result.url,
              reason: 'retry-budget-exhausted',
            });
          }

          currentUrl = result.url;

          if (result.delay > 0) {
            return new Promise<void>((r) => setTimeout(r, result.delay)).then(tryLoad);
          }
          return tryLoad();
        },
      );
    }

    return tryLoad();
  };

  deps.log.debug('SystemJS adapter: instantiate hooked');
}

/**
 * `@vitejs/plugin-legacy` 的入口脚本使用 `<script data-src="...">` +
 * 内联 `System.import(...)` 的模式。当 polyfill 异步回退加载时，内联代码
 * 因 `System is not defined` 而失败。等 polyfill 加载完成后，重放这些导入。
 *
 * 使用 `data-src` 属性而非硬编码特定 ID，以兼容 MPA 和未来变更。
 */
function replayDeferredEntries(deps: AdapterDeps): void {
  const scripts = document.querySelectorAll('script[data-src]');
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].getAttribute('data-src');
    if (!src) continue;
    deps.log.info('SystemJS adapter: replaying deferred import', { src });
    const S = (window as unknown as Record<string, unknown>).System as SystemJSLike;
    S.import(src).catch((err: unknown) => {
      deps.log.error('SystemJS adapter: deferred import failed', err);
    });
  }
}
