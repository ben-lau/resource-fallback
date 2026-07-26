import type { RecoveryCoordinator, RecoveryTransport } from '../internal/coordinator';
import type { OwnershipRegistry } from '../internal/ownership';
import type { SriPolicy } from '../types';
import type { Logger } from './logger';
import { appendRetryParam, stripRetryParam } from './utils';

const ATTEMPT_ATTR = 'data-rf-attempt';
const MANAGED_ATTR = 'data-rf-managed';
const FALLBACK_ATTR = 'data-rf-fallback';

export interface ObserverDeps {
  coordinator: RecoveryCoordinator;
  ownership: OwnershipRegistry;
  log: Logger;
  sri: SriPolicy;
}

type ManagedElement = HTMLScriptElement | HTMLLinkElement;

/**
 * 捕获页面中受支持的脚本和样式表加载失败，并把已发生的原生失败交给
 * RecoveryCoordinator。Observer 只负责 DOM 事件和新节点的创建，不负责恢复决策。
 */
export function installObserver(deps: ObserverDeps): { dispose(): void } {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { dispose() {} };
  }

  let disposed = false;
  window.addEventListener('error', onError, true);

  function onError(event: Event): void {
    if (disposed) return;
    const element = event.target as HTMLElement | null;
    if (!element || element === (window as unknown as HTMLElement)) return;
    if (!isSupportedElement(element)) return;
    if (isWebpackChunkScript(element) || element.hasAttribute(MANAGED_ATTR)) return;

    const initialUrl = readUrl(element);
    if (!initialUrl) return;

    const logicalKey = 'url:' + initialUrl;
    const lease = deps.ownership.claim('observer', logicalKey);
    if (!lease) return;

    const request = {
      owner: 'observer' as const,
      logicalKey,
      initialUrl,
      initialFailure: { kind: 'load-error' as const, error: event },
      transport: createObserverTransport(element, deps.sri, deps.log),
    };

    let recovery: Promise<unknown>;
    try {
      recovery = deps.coordinator.recover(request);
    } catch {
      lease.release();
      return;
    }

    void recovery
      .finally(() => lease.release())
      .catch(() => {
        // 终端错误已经由 EventBus 发送；Observer 不把它重新抛到 window。
      });
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('error', onError, true);
      deps.coordinator.cancelOwner('observer');
    },
  };
}

export function createObserverTransport(
  source: ManagedElement,
  sri: SriPolicy,
  log: Logger,
): RecoveryTransport<void> {
  let current = source;

  return {
    attempt(input, signal) {
      return new Promise((resolve) => {
        if (signal.aborted) {
          resolve({ ok: false, failure: { kind: 'aborted' } });
          return;
        }

        const parent = current.parentNode;
        if (!parent) {
          log.warn('observer element parent is missing', { url: input.url });
          resolve({
            ok: false,
            failure: { kind: 'unknown', error: new Error('observer element parent is missing') },
          });
          return;
        }

        const fallback = input.phase === 'fallback';
        let fetchUrl = fallback ? stripRetryParam(input.url) : input.url;
        if (!fallback && input.attempt > 1 && needsCacheBust(current)) {
          fetchUrl = appendRetryParam(fetchUrl, input.attempt - 1);
        }

        const replacement = cloneTag(
          current,
          fetchUrl,
          Math.max(0, input.attempt - 1),
          sri,
          fallback,
        );
        let settled = false;

        const cleanup = () => {
          replacement.removeEventListener('load', onLoad);
          replacement.removeEventListener('error', onError);
          signal.removeEventListener('abort', onAbort);
        };
        const settle = (result: Parameters<typeof resolve>[0]) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        };
        const onLoad = () => settle({ ok: true, value: undefined });
        const onError = (event: Event) =>
          settle({ ok: false, failure: { kind: 'load-error', error: event } });
        const onAbort = () => {
          if (replacement.parentNode) replacement.parentNode.removeChild(replacement);
          settle({ ok: false, failure: { kind: 'aborted' } });
        };

        replacement.addEventListener('load', onLoad);
        replacement.addEventListener('error', onError);
        signal.addEventListener('abort', onAbort, { once: true });

        try {
          if (current.parentNode) current.parentNode.replaceChild(replacement, current);
          else parent.appendChild(replacement);
          current = replacement;
        } catch (error) {
          log.warn('observer replacement failed', error);
          settle({ ok: false, failure: { kind: 'unknown', error } });
        }
      });
    },
  };
}

function isSupportedElement(element: HTMLElement): element is ManagedElement {
  const tagName = element.tagName.toUpperCase();
  if (tagName === 'SCRIPT') return true;
  if (tagName !== 'LINK') return false;

  const rel = (element.getAttribute('rel') || '').toLowerCase();
  return rel.split(/\s+/).some((token) => token === 'stylesheet');
}

function isWebpackChunkScript(element: HTMLElement): boolean {
  return element.tagName.toUpperCase() === 'SCRIPT' && element.hasAttribute('data-webpack');
}

function needsCacheBust(element: ManagedElement): boolean {
  return element.tagName.toUpperCase() === 'SCRIPT' && element.getAttribute('type') === 'module';
}

function readUrl(element: ManagedElement): string {
  return element.tagName.toUpperCase() === 'SCRIPT'
    ? element.getAttribute('src') || ''
    : element.getAttribute('href') || '';
}

const SCRIPT_FORWARDED_ATTRS = [
  'type',
  'crossorigin',
  'nonce',
  'referrerpolicy',
  'fetchpriority',
  'async',
  'defer',
  'noModule',
];

const LINK_FORWARDED_ATTRS = [
  'rel',
  'as',
  'type',
  'media',
  'crossorigin',
  'nonce',
  'referrerpolicy',
  'fetchpriority',
  'disabled',
];

function cloneTag(
  source: ManagedElement,
  newUrl: string,
  nextAttempt: number,
  sri: SriPolicy,
  fallback: boolean,
): ManagedElement {
  const tagName = source.tagName.toLowerCase();
  const replacement = document.createElement(tagName) as ManagedElement;
  const forwarded = tagName === 'script' ? SCRIPT_FORWARDED_ATTRS : LINK_FORWARDED_ATTRS;

  for (const attribute of forwarded) {
    if (source.hasAttribute(attribute)) {
      replacement.setAttribute(attribute, source.getAttribute(attribute) || '');
    }
  }

  if (sri !== 'strip' && source.hasAttribute('integrity')) {
    replacement.setAttribute('integrity', source.getAttribute('integrity') || '');
  }

  replacement.setAttribute(ATTEMPT_ATTR, String(nextAttempt));
  replacement.setAttribute(MANAGED_ATTR, '1');
  if (fallback) replacement.setAttribute(FALLBACK_ATTR, '1');

  if (tagName === 'script') {
    (replacement as HTMLScriptElement).src = newUrl;
  } else {
    (replacement as HTMLLinkElement).href = newUrl;
  }

  return replacement;
}
