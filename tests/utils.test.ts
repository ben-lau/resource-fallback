import { describe, expect, it } from 'vitest';

import {
  inferResourceFallbackAssetType,
  joinAssetPrefix,
  serialiseConfig,
} from '../packages/core/src/index';

describe('joinAssetPrefix', () => {
  it('returns filename as-is for absolute URL', () => {
    expect(joinAssetPrefix('https://cdn.com/', 'https://other.com/file.js')).toBe(
      'https://other.com/file.js',
    );
  });

  it('returns filename as-is for root-relative path', () => {
    expect(joinAssetPrefix('https://cdn.com/', '/assets/file.js')).toBe('/assets/file.js');
  });

  it('joins prefix and filename with single slash', () => {
    expect(joinAssetPrefix('https://cdn.com', 'assets/file.js')).toBe(
      'https://cdn.com/assets/file.js',
    );
  });

  it('handles prefix with trailing slash', () => {
    expect(joinAssetPrefix('https://cdn.com/', 'assets/file.js')).toBe(
      'https://cdn.com/assets/file.js',
    );
  });

  it('strips leading slashes from filename', () => {
    expect(joinAssetPrefix('https://cdn.com/', 'assets///file.js')).toBe(
      'https://cdn.com/assets///file.js',
    );
  });

  it('returns normalized prefix for empty filename', () => {
    expect(joinAssetPrefix('https://cdn.com/', '')).toBe('https://cdn.com');
    expect(joinAssetPrefix('https://cdn.com', '')).toBe('https://cdn.com');
  });

  it('returns / for empty prefix and empty filename', () => {
    expect(joinAssetPrefix('', '')).toBe('/');
  });
});

describe('serialiseConfig', () => {
  it('serialises plain config as JSON', () => {
    const result = serialiseConfig({ rules: [], defaults: {} });
    expect(result).toContain('"rules"');
    expect(result).toContain('[]');
  });

  it('renders RegExp as native literal', () => {
    const result = serialiseConfig({
      rules: [{ match: /^https:\/\/cdn\.com\//, urls: ['https://cdn.com/'] }],
      defaults: {},
    });
    expect(result).toContain('/^https:\\/\\/cdn\\.com\\//');
    expect(result).not.toContain('__regexp__');
  });

  it('handles webpackChunkLoadingGlobals', () => {
    const result = serialiseConfig({
      rules: [],
      defaults: {},
      webpackChunkLoadingGlobals: ['webpackChunkMyApp'],
    });
    expect(result).toContain('webpackChunkMyApp');
  });
});

describe('inferResourceFallbackAssetType', () => {
  it('detects script files', () => {
    expect(inferResourceFallbackAssetType('app.js')).toBe('script');
    expect(inferResourceFallbackAssetType('vendor.mjs')).toBe('script');
    expect(inferResourceFallbackAssetType('polyfill.cjs')).toBe('script');
  });

  it('detects style files', () => {
    expect(inferResourceFallbackAssetType('main.css')).toBe('style');
  });

  it('detects image files', () => {
    expect(inferResourceFallbackAssetType('logo.png')).toBe('image');
    expect(inferResourceFallbackAssetType('photo.jpeg')).toBe('image');
    expect(inferResourceFallbackAssetType('icon.svg')).toBe('image');
    expect(inferResourceFallbackAssetType('banner.webp')).toBe('image');
    expect(inferResourceFallbackAssetType('pic.avif')).toBe('image');
  });

  it('detects font files', () => {
    expect(inferResourceFallbackAssetType('font.woff2')).toBe('font');
    expect(inferResourceFallbackAssetType('font.ttf')).toBe('font');
    expect(inferResourceFallbackAssetType('font.otf')).toBe('font');
  });

  it('detects media files', () => {
    expect(inferResourceFallbackAssetType('video.mp4')).toBe('media');
    expect(inferResourceFallbackAssetType('audio.mp3')).toBe('media');
    expect(inferResourceFallbackAssetType('music.flac')).toBe('media');
  });

  it('returns asset for unknown extensions', () => {
    expect(inferResourceFallbackAssetType('data.json')).toBe('asset');
    expect(inferResourceFallbackAssetType('readme.txt')).toBe('asset');
  });

  it('ignores query and hash', () => {
    expect(inferResourceFallbackAssetType('app.js?v=123')).toBe('script');
    expect(inferResourceFallbackAssetType('style.css#chunk')).toBe('style');
  });

  it('is case-insensitive', () => {
    expect(inferResourceFallbackAssetType('App.JS')).toBe('script');
    expect(inferResourceFallbackAssetType('FONT.WOFF2')).toBe('font');
  });
});
