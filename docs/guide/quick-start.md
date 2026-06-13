---
title: 快速开始
---

# 快速开始

## 安装

::: code-group

```bash [Vite]
pnpm add -D @resource-fallback/vite-plugin
```

```bash [Webpack]
pnpm add -D @resource-fallback/webpack-plugin html-webpack-plugin
```

:::

::: warning Webpack 依赖
Webpack 插件依赖 `html-webpack-plugin` 自动注入运行时。如果项目不使用它，需要通过 `@resource-fallback/core` 手动注入 runtime。
:::

## Vite 最小配置

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn1.example.com/',
  plugins: [
    resourceFallback({
      rules: [
        {
          match: 'https://cdn1.example.com/',
          urls: [
            'https://cdn2.example.com/',
            'https://backup.example.com/',
            '/', // 回源
          ],
          retry: { max: 2, baseDelay: 300 },
          circuit: { threshold: 3, cooldown: 30000 },
        },
      ],
    }),
  ],
});
```

::: tip match 与 base 对齐
`match` 的值应当与 Vite 的 `base` 保持一致，确保构建产物的 URL 能被规则匹配。
:::

## Webpack 最小配置

```js
// webpack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ResourceFallbackWebpackPlugin } = require('@resource-fallback/webpack-plugin');

module.exports = {
  output: {
    publicPath: 'https://cdn1.example.com/',
  },
  plugins: [
    new HtmlWebpackPlugin(),
    new ResourceFallbackWebpackPlugin({
      rules: [
        {
          match: 'https://cdn1.example.com/',
          urls: ['https://cdn2.example.com/', 'https://backup.example.com/', '/'],
        },
      ],
    }),
  ],
};
```

::: tip match 与 publicPath 对齐
`match` 的值应当与 `output.publicPath` 保持一致。
:::

## 验证

构建并预览后，打开 DevTools → Network 可观察完整的 **重试 → 回退 → 回源** 链路。

监听 `rf:retry` 事件确认运行时已生效：

```ts
window.addEventListener('rf:retry', (e) => {
  console.log('重试:', e.detail);
});
```

### Demo 项目

项目提供了两个无需 mock 服务器的示例（使用 `.invalid` 域名模拟 CDN 失败）：

```bash
pnpm install
pnpm build

# Vite + Vue
pnpm --filter @resource-fallback-example/vite-vue build
pnpm --filter @resource-fallback-example/vite-vue start   # http://127.0.0.1:4174

# Webpack + React
pnpm --filter @resource-fallback-example/webpack-react build
pnpm --filter @resource-fallback-example/webpack-react start   # http://127.0.0.1:4173
```

## 上手注意点

1. **`match` 要对齐构建产物前缀** — Vite 对齐 `base`，Webpack 对齐 `output.publicPath`。如果首次资源 URL 匹配不上 `match`，运行时不会进入 retry/fallback。
2. **`urls` 顺序就是回退顺序** — 建议写成备用 CDN → 自建静态源 → 回源 `'/'`。最后一个通常放同源回源，避免主 CDN 故障时再次命中 CDN。
3. **Vite dev 不是主要验证环境** — dev server 使用原生 ESM，动态 `import()` 失败无法完整拦截；请用 `vite build && vite preview` 或示例里的 E2E 验证。
4. **入口资源失败要自己兜底 UI** — 入口 bundle 如果所有候选 URL 都失败，React/Vue 还没启动；建议在 `index.html` 加一个轻量 `rf:error` 监听显示降级文案。
5. **Hybrid SW 是 opt-in** — 需要 `serviceWorker: true` 或对象配置才会接管图片、字体、CSS 背景图等子资源。SW 调试请使用 `localhost` / `127.0.0.1` / HTTPS。

::: warning Vite 开发模式
默认情况下插件在 `dev` 模式不激活（`enableDev: false`）。如需调试回退逻辑，请使用 `vite build && vite preview`。
:::

## 下一步

- [配置参考](./configuration.md) — 完整配置选项
- [运行时事件](./runtime-events.md) — 事件监听与监控对接
- [最佳实践](./best-practices.md) — 生产环境建议
