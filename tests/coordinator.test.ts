import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type AttemptResult,
  type CircuitRegistry,
  type RecoveryRequest,
} from '../packages/core/src/internal/coordinator';
import type { HookBus } from '../packages/core/src/runtime/hooks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function failure(kind: 'network' | 'timeout' = 'network'): AttemptResult<never> {
  return { ok: false, failure: { kind } };
}

function success<T>(value: T): AttemptResult<T> {
  return { ok: true, value };
}

function createBus() {
  return {
    emitRetry: vi.fn(),
    emitFallback: vi.fn(),
    emitSuccess: vi.fn(),
    emitError: vi.fn(),
  } satisfies HookBus;
}

function createCircuit(): CircuitRegistry & {
  isOpen: ReturnType<typeof vi.fn>;
  recordFailure: ReturnType<typeof vi.fn>;
  recordSuccess: ReturnType<typeof vi.fn>;
} {
  return {
    isOpen: vi.fn(() => false),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
    dispose: vi.fn(),
  };
}

function createConfig(max = 0) {
  return compileRuntimeConfig({
    rules: [
      {
        base: 'https://a.test/',
        urls: ['https://b.test/'],
        retry: { max, baseDelay: 0, maxDelay: 0, jitter: false },
      },
    ],
  });
}

function request<T>(transport: RecoveryRequest<T>['transport']): RecoveryRequest<T> {
  return {
    owner: 'vite',
    logicalKey: 'chunk-a',
    initialUrl: 'https://a.test/chunk.js',
    transport,
  };
}

describe('recovery coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one attempt chain for the same owner and logical key', async () => {
    const bus = createBus();
    const circuit = createCircuit();
    const transport = {
      attempt: vi.fn().mockResolvedValueOnce(failure()).mockResolvedValueOnce(success('module')),
    };
    const coordinator = createRecoveryCoordinator({
      config: createConfig(),
      bus,
      circuit,
      random: () => 0.5,
    });
    const first = coordinator.recover(request(transport));
    const second = coordinator.recover(request(transport));

    await expect(Promise.all([first, second])).resolves.toEqual(['module', 'module']);
    expect(transport.attempt).toHaveBeenCalledTimes(2);
    expect(bus.emitFallback).toHaveBeenCalledTimes(1);
    expect(bus.emitSuccess).toHaveBeenCalledTimes(1);
    expect(bus.emitError).not.toHaveBeenCalled();
    expect(circuit.recordFailure).toHaveBeenCalledTimes(1);
    expect(circuit.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it('ignores a success callback after an attempt deadline', async () => {
    const bus = createBus();
    const circuit = createCircuit();
    const pending = deferred<AttemptResult<string>>();
    const transport = { attempt: vi.fn(() => pending.promise) };
    const coordinator = createRecoveryCoordinator({
      config: compileRuntimeConfig({
        rules: [
          {
            base: 'https://a.test/',
            urls: ['https://a.test/'],
            retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
          },
        ],
      }),
      bus,
      circuit,
      attemptTimeoutMs: 30_000,
      sessionTimeoutMs: 120_000,
    });
    const promise = coordinator.recover(request(transport));

    await vi.advanceTimersByTimeAsync(30_001);
    await expect(promise).rejects.toMatchObject({ kind: 'timeout' });
    expect(bus.emitError).toHaveBeenCalledTimes(1);

    pending.resolve(success('late'));
    await Promise.resolve();
    expect(bus.emitSuccess).not.toHaveBeenCalled();
    expect(bus.emitError).toHaveBeenCalledTimes(1);
  });

  it('cancels the active session without falling back', async () => {
    const bus = createBus();
    const circuit = createCircuit();
    const pending = deferred<AttemptResult<string>>();
    let signal: AbortSignal | undefined;
    const transport = {
      attempt: vi.fn((_input, receivedSignal: AbortSignal) => {
        signal = receivedSignal;
        return pending.promise;
      }),
    };
    const coordinator = createRecoveryCoordinator({
      config: createConfig(),
      bus,
      circuit,
    });
    const promise = coordinator.recover(request(transport));

    coordinator.cancelOwner('vite');
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
    expect(signal?.aborted).toBe(true);
    expect(bus.emitFallback).not.toHaveBeenCalled();
    expect(circuit.recordFailure).not.toHaveBeenCalled();

    pending.resolve(success('late'));
    await Promise.resolve();
    expect(bus.emitSuccess).not.toHaveBeenCalled();
  });

  it('rejects all subscribers after exhaustion and emits one terminal error', async () => {
    const bus = createBus();
    const circuit = createCircuit();
    const transport = { attempt: vi.fn().mockResolvedValue(failure()) };
    const coordinator = createRecoveryCoordinator({
      config: createConfig(),
      bus,
      circuit,
    });
    const first = coordinator.recover(request(transport));
    const second = coordinator.recover(request(transport));

    await expect(Promise.all([first, second])).rejects.toMatchObject({ kind: 'network' });
    expect(transport.attempt).toHaveBeenCalledTimes(2);
    expect(bus.emitError).toHaveBeenCalledTimes(1);
    expect(bus.emitSuccess).not.toHaveBeenCalled();
  });
});
