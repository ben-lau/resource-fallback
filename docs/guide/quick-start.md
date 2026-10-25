---
title: 快速开始
outline: [2, 3]
---

# 快速开始

选择你的构建工具，配置资源 URL 的匹配前缀与候选地址，然后用生产构建验证一次 CDN 故障。

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
          base: 'https://cdn1.example.com/',
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

::: tip rule `base` 与 Vite `base` 对齐
`rules[].base`（rule `base`）应当与 Vite `base` 保持一致，确保构建产物的 URL 能被规则匹配。
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
          base: 'https://cdn1.example.com/',
          urls: ['https://cdn2.example.com/', 'https://backup.example.com/', '/'],
        },
      ],
    }),
  ],
};
```

::: tip rule `base` 与 publicPath 对齐
`rules[].base`（rule `base`）应当与 `output.publicPath` 保持一致。
:::

## 验证

### 预期的请求顺序

假设页面位于 `https://app.example.com/`，要加载的文件是 `assets/app.js`。按上方配置，资源路径在各地址间保持一致。没有熔断且前面的地址持续失败时，浏览器会依次尝试下表中的 URL。

| 地址              | 请求 URL                                   |
| ----------------- | ------------------------------------------ |
| 主 CDN            | `https://cdn1.example.com/assets/app.js`   |
| 备用 CDN          | `https://cdn2.example.com/assets/app.js`   |
| 自建静态源        | `https://backup.example.com/assets/app.js` |
| 页面源站（`'/'`） | `https://app.example.com/assets/app.js`    |

将同一份构建产物部署到各地址对应的路径。配置中的 `'/'` 指页面源站的根路径。如果产物发布在 `/app/` 下，就把对应候选写成 `'/app/'`。

### 模拟 CDN 故障

1. 预览生产构建。Vite 可运行 `pnpm exec vite build` 和 `pnpm exec vite preview`。Webpack 可运行 `pnpm exec webpack --mode production`，再用静态服务器提供构建输出。
2. 在 DevTools 的 Network 面板关闭缓存，并屏蔽待测资源在主 CDN 上的请求。只屏蔽一个懒加载 chunk，便于应用启动后反复验证。重试可能附加查询参数，屏蔽规则要覆盖这些请求。
3. 在触发懒加载前注册下方监听器。触发后，查看同一个资源的 `rf:retry`、`rf:fallback` 和 `rf:success`，并核对 Network 中成功请求的主机。
4. 在新的浏览器会话中屏蔽同一资源的所有 CDN 候选，验证回源。再屏蔽源站，核对候选耗尽时的 `rf:error`，以及应用的降级界面。

```js
for (const name of ['rf:retry', 'rf:fallback', 'rf:success', 'rf:error']) {
  window.addEventListener(name, (event) => {
    console.log(name, event.detail);
  });
}
```

如果测试的是入口脚本，在页面触发首次加载前注册监听器。参见[入口失败降级 UI](./runtime-events.md#入口失败降级-ui)。

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

1. **`rules[].base` 要对齐构建产物前缀** — Vite 对齐 Vite `base`，Webpack 对齐 `output.publicPath`。如果首次资源 URL 匹配不上 rule `base`，运行时不会进入 retry/fallback。
2. **`urls` 顺序就是回退顺序** — 建议写成备用 CDN → 自建静态源 → 回源 `'/'`。最后一个通常放同源回源，避免主 CDN 故障时再次命中 CDN。
3. **Vite dev 不是主要验证环境** — dev server 使用原生 ESM，动态 `import()` 失败无法完整拦截；请用 `vite build && vite preview` 或示例里的 E2E 验证。
4. **入口资源失败要自己兜底 UI** — 入口 bundle 如果所有候选 URL 都失败，React/Vue 还没启动；建议在 `index.html` 加一个轻量 `rf:error` 监听显示降级文案。
5. **Hybrid SW 是 opt-in** — 需要 `serviceWorker: true` 或对象配置才会接管图片、字体、CSS 背景图等子资源。SW 调试请使用 `localhost` / `127.0.0.1` / HTTPS。

::: warning Vite 开发模式
默认情况下插件在 `dev` 模式不激活（`enableDev: false`）。如需调试回退逻辑，请使用 `vite build && vite preview`。
:::

## 下一步

- [故障排查](./troubleshooting.md) — 从 Network 与事件定位失败环节
- [配置参考](./configuration.md) — 完整配置选项
- [运行时事件](./runtime-events.md) — 事件监听与监控对接
- [最佳实践](./best-practices.md) — 生产环境建议
