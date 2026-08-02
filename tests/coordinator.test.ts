import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type AttemptResult,
  type CircuitRegistry,
  type RecoveryRequest,
} from '../packages/core/src/internal/coordinator';
import type { EventBus, RecoveryEvent } from '../packages/core/src/runtime/hooks';

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
  const bus = {
    emitRetry: vi.fn(),
    emitFallback: vi.fn(),
    emitSuccess: vi.fn(),
    emitError: vi.fn(),
    transition: vi.fn((_sessionId: string, event: RecoveryEvent) => {
      if (event.type === 'retry') bus.emitRetry(event.event);
      else if (event.type === 'fallback') bus.emitFallback(event.event);
      else if (event.type === 'success') bus.emitSuccess(event.event);
      else bus.emitError(event.event);
    }),
    close: vi.fn(),
    dispose: vi.fn(),
  } satisfies EventBus;
  return bus;
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

  it('counts an externally completed failure before starting recovery', async () => {
    const bus = createBus();
    const circuit = createCircuit();
    const transport = {
      attempt: vi.fn().mockResolvedValue(success('fallback-module')),
    };
    const coordinator = createRecoveryCoordinator({
      config: createConfig(0),
      bus,
      circuit,
    });

    const result = await coordinator.recover({
      ...request(transport),
      initialFailure: { kind: 'load-error', error: new Event('error') },
    });

    expect(result).toBe('fallback-module');
    expect(transport.attempt).toHaveBeenCalledTimes(1);
    expect(transport.attempt.mock.calls[0][0]).toMatchObject({
      attempt: 1,
      totalAttempts: 2,
      phase: 'fallback',
    });
    expect(bus.emitFallback).toHaveBeenCalledTimes(1);
  });

  it('does not emit recovery success for a native first-attempt success', async () => {
    const bus = createBus();
    const coordinator = createRecoveryCoordinator({
      config: createConfig(0),
      bus,
      circuit: createCircuit(),
    });

    await coordinator.recover(request({ attempt: vi.fn().mockResolvedValue(success('native')) }));

    expect(bus.transition).not.toHaveBeenCalled();
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

  it('shares the mapped typed Promise for same-entrance callers', async () => {
    const mapped = new Error('native failure');
    const transport = { attempt: vi.fn().mockResolvedValue(failure()) };
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
      circuit: createCircuit(),
    });
    const requestWithMapping = {
      ...request(transport),
      logicalKey: 'mapped-promise',
      mapFailure: () => mapped,
    };

    const first = coordinator.recover(requestWithMapping);
    const second = coordinator.recover(requestWithMapping);

    expect(first).toBe(second);
    await expect(first).rejects.toBe(mapped);
    await expect(second).rejects.toBe(mapped);
    expect(transport.attempt).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit rule id and waits for a positive retry delay', async () => {
    const bus = createBus();
    const circuit = createCircuit();
    const transport = {
      attempt: vi.fn().mockResolvedValueOnce(failure()).mockResolvedValueOnce(success('module')),
    };
    const coordinator = createRecoveryCoordinator({
      config: compileRuntimeConfig({
        rules: [
          {
            base: 'https://a.test/',
            urls: ['https://a.test/'],
            retry: { max: 1, baseDelay: 10, maxDelay: 10, jitter: false },
          },
        ],
      }),
      bus,
      circuit,
    });
    const promise = coordinator.recover({
      ...request(transport),
      initialUrl: 'https://not-matching.test/chunk.js',
      ruleId: 'rule-0',
      logicalKey: 'delayed-chunk',
    });

    await Promise.resolve();
    expect(transport.attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(transport.attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('module');
    expect(bus.emitRetry).toHaveBeenCalledTimes(1);
  });

  it('ends a session at the session deadline and ignores the pending transport', async () => {
    const bus = createBus();
    const circuit = createCircuit();
    const pending = deferred<AttemptResult<string>>();
    const coordinator = createRecoveryCoordinator({
      config: createConfig(),
      bus,
      circuit,
      attemptTimeoutMs: 30_000,
      sessionTimeoutMs: 100,
    });
    const promise = coordinator.recover({
      ...request({ attempt: vi.fn(() => pending.promise) }),
      logicalKey: 'session-timeout',
    });

    await vi.advanceTimersByTimeAsync(101);
    await expect(promise).rejects.toMatchObject({ kind: 'timeout' });
    pending.resolve(success('late'));
    await Promise.resolve();
    expect(bus.emitError).toHaveBeenCalledTimes(1);
    expect(bus.emitSuccess).not.toHaveBeenCalled();
  });

  it('handles missing rules, thrown transports, open circuits, and disposal', async () => {
    const noMatchCoordinator = createRecoveryCoordinator({ config: createConfig() });
    await expect(
      noMatchCoordinator.recover({
        ...request({ attempt: vi.fn() }),
        initialUrl: 'https://unknown.test/chunk.js',
        logicalKey: 'missing-rule',
      }),
    ).rejects.toMatchObject({ kind: 'unknown' });

    const bus = createBus();
    const circuit = createCircuit();
    circuit.isOpen.mockImplementation((host) => host === 'b.test');
    const coordinator = createRecoveryCoordinator({
      config: createConfig(),
      bus,
      circuit,
    });
    const thrown = coordinator.recover({
      ...request({ attempt: vi.fn(() => Promise.reject(new Error('network down'))) }),
      logicalKey: 'thrown-transport',
    });
    await expect(thrown).rejects.toMatchObject({ kind: 'unknown' });
    expect(bus.emitError).toHaveBeenCalledTimes(1);
    expect(circuit.recordFailure).toHaveBeenCalledTimes(1);

    coordinator.dispose();
    coordinator.dispose();
    expect(circuit.dispose).toHaveBeenCalledTimes(1);
    await expect(
      coordinator.recover({
        ...request({ attempt: vi.fn() }),
        logicalKey: 'after-dispose',
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('maps an AbortError thrown by a transport to cancellation', async () => {
    const coordinator = createRecoveryCoordinator({ config: createConfig() });
    const promise = coordinator.recover({
      ...request({ attempt: vi.fn(() => Promise.reject({ name: 'AbortError' })) }),
      logicalKey: 'abort-error',
    });
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });
});
