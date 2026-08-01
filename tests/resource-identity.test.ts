import { describe, expect, it } from 'vitest';
import {
  normalizeResourceUrl,
  urlResourceKey,
  webpackResourceKey,
} from '../packages/core/src/internal/resource-identity';

describe('resource identity', () => {
  const base = 'https://app.example.test/assets/';

  it('normalizes relative and absolute URLs to the same identity', () => {
    expect(urlResourceKey('./chunk.js', base)).toBe(
      urlResourceKey('https://app.example.test/assets/chunk.js', base),
    );
  });

  it('ignores the retry parameter and fragment', () => {
    expect(normalizeResourceUrl('https://cdn.test/chunk.js?__rf=2-ab12#module', base)).toBe(
      'https://cdn.test/chunk.js',
    );
  });

  it('keeps business query parameters distinct', () => {
    expect(urlResourceKey('https://cdn.test/chunk.js?lang=en', base)).not.toBe(
      urlResourceKey('https://cdn.test/chunk.js?lang=zh', base),
    );
  });

  it('keeps Webpack identity stable across retry and fallback URL changes', () => {
    expect(webpackResourceKey('https://cdn.test/a.js?__rf=1-ab12', { key: 'app:42' }, base)).toBe(
      'chunk:app:42',
    );
    expect(webpackResourceKey('https://cdn.test/fallback/a.js', { key: 'app:42' }, base)).toBe(
      'chunk:app:42',
    );

    expect(webpackResourceKey('https://cdn.test/a.js?__rf=1-ab12', { chunkId: 42 }, base)).toBe(
      'chunk:42',
    );
    expect(webpackResourceKey('https://cdn.test/fallback/a.js', { chunkId: 42 }, base)).toBe(
      'chunk:42',
    );
  });

  it('prefers Webpack key, then chunk id, then URL', () => {
    expect(webpackResourceKey('https://cdn.test/a.js', { key: 'app:42', chunkId: 42 }, base)).toBe(
      'chunk:app:42',
    );
    expect(webpackResourceKey('https://cdn.test/a.js', { chunkId: 42 }, base)).toBe('chunk:42');
    expect(webpackResourceKey('./a.js', {}, base)).toBe('url:https://app.example.test/assets/a.js');
  });

  it('falls back to string cleanup when URL parsing fails', () => {
    expect(normalizeResourceUrl('chunk.js?lang=en&__rf=2-ab12#module', 'not a url')).toBe(
      'chunk.js?lang=en',
    );
  });
});
