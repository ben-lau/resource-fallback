import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type CircuitRegistry,
  type RecoveryCoordinator,
} from '../packages/core/src/internal/coordinator';
import {
  createOwnershipRegistry,
  type OwnershipRegistry,
} from '../packages/core/src/internal/ownership';
import {
  installWebpackAdapter,
  type WebpackRequireLike,
} from '../packages/core/src/runtime/adapter-webpack';
import { createHookBus } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';

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

function installRuntime(
  nativeLoad: NonNullable<WebpackRequireLike['l']>,
  overrides: Partial<{
    coordinator: RecoveryCoordinator;
    ownership: OwnershipRegistry;
  }> = {},
) {
  const config = compileRuntimeConfig({
    rules: [
      {
        base: cdn1,
        urls: [cdn1, cdn2],
        retry: { max: 1, baseDelay: 0, maxDelay: 0, jitter: false },
      },
    ],
  });
  const coordinator =
    overrides.coordinator ||
    createRecoveryCoordinator({
      config,
      bus: createHookBus({}, createLogger(false)),
      circuit: createCircuit(),
    });
  const control = installWebpackAdapter({
    coordinator,
    ownership: overrides.ownership || createOwnershipRegistry(),
    log: createLogger(false),
    chunkLoadingGlobals: ['webpackChunk_contract'],
  });
  const chunks = (window as unknown as Record<string, unknown>)
    .webpackChunk_contract as Array<unknown>;
  const runtime = (req: WebpackRequireLike) => {
    req.l = nativeLoad;
  };
  chunks.push([['1'], {}, runtime]);
  const stored = chunks[chunks.length - 1] as [unknown, unknown, (req: WebpackRequireLike) => void];
  const req: WebpackRequireLike = {
    nc: 'nonce-value',
    crossOrigin: 'anonymous',
    referrerPolicy: 'no-referrer',
    charset: 'utf-8',
  };
  stored[2](req);
  return { control, req };
}

describe('webpack coordinator transport', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).webpackChunk_contract;
    document.head.innerHTML = '';
  });

  it('uses the native webpack loader for the first attempt', async () => {
    const nativeLoad = vi.fn((_url: string, done: (event?: { type: string }) => void) => {
      done({ type: 'load' });
    });
    const done = vi.fn();
    const { control, req } = installRuntime(nativeLoad);

    req.l!('https://cdn1.example.com/a.js', done, 'app:42', 42);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(nativeLoad).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    control.dispose();
  });

  it('shares concurrent callbacks for one chunk key', async () => {
    let complete!: (event?: { type: string }) => void;
    const nativeLoad = vi.fn((_url: string, done: (event?: { type: string }) => void) => {
      complete = done;
    });
    const firstDone = vi.fn();
    const secondDone = vi.fn();
    const { control, req } = installRuntime(nativeLoad);

    req.l!('https://cdn1.example.com/a.js', firstDone, 'app:42', 42);
    req.l!('https://cdn1.example.com/a.js', secondDone, 'app:42', 42);
    expect(nativeLoad).toHaveBeenCalledTimes(1);

    complete({ type: 'load' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstDone).toHaveBeenCalledTimes(1);
    expect(secondDone).toHaveBeenCalledTimes(1);
    control.dispose();
  });

  it('falls back to native webpack loader once when chunk ownership is denied', async () => {
    const nativeLoad = vi.fn(
      (
        _url: string,
        done: (event?: { type: string }) => void,
        _key?: string,
        _chunkId?: string | number,
      ) => {
        done({ type: 'load' });
      },
    );
    const done = vi.fn();
    const coordinator: RecoveryCoordinator = {
      recover: vi.fn(),
      cancelOwner: vi.fn(),
      dispose: vi.fn(),
    };
    const ownership: OwnershipRegistry = {
      admit: vi.fn(() => ({ kind: 'denied' })),
      isClaimed: vi.fn(() => true),
      dispose: vi.fn(),
    };
    const { control, req } = installRuntime(nativeLoad, { coordinator, ownership });

    req.l!('https://cdn1.example.com/a.js', done, 'app:42', 42);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ownership.admit).toHaveBeenCalledWith('webpack', 'chunk:app:42');
    expect(nativeLoad).toHaveBeenCalledTimes(1);
    expect(nativeLoad).toHaveBeenCalledWith(
      'https://cdn1.example.com/a.js',
      expect.any(Function),
      'app:42',
      42,
    );
    expect(coordinator.recover).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith({ type: 'load' });
    control.dispose();
  });

  it('uses stable webpack chunk identity even when retry and fallback URLs change', async () => {
    const nativeLoad = vi.fn((_url: string, done: (event?: { type: string }) => void) => {
      done({ type: 'error' });
    });
    const recover = vi.fn(({ transport }) => {
      void transport.attempt(
        {
          initialUrl: 'https://cdn1.example.com/a.js',
          url: 'https://cdn1.example.com/a.js?__rf=1-test',
          attempt: 2,
          totalAttempts: 3,
          phase: 'retry',
        },
        new AbortController().signal,
      );
      void transport.attempt(
        {
          initialUrl: 'https://cdn1.example.com/a.js',
          url: 'https://cdn2.example.com/a.js',
          attempt: 3,
          totalAttempts: 3,
          phase: 'fallback',
        },
        new AbortController().signal,
      );
      return Promise.resolve({ type: 'load' });
    });
    const coordinator: RecoveryCoordinator = {
      recover,
      cancelOwner: vi.fn(),
      dispose: vi.fn(),
    };
    const done = vi.fn();
    const { control, req } = installRuntime(nativeLoad, { coordinator });

    req.l!('https://cdn1.example.com/a.js', done, 'app:42', 42);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover.mock.calls[0][0].logicalKey).toBe('chunk:app:42');
    const scripts = Array.from(document.querySelectorAll('script[data-webpack="app:42"]'));
    expect(scripts.map((script) => (script as HTMLScriptElement).src)).toEqual([
      'https://cdn1.example.com/a.js?__rf=1-test',
      'https://cdn2.example.com/a.js',
    ]);
    control.dispose();
  });

  it('creates a fresh retry script and preserves Webpack metadata', async () => {
    const nativeLoad = vi.fn((_url: string, done: (event?: { type: string }) => void) => {
      done({ type: 'error' });
    });
    const done = vi.fn();
    const { control, req } = installRuntime(nativeLoad);

    req.l!('https://cdn1.example.com/a.js', done, 'app:42', 42);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const retry = document.querySelector('script[data-webpack="app:42"]') as HTMLScriptElement;
    expect(retry).toBeTruthy();
    expect(retry.async).toBe(true);
    expect(retry.nonce).toBe('nonce-value');
    expect(retry.crossOrigin).toBe('anonymous');
    expect(retry.referrerPolicy).toBe('no-referrer');
    retry.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(done).toHaveBeenCalledTimes(1);
    control.dispose();
  });
});
