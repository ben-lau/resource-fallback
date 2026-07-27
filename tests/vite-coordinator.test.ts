import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compileRuntimeConfig } from '../packages/core/src/internal/config';
import {
  createRecoveryCoordinator,
  type CircuitRegistry,
} from '../packages/core/src/internal/coordinator';
import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';
import { installViteAdapter, setViteImportModule } from '../packages/core/src/runtime/adapter-vite';
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

function createRuntime(importer: (url: string) => Promise<unknown>, onSuccess?: () => void) {
  const config = compileRuntimeConfig({
    rules: [
      {
        base: cdn1,
        urls: [cdn1, cdn2],
        retry: { max: 1, baseDelay: 0, maxDelay: 0, jitter: false },
      },
    ],
  });
  const target: Record<string, unknown> = {};
  const bus = createHookBus({ onSuccess }, createLogger(false));
  const coordinator = createRecoveryCoordinator({ config, bus, circuit: createCircuit() });
  const control = installViteAdapter({
    config,
    coordinator,
    ownership: createOwnershipRegistry(),
    log: createLogger(false),
    target,
    resolveUrl: (filename) => cdn1 + filename,
  });
  setViteImportModule(importer);
  return { target, control };
}

describe('vite coordinator transport', () => {
  beforeEach(() => {
    setViteImportModule(null);
  });

  afterEach(() => {
    setViteImportModule(null);
    delete (window as unknown as Record<string, unknown>).__RF__;
  });

  it('shares concurrent imports for one filename', async () => {
    let resolveImport!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveImport = resolve;
    });
    const importer = vi.fn(() => pending);
    const { target, control } = createRuntime(importer);
    const load = target.load as (filename: string) => Promise<unknown>;

    const first = load('assets/a.js');
    const second = load('assets/a.js');
    expect(importer).toHaveBeenCalledTimes(1);

    resolveImport({ default: 'A' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { default: 'A' },
      { default: 'A' },
    ]);
    control.dispose();
  });

  it('does not emit recovery success for native first-attempt success', async () => {
    const success = vi.fn();
    const { target, control } = createRuntime(vi.fn().mockResolvedValue({}), success);
    await (target.load as (filename: string) => Promise<unknown>)('assets/a.js');

    expect(success).not.toHaveBeenCalled();
    control.dispose();
  });

  it('adds a cache-busting parameter only on a same-url retry', async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce({ default: 'A' });
    const { target, control } = createRuntime(importer);

    await (target.load as (filename: string) => Promise<unknown>)('assets/a.js');

    expect(importer).toHaveBeenCalledTimes(2);
    expect(importer.mock.calls[0][0]).toBe(cdn1 + 'assets/a.js');
    expect(importer.mock.calls[1][0]).toMatch(/assets\/a\.js\?__rf=1-/);
    control.dispose();
  });

  it('does not cancel an unmatched preload error', () => {
    const { control } = createRuntime(vi.fn().mockResolvedValue({}));
    const event = new Event('vite:preloadError', { cancelable: true });
    (event as Event & { payload?: unknown }).payload = new Error(
      'Unable to preload CSS for https://other.example.com/a.css',
    );
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    control.dispose();
  });
});
