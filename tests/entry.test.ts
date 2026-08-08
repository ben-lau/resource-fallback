import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setViteImportModule } from '../packages/core/src/runtime/adapter-vite';
import { install } from '../packages/core/src/runtime/entry';

const cdn1 = 'https://cdn1.example.com/';

interface RfGlobal {
  install: typeof install;
  url: (filename: string) => string;
  load?: (filename: string) => Promise<unknown>;
  dispose: () => void;
  installed: boolean;
  version: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function getGlobal(): RfGlobal {
  const w = window as unknown as Record<string, unknown>;
  if (!w.__RF__) {
    w.__RF__ = {
      install,
      url: () => '',
      dispose: () => {
        delete w.__RF__;
      },
      installed: false,
      version: '0.0.0',
    };
  }
  return w.__RF__ as unknown as RfGlobal;
}

describe('entry (install)', () => {
  beforeEach(() => {
    setViteImportModule(null);
    const w = window as unknown as Record<string, unknown>;
    // Reset installed state but keep __RF__ alive (entry.ts ensureGlobal runs at import-time)
    const g = w.__RF__ as RfGlobal | undefined;
    if (g) {
      g.installed = false;
      g.url = () => '';
    }
    delete w.__RF_DISABLE__;
    delete w.__CUSTOM_DISABLE__;
    delete w.System;
    delete w.webpackChunk_test;
    localStorage.clear();
    document.head.innerHTML = '';
    document.cookie = '__rf_disable=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    const w = window as unknown as Record<string, unknown>;
    const g = w.__RF__ as { dispose?: () => void } | undefined;
    if (g?.dispose) g.dispose();
    delete w.__RF__;
    setViteImportModule(null);
    delete w.__RF_DISABLE__;
    delete w.__CUSTOM_DISABLE__;
    delete w.webpackChunk_test;
    document.head.innerHTML = '';
    document.cookie = '__rf_disable=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('install sets installed=true without exposing the legacy resolver', () => {
    install({
      rules: [{ base: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect((g as RfGlobal & { resolver?: unknown }).resolver).toBeUndefined();
  });

  it('install is idempotent — second call is a no-op', () => {
    install({
      rules: [{ base: cdn1, urls: [cdn1, 'https://cdn2.example.com/'] }],
    });
    const global1 = getGlobal();

    install({
      rules: [{ base: 'https://other.example.com/', urls: ['https://other.example.com/'] }],
    });
    const global2 = getGlobal();

    expect(global2).toBe(global1);
  });

  it('does not leave a partially installed global after invalid config', () => {
    expect(() =>
      install({
        rules: [{ base: cdn1, urls: [cdn1, cdn1] }],
      }),
    ).toThrow(/duplicate candidate/);

    expect(getGlobal().installed).toBe(false);
  });

  it('dispose removes the global and allows a fresh install', () => {
    install({ rules: [{ base: cdn1, urls: [cdn1] }] });
    const firstGlobal = getGlobal();

    firstGlobal.dispose();

    const w = window as unknown as Record<string, unknown>;
    expect(w.__RF__).toBeUndefined();

    install({ rules: [{ base: cdn1, urls: [cdn1] }] });
    expect(getGlobal().installed).toBe(true);
  });

  it('isolates a deferred Vite load from dispose and a fresh installation', async () => {
    const oldImport = deferred<unknown>();
    const newImport = deferred<unknown>();
    const importer = vi
      .fn<(url: string) => Promise<unknown>>()
      .mockImplementationOnce(() => oldImport.promise)
      .mockImplementationOnce(() => newImport.promise);
    setViteImportModule(importer);
    const config = {
      rules: [
        {
          base: cdn1,
          urls: [cdn1],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    };

    install(config);
    const oldGlobal = getGlobal();
    const oldRecovery = oldGlobal.load!('shared.js');
    await Promise.resolve();
    expect(importer).toHaveBeenCalledTimes(1);

    const source = document.createElement('script');
    source.src = cdn1 + 'shared.js#observer';
    document.head.appendChild(source);
    source.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(Array.from(document.head.querySelectorAll('script'))).toEqual([source]);

    oldGlobal.dispose();
    await expect(oldRecovery).rejects.toMatchObject({ kind: 'aborted' });
    expect((window as unknown as Record<string, unknown>).__RF__).toBeUndefined();

    install(config);
    const newGlobal = getGlobal();
    expect(newGlobal).not.toBe(oldGlobal);
    const newRecovery = newGlobal.load!('shared.js');
    let newSettled = false;
    void newRecovery.then(
      () => {
        newSettled = true;
      },
      () => {
        newSettled = true;
      },
    );
    await Promise.resolve();
    expect(importer).toHaveBeenCalledTimes(2);

    oldImport.resolve({ default: 'old' });
    await Promise.resolve();
    await Promise.resolve();
    expect(newSettled).toBe(false);

    source.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(Array.from(document.head.querySelectorAll('script'))).toEqual([source]);

    const newModule = { default: 'new' };
    newImport.resolve(newModule);
    await expect(newRecovery).resolves.toBe(newModule);
  });

  it('__RF__.url returns correct URL after install', () => {
    install({
      rules: [{ base: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.url('assets/chunk.js')).toBe(cdn1 + 'assets/chunk.js');
  });

  it('kill-switch: install with __RF_DISABLE__ skips wiring', () => {
    (window as unknown as Record<string, unknown>).__RF_DISABLE__ = true;

    install({
      rules: [{ base: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.url('test.js')).toBe('test.js');
  });

  it('kill-switch: ?__rf=off disables runtime', () => {
    history.replaceState(null, '', '/?__rf=off');

    install({
      rules: [{ base: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.url('test.js')).toBe('test.js');
  });

  it('kill-switch: cookie __rf_disable=1 disables runtime', () => {
    document.cookie = '__rf_disable=1; path=/';

    install({
      rules: [{ base: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
  });

  it('rejects duplicate rules before wiring adapters', () => {
    expect(() =>
      install({
        rules: [
          { base: cdn1, urls: [cdn1] },
          { base: cdn1, urls: [cdn1, 'https://backup.example.com/'] },
        ],
      }),
    ).toThrow(/duplicates/);
    expect(getGlobal().installed).toBe(false);
  });

  it('accepts unique base prefixes', () => {
    install({
      rules: [
        { base: cdn1, urls: [cdn1] },
        { base: 'https://other.example.com/', urls: ['https://other.example.com/'] },
      ],
    });

    expect(getGlobal().installed).toBe(true);
  });

  it('install with empty rules still completes', () => {
    install({ rules: [] });
    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.url('test.js')).toBe('test.js');
  });

  it('install with webpackChunkLoadingGlobals creates chunk arrays', () => {
    install({
      rules: [{ base: cdn1, urls: [cdn1] }],
      webpackChunkLoadingGlobals: ['webpackChunk_test'],
    });

    const arr = (window as unknown as Record<string, unknown>).webpackChunk_test;
    expect(Array.isArray(arr)).toBe(true);
  });
});
