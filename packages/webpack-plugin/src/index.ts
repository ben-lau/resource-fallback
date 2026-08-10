import type { Compiler, Compilation, RuntimeModule as RuntimeModuleType } from 'webpack';

import {
  buildInjectedTags,
  buildServiceWorkerAssets,
  getServiceWorkerCode,
  inferResourceFallbackAssetType,
  joinAssetPrefix,
  normalizeServiceWorkerOptions,
  rfError,
  type HtmlTag,
  type PluginOptions,
} from '@resource-fallback/core';
import { generateWebpackRuntimeBridge } from './runtime-bridge';

const PLUGIN = 'ResourceFallbackWebpackPlugin';

export type WebpackPluginOptions = PluginOptions;

export class ResourceFallbackWebpackPlugin {
  private readonly options: WebpackPluginOptions;

  constructor(options: WebpackPluginOptions) {
    if (!options || !Array.isArray(options.rules) || options.rules.length === 0) {
      throw rfError('`rules` must be a non-empty array');
    }
    this.options = options;
  }

  apply(compiler: Compiler): void {
    if (skipForTarget(compiler.options.target)) return;

    const isDev = compiler.options.mode === 'development';
    if (isDev && !this.options.enableDev) return;

    const webpack =
      compiler.webpack || (compiler as unknown as { webpack: typeof import('webpack') }).webpack;
    if (webpack && typeof webpack.RuntimeModule === 'function') {
      injectRuntimeModule(compiler, webpack);
    }

    const pluginOptions = this.options;
    compiler.hooks.compilation.tap(PLUGIN, (compilation) => {
      const HtmlPlugin = locateHtmlPlugin(compiler);
      if (!HtmlPlugin) {
        if (!warnedNoHtml.has(compiler)) {
          warnedNoHtml.add(compiler);
          compilation.warnings.push(
            rfError(
              'html-webpack-plugin not found; runtime will not be injected automatically. Add html-webpack-plugin or inject via @resource-fallback/core getRuntimeCode().',
            ) as unknown as Error,
          );
        }
        return;
      }
      const ctor = HtmlPlugin as unknown as { getHooks?: (c: unknown) => HtmlPluginHooks };
      const getHooks =
        (HtmlPlugin as { constructor?: { getHooks?: (c: unknown) => HtmlPluginHooks } }).constructor
          ?.getHooks ?? ctor.getHooks;
      if (typeof getHooks !== 'function') {
        compilation.warnings.push(
          rfError('html-webpack-plugin is too old (v4+ required).') as unknown as Error,
        );
        return;
      }
      // 延迟构建标签：此时 webpack 的默认值（uniqueName/chunkLoadingGlobal）
      // 已在 `compilation` 触发时完成了标准化。
      const chunkGlobal = resolveChunkLoadingGlobal(
        (compilation.outputOptions as Compiler['options']['output']) || compiler.options.output,
      );
      let emittedServiceWorker = false;
      const hooks = getHooks(compilation);
      hooks.alterAssetTagGroups.tapAsync(
        PLUGIN,
        (
          data: AlterAssetTagGroupsData,
          cb: (err: Error | null, data: AlterAssetTagGroupsData) => void,
        ) => {
          const order = pluginOptions.htmlInject || 'head-prepend';
          const swAssets = buildWebpackServiceWorkerAssets(
            compiler,
            compilation,
            pluginOptions,
            data,
          );
          if (swAssets && !emittedServiceWorker) {
            emittedServiceWorker = true;
            emitTextAsset(compiler, compilation, swAssets.path, swAssets.code);
            emitTextAsset(
              compiler,
              compilation,
              manifestFileName(swAssets.path),
              JSON.stringify(swAssets.manifest),
            );
          }
          const tags = buildInjectedTags({
            ...pluginOptions,
            webpackChunkLoadingGlobals: [chunkGlobal],
            serviceWorkerManifest: swAssets?.manifest,
          } as Parameters<typeof buildInjectedTags>[0]);
          const converted = tags.map(toHtmlPluginTag);
          if (order === 'head-prepend') data.headTags.unshift(...converted);
          else data.headTags.push(...converted);
          cb(null, data);
        },
      );
    });
  }
}

function buildWebpackServiceWorkerAssets(
  compiler: Compiler,
  compilation: Compilation,
  options: WebpackPluginOptions,
  data: AlterAssetTagGroupsData,
) {
  const serviceWorker = normalizeServiceWorkerOptions(options.serviceWorker);
  if (!serviceWorker.enabled) return null;
  return buildServiceWorkerAssets(options, {
    versionSeed: collectWebpackAssetNames(compilation).sort().join('|') || 'webpack',
    assets: collectWebpackManifestAssets(compiler, compilation, data),
    code: getServiceWorkerCode(),
  });
}

function collectWebpackManifestAssets(
  compiler: Compiler,
  compilation: Compilation,
  data: AlterAssetTagGroupsData,
) {
  const publicPath = resolvePublicPath(compilation, compiler);
  const names = new Set<string>();
  for (const name of collectWebpackAssetNames(compilation)) names.add(name);
  for (const tag of data.headTags.concat(data.bodyTags)) {
    const src = tag.attributes.src;
    const href = tag.attributes.href;
    if (typeof src === 'string') names.add(src);
    if (typeof href === 'string') names.add(href);
  }
  return Array.from(names).map((name) => ({
    url: joinAssetPrefix(publicPath, name),
    type: inferResourceFallbackAssetType(name),
  }));
}

function collectWebpackAssetNames(compilation: Compilation): string[] {
  const c = compilation as Compilation & {
    getAssets?: () => Array<{ name: string }>;
    assets?: Record<string, unknown>;
  };
  if (typeof c.getAssets === 'function') return c.getAssets().map((asset) => asset.name);
  return Object.keys(c.assets || {});
}

function emitTextAsset(
  compiler: Compiler,
  compilation: Compilation,
  path: string,
  source: string,
): void {
  const fileName = stripLeadingSlash(path);
  const RawSource = (
    compiler.webpack || (compiler as unknown as { webpack: typeof import('webpack') }).webpack
  ).sources.RawSource;
  compilation.emitAsset(fileName, new RawSource(source));
}

function manifestFileName(swPath: string): string {
  const parts = stripLeadingSlash(swPath).split('/');
  parts[parts.length - 1] = 'manifest.json';
  return parts.join('/');
}

function stripLeadingSlash(path: string): string {
  return path.replace(/^\/+/, '');
}

function resolvePublicPath(compilation: Compilation, compiler: Compiler): string {
  const output =
    (compilation.outputOptions as Compiler['options']['output']) || compiler.options.output;
  const publicPath = output?.publicPath;
  return typeof publicPath === 'string' && publicPath !== 'auto' ? publicPath : '/';
}

const warnedNoHtml = new WeakSet<Compiler>();

interface HtmlPluginTag {
  tagName: string;
  voidTag: boolean;
  attributes: Record<string, string | boolean>;
  innerHTML?: string;
  meta?: { plugin?: string };
}

interface AlterAssetTagGroupsData {
  headTags: HtmlPluginTag[];
  bodyTags: HtmlPluginTag[];
}

interface HtmlPluginHooks {
  alterAssetTagGroups: {
    tapAsync(
      name: string,
      handler: (
        data: AlterAssetTagGroupsData,
        cb: (err: Error | null, data: AlterAssetTagGroupsData) => void,
      ) => void,
    ): void;
  };
}

function toHtmlPluginTag(tag: HtmlTag): HtmlPluginTag {
  const attrs: Record<string, string | boolean> = {};
  for (const k of Object.keys(tag.attributes)) {
    const v = tag.attributes[k];
    if (v === undefined) continue;
    attrs[k] = v as string | boolean;
  }
  return {
    tagName: tag.tagName,
    voidTag: !!tag.voidTag,
    attributes: attrs,
    innerHTML: tag.innerHTML,
    meta: { plugin: PLUGIN },
  };
}

function locateHtmlPlugin(compiler: Compiler): unknown | undefined {
  for (const p of compiler.options.plugins || []) {
    if (!p) continue;
    const ctor = (p as { constructor?: { name?: string; getHooks?: unknown } }).constructor;
    if (ctor?.name === 'HtmlWebpackPlugin') return p;
    if (typeof ctor?.getHooks === 'function') return p;
  }
  return undefined;
}

function skipForTarget(target: Compiler['options']['target']): boolean {
  if (!target) return false;
  if (target === 'node' || target === 'webworker' || target === 'electron-main') return true;
  if (Array.isArray(target)) {
    for (const t of target) {
      const s = String(t);
      if (s.indexOf('node') === 0) return true;
      if (s === 'webworker') return true;
    }
  }
  return false;
}

/**
 * 复现 webpack 的 `Template.toIdentifier('webpackChunk' + uniqueName)` 逻辑。
 * 无法安全地导入 webpack 的运行时辅助函数（peer dep + 版本差异），
 * 所以这里复刻其使用的正则。
 */
function resolveChunkLoadingGlobal(output: Compiler['options']['output'] | undefined): string {
  const explicit = output?.chunkLoadingGlobal;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const uniqueName = output?.uniqueName || '';
  return ('webpackChunk' + uniqueName).replace(/[^a-zA-Z0-9$]+/g, '_');
}

/**
 * 注入一个 Webpack `RuntimeModule`，在 webpack 自身的 bootstrap 内部
 * patch `__webpack_require__.l`——在其定义之后、首次 chunk 加载触发之前。
 * 这比从外部 monkey-patch chunk 数组的 `push()` 可靠得多。
 */
function injectRuntimeModule(compiler: Compiler, webpack: typeof import('webpack')): void {
  const RuntimeModuleCtor = webpack.RuntimeModule as unknown as {
    new (name: string, stage?: number): RuntimeModuleType;
  };
  // STAGE_TRIGGER (20) > STAGE_ATTACH (10) > STAGE_BASIC (5) > STAGE_NORMAL (0)。
  // LoadScriptRuntimeModule 注册在默认阶段 (NORMAL)，任何严格更高的值即可；
  // 选择最高的文档化阶段以防未来 webpack 版本移动 LoadScript。
  const stage =
    (webpack.RuntimeModule as unknown as { STAGE_TRIGGER?: number }).STAGE_TRIGGER ?? 20;

  const runtimeSource = generateWebpackRuntimeBridge();

  compiler.hooks.thisCompilation.tap(PLUGIN, (compilation: Compilation) => {
    compilation.hooks.runtimeRequirementInTree.for('__webpack_require__.l').tap(PLUGIN, (chunk) => {
      class RfRuntimeModule extends RuntimeModuleCtor {
        constructor() {
          // 更高的 stage = 在运行时模板中更*晚*生成，这样到我们的包装执行时，
          // webpack 的 LoadScriptRuntimeModule 已经安装了 `__webpack_require__.l`。
          // STAGE_TRIGGER 是定义的最高阶段，RuntimePlugin 用它来注册
          // 依赖模块——在此使用是安全的。
          super('resource-fallback hook', stage);
        }
        override generate(): string {
          return runtimeSource;
        }
      }
      compilation.addRuntimeModule(chunk, new RfRuntimeModule());
      // 重要：不要返回 `true`。`runtimeRequirementInTree` 是 SyncBailHook——
      // 返回真值会短路整个链，阻止 webpack 自身的 `RuntimePlugin` 注册
      // `LoadScriptRuntimeModule`（也就是定义 `__webpack_require__.l` 的模块）。
      // 没有它我们的包装找不到 `.l`，页面在请求异步 chunk 时会抛出
      // "t.l is not a function"。
      return undefined;
    });
  });
}

export default ResourceFallbackWebpackPlugin;
