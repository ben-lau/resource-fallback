import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokenizeSearch } from '../docs/.vitepress/search';
import { previewPrefixes } from '../docs/.vitepress/theme/url-preview';

const pageUrl = 'https://app.example.com/app/';

describe('documentation URL preview', () => {
  it('preserves path/query and resolves origin candidates against the page across multiple CDNs', () => {
    const result = previewPrefixes({
      pageUrl,
      resourceUrl: 'https://cdn1.example.com/app/assets/main.js?v=2',
      retries: 1,
      rules: [
        {
          base: 'https://cdn1.example.com/app',
          urls: ['https://cdn2.example.com/app/', 'https://cdn3.example.com/static/', '/app/'],
        },
      ],
    });
    expect(result.chain.map((entry) => entry.url)).toEqual([
      'https://cdn1.example.com/app/assets/main.js?v=2',
      'https://cdn2.example.com/app/assets/main.js?v=2',
      'https://cdn3.example.com/static/assets/main.js?v=2',
      'https://app.example.com/app/assets/main.js?v=2',
    ]);
    expect(result.matched && result.maximumAttempts).toBe(8);
  });

  it('selects the longest prefix and respects its retry override', () => {
    const result = previewPrefixes({
      pageUrl,
      resourceUrl: 'https://cdn.example.com/app/x.js',
      retries: 2,
      rules: [
        { base: 'https://cdn.example.com/', urls: ['/'] },
        { base: 'https://cdn.example.com/app/', urls: ['/app/'], retry: { max: 0 } },
      ],
    });
    expect(result.matched && result.base).toBe('https://cdn.example.com/app/');
    expect(result.matched && result.maximumAttempts).toBe(2);
    expect(result.chain.at(-1)?.url).toBe('https://app.example.com/app/x.js');
  });

  it('keeps raw relative/absolute matching semantics', () => {
    const rules = [{ base: '/app/', urls: ['https://backup.example.com/static/'] }];
    expect(
      previewPrefixes({
        pageUrl,
        resourceUrl: 'https://app.example.com/app/a.js',
        retries: 1,
        rules,
      }).matched,
    ).toBe(false);
    expect(
      previewPrefixes({ pageUrl, resourceUrl: '/app/a.js', retries: 1, rules }).chain.at(-1)?.url,
    ).toBe('https://backup.example.com/static/a.js');
  });

  it('does not restart candidates that precede an already selected URL', () => {
    const result = previewPrefixes({
      pageUrl,
      resourceUrl: 'https://cdn.example.com/backup/x.js',
      retries: 1,
      rules: [
        {
          base: 'https://cdn.example.com/',
          urls: ['https://unused.example.com/', 'https://cdn.example.com/backup/', '/app/'],
        },
      ],
    });
    expect(result.chain.map((entry) => entry.url)).toEqual([
      'https://cdn.example.com/backup/x.js',
      'https://app.example.com/app/x.js',
    ]);
    expect(result.matched && result.suffix).toBe('x.js');
  });

  it('rejects duplicate candidates and non-HTTP protocols', () => {
    expect(() =>
      previewPrefixes({
        pageUrl,
        resourceUrl: '/app/a.js',
        retries: 1,
        rules: [{ base: '/app/', urls: ['/backup/', '/backup/'] }],
      }),
    ).toThrow('duplicate');
    expect(() =>
      previewPrefixes({
        pageUrl,
        resourceUrl: '/app/a.js',
        retries: 1,
        rules: [{ base: '/app/', urls: ['javascript:alert(1)'] }],
      }),
    ).toThrow('http');
  });
});

describe('documentation search serialization', () => {
  it('handles mixed Chinese/code tokens without splitting event names', () => {
    const tokens = tokenizeSearch('页面 runtime 的 rf:error 与超时');
    expect(tokens).toEqual(expect.arrayContaining(['页面', 'runtime', 'rf:error', '超时']));
    expect(tokens).not.toContain('error');
    expect(tokenizeSearch('资源回退')).toEqual(['资源', '源回', '回退']);
  });

  it('runs identically after VitePress serializes the function without module scope', () => {
    const restored = new Function('return ' + tokenizeSearch.toString())() as typeof tokenizeSearch;
    expect(restored('hooks 熔断 rf:error')).toEqual(tokenizeSearch('hooks 熔断 rf:error'));
  });
});

describe('documented entry fallback lifecycle', () => {
  for (const locale of ['', 'en/']) {
    it(`removes the ${locale || 'zh/'} documented listener after application boot`, () => {
      const markdown = readFileSync(resolve('docs', locale, 'guide/runtime-events.md'), 'utf8');
      const script = markdown.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
      expect(script).toBeDefined();
      document.body.innerHTML = '<p id="rf-entry-fallback" hidden>Failed</p>';
      new Function(script!)();
      const fallback = document.getElementById('rf-entry-fallback')!;
      const fail = () =>
        window.dispatchEvent(
          new CustomEvent('rf:error', {
            detail: { url: 'https://cdn2.example.com/assets/main.js' },
          }),
        );
      fail();
      expect(fallback.hidden).toBe(false);
      fallback.hidden = true;
      window.dispatchEvent(new Event('app:ready'));
      fail();
      expect(fallback.hidden).toBe(true);
      document.body.innerHTML = '';
    });
  }
});
