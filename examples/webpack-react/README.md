# Webpack + React 示例

演示 `@resource-fallback/webpack-plugin` 在 React 18 应用中的完整集成，包括：

- `React.lazy()` + `<Suspense>` 异步组件加载
- `ErrorBoundary` 兜底 chunk 加载失败
- 入口脚本的 `rf:error` 白屏兜底
- 运行时事件面板，实时展示 `rf:retry` / `rf:fallback` / `rf:success` / `rf:error` 事件

## 回退链路

```
cdn-primary.example.invalid  （DNS 必然失败）
        ↓ 重试 1 次
cdn-secondary.example.invalid （DNS 必然失败）
        ↓ 重试 1 次
cdn-backup.example.invalid    （DNS 必然失败）
        ↓ 重试 1 次
/                             （回源，同源请求，成功）
```

使用 `.invalid` 域名（RFC 2606 保留），DNS 必然失败，无需任何 mock 服务器即可观察完整的回退链路。

## 配置说明

```js
// webpack.config.cjs
{
  output: {
    publicPath: 'http://cdn-primary.example.invalid/',  // 构建产物的 URL 前缀
  },
  plugins: [
    new ResourceFallbackWebpackPlugin({
      rules: [{
        match: 'http://cdn-primary.example.invalid/',  // 匹配 publicPath
        urls: [
          'http://cdn-secondary.example.invalid/',     // 备用 CDN 1
          'http://cdn-backup.example.invalid/',         // 备用 CDN 2
          '/',                                          // 回源
        ],
        retry: { max: 1, baseDelay: 300, maxDelay: 1000, jitter: false },
        circuit: { threshold: 2, cooldown: 15_000, storageTtl: 60_000 },
      }],
      debug: true,
    }),
  ],
}
```

## 错误处理

本示例展示了两层兜底机制：

### 1. 入口脚本失败 → 白屏兜底

在 `index.html` 中内联 `rf:error` 监听器。当入口 bundle 所有 fallback 都失败时，React 不会初始化。内联脚本会显示降级 UI（错误信息 + 刷新按钮）。

### 2. 异步 chunk 失败 → ErrorBoundary

`React.lazy()` 在 chunk 加载失败时会抛出错误，`<Suspense>` 只处理 loading 不处理 error。本示例通过 `ChunkErrorBoundary` 组件捕获错误并显示重试 UI，避免整个应用崩溃。

## 运行

```bash
# 在 monorepo 根目录
pnpm install
pnpm build                   # 先构建 packages

# 构建示例
pnpm --filter @resource-fallback-example/webpack-react build

# 启动静态服务器
pnpm --filter @resource-fallback-example/webpack-react start
```

打开 http://127.0.0.1:4173，点击 "Load Lazy Module" 按钮观察异步 chunk 的回退行为。

打开 DevTools → Network 面板可以看到：
1. 入口脚本对 `cdn-primary.example.invalid` 的请求失败
2. Webpack adapter 重试 → 切换到 `cdn-secondary` → 再到 `cdn-backup` → 最后回源 `/`
3. 回源成功，React 应用正常渲染
4. 点击加载异步模块时，同样的回退链路再次触发

页面内的事件面板实时展示所有 `rf:*` 事件。

## E2E 测试

```bash
# 安装 Playwright 浏览器
pnpm --filter @resource-fallback-example/webpack-react exec playwright install

# 运行测试
pnpm --filter @resource-fallback-example/webpack-react test:e2e
```

测试覆盖：
- 入口脚本的完整重试→回退→回源链路
- 多个 `React.lazy()` 组件的顺序加载与回退
- 事件顺序验证
- 熔断器状态在多次加载间的持久性
- 无未捕获异常
