import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type CircuitRegistry,
  type RecoveryCoordinator,
} from '../packages/core/src/internal/coordinator';
import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';
import { urlResourceKey } from '../packages/core/src/internal/resource-identity';
import { installObserver } from '../packages/core/src/runtime/observer';
import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';
import type { FallbackEvent } from '../packages/core/src/types';

const cdn1 = 'https://cdn1.example.com/';
const cdn2 = 'https://cdn2.example.com/';

function createCircuit(): CircuitRegistry {
  return {
    isOpen: () => false,
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
    dispose: vi.fn(),
  };
}

function createCoordinator(
  onSuccess?: (url: string) => void,
  onFallback?: (event: FallbackEvent) => void,
): RecoveryCoordinator {
  const config = compileRuntimeConfig({
    rules: [
      {
        base: cdn1,
        urls: [cdn1, cdn2],
        retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
      },
    ],
  });
  const bus = createHookBus(
    {
      onSuccess: (event) => onSuccess?.(event.url),
      onFallback,
    },
    createLogger(false),
  );
  return createRecoveryCoordinator({ config, bus, circuit: createCircuit() });
}

function dispatchError(element: HTMLElement): void {
  element.dispatchEvent(new Event('error'));
}

describe('observer coordinator transport', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it.each(['icon', 'manifest', 'canonical', 'preload', 'prefetch', 'modulepreload'])(
    'ignores non-stylesheet link rel=%s',
    (rel) => {
      const coordinator = {
        recover: vi.fn(() => Promise.resolve(undefined)),
        cancelOwner: vi.fn(),
        dispose: vi.fn(),
      } satisfies RecoveryCoordinator;
      const control = installObserver({
        coordinator,
        ownership: createOwnershipRegistry(),
        log: createLogger(false),
        sri: 'strip',
      });
      const link = document.createElement('link');
      link.rel = rel;
      link.href = cdn1 + 'a.css';
      document.head.appendChild(link);

      dispatchError(link);

      expect(coordinator.recover).not.toHaveBeenCalled();
      control.dispose();
    },
  );

  it('accepts stylesheet among multiple rel tokens', () => {
    const coordinator = {
      recover: vi.fn(() => Promise.resolve(undefined)),
      cancelOwner: vi.fn(),
      dispose: vi.fn(),
    } satisfies RecoveryCoordinator;
    const control = installObserver({
      coordinator,
      ownership: createOwnershipRegistry(),
      log: createLogger(false),
      sri: 'strip',
    });
    const link = document.createElement('link');
    link.rel = 'alternate stylesheet';
    link.href = cdn1 + 'a.css';
    document.head.appendChild(link);

    dispatchError(link);

    expect(coordinator.recover).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'observer',
        initialFailure: expect.objectContaining({ kind: 'load-error' }),
      }),
    );
    control.dispose();
  });

  it('hands an existing script error to coordinator and settles from replacement load', async () => {
    const recoveredUrls: string[] = [];
    const control = installObserver({
      coordinator: createCoordinator((url) => recoveredUrls.push(url)),
      ownership: createOwnershipRegistry(),
      log: createLogger(false),
      sri: 'strip',
    });
    const source = document.createElement('script');
    source.src = cdn1 + 'chunk.js';
    document.head.appendChild(source);

    dispatchError(source);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const replacement = document.head.querySelector('script');
    expect(replacement).not.toBe(source);
    expect((replacement as HTMLScriptElement).src).toBe(cdn2 + 'chunk.js');

    replacement?.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recoveredUrls).toEqual([cdn2 + 'chunk.js']);
    control.dispose();
  });

  it('does not recover or replace when another entrance owns the canonical URL', async () => {
    const ownership = createOwnershipRegistry();
    const admission = ownership.admit('vite', urlResourceKey(cdn1 + 'shared.js'));
    expect(admission.kind).toBe('acquired');
    const coordinator = {
      recover: vi.fn(() => Promise.resolve(undefined)),
      cancelOwner: vi.fn(),
      dispose: vi.fn(),
    } satisfies RecoveryCoordinator;
    const control = installObserver({
      coordinator,
      ownership,
      log: createLogger(false),
      sri: 'strip',
    });
    const source = document.createElement('script');
    source.setAttribute('src', cdn1 + 'shared.js#entry');
    document.head.appendChild(source);

    dispatchError(source);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(coordinator.recover).not.toHaveBeenCalled();
    expect(Array.from(document.head.querySelectorAll('script'))).toEqual([source]);
    control.dispose();
    if (admission.kind === 'acquired') admission.lease.release();
  });

  it('joins duplicate synchronous script errors into one fallback replacement', async () => {
    const fallbacks: string[] = [];
    const coordinator = createCoordinator(undefined, (event) => fallbacks.push(String(event.to)));
    const control = installObserver({
      coordinator,
      ownership: createOwnershipRegistry(),
      log: createLogger(false),
      sri: 'strip',
    });
    const source = document.createElement('script');
    source.src = cdn1 + 'shared.js';
    document.head.appendChild(source);

    dispatchError(source);
    dispatchError(source);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fallbacks).toEqual([cdn2 + 'shared.js']);
    const scripts = Array.from(document.head.querySelectorAll('script'));
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toBe(source);
    expect(scripts[0].src).toBe(cdn2 + 'shared.js');
    control.dispose();
  });
});
