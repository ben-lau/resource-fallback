import type { HtmlTagDescriptor, Plugin, UserConfig } from 'vite';

import { buildInjectedTags, type HtmlTag, type PluginOptions } from '@resource-fallback/core';

export type ViteResourceFallbackOptions = PluginOptions;

const PLUGIN_NAME = 'resource-fallback';

export default function resourceFallback(options: ViteResourceFallbackOptions): Plugin {
  if (!options || !Array.isArray(options.rules) || options.rules.length === 0) {
    throw new Error(`[${PLUGIN_NAME}] \`rules\` must be a non-empty array`);
  }

  const tags = buildInjectedTags(options);
  const injectTo: HtmlTagDescriptor['injectTo'] =
    options.htmlInject === 'head-append' ? 'head' : 'head-prepend';

  return {
    name: PLUGIN_NAME,

    apply(_userConfig, env) {
      return options.enableDev ? true : env.command === 'build';
    },

    config(): UserConfig {
      return {
        experimental: {
          renderBuiltUrl(filename, { hostType }) {
            if (hostType === 'js') {
              return { runtime: `window.__RF__.url(${JSON.stringify(filename)})` };
            }
            return { relative: true };
          },
        },
      };
    },

    renderDynamicImport({ targetChunk, format }) {
      if (!targetChunk || format !== 'es') return null;
      return {
        left: `window.__RF__.load(${JSON.stringify(targetChunk.fileName)},`,
        right: ')',
      };
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
