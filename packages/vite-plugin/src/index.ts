import type { HtmlTagDescriptor, Plugin, UserConfig } from 'vite';
import { posix, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { init, parse } from 'es-module-lexer';
import MagicString from 'magic-string';

import { buildInjectedTags, type HtmlTag, type PluginOptions } from '@resource-fallback/core';

export type ViteResourceFallbackOptions = PluginOptions;

const PLUGIN_NAME = 'resource-fallback';

export default function resourceFallback(options: ViteResourceFallbackOptions): Plugin {
  if (!options || !Array.isArray(options.rules) || options.rules.length === 0) {
    throw new Error(`[${PLUGIN_NAME}] \`rules\` must be a non-empty array`);
  }

  let shouldRewriteUrls = true;
  const tags = buildInjectedTags(options);
  const injectTo: HtmlTagDescriptor['injectTo'] =
    options.htmlInject === 'head-append' ? 'head' : 'head-prepend';

  return {
    name: PLUGIN_NAME,

    apply(_userConfig, env) {
      return options.enableDev ? true : env.command === 'build';
    },

    config(userConfig): UserConfig {
      const base = typeof userConfig?.base === 'string' ? userConfig.base : '/';
      shouldRewriteUrls = options.rules.some((r) => {
        if (typeof r.match === 'string') return base === r.match;
        if (r.match instanceof RegExp) return r.match.test(base);
        if (typeof r.match === 'function') return r.match(base);
        return false;
      });

      return {};
    },

    async writeBundle(options, bundle) {
      if (!shouldRewriteUrls) return;

      await init;

      const outDir = options.dir!;

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!chunk.dynamicImports || chunk.dynamicImports.length === 0) continue;

        const dynamicChunks = new Set(chunk.dynamicImports);
        const chunkDir = posix.dirname(chunk.fileName);
        const filePath = join(outDir, chunk.fileName);
        const code = readFileSync(filePath, 'utf8');

        const [imports] = parse(code);
        const s = new MagicString(code);
        let modified = false;

        for (const imp of imports) {
          // imp.d === -1 → static import; imp.d >= 0 → dynamic import (position of `import` keyword)
          if (imp.d < 0) continue;

          // imp.n is the specifier string (e.g. "./About-xxx.js"), undefined for non-literal
          if (!imp.n) continue;

          const resolved = posix.normalize(posix.join(chunkDir, imp.n));
          if (!dynamicChunks.has(resolved)) continue;

          // imp.ss = statement start (position of `import` keyword)
          // imp.se = statement end (position after closing `)`)
          s.overwrite(imp.ss, imp.se, `window.__RF__.load(${JSON.stringify(resolved)})`);
          modified = true;
        }

        if (modified) {
          writeFileSync(filePath, s.toString());
        }
      }
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        return {
          html,
          tags: tags.map((t) => toViteTag(t, injectTo)),
        };
      },
    },
  };
}

function toViteTag(tag: HtmlTag, injectTo: HtmlTagDescriptor['injectTo']): HtmlTagDescriptor {
  const attrs: Record<string, string | true> = {};
  for (const k of Object.keys(tag.attributes)) {
    const v = tag.attributes[k];
    if (v === undefined) continue;
    if (typeof v === 'boolean') attrs[k] = v ? true : '';
    else attrs[k] = v;
  }
  return {
    tag: tag.tagName,
    attrs,
    children: tag.innerHTML,
    injectTo,
  };
}

export { resourceFallback };
