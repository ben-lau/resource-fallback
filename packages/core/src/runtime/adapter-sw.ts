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
  register(
    scriptURL: string,
    options?: RegistrationOptions,
  ): Promise<ServiceWorkerRegistrationLike>;
  getRegistrations?(): Promise<ServiceWorkerRegistrationLike[]>;
  ready?: Promise<ServiceWorkerRegistrationLike>;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
}

interface ServiceWorkerRegistrationLike {
  active?: { scriptURL?: string; postMessage(message: unknown): void } | null;
  waiting?: { postMessage(message: unknown): void } | null;
  installing?: { postMessage(message: unknown): void } | null;
  update?(): Promise<ServiceWorkerRegistrationLike>;
  unregister?(): Promise<boolean>;
}

export function installSwAdapter(deps: SwAdapterDeps): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  const options = normalizeServiceWorkerOptions(deps.config.serviceWorker);
  if (!options.enabled) {
    unregisterStaleWorkers(deps.log, options.path);
    return;
  }
  if (!deps.config.serviceWorkerManifest) {
    deps.log.warn('Service Worker enabled but manifest is missing; skip registration');
    return;
  }

  const container = (navigator as unknown as { serviceWorker?: ServiceWorkerContainerLike })
    .serviceWorker;
  if (!container || typeof container.register !== 'function') {
    deps.log.warn('Service Worker is not supported in this environment');
    return;
  }
  if (!isSecureServiceWorkerContext()) {
    deps.log.warn('Service Worker requires HTTPS or localhost');
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

  container
    .register(options.path, {
      scope: options.scope,
      updateViaCache: 'none' as ServiceWorkerUpdateViaCache,
    })
    .then((registration) => {
      postConfig(registration, message);
      if (registration.update) {
        registration.update().catch(() => {});
      }
      if (container.ready) {
        container.ready
          .then((readyRegistration) => postConfig(readyRegistration, message))
          .catch((err) => {
            deps.log.warn('waiting for Service Worker ready failed', err);
          });
      }
    })
    .catch((err) => {
      deps.log.warn('Service Worker registration failed', err);
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
  else if (event.event === 'fallback')
    bus.emitFallback(event.payload as Parameters<HookBus['emitFallback']>[0]);
  else if (event.event === 'success')
    bus.emitSuccess(event.payload as Parameters<HookBus['emitSuccess']>[0]);
  else if (event.event === 'error')
    bus.emitError(event.payload as Parameters<HookBus['emitError']>[0]);
}

function unregisterStaleWorkers(log: Logger, swPath: string): void {
  const container = (navigator as unknown as { serviceWorker?: ServiceWorkerContainerLike })
    .serviceWorker;
  if (!container?.getRegistrations) return;
  container
    .getRegistrations()
    .then((registrations) => {
      for (const reg of registrations) {
        const scriptURL = reg.active?.scriptURL || '';
        try {
          if (new URL(scriptURL).pathname === swPath && reg.unregister) {
            reg
              .unregister()
              .then((ok) => {
                if (ok)
                  log.info('unregistered previous resource-fallback Service Worker', { scriptURL });
              })
              .catch(() => {});
          }
        } catch {
          /* invalid URL, skip */
        }
      }
    })
    .catch(() => {});
}

function isSecureServiceWorkerContext(): boolean {
  const loc = window.location;
  return loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
}
