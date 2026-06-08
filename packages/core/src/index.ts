import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HtmlTag, PluginOptions, RuntimeConfig } from './types';

export type {
  CircuitOptions,
  ErrorEvent,
  FallbackEvent,
  FallbackRule,
  HtmlTag,
  HtmlTagAttributes,
  MatchPattern,
  NormalizedServiceWorkerOptions,
  PluginOptions,
  ResolveResult,
  RetryEvent,
  RetryOptions,
  ResourceFallbackAssetOwner,
  ResourceFallbackAssetType,
  ResourceFallbackManifest,
  ResourceFallbackManifestAsset,
  RuntimeConfig,
  RuntimeHooks,
  ServiceWorkerOptions,
  SriPolicy,
  SuccessEvent,
} from './types';
export {
  buildResourceFallbackManifest,
  buildServiceWorkerAssets,
  inferResourceFallbackAssetType,
  normalizeServiceWorkerOptions,
} from './service-worker';

/**
 * 恒等辅助函数——让用户在编写配置时获得类型检查和 IDE 悬浮提示。
 *
 * @example
 *   import { defineConfig } from '@resource-fallback/core';
 *   export default defineConfig({ rules: [...] });
 */
export function defineConfig<T extends PluginOptions>(config: T): T {
  return config;
}

/** 返回 IIFE 运行时文件的绝对路径。 */
export function getRuntimePath(): string {
  // tsup 会把两个文件输出到同一个 `dist/` 目录。当从源码运行（例如 vitest）时，
  // 需要改为查找 `../dist/`。
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    const cjsDirname = (globalThis as { __dirname?: string }).__dirname;
    here = typeof cjsDirname === 'string' ? cjsDirname : process.cwd();
  }
  const candidates = [
    resolve(here, 'runtime.iife.js'),
    resolve(here, '..', 'dist', 'runtime.iife.js'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* 尝试下一个路径 */
    }
  }
  return candidates[0];
}

let cachedCode: string | null = null;

/** 读取 IIFE 运行时文件内容。首次调用后缓存。 */
export function getRuntimeCode(): string {
  if (cachedCode === null) {
    cachedCode = readFileSync(getRuntimePath(), 'utf8');
  }
  return cachedCode;
}

/** 返回 Service Worker 运行时文件的绝对路径。 */
export function getServiceWorkerPath(): string {
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    const cjsDirname = (globalThis as { __dirname?: string }).__dirname;
    here = typeof cjsDirname === 'string' ? cjsDirname : process.cwd();
  }
  const candidates = [resolve(here, 'rf-sw.js'), resolve(here, '..', 'dist', 'rf-sw.js')];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* 尝试下一个路径 */
    }
  }
  return candidates[0];
}

let cachedSwCode: string | null = null;

/** 读取 Service Worker 运行时代码。源码测试环境未构建时返回占位代码。 */
export function getServiceWorkerCode(): string {
  if (cachedSwCode === null) {
    try {
      cachedSwCode = readFileSync(getServiceWorkerPath(), 'utf8');
    } catch {
      cachedSwCode = '/* resource-fallback service worker: RF_SW_CONFIG */';
    }
  }
  return cachedSwCode;
}

interface ExtendedPluginOptions extends PluginOptions {
  /** 供 webpack 插件内部使用，将 chunkLoadingGlobal 信息转发给运行时。 */
  webpackChunkLoadingGlobals?: string[];
}

/**
 * 构建所有需要注入到 HTML 中的 `<script>` / `<link>` 标签描述。
 * webpack 和 vite 插件都调用此函数以确保输出一致的标记。
 *
 * 运行时配置被 JSON 序列化并内联；仅原始类型的匹配器（string / RegExp）会被保留。
 * 函数形式的 `match` 需要通过 `defaults` 传入或手动初始化运行时。
 */
export function buildInjectedTags(opts: ExtendedPluginOptions): HtmlTag[] {
  const tags: HtmlTag[] = [];
  const runtimeConfig = stripPluginOnlyFields(opts);

  if (opts.injectPreconnect !== false) {
    const seen = new Set<string>();
    for (const rule of opts.rules || []) {
      for (const u of rule.urls || []) {
        const origin = safeOrigin(u);
        if (!origin || seen.has(origin)) continue;
        seen.add(origin);
        tags.push({
          tagName: 'link',
          voidTag: true,
          attributes: { rel: 'preconnect', href: origin, crossorigin: 'anonymous' },
        });
      }
    }
  }

  const scriptAttrs: Record<string, string | true> = {};
  if (opts.nonce) scriptAttrs.nonce = opts.nonce;

  if (opts.externalRuntime) {
    const src = opts.externalRuntimePath || '/__rf/runtime.js';
    tags.push({
      tagName: 'script',
      voidTag: false,
      attributes: { ...scriptAttrs, src },
      innerHTML: '',
    });
    tags.push({
      tagName: 'script',
      voidTag: false,
      attributes: { ...scriptAttrs },
      innerHTML: `window.__RF__&&window.__RF__.install(${serialiseConfig(runtimeConfig)})`,
    });
  } else {
    tags.push({
      tagName: 'script',
      voidTag: false,
      attributes: { ...scriptAttrs },
      innerHTML: `${getRuntimeCode()};window.__RF__.install(${serialiseConfig(runtimeConfig)})`,
    });
  }

  return tags;
}

/**
 * 将运行时配置序列化为 JSON，其中 `RegExp` 实例会被渲染为原生正则字面量，
 * 以便运行时直接使用。
 */
export function serialiseConfig(
  cfg: RuntimeConfig & { webpackChunkLoadingGlobals?: string[] },
): string {
  return stringify(cfg);
}

/**
 * 拼接 asset 前缀与文件名。
 *
 *  - 绝对 URL（`https?://` 或 `/` 开头）直接返回 filename
 *  - 空 filename 返回 prefix（标准化尾部斜杠）
 *  - 去掉 filename 的前导 `/`，确保 prefix 与 filename 之间恰好一个 `/`
 */
export function joinAssetPrefix(prefix: string, filename: string): string {
  if (!filename) return prefix.replace(/\/?$/, '') || '/';
  if (/^https?:\/\//.test(filename) || filename[0] === '/') return filename;
  const name = filename.replace(/^\/+/, '');
  const sep = /[/\\]$/.test(prefix) ? '' : '/';
  return `${prefix}${sep}${name}`;
}

/** 剥离仅供插件使用的字段后再序列化。 */
function stripPluginOnlyFields(
  opts: ExtendedPluginOptions,
): RuntimeConfig & { webpackChunkLoadingGlobals?: string[] } {
  const {
    enableDev: _enableDev,
    nonce: _nonce,
    externalRuntime: _externalRuntime,
    externalRuntimePath: _externalRuntimePath,
    injectPreconnect: _injectPreconnect,
    htmlInject: _htmlInject,
    ...rest
  } = opts;
  return rest;
}

function safeOrigin(url: string): string | null {
  if (!url) return null;
  // 相对路径（`/`、`./`、`../`）始终指向当前 origin——没有需要 preconnect 的
  // 内容，跳过以避免注入无意义的 `<link rel=preconnect href="http://dummy.local">` 标签。
  if (url[0] === '/' || /^\.\.?\//.test(url)) return null;
  try {
    const parsed = new URL(url, 'http://dummy.local/');
    if (parsed.origin === 'http://dummy.local') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function stringify(value: unknown): string {
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stringify).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'function') continue; // hooks 必须在运行时绑定
      if (v === undefined) continue;
      parts.push(JSON.stringify(k) + ':' + stringify(v));
    }
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(value).replace(/</g, '\\x3c');
}
