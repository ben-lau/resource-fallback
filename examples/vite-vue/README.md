# Vite + Vue 示例

演示 `@resource-fallback/vite-plugin` 在 Vue 3 应用中的完整集成，包括：

- Vue Router 懒加载路由（`() => import('./views/About.vue')`）
- `defineAsyncComponent` 异步组件
- `@vitejs/plugin-legacy` 生成的 SystemJS legacy bundle
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

```ts
// vite.config.ts
{
  base: 'http://cdn-primary.example.invalid/',  // 构建产物的 URL 前缀
  plugins: [
    resourceFallback({
      rules: [{
        match: 'http://cdn-primary.example.invalid/',  // 匹配 base
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

## 运行

```bash
# 在 monorepo 根目录
pnpm install
pnpm build                   # 先构建 packages

# 构建示例
pnpm --filter @resource-fallback-example/vite-vue build

# 启动预览服务器
pnpm --filter @resource-fallback-example/vite-vue start
```

打开 http://127.0.0.1:4174，在路由间切换可观察异步 chunk 的回退行为。

打开 DevTools → Network 面板可以看到：
1. 对 `cdn-primary.example.invalid` 的请求失败
2. 运行时重试 → 切换到 `cdn-secondary` → 再到 `cdn-backup` → 最后回源 `/`
3. 回源成功，页面正常渲染

页面内的事件面板实时展示所有 `rf:*` 事件的时间线。

> **注意**：Vite dev server（`vite dev`）不支持动态 import 回退拦截。请使用 `vite preview` 或 `vite build` 验证。

## E2E 测试

```bash
# 安装 Playwright 浏览器
pnpm --filter @resource-fallback-example/vite-vue exec playwright install

# 运行测试
pnpm --filter @resource-fallback-example/vite-vue test:e2e
```

测试覆盖：
- 入口脚本的完整重试→回退→回源链路
- 路由切换时异步 chunk 的回退
- 事件顺序验证（retry → fallback → success）
- 无控制台错误
