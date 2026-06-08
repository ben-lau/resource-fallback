import type { ErrorEvent, FallbackEvent, RetryEvent, RuntimeHooks, SuccessEvent } from '../types';
import type { Logger } from './logger';

export interface HookBus {
  emitRetry(e: RetryEvent): void;
  emitFallback(e: FallbackEvent): void;
  emitSuccess(e: SuccessEvent): void;
  emitError(e: ErrorEvent): void;
}

export function createHookBus(hooks: RuntimeHooks | undefined, log: Logger): HookBus {
  const safeCall = <T>(fn: ((e: T) => void) | undefined, e: T, name: string) => {
    if (!fn) return;
    try {
      fn(e);
    } catch (err) {
      log.warn('钩子 ' + name + ' 抛出异常', err);
    }
  };

  // 在调用 JS 钩子的同时分发 DOM CustomEvent，这样即使在插件配置之外的应用代码
  // （如在 app source 中）也能通过 `window.addEventListener('rf:retry', ...)`
  // 订阅。插件配置中的函数钩子在 JSON 序列化时会被丢弃，因此 DOM 事件通道是
  // 应用代码观察运行时决策的主要方式。
  const dispatch = (name: string, detail: unknown) => {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch {
      /* CustomEvent 构造函数不支持（很老的 IE）——吞掉 */
    }
  };

  return {
    emitRetry(e) {
      log.debug('retry', e);
      dispatch('rf:retry', e);
      safeCall(hooks?.onRetry, e, 'onRetry');
    },
    emitFallback(e) {
      log.info('fallback', e);
      dispatch('rf:fallback', e);
      safeCall(hooks?.onFallback, e, 'onFallback');
    },
    emitSuccess(e) {
      log.debug('success', e);
      dispatch('rf:success', e);
      safeCall(hooks?.onSuccess, e, 'onSuccess');
    },
    emitError(e) {
      log.error('error', e);
      dispatch('rf:error', e);
      safeCall(hooks?.onError, e, 'onError');
    },
  };
}
