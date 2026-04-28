# @resource-fallback/webpack-plugin

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
          match: 'https://cdn.example.com/',
          urls: [
            'https://cdn-backup.example.com/',
            '/',  // 回源
          ],
        },
      ],
    }),
  ],
};
```

> **重要**：`output.publicPath` 应当与 `match` 保持一致。

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

### 运行时 — 双层保护

#### 第一层：`__webpack_require__.l` 包装

webpack 所有异步 chunk（包括 `React.lazy()`、动态 `import()`）都通过 `__webpack_require__.l` 加载 `<script>`。包装后的流程：

```
chunk 加载请求
  │
  ├── __webpack_require__.l(url, done, key, chunkId)
  │   │
  │   ├── 原始 <script> 加载
  │   │   ├── 成功 → recordSuccess → done(event)
  │   │   └── 失败 → resolver.resolve()
  │   │       ├── retry → 创建新 <script>，延迟重试
  │   │       ├── fallback → 创建新 <script>，切换 URL
  │   │       └── giveup → done(event)（让 webpack 处理错误）
```

每次重试/回退都创建全新的 `<script>` 元素（设置 `data-webpack` 属性），绕过浏览器缓存。

#### 第二层：Observer

Observer 作为安全网，处理 `__webpack_require__.l` 未覆盖的场景：
- **入口脚本**（无 `data-webpack` 属性）
- **CSS chunk**（`mini-css-extract-plugin` 输出的 `<link>` 标签，虽然也带 `data-webpack`，但 webpack adapter 不处理 CSS）
- **其他外部 `<script>`**

Observer 自动跳过带 `data-webpack` 属性的 `<script>` 标签，避免与 webpack adapter 重复处理。

### chunkLoadingGlobal hook

运行时还会 hook `window[chunkLoadingGlobal]`（默认 `webpackChunk_`）的 `push` 方法。当 webpack bootstrap 安装 `__webpack_require__` 后，运行时会捕获并包装 `__webpack_require__.l`。这提供了一个备用路径：即使 `RuntimeModule` 因某些原因未生效，外部 hook 也能接管。

## 配置

`WebpackPluginOptions` 等同于 `@resource-fallback/core` 的 `PluginOptions`，完整字段参见[根目录 README](../../README.md#配置参考)。

### 常用配置示例

```js
new ResourceFallbackWebpackPlugin({
  rules: [
    {
      match: 'https://cdn.example.com/',
      urls: [
        'https://cdn-backup.example.com/',
        'https://static.mysite.com/',
        '/',
      ],
      retry: { max: 2, baseDelay: 300, maxDelay: 3000, jitter: true },
      circuit: { threshold: 3, cooldown: 30000 },
    },
  ],
  debug: 'auto',
  sri: 'strip',
  nonce: 'my-csp-nonce',
  injectPreconnect: true,
})
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
</ChunkErrorBoundary>
```

### 入口脚本兜底

入口脚本（entry bundle）如果所有 fallback 都失败，React/Vue 不会初始化，页面白屏。建议在 `index.html` 中添加内联的 `rf:error` 监听：

```html
<script>
  window.addEventListener('rf:error', function() {
    document.body.innerHTML = '<p>资源加载失败，请刷新页面</p>';
  });
</script>
```

## 许可证

MIT
