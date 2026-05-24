import type { RuntimeConfig } from '../types';
import { normalizeServiceWorkerOptions } from '../service-worker';
import type { HookBus } from './hooks';
import type { Logger } from './logger';

interface SwAdapterDeps {
  config: RuntimeConfig;
  bus: HookBus;
  log: Logger;
}

interface ServiceWorkerContainerLike {
  register(scriptURL: string, options?: RegistrationOptions): Promise<ServiceWorkerRegistrationLike>;
  ready?: Promise<ServiceWorkerRegistrationLike>;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
}

interface ServiceWorkerRegistrationLike {
  active?: { postMessage(message: unknown): void } | null;
  waiting?: { postMessage(message: unknown): void } | null;
  installing?: { postMessage(message: unknown): void } | null;
}

export function installSwAdapter(deps: SwAdapterDeps): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  const options = normalizeServiceWorkerOptions(deps.config.serviceWorker);
  if (!options.enabled) return;
  if (!deps.config.serviceWorkerManifest) {
    deps.log.warn('Service Worker 已启用但缺少 manifest，跳过注册');
    return;
  }

  const container = (navigator as unknown as { serviceWorker?: ServiceWorkerContainerLike }).serviceWorker;
  if (!container || typeof container.register !== 'function') {
    deps.log.warn('当前环境不支持 Service Worker');
    return;
  }
  if (!isSecureServiceWorkerContext()) {
    deps.log.warn('Service Worker 需要 HTTPS 或 localhost 环境');
    return;
  }

  container.addEventListener('message', (event: MessageEvent) => {
    bridgeEvent(event.data, deps.bus);
  });

  const message = {
    type: 'RF_SW_CONFIG',
    manifest: deps.config.serviceWorkerManifest,
    runtimeConfig: deps.config,
    serviceWorker: options,
  };

  container.register(options.path, { scope: options.scope })
    .then((registration) => {
      postConfig(registration, message);
      if (container.ready) {
        container.ready.then((readyRegistration) => postConfig(readyRegistration, message)).catch((err) => {
          deps.log.warn('等待 Service Worker ready 失败', err);
        });
      }
    })
    .catch((err) => {
      deps.log.warn('Service Worker 注册失败', err);
    });
}

function postConfig(registration: ServiceWorkerRegistrationLike, message: unknown): void {
  const target = registration.active || registration.waiting || registration.installing;
  if (target) target.postMessage(message);
}

function bridgeEvent(data: unknown, bus: HookBus): void {
  const event = data as { type?: string; event?: string; payload?: unknown } | null;
  if (!event || event.type !== 'RF_SW_EVENT') return;
  if (event.event === 'retry') bus.emitRetry(event.payload as Parameters<HookBus['emitRetry']>[0]);
  else if (event.event === 'fallback') bus.emitFallback(event.payload as Parameters<HookBus['emitFallback']>[0]);
  else if (event.event === 'success') bus.emitSuccess(event.payload as Parameters<HookBus['emitSuccess']>[0]);
  else if (event.event === 'error') bus.emitError(event.payload as Parameters<HookBus['emitError']>[0]);
}

function isSecureServiceWorkerContext(): boolean {
  const loc = window.location;
  return loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
}
