import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type CircuitRegistry,
} from '../packages/core/src/internal/coordinator';
import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';
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

function createSystem() {
  const requests: string[] = [];
  function SystemConstructor() {}
  const proto = {
    instantiate(url: string) {
      requests.push(url);
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
  return { system, proto, requests };
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
});
