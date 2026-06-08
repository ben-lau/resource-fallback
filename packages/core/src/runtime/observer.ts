import type { SriPolicy } from '../types';
import type { HookBus } from './hooks';
import type { Logger } from './logger';
import type { Resolver } from './resolver';
import { systemjsManagedUrls } from './adapter-systemjs';
import { appendRetryParam, stripRetryParam } from './utils';

const ATTEMPT_ATTR = 'data-rf-attempt';
const MANAGED_ATTR = 'data-rf-managed';
const FALLBACK_ATTR = 'data-rf-fallback';

interface ObserverDeps {
  resolver: Resolver;
  bus: HookBus;
  log: Logger;
  sri: SriPolicy;
}

/**
 * 捕获 `<script>` 和 `<link rel=stylesheet>` 元素（包括后续由
 * mini-css-extract-plugin 或运行时代码注入的）的加载失败，并原地替换为
 * 重试/fallback URL。
 *
 * 已知限制（README 中已说明）：同步 `<script>` 标签如果已执行了后续依赖代码，
 * 替换后无法重排序；此时触发 `onError`，由消费者决定如何处理（如刷新页面）。
 */
export function installObserver(deps: ObserverDeps): { dispose(): void } {
  const { resolver, bus, log, sri } = deps;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { dispose() {} };
  }

  window.addEventListener('error', onError, true);
  window.addEventListener('load', onLoad, true);

  function onError(ev: Event): void {
    const el = ev.target as HTMLElement | null;
    if (!el || el === (window as unknown as HTMLElement)) return;
    if (!isManagedTag(el)) return;
    if (isPreloadHint(el)) return;
    if (isWebpackChunkScript(el)) return;

    const url = readUrl(el);
    if (!url) return;
    if (systemjsManagedUrls.has(url)) return;

    const isFallback = !!el.getAttribute(FALLBACK_ATTR);
    const attempt = readAttempt(el) + 1;
    const result = resolver.resolve(url, attempt, isFallback);

    if (result.kind === 'giveup') {
      bus.emitError({ url, reason: result.reason });
      return;
    }

    if (result.kind === 'retry') {
      // ESM module 脚本按 URL 缓存：重新插入 `<script type=module src=同一URL>`
      // 是浏览器无操作，因为 module record 仍处于 "error" 状态，第二次 `error`
      // 事件不会触发。附加一个唯一的查询参数让浏览器视为全新的 module record。
      const fetchUrl = needsCacheBust(el) ? appendRetryParam(result.url, attempt) : result.url;
      bus.emitRetry({ url: result.url, attempt: result.attempt });
      scheduleReplace(el, fetchUrl, attempt, result.delay, isFallback);
    } else {
      // Fallback URL 的 host 不同，不存在 module 去重问题；
      // 去掉之前重试时遗留的 `__rf=` 参数以保持 CDN 缓存 key 干净。
      // 同时将 `data-rf-attempt` 重置为 0，让新 URL 拥有独立的重试预算，
      // 而非在首次失败时就直接跳到下一个 fallback。
      const fetchUrl = stripRetryParam(result.url);
      bus.emitFallback({ from: result.from, to: fetchUrl, reason: 'retry-budget-exhausted' });
      scheduleReplace(el, fetchUrl, 0, result.delay, true);
    }
  }

  function onLoad(ev: Event): void {
    const el = ev.target as HTMLElement | null;
    if (!el || el === (window as unknown as HTMLElement)) return;
    if (!isManagedTag(el) || !el.getAttribute(MANAGED_ATTR)) return;
    if (isWebpackChunkScript(el)) return;
    const url = readUrl(el);
    if (!url) return;
    const attempts = readAttempt(el) || 1;
    resolver.recordSuccess(url);
    bus.emitSuccess({ url, attempts });
  }

  function scheduleReplace(el: HTMLElement, newUrl: string, nextAttempt: number, delay: number, isFallback?: boolean) {
    const parent = el.parentNode;
    if (!parent) {
      log.warn('父节点不存在 - 无法替换', { url: newUrl });
      return;
    }
    const replacement = cloneTag(el, newUrl, nextAttempt, sri, isFallback);

    const swap = () => {
      // 原始节点可能因脚本执行竞态已被移除
      try {
        if (el.parentNode) el.parentNode.replaceChild(replacement, el);
        else parent.appendChild(replacement);
      } catch (err) {
        log.warn('替换失败', err);
      }
    };

    if (delay > 0) setTimeout(swap, delay);
    else swap();
  }

  return {
    dispose() {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('load', onLoad, true);
    },
  };
}

function isManagedTag(el: HTMLElement): el is HTMLScriptElement | HTMLLinkElement {
  const tag = el.tagName;
  return tag === 'SCRIPT' || tag === 'LINK';
}

function isPreloadHint(el: HTMLElement): boolean {
  if (el.tagName !== 'LINK') return false;
  const rel = ((el as HTMLLinkElement).rel || '').toLowerCase();
  return rel === 'preload' || rel === 'prefetch' || rel === 'modulepreload' || rel === 'dns-prefetch';
}

/**
 * Webpack 5 的 `LoadScriptRuntimeModule` 始终为 chunk 加载的 `<script>` 元素
 * 添加 `data-webpack="<chunkLoadingGlobal>:<chunkId>"` 属性，我们的 webpack
 * adapter 在重试/fallback 时也会复制该属性。
 *
 * 如果不做此过滤，我们会与 webpack adapter 在同一个 `error` 事件上竞争：
 * window 级别的捕获触发一次，`script.onerror`（adapter 所在位置）也触发一次。
 * 双方各自发起重试/fallback 链，导致请求次数翻倍——用户会看到 primary/secondary
 * 各被请求 ~6 次而非 2 次。
 *
 * 异步 chunk 由 webpack adapter 负责；只有入口脚本（没有 `data-webpack`
 * 属性的）才由 observer 处理。
 *
 * 注意：此处仅过滤 `<script>` 标签。mini-css-extract-plugin 输出的 CSS chunk
 * 的 `<link>` 标签也带 `data-webpack`，但 webpack adapter 不拦截 CSS 加载——
 * 因此 observer 仍然是 CSS chunk 的唯一安全网，必须继续处理。
 */
function isWebpackChunkScript(el: HTMLElement): boolean {
  return el.tagName === 'SCRIPT' && el.hasAttribute('data-webpack');
}

function needsCacheBust(el: HTMLElement): boolean {
  // Module 脚本按 URL 去重（失败的 module record 会被复用）。
  // 经典脚本和样式表每次插入都会发起新的请求，无需缓存破坏。
  // 添加查询参数只会降低 CDN 缓存命中率。
  if (el.tagName !== 'SCRIPT') return false;
  const t = (el as HTMLScriptElement).type;
  return t === 'module';
}

function readUrl(el: HTMLElement): string {
  // 使用 getAttribute 而非 .src / .href 属性——后者会被浏览器 resolve 为绝对 URL。
  // 当 origin URL 使用相对路径（如 "/"）时，setAttribute 设置的 "/assets/foo.js"
  // 经 getAttribute 仍为 "/assets/foo.js"，resolver 可以匹配 "/" 前缀。
  // 对于绝对 URL（如 "http://cdn/foo.js"），getAttribute 与 .src 等价。
  const tag = el.tagName;
  if (tag === 'SCRIPT') return el.getAttribute('src') || '';
  if (tag === 'LINK') return el.getAttribute('href') || '';
  return '';
}

function readAttempt(el: HTMLElement): number {
  const v = el.getAttribute(ATTEMPT_ATTR);
  if (!v) return 0;
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

// 需要从原始标签复制的属性。故意不使用 `cloneNode`，因为对 `<script>` 元素
// 规范会保留 "already started" 标记——浏览器会拒绝 fetch/执行克隆体，即使
// 其 `src` 与原始不同。通过 createElement 重新创建可以获得一个全新的、
// "not started" 状态的脚本。
const SCRIPT_FORWARDED_ATTRS = ['type', 'crossorigin', 'nonce', 'referrerpolicy', 'fetchpriority', 'async', 'defer', 'noModule'];
const LINK_FORWARDED_ATTRS = ['rel', 'as', 'type', 'media', 'crossorigin', 'nonce', 'referrerpolicy', 'fetchpriority', 'disabled'];

function cloneTag(
  source: HTMLElement,
  newUrl: string,
  nextAttempt: number,
  sri: SriPolicy,
  isFallback?: boolean,
): HTMLElement {
  const tag = source.tagName;
  const fresh = document.createElement(tag.toLowerCase());
  const forwarded = tag === 'SCRIPT' ? SCRIPT_FORWARDED_ATTRS : LINK_FORWARDED_ATTRS;

  for (let i = 0; i < forwarded.length; i++) {
    const name = forwarded[i];
    if (source.hasAttribute(name)) {
      fresh.setAttribute(name, source.getAttribute(name) || '');
    }
  }

  if (sri !== 'strip' && source.hasAttribute('integrity')) {
    // 'strict' / 'keep' ——浏览器会校验；不匹配时我们仍然触发 error。
    // 'strip'（默认）会故意丢弃，因为 integrity hash 通常只匹配*主* CDN 的产物。
    fresh.setAttribute('integrity', source.getAttribute('integrity') || '');
  }

  fresh.setAttribute(ATTEMPT_ATTR, String(nextAttempt));
  fresh.setAttribute(MANAGED_ATTR, '1');
  if (isFallback) fresh.setAttribute(FALLBACK_ATTR, '1');

  if (tag === 'SCRIPT') (fresh as HTMLScriptElement).src = newUrl;
  else (fresh as HTMLLinkElement).href = newUrl;

  return fresh;
}
