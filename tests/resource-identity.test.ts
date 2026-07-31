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

  it('prefers Webpack key, then chunk id, then URL', () => {
    expect(webpackResourceKey('https://cdn.test/a.js', { key: 'app:42', chunkId: 42 }, base)).toBe(
      'chunk:app:42',
    );
    expect(webpackResourceKey('https://cdn.test/a.js', { chunkId: 42 }, base)).toBe('chunk:42');
    expect(webpackResourceKey('./a.js', {}, base)).toBe('url:https://app.example.test/assets/a.js');
  });
});
