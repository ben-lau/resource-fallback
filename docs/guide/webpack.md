---
title: Webpack 集成
---

# Webpack 集成

`@resource-fallback/webpack-plugin` 是 Webpack 5+ 插件，为 Webpack 构建产物（入口脚本、异步 chunk、CSS）提供运行时重试与多 CDN 回退能力。

## 安装

```bash
pnpm add -D @resource-fallback/webpack-plugin html-webpack-plugin
```

需要同时安装 `html-webpack-plugin`（v4+）以自动注入运行时。

## 基本配置

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
});
```

::: tip 重要
`output.publicPath` 应当与 `rules[].base`（rule `base`）保持一致。
:::

完整配置选项见 [配置参考](./configuration.md)。

## 工作原理

插件在构建时完成两件事，运行时提供双层保护。

### 构建时

#### 1. HTML 注入

通过 `html-webpack-plugin` 的 `alterAssetTagGroups` 钩子在 `<head>` 中注入：

- `<link rel="preconnect">` 标签（为每个 fallback 域名预建连接）
- `<script>` 内联运行时 IIFE + `install(config)` 调用

::: warning 无 html-webpack-plugin
如果未检测到 `html-webpack-plugin`，插件会输出警告，不会自动注入。此时需要通过 `@resource-fallback/core` 的 `getRuntimeCode()` 手动注入。
:::

#### 2. RuntimeModule 注入

注入一个 Webpack `RuntimeModule`（stage = `STAGE_TRIGGER`），在 webpack 的 bootstrap 内部 patch `__webpack_require__.l`——在其定义之后、首次 chunk 加载触发之前。这比从外部 monkey-patch 可靠得多。

注入代码只负责把 Webpack 的加载回调接到 core 的私有 `window.__RF__.internal` 桥接；它不是面向应用代码的公开 API，也不应作为 semver 承诺的集成面。页面侧的 RecoveryCoordinator 才是恢复决策引擎，统一拥有重试、回退、熔断、事件、取消和进行中 recovery Promise 的共享。

### 运行时 — 双层保护

#### 第一层：`__webpack_require__.l` 包装

webpack 所有异步 chunk（包括 `React.lazy()`、动态 `import()`）都通过 `__webpack_require__.l` 加载 `<script>`。RuntimeModule 是主路径：它直接在 webpack bootstrap 内包装原生 loader，保留首次加载回调语义，再把后续恢复动作交给 Coordinator。包装后的流程：

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

同一个逻辑 chunk（`key`/`chunkId` 对应的 `logicalKey`）在并发触发时会加入同一 Coordinator session，共享同一个 recovery Promise，而不是各自独立重试。每次 retry/fallback 都会创建全新的 `<script>` 元素，并保留 webpack 的 `nonce`、`crossOrigin`、`referrerPolicy`、`charset`、`trustedScriptUrl` 等元数据；如果提供了 `key`，新节点还会带上 `data-webpack` 属性。

#### data-webpack ownership

重试/回退创建的 `<script>` 元素会设置 `data-webpack` 属性（值为 chunk loading key）。Observer 只会跳过带 `data-webpack` 的 `<script>`，避免与 webpack adapter 对同一个异步 JS chunk 重复接管；这条规则不适用于 CSS `<link>`，因此 CSS 仍由 Observer 负责替换。

::: info ownership 划分

- **Webpack adapter** — 带 `data-webpack` 的异步 chunk `<script>`
- **Observer** — 入口脚本（无 `data-webpack`）、CSS chunk、其他外部 `<script>`
  :::

#### CSS chunk promise 处理

`mini-css-extract-plugin` 和 webpack `experiments.css` 会在 `__webpack_require__.f` 上注册非 `j` loader（如 `miniCss`、`css`）。当异步 chunk 同时包含 JS 和独立 CSS 时，`__webpack_require__.e(chunkId)` 会对这些 loader Promise 执行 `Promise.all`。

如果 CSS `<link>` 加载失败，webpack 生成的 `onerror` 会以 `CSS_CHUNK_LOAD_FAILED`（或指向 `.css` 请求的错误）reject。Webpack RuntimeModule 在这里做的事情只有一件：吞掉这类已识别的 CSS rejection，避免 `Promise.all` 提前短路；真正的 `<link>` 替换仍由 Observer 负责。换句话说，Webpack hook 负责“不要过早失败”，Observer 负责“生成并接管新的 CSS 节点”。

#### 第二层：Observer

Observer 作为安全网，处理 `__webpack_require__.l` 未覆盖的场景：

- **入口脚本**（无 `data-webpack` 属性）
- **CSS chunk**（`mini-css-extract-plugin` 输出的 `<link>` 标签）
- **其他外部 `<script>`**

### chunkLoadingGlobal hook

core 的 webpack adapter 还会 hook `window[chunkLoadingGlobal]` 的 `push` 方法作为备用路径：当 chunk runtime 执行并暴露 `__webpack_require__` 后，它会补充包装 `__webpack_require__.l`。这里的全局名优先取 `output.chunkLoadingGlobal`，否则按 webpack 的 `uniqueName` 规则推导，并不总是字面量 `webpackChunk_`。

这条 chunk-array / `chunkLoadingGlobal` 路径是后备机制，不替代 RuntimeModule 主路径。若 RuntimeModule 因版本或注入时机问题未生效，页面侧 adapter 仍有机会接管；若插件内的 RuntimeModule 已经完成包装，chunk-array adapter 会识别已有标记并让出控制权。

## 配置示例

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

调用 `window.__RF__.dispose()` 或卸载当前 runtime 安装时，会取消 owner = `webpack` 的进行中恢复，并移除 `__webpack_require__.l` 包装、chunk-array `push` 补丁、扫描定时器和监听器。旧 session 不会继续接管新安装后的页面状态；需要新的恢复流程时，应让新的 runtime 安装重新建立自己的 Coordinator 和适配器。

## 同步/异步覆盖

| 场景                       | Webpack                                      |
| -------------------------- | -------------------------------------------- |
| 同步 `<script>` / `<link>` | ✓ Observer                                   |
| 异步 chunk（`import()`）   | ✓ `__webpack_require__.l` hook               |
| CSS 动态注入               | ✓ Observer                                   |
| SystemJS（legacy bundle）  | ✓ `instantiate` hook                         |
| 图片 / 字体 / 媒体资源     | ✓ Hybrid SW（opt-in，受控页面）              |
| CSS `url()` / `@font-face` | ✓ Hybrid SW（opt-in，受控页面）              |
| CSS `@import`              | ✓ Hybrid SW（需 CSS referrer 命中 manifest） |

## 相关文档

- [快速开始](./quick-start.md)
- [Hybrid Service Worker](./service-worker.md)
- [运行时事件](./runtime-events.md)
