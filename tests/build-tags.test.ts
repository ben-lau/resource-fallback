import { describe, expect, it } from 'vitest';

import { buildInjectedTags, defineConfig } from '../packages/core/src/index';

describe('buildInjectedTags', () => {
  it('emits preconnect for each unique fallback host', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [
          {
            match: 'https://cdn1.example.com/',
            urls: ['https://cdn1.example.com/', 'https://cdn2.example.com/'],
          },
        ],
      }),
    );
    const preconnects = tags.filter(
      (t) => t.tagName === 'link' && t.attributes['rel'] === 'preconnect',
    );
    expect(preconnects.length).toBe(2);
  });

  it('skips preconnect for relative URLs (same origin / origin fallback)', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [
          {
            match: 'https://cdn1.example.com/',
            urls: ['https://cdn1.example.com/', '/', './local/'],
          },
        ],
      }),
    );
    const preconnects = tags.filter(
      (t) => t.tagName === 'link' && t.attributes['rel'] === 'preconnect',
    );
    expect(preconnects.length).toBe(1);
    expect(preconnects[0].attributes['href']).toBe('https://cdn1.example.com');
    expect(
      tags.find(
        (t) =>
          t.attributes['rel'] === 'preconnect' && t.attributes['href'] === 'http://dummy.local',
      ),
    ).toBeUndefined();
  });

  it('skips preconnect when injectPreconnect=false', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [{ match: 'https://x/', urls: ['https://x/'] }],
        injectPreconnect: false,
      }),
    );
    expect(tags.find((t) => t.attributes['rel'] === 'preconnect')).toBeUndefined();
  });

  it('emits CSP nonce on injected script', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [{ match: 'https://x/', urls: ['https://x/'] }],
        injectPreconnect: false,
        nonce: 'abc123',
      }),
    );
    const script = tags.find((t) => t.tagName === 'script');
    expect(script?.attributes['nonce']).toBe('abc123');
  });

  it('externalRuntime emits two scripts: src + install', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [{ match: 'https://x/', urls: ['https://x/'] }],
        injectPreconnect: false,
        externalRuntime: true,
      }),
    );
    const scripts = tags.filter((t) => t.tagName === 'script');
    expect(scripts.length).toBe(2);
    expect(scripts[0].attributes['src']).toBe('/__rf/runtime.js');
    expect(scripts[1].innerHTML).toContain('install(');
  });

  it('serialises RegExp match patterns', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [{ match: /^https:\/\/cdn\d+\//, urls: ['https://cdn1/'] }],
        injectPreconnect: false,
      }),
    );
    const script = tags.find((t) => t.tagName === 'script' && t.innerHTML?.includes('install('));
    expect(script?.innerHTML).toContain('/^https:\\/\\/cdn\\d+\\//');
  });

  it('escapes </script> in config strings to prevent HTML injection', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [{ match: '</script><script>alert(1)</script>', urls: ['https://x/'] }],
        injectPreconnect: false,
      }),
    );
    const script = tags.find((t) => t.tagName === 'script' && t.innerHTML?.includes('install('));
    expect(script?.innerHTML).toContain('\\x3c');
    expect(script?.innerHTML).not.toContain('</script><script>');
  });

  it('serialises service worker manifest into the install config when provided', () => {
    const tags = buildInjectedTags(
      defineConfig({
        rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/'] }],
        injectPreconnect: false,
        serviceWorker: true,
        serviceWorkerManifest: {
          version: 'rf-test',
          rules: [{ match: 'https://cdn.example.com/', urls: ['https://cdn.example.com/', '/'] }],
          assets: [{ url: 'https://cdn.example.com/logo.png', type: 'image', owner: 'sw' }],
        },
      }),
    );
    const script = tags.find((t) => t.tagName === 'script' && t.innerHTML?.includes('install('));
    expect(script?.innerHTML).toContain('"serviceWorker":true');
    expect(script?.innerHTML).toContain('"serviceWorkerManifest"');
    expect(script?.innerHTML).toContain('"owner":"sw"');
  });
});
