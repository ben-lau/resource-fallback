import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install } from '../packages/core/src/runtime/entry';

const cdn1 = 'https://cdn1.example.com/';

interface RfGlobal {
  install: typeof install;
  url: (filename: string) => string;
  installed: boolean;
  version: string;
}

function getGlobal(): RfGlobal {
  const w = window as unknown as Record<string, unknown>;
  if (!w.__RF__) {
    w.__RF__ = {
      install,
      url: () => '',
      installed: false,
      version: '0.0.0',
    };
  }
  return w.__RF__ as unknown as RfGlobal;
}

describe('entry (install)', () => {
  beforeEach(() => {
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
