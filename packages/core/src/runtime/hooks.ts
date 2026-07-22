import type { ErrorEvent, FallbackEvent, RetryEvent, RuntimeHooks, SuccessEvent } from '../types';
import type { Logger } from './logger';

export interface HookBus {
  emitRetry(e: RetryEvent): void;
  emitFallback(e: FallbackEvent): void;
  emitSuccess(e: SuccessEvent): void;
  emitError(e: ErrorEvent): void;
}

export type RecoveryEvent =
  | { type: 'retry'; event: RetryEvent }
  | { type: 'fallback'; event: FallbackEvent }
  | { type: 'success'; event: SuccessEvent }
  | { type: 'error'; event: ErrorEvent };

export interface EventBus extends HookBus {
  transition(sessionId: string, event: RecoveryEvent): void;
  close(sessionId: string): void;
  dispose(): void;
}

export function createHookBus(hooks: RuntimeHooks | undefined, log: Logger): EventBus {
  const sessions = new Map<string, { terminal: boolean }>();
  const safeCall = <T>(fn: ((e: T) => void) | undefined, e: T, name: string) => {
    if (!fn) return;
    try {
      fn(e);
    } catch (err) {
      log.warn('hook ' + name + ' threw', err);
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

  const bus: EventBus = {
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
    transition(sessionId, event) {
      const session = sessions.get(sessionId) || { terminal: false };
      sessions.set(sessionId, session);
      if (session.terminal) return;
      if (event.type === 'retry') bus.emitRetry(event.event);
      else if (event.type === 'fallback') bus.emitFallback(event.event);
      else if (event.type === 'success') {
        session.terminal = true;
        bus.emitSuccess(event.event);
      } else {
        session.terminal = true;
        bus.emitError(event.event);
      }
    },
    close(sessionId) {
      const session = sessions.get(sessionId) || { terminal: false };
      session.terminal = true;
      sessions.set(sessionId, session);
    },
    dispose() {
      sessions.clear();
    },
  };

  return bus;
}
