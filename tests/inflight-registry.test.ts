import { describe, expect, it } from 'vitest';
import { createInFlightRegistry } from '../packages/core/src/internal/inflight-registry';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('in-flight registry', () => {
  it('shares one promise for the same owner and logical key', async () => {
    const registry = createInFlightRegistry();
    const pending = deferred<string>();
    let created = 0;

    const first = registry.getOrCreate('vite\0chunk-a', () => {
      created += 1;
      return { promise: pending.promise, cancel: () => pending.reject(new Error('cancelled')) };
    });
    const second = registry.getOrCreate('vite\0chunk-a', () => {
      created += 1;
      return { promise: Promise.resolve('unexpected'), cancel() {} };
    });

    expect(first).toBe(second);
    expect(created).toBe(1);
    pending.resolve('module');
    await expect(first).resolves.toBe('module');
  });

  it('keeps different logical keys independent and cancels selected owners', async () => {
    const registry = createInFlightRegistry();
    const vite = deferred<string>();
    const observer = deferred<string>();
    let viteCancelled = 0;
    let observerCancelled = 0;

    const vitePromise = registry.getOrCreate('vite\0chunk-a', () => ({
      promise: vite.promise,
      cancel: () => {
        viteCancelled += 1;
        vite.reject(new Error('vite cancelled'));
      },
    }));
    const observerPromise = registry.getOrCreate('observer\0element-a', () => ({
      promise: observer.promise,
      cancel: () => {
        observerCancelled += 1;
        observer.reject(new Error('observer cancelled'));
      },
    }));

    registry.cancelWhere((key) => key.startsWith('vite\0'));
    await expect(vitePromise).rejects.toThrow('vite cancelled');
    expect(observerCancelled).toBe(0);
    observer.resolve('style');
    await expect(observerPromise).resolves.toBe('style');
    expect(viteCancelled).toBe(1);
  });

  it('does not reuse an entry after it settles and dispose is idempotent', async () => {
    const registry = createInFlightRegistry();
    const first = registry.getOrCreate('vite\0chunk-a', () => ({
      promise: Promise.resolve('first'),
      cancel() {},
    }));
    await expect(first).resolves.toBe('first');

    const second = registry.getOrCreate('vite\0chunk-a', () => ({
      promise: Promise.resolve('second'),
      cancel() {},
    }));
    await expect(second).resolves.toBe('second');
    registry.dispose();
    registry.dispose();
    expect(registry.size()).toBe(0);
  });
});
