import type { HtmlTagDescriptor, Plugin, UserConfig } from 'vite';
import { posix, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { init, parse } from 'es-module-lexer';
import MagicString from 'magic-string';

import {
  buildInjectedTags,
  buildServiceWorkerAssets,
  ensureTrailingSlash,
  getServiceWorkerCode,
  inferResourceFallbackAssetType,
  joinAssetPrefix,
  normalizeServiceWorkerOptions,
  rfError,
  type HtmlTag,
  type PluginOptions,
  type ResourceFallbackManifest,
} from '@resource-fallback/core';

export type ViteResourceFallbackOptions = PluginOptions;

const PLUGIN_NAME = 'resource-fallback';

type OutputBundleLike = Record<string, { fileName: string; type: 'chunk' | 'asset' }>;

export default function resourceFallback(options: ViteResourceFallbackOptions): Plugin {
  if (!options || !Array.isArray(options.rules) || options.rules.length === 0) {
    throw rfError('`rules` must be a non-empty array');
  }

  let shouldRewriteUrls = true;
  let base = '/';
  let serviceWorkerManifest: ResourceFallbackManifest | undefined;
  const lexerReady = init;
  const injectTo: HtmlTagDescriptor['injectTo'] =
    options.htmlInject === 'head-append' ? 'head' : 'head-prepend';

  return {
    name: PLUGIN_NAME,

    apply(_userConfig, env) {
      return options.enableDev ? true : env.command === 'build';
    },

    config(userConfig): UserConfig {
      base = typeof userConfig?.base === 'string' ? userConfig.base : '/';
      return {};
    },

    configResolved(resolvedConfig) {
      base = resolvedConfig.base;
      shouldRewriteUrls = options.rules.some(
        (r) => ensureTrailingSlash(base) === ensureTrailingSlash(r.base),
      );
    },

    generateBundle(_outputOptions, bundle) {
      const serviceWorker = normalizeServiceWorkerOptions(options.serviceWorker);
      if (!serviceWorker.enabled) return;
      const swAssets = buildServiceWorkerAssets(options, {
        versionSeed: createVersionSeed(bundle),
        assets: collectBundleAssets(bundle, base),
        code: getServiceWorkerCode(),
      });
      if (!swAssets) return;
      serviceWorkerManifest = swAssets.manifest;
      this.emitFile({
        type: 'asset',
        fileName: stripLeadingSlash(serviceWorker.path),
        source: swAssets.code,
      });
      this.emitFile({
        type: 'asset',
        fileName: manifestFileName(serviceWorker.path),
        source: JSON.stringify(swAssets.manifest),
      });
    },

    async writeBundle(options, bundle) {
      if (!shouldRewriteUrls) return;

      await lexerReady;

      const outDir = options.dir;
      if (!outDir) return;

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!chunk.dynamicImports || chunk.dynamicImports.length === 0) continue;

        const dynamicChunks = new Set(chunk.dynamicImports);
        const chunkDir = posix.dirname(chunk.fileName);
        const filePath = join(outDir, chunk.fileName);
        const code = await readFile(filePath, 'utf8');

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
          await writeFile(filePath, s.toString());
        }
      }
    },

    transformIndexHtml: {
      order: 'post',
      handler(html: string, ctx) {
        const manifest = serviceWorkerManifest || buildInlineManifest(ctx.bundle, base, options);
        const tags = buildInjectedTags({
          ...options,
          serviceWorkerManifest: manifest,
        });
        return {
          html,
          tags: tags.map((t) => toViteTag(t, injectTo)),
        };
      },
    },
  };
}

function buildInlineManifest(
  bundle: OutputBundleLike | undefined,
  base: string,
  options: ViteResourceFallbackOptions,
): ResourceFallbackManifest | undefined {
  const serviceWorker = normalizeServiceWorkerOptions(options.serviceWorker);
  if (!serviceWorker.enabled) return undefined;
  const swAssets = buildServiceWorkerAssets(options, {
    versionSeed: bundle ? createVersionSeed(bundle) : 'vite-html',
    assets: bundle ? collectBundleAssets(bundle, base) : [],
    code: getServiceWorkerCode(),
  });
  return swAssets?.manifest;
}

function collectBundleAssets(bundle: OutputBundleLike, base: string) {
  return Object.values(bundle).map((item) => {
    const fileName = item.fileName;
    return {
      url: joinAssetPrefix(base, fileName),
      type: item.type === 'chunk' ? ('script' as const) : inferResourceFallbackAssetType(fileName),
    };
  });
}

function createVersionSeed(bundle: OutputBundleLike): string {
  return (
    Object.values(bundle)
      .map((item) => item.fileName)
      .sort()
      .join('|') || 'vite'
  );
}

function stripLeadingSlash(path: string): string {
  return path.replace(/^\/+/, '');
}

function manifestFileName(swPath: string): string {
  const parts = stripLeadingSlash(swPath).split('/');
  parts[parts.length - 1] = 'manifest.json';
  return parts.join('/');
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
