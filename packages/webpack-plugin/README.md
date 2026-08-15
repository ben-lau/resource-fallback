# @resource-fallback/webpack-plugin

> **[中文](README.md)** | [English](README.en.md)

Webpack 5+ 插件，为 Webpack 构建产物（入口脚本、异步 chunk、CSS）提供运行时重试与多 CDN 回退能力。

## 安装

```bash
pnpm add @resource-fallback/webpack-plugin -D
```

需要同时安装 `html-webpack-plugin`（v4+）以自动注入运行时。

## 基本用法

```js
// webpack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ResourceFallbackWebpackPlugin } = require('@resource-fallback/webpack-plugin');

module.exports = {
  output: {
    publicPath: 'https://cdn.example.com/',
  },
  plugins: [
    new HtmlWebpackPlugin(),
    new ResourceFallbackWebpackPlugin({
      rules: [
        {
          base: 'https://cdn.example.com/',
          urls: [
            'https://cdn-backup.example.com/',
            '/', // 回源
          ],
        },
      ],
    }),
  ],
};
```

> **重要**：`output.publicPath` 应当与 `rules[].base`（rule `base`）保持一致。

## 工作原理

插件在构建时完成两件事，运行时提供双层保护：

### 构建时

#### 1. HTML 注入

通过 `html-webpack-plugin` 的 `alterAssetTagGroups` 钩子在 `<head>` 中注入：

- `<link rel="preconnect">` 标签（为每个 fallback 域名预建连接）
- `<script>` 内联运行时 IIFE + `install(config)` 调用

如果未检测到 `html-webpack-plugin`，插件会输出警告，不会自动注入。此时需要通过 `@resource-fallback/core` 的 `getRuntimeCode()` 手动注入。

#### 2. RuntimeModule 注入

注入一个 Webpack `RuntimeModule`（stage = `STAGE_TRIGGER`），在 webpack 的 bootstrap 内部 patch `__webpack_require__.l`——在其定义之后、首次 chunk 加载触发之前。这比从外部 monkey-patch 可靠得多。

注入的代码只负责把 Webpack 的加载回调接到 core 的私有 `window.__RF__.internal` 桥接；它不是给业务代码调用的公开 API。页面侧 RecoveryCoordinator 才是恢复决策引擎，统一拥有重试、回退、熔断、事件、取消和进行中 recovery Promise 的共享。

### 运行时 — 双层保护

#### 第一层：`__webpack_require__.l` 包装

webpack 所有异步 chunk（包括 `React.lazy()`、动态 `import()`）都通过 `__webpack_require__.l` 加载 `<script>`。RuntimeModule 是主路径：它在 bootstrap 内包装原生 loader，再把恢复决策交给 Coordinator。包装后的流程：

```
chunk 加载请求
  │
  ├── __webpack_require__.l(url, done, key, chunkId)
  │   │
  │   ├── 原始 <script> 加载
  │   │   ├── 成功 → Coordinator → done(event)
  │   │   └── 失败 → Coordinator recovery
  │   │       ├── retry → 创建新 <script>，延迟重试
  │   │       ├── fallback → 创建新 <script>，切换 URL
  │   │       └── giveup → done(event)（让 webpack 处理错误）
```

同一个逻辑 chunk 的并发请求会加入同一个 Coordinator session，共享一个 recovery Promise。每次 retry/fallback 都会创建全新的 `<script>` 元素，保留 webpack 的 `nonce`、`crossOrigin`、`referrerPolicy`、`charset`、`trustedScriptUrl` 等元数据；如果存在 `key`，新节点还会设置 `data-webpack` 属性。

#### 第二层：Observer

Observer 作为安全网，处理 `__webpack_require__.l` 未覆盖的场景：

- **入口脚本**（无 `data-webpack` 属性）
- **CSS chunk**（`mini-css-extract-plugin` 或 `experiments.css` 产生的 `<link>` 标签；即使带 `data-webpack`，CSS 替换仍不由 webpack adapter 接管）
- **其他外部 `<script>`**

Observer 自动跳过带 `data-webpack` 的 `<script>` 标签，避免与 webpack adapter 重复处理同一个异步 JS chunk；这条规则不改变 CSS 所有权，CSS `<link>` 仍由 Observer 替换。与此同时，RuntimeModule 会包装非 `j` 的 `__webpack_require__.f` loader，吞掉已识别的 CSS rejection，避免 `Promise.all` 在 Observer 替换 `<link>` 之前提前失败。

### chunkLoadingGlobal hook

运行时还会 hook `window[chunkLoadingGlobal]` 的 `push` 方法作为备用路径。当 webpack bootstrap 安装 `__webpack_require__` 后，页面侧 adapter 会捕获并包装 `__webpack_require__.l`。这个全局名优先取 `output.chunkLoadingGlobal`，否则按 webpack `uniqueName` 的默认规则推导，并不总是字面量 `webpackChunk_`。

这条 chunk-array 路径是后备机制，不替代 RuntimeModule 主路径；如果 RuntimeModule 已经完成包装，页面侧 adapter 会识别标记并让出控制权。

## 配置

`WebpackPluginOptions` 等同于 `@resource-fallback/core` 的 `PluginOptions`，完整字段参见[根目录 README](../../README.md#配置参考)。

### 常用配置示例

```js
new ResourceFallbackWebpackPlugin({
  rules: [
    {
      base: 'https://cdn.example.com/',
      urls: ['https://cdn-backup.example.com/', 'https://static.mysite.com/', '/'],
      retry: { max: 2, baseDelay: 300, maxDelay: 3000, jitter: true },
      circuit: { threshold: 3, cooldown: 30000 },
    },
  ],
  debug: 'auto',
  sri: 'strip',
  nonce: 'my-csp-nonce',
  injectPreconnect: true,
});
```

## 注意事项

### 非浏览器 target

当 `target` 为 `node` / `webworker` / `electron-main` 时，插件自动跳过，不注入任何内容。

### React.lazy 错误处理

使用 `React.lazy()` 时，如果异步 chunk 在所有候选 URL 耗尽后仍然失败，`React.lazy()` 会抛出错误。`<Suspense>` 只处理 loading 状态，不处理错误。建议包裹 `ErrorBoundary`：

```tsx
class ChunkErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div>资源加载失败，请刷新页面重试</div>;
    }
    return this.props.children;
  }
}

// 使用
<ChunkErrorBoundary>
  <Suspense fallback={<Loading />}>
    <LazyComponent />
  </Suspense>
</ChunkErrorBoundary>;
```

### 入口脚本兜底

入口脚本（entry bundle）如果所有 fallback 都失败，React/Vue 不会初始化，页面白屏。建议在 `index.html` 中添加内联的 `rf:error` 监听：

```html
<script>
  window.addEventListener('rf:error', function () {
    document.body.innerHTML = '<p>资源加载失败，请刷新页面</p>';
  });
</script>
```

### dispose 清理

调用 `window.__RF__.dispose()` 时，runtime 会取消 owner = `webpack` 的进行中恢复，并移除 `__webpack_require__.l` 包装、chunk-array `push` 补丁、扫描定时器和相关监听。旧 session 不会继续影响后续的新安装。

## 许可证

MIT
