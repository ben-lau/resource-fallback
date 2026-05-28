import { describe, expect, it } from 'vitest';

import {
  buildServiceWorkerAssets,
  buildResourceFallbackManifest,
  normalizeServiceWorkerOptions,
} from '../packages/core/src/index';

describe('service worker options', () => {
  it('normalizes boolean opt-in to the hybrid defaults', () => {
    expect(normalizeServiceWorkerOptions(true)).toEqual({
      enabled: true,
      path: '/rf-sw.js',
      scope: '/',
      includeStyleImports: true,
      fallbackOnOpaque: false,
      cache: {
        enabled: true,
        cacheOpaque: false,
      },
    });
  });

  it('keeps service worker disabled by default', () => {
    expect(normalizeServiceWorkerOptions(undefined).enabled).toBe(false);
    expect(normalizeServiceWorkerOptions(false).enabled).toBe(false);
  });

  it('derives the default service worker path from the configured scope', () => {
    expect(normalizeServiceWorkerOptions({ scope: '/app/' }).path).toBe('/app/rf-sw.js');
    expect(normalizeServiceWorkerOptions({ scope: '/nested' }).path).toBe('/nested/rf-sw.js');
  });

  it('builds a manifest with page-owned scripts and sw-owned subresources', () => {
    const manifest = buildResourceFallbackManifest({
      versionSeed: 'build-1',
      rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/'] }],
      assets: [
        { url: 'https://cdn.example.com/assets/app.js', type: 'script' },
        { url: 'https://cdn.example.com/assets/app.css', type: 'style' },
        { url: 'https://cdn.example.com/assets/logo.png', type: 'image' },
        { url: 'https://cdn.example.com/assets/font.woff2', type: 'font' },
        { url: 'https://cdn.example.com/assets/intro.mp4', type: 'media' },
      ],
    });

    expect(manifest.version).toMatch(/^rf-/);
    expect(manifest.rules).toHaveLength(1);
    expect(manifest.assets).toEqual([
      { url: 'https://cdn.example.com/assets/app.js', type: 'script', owner: 'page' },
      { url: 'https://cdn.example.com/assets/app.css', type: 'style', owner: 'page' },
      { url: 'https://cdn.example.com/assets/logo.png', type: 'image', owner: 'sw' },
      { url: 'https://cdn.example.com/assets/font.woff2', type: 'font', owner: 'sw' },
      { url: 'https://cdn.example.com/assets/intro.mp4', type: 'media', owner: 'sw' },
    ]);
  });

  it('builds service worker assets only when enabled', () => {
    expect(buildServiceWorkerAssets({
      rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/'] }],
      serviceWorker: false,
    }, {
      versionSeed: 'build-1',
      assets: [],
    })).toBeNull();

    const assets = buildServiceWorkerAssets({
      rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/'] }],
      serviceWorker: true,
    }, {
      versionSeed: 'build-1',
      assets: [{ url: 'https://cdn.example.com/logo.png', type: 'image' }],
    });

    expect(assets?.path).toBe('/rf-sw.js');
    expect(assets?.scope).toBe('/');
    expect(assets?.code).toContain('RF_SW_CONFIG');
    expect(assets?.code).toContain('__RF_SW_PRELOAD__');
    expect(assets?.code).toContain('https://cdn.example.com/logo.png');
    expect(assets?.manifest.assets[0]).toEqual({
      url: 'https://cdn.example.com/logo.png',
      type: 'image',
      owner: 'sw',
    });
  });

  it('preserves RegExp rules in the preloaded service worker config', () => {
    const assets = buildServiceWorkerAssets({
      rules: [{ match: /^https:\/\/cdn\d+\.example\.com\//, urls: ['https://cdn1.example.com/', '/'] }],
      serviceWorker: true,
    }, {
      versionSeed: 'build-1',
      assets: [{ url: 'https://cdn1.example.com/logo.png', type: 'image' }],
    });

    expect(assets?.code).toContain('"match":/^https:\\/\\/cdn\\d+\\.example\\.com\\//');
    expect(assets?.code).not.toContain('"match":{}');
  });

  it('changes manifest version when rules or sw cache policy changes', () => {
    const input = {
      versionSeed: 'same-build',
      assets: [{ url: 'https://cdn.example.com/logo.png', type: 'image' as const }],
    };
    const first = buildServiceWorkerAssets({
      rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/a/'] }],
      serviceWorker: { cache: { enabled: true } },
    }, input);
    const changedRule = buildServiceWorkerAssets({
      rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/b/'] }],
      serviceWorker: { cache: { enabled: true } },
    }, input);
    const changedCache = buildServiceWorkerAssets({
      rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/a/'] }],
      serviceWorker: { cache: { enabled: false } },
    }, input);

    expect(changedRule?.manifest.version).not.toBe(first?.manifest.version);
    expect(changedCache?.manifest.version).not.toBe(first?.manifest.version);
  });
});
