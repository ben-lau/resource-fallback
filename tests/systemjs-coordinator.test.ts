import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type CircuitRegistry,
  type RecoveryCoordinator,
} from '../packages/core/src/internal/coordinator';
import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';
import { urlResourceKey } from '../packages/core/src/internal/resource-identity';
import {
  installSystemJSAdapter,
  type SystemJSLike,
} from '../packages/core/src/runtime/adapter-systemjs';
import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';

const cdn1 = 'https://cdn1.example.com/';

function createCircuit(): CircuitRegistry {
  return {
    isOpen: () => false,
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
    dispose: vi.fn(),
  };
}

function createSystem(behavior?: { shouldFail?: (url: string) => boolean }) {
  const requests: string[] = [];
  const failures: Error[] = [];
  function SystemConstructor() {}
  const proto = {
    instantiate(url: string) {
      requests.push(url);
      if (behavior?.shouldFail?.(url)) {
        const failure = new Error('load failed: ' + url);
        failures.push(failure);
        return Promise.reject(failure);
      }
      return Promise.resolve([[], () => ({})]);
    },
    getRegister() {
      return undefined;
    },
  } as unknown as SystemJSLike['constructor']['prototype'];
  SystemConstructor.prototype = proto;
  const system = Object.create(proto) as SystemJSLike;
  system.constructor = SystemConstructor as SystemJSLike['constructor'];
  system.import = (id: string) => proto.instantiate.call(system, id);
  system.getRegister = () => undefined;
  return { system, proto, requests, failures };
}

function createDeps() {
  const config = compileRuntimeConfig({
    rules: [
      {
        base: cdn1,
        urls: [cdn1],
        retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
      },
    ],
  });
  const coordinator = createRecoveryCoordinator({
    config,
    bus: createHookBus({}, createLogger(false)),
    circuit: createCircuit(),
  });
  return {
    config,
    coordinator,
    ownership: createOwnershipRegistry(),
    log: createLogger(false),
  };
}

describe('systemjs coordinator proxy', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).System;
  });

  it('hooks a runtime that appears after installation and delegates by current prototype', async () => {
    const first = createSystem();
    const second = createSystem();
    (window as unknown as Record<string, unknown>).System = first.system;
    const control = installSystemJSAdapter(createDeps());
    await new Promise((resolve) => setTimeout(resolve, 100));

    (window as unknown as Record<string, unknown>).System = second.system;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await second.system.import(cdn1 + 'chunk.js');

    expect(first.requests).toHaveLength(0);
    expect(second.requests).toContain(cdn1 + 'chunk.js');
    control.dispose();
  });

  it('restores the prototype and permits a clean reinstall', async () => {
    const runtime = createSystem();
    (window as unknown as Record<string, unknown>).System = runtime.system;
    const original = runtime.proto.instantiate;

    const first = installSystemJSAdapter(createDeps());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runtime.proto.instantiate).not.toBe(original);

    first.dispose();
    expect(runtime.proto.instantiate).toBe(original);

    const second = installSystemJSAdapter(createDeps());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runtime.proto.instantiate).not.toBe(original);
    second.dispose();
  });

  it('joins concurrent canonical SystemJS URLs into the same recovery Promise', async () => {
    const runtime = createSystem();
    (window as unknown as Record<string, unknown>).System = runtime.system;
    const control = installSystemJSAdapter(createDeps());
    await new Promise((resolve) => setTimeout(resolve, 100));

    const first = runtime.proto.instantiate(cdn1 + 'chunk.js');
    const second = runtime.proto.instantiate(cdn1 + 'chunk.js#module');

    expect(second).toBe(first);
    await expect(first).resolves.toEqual([[], expect.any(Function)]);
    expect(runtime.requests).toEqual([cdn1 + 'chunk.js']);
    control.dispose();
  });

  it('shares the same mapped rejection Promise for concurrent canonical SystemJS URLs', async () => {
    const runtime = createSystem({ shouldFail: () => true });
    (window as unknown as Record<string, unknown>).System = runtime.system;
    const control = installSystemJSAdapter(createDeps());
    await new Promise((resolve) => setTimeout(resolve, 100));

    const first = runtime.proto.instantiate(cdn1 + 'fail.js');
    const second = runtime.proto.instantiate(cdn1 + 'fail.js#module');

    expect(second).toBe(first);
    await expect(first).rejects.toBe(runtime.failures[0]);
    await expect(second).rejects.toBe(runtime.failures[0]);
    expect(runtime.requests).toEqual([cdn1 + 'fail.js']);
    control.dispose();
  });

  it('uses native instantiate when another entrance already owns the canonical URL', async () => {
    const runtime = createSystem();
    (window as unknown as Record<string, unknown>).System = runtime.system;
    const ownership = createOwnershipRegistry();
    const admission = ownership.admit('observer', urlResourceKey(cdn1 + 'owned.js'));
    expect(admission.kind).toBe('acquired');
    const coordinator = {
      recover: vi.fn(),
      cancelOwner: vi.fn(),
      dispose: vi.fn(),
    } satisfies RecoveryCoordinator;
    const control = installSystemJSAdapter({
      config: createDeps().config,
      coordinator,
      ownership,
      log: createLogger(false),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await runtime.proto.instantiate(cdn1 + 'owned.js#module');

    expect(result).toEqual([[], expect.any(Function)]);
    expect(runtime.requests).toEqual([cdn1 + 'owned.js#module']);
    expect(coordinator.recover).not.toHaveBeenCalled();
    control.dispose();
    if (admission.kind === 'acquired') admission.lease.release();
  });
});
