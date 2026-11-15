import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
