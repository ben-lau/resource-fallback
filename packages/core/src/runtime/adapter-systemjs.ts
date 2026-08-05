import type { RecoveryCoordinator, RecoveryTransport } from '../internal/coordinator';
import type { PreparedRuntimeConfig } from '../internal/config';
import type { OwnershipRegistry } from '../internal/ownership';
import { urlResourceKey } from '../internal/resource-identity';
import type { Logger } from './logger';

export interface SystemJSProto {
  instantiate(url: string, parentUrl?: string): Promise<unknown>;
  getRegister?(url?: string): unknown;
  __rfHooked?: boolean;
}

export interface SystemJSLike {
  constructor: { prototype: SystemJSProto };
  import(id: string, parentUrl?: string): Promise<unknown>;
  getRegister(url?: string): unknown;
}

export interface SystemJSAdapterDeps {
  config: PreparedRuntimeConfig;
  coordinator: RecoveryCoordinator;
  ownership: OwnershipRegistry;
  log: Logger;
}

interface Registration {
  readonly proto: SystemJSProto;
  readonly original: SystemJSProto['instantiate'];
  readonly proxy: SystemJSProto['instantiate'];
  readonly deps: SystemJSAdapterDeps;
  readonly hadMarker: boolean;
  readonly markerValue: boolean | undefined;
  active: boolean;
}

const registrations = new WeakMap<object, Registration>();

export function installSystemJSAdapter(deps: SystemJSAdapterDeps): { dispose(): void } {
  if (typeof window === 'undefined') return { dispose() {} };

  const w = window as unknown as Record<string, unknown>;
  const ownedRegistrations: Registration[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let disposed = false;

  tryHook();
  for (const delay of [50, 100, 200, 500, 1000, 2000, 5000]) {
    timers.push(setTimeout(tryHook, delay));
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      if (ownedRegistrations.length > 0) deps.coordinator.cancelOwner('systemjs');

      for (let i = ownedRegistrations.length - 1; i >= 0; i--) {
        const registration = ownedRegistrations[i];
        registration.active = false;
        const { proto } = registration;
        if (proto.instantiate === registration.proxy) proto.instantiate = registration.original;
        if (registration.hadMarker) proto.__rfHooked = registration.markerValue;
        else delete proto.__rfHooked;
        if (registrations.get(proto) === registration) registrations.delete(proto);
      }
    },
  };

  function tryHook(): void {
    if (disposed) return;

    const system = w.System as SystemJSLike | undefined;
    if (!system || !system.constructor) return;

    const proto = system.constructor.prototype;
    if (!proto || typeof proto.instantiate !== 'function') return;

    const existing = registrations.get(proto);
    if (existing?.active) return;
    if (proto.__rfHooked) return;

    const original = proto.instantiate;
    const hadMarker = Object.prototype.hasOwnProperty.call(proto, '__rfHooked');
    const markerValue = proto.__rfHooked;
    const registration = {} as Registration;
    const proxy = proxyInstantiate as SystemJSProto['instantiate'];
    Object.assign(registration, {
      proto,
      original,
      proxy,
      deps,
      hadMarker,
      markerValue,
      active: true,
    });
    registrations.set(proto, registration);
    ownedRegistrations.push(registration);
    proto.__rfHooked = true;
    proto.instantiate = proxy;
    replayDeferredEntries(system, registration);
    deps.log.debug('SystemJS adapter: instantiate hooked');
  }
}

function proxyInstantiate(this: SystemJSLike, url: string, parentUrl?: string): Promise<unknown> {
  const directRegistration = registrations.get(this as unknown as object);
  const proto = directRegistration
    ? directRegistration.proto
    : this.constructor && this.constructor.prototype;
  const registration = directRegistration || (proto && registrations.get(proto));
  if (!registration || !registration.active) {
    return (
      registration?.original.call(this, url, parentUrl) ||
      Promise.reject(new Error('SystemJS adapter is inactive'))
    );
  }

  if (!matchesPreparedRule(registration.deps.config, url)) {
    return registration.original.call(this, url, parentUrl);
  }

  const self = this;
  const logicalKey = urlResourceKey(url);
  const admission = registration.deps.ownership.admit('systemjs', logicalKey);

  if (admission.kind === 'denied') {
    return registration.original.call(self, url, parentUrl);
  }

  const transport: RecoveryTransport<unknown> = {
    attempt(input, signal) {
      if (signal.aborted) return Promise.resolve({ ok: false, failure: { kind: 'aborted' } });
      return Promise.resolve(registration.original.call(self, input.url, parentUrl)).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, failure: { kind: 'load-error', error } }),
      );
    },
  };

  let recovery: Promise<unknown>;
  try {
    recovery = registration.deps.coordinator.recover({
      owner: 'systemjs',
      logicalKey,
      initialUrl: url,
      mapFailure: unwrapFailure,
      transport,
    });
  } catch (error) {
    if (admission.kind === 'acquired') admission.lease.release();
    return Promise.reject(error);
  }

  if (admission.kind === 'acquired') {
    void recovery
      .finally(() => admission.lease.release())
      .catch(() => {
        // instantiate() 的返回 promise 负责把原生失败交给调用方。
      });
  }
  return recovery;
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

function replayDeferredEntries(system: SystemJSLike, registration: Registration): void {
  if (typeof document === 'undefined' || !registration.active) return;

  const scripts = document.querySelectorAll('script[data-src]');
  for (const script of scripts) {
    const source = script.getAttribute('data-src');
    if (!source) continue;
    registration.deps.log.info('SystemJS adapter: replaying deferred import', { src: source });
    void system.import(source).catch((error) => {
      registration.deps.log.error('SystemJS adapter: deferred import failed', error);
    });
  }
}
