import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type CircuitRegistry,
} from '../packages/core/src/internal/coordinator';
import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';
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

function installRuntime(nativeLoad: NonNullable<WebpackRequireLike['l']>) {
  const config = compileRuntimeConfig({
    rules: [
      {
        base: cdn1,
        urls: [cdn1, cdn2],
        retry: { max: 1, baseDelay: 0, maxDelay: 0, jitter: false },
      },
    ],
  });
  const coordinator = createRecoveryCoordinator({
    config,
    bus: createHookBus({}, createLogger(false)),
    circuit: createCircuit(),
  });
  const control = installWebpackAdapter({
    coordinator,
    ownership: createOwnershipRegistry(),
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
