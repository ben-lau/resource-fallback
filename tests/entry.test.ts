import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { install } from '../packages/core/src/runtime/entry';

const cdn1 = 'https://cdn1.example.com/';

interface RfGlobal {
  install: typeof install;
  url: (filename: string) => string;
  installed: boolean;
  version: string;
  resolver?: unknown;
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
      g.resolver = undefined;
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

  it('install sets installed=true and exposes resolver', () => {
    install({
      rules: [{ match: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.resolver).toBeTruthy();
  });

  it('install is idempotent — second call is a no-op', () => {
    install({
      rules: [{ match: cdn1, urls: [cdn1, 'https://cdn2.example.com/'] }],
    });
    const resolver1 = getGlobal().resolver;

    install({
      rules: [{ match: 'https://other.example.com/', urls: ['https://other.example.com/'] }],
    });
    const resolver2 = getGlobal().resolver;

    expect(resolver2).toBe(resolver1);
  });

  it('__RF__.url returns correct URL after install', () => {
    install({
      rules: [{ match: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.url('assets/chunk.js')).toBe(cdn1 + 'assets/chunk.js');
  });

  it('kill-switch: install with __RF_DISABLE__ skips wiring', () => {
    (window as unknown as Record<string, unknown>).__RF_DISABLE__ = true;

    install({
      rules: [{ match: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.url('test.js')).toBe('test.js');
    expect(g.resolver).toBeUndefined();
  });

  it('kill-switch: ?__rf=off disables runtime', () => {
    history.replaceState(null, '', '/?__rf=off');

    install({
      rules: [{ match: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.url('test.js')).toBe('test.js');
    expect(g.resolver).toBeUndefined();
  });

  it('kill-switch: cookie __rf_disable=1 disables runtime', () => {
    document.cookie = '__rf_disable=1; path=/';

    install({
      rules: [{ match: cdn1, urls: [cdn1] }],
    });

    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.resolver).toBeUndefined();
  });

  it('warns about duplicate rules in console', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    install({
      rules: [
        { match: cdn1, urls: [cdn1] },
        { match: cdn1, urls: [cdn1, 'https://backup.example.com/'] },
      ],
      debug: true,
    });

    const warnCalls = warnSpy.mock.calls;
    const duplicateWarning = warnCalls.find(
      (args) => typeof args[1] === 'string' && args[1].includes('重复'),
    );
    expect(duplicateWarning).toBeTruthy();

    warnSpy.mockRestore();
  });

  it('does not warn when all rules have unique match patterns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    install({
      rules: [
        { match: cdn1, urls: [cdn1] },
        { match: 'https://other.example.com/', urls: ['https://other.example.com/'] },
      ],
      debug: true,
    });

    const warnCalls = warnSpy.mock.calls;
    const duplicateWarning = warnCalls.find(
      (args) => typeof args[1] === 'string' && args[1].includes('重复'),
    );
    expect(duplicateWarning).toBeUndefined();

    warnSpy.mockRestore();
  });

  it('install with empty rules still completes', () => {
    install({ rules: [] });
    const g = getGlobal();
    expect(g.installed).toBe(true);
    expect(g.url('test.js')).toBe('test.js');
  });

  it('install with webpackChunkLoadingGlobals creates chunk arrays', () => {
    install({
      rules: [{ match: cdn1, urls: [cdn1] }],
      webpackChunkLoadingGlobals: ['webpackChunk_test'],
    });

    const arr = (window as unknown as Record<string, unknown>).webpackChunk_test;
    expect(Array.isArray(arr)).toBe(true);
  });
});
