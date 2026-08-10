---
title: Vite 集成
---

# Vite 集成

`@resource-fallback/vite-plugin` 是 Vite 4+ 插件，为 Vite 构建产物（同步 JS/CSS、异步 chunk、modulepreload）提供运行时重试与多 CDN 回退能力。

## 安装

```bash
pnpm add -D @resource-fallback/vite-plugin
```

## 基本配置

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn.example.com/',
  plugins: [
    resourceFallback({
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
Vite `base` 应当与 `rules[].base`（rule `base`）保持一致，确保构建产物的 URL 能被规则匹配。
:::

完整配置选项见 [配置参考](./configuration.md)。

## 工作原理

插件在构建时按下面的顺序工作：

### 1. `configResolved`：比较规范化后的 Vite base 与规则 base

插件先在 `configResolved` 阶段读取 Vite 最终解析后的 `base`，再和每条 `rules[].base` 做同样的尾斜杠规范化比较。

- 若规范化后的 Vite `base` 与至少一条 rule `base` 相等，才会继续启用后续的 URL 改写
- 若不匹配，则 `writeBundle` 中的动态 import 改写会直接跳过，避免把非 CDN 构建误写成外域地址

### 2. `generateBundle`：按需生成 Service Worker 资源

如果开启了 `serviceWorker`，插件会在 `generateBundle` 阶段按需生成并发出：

- `rf-sw.js`
- `manifest.json`

### 3. `writeBundle`：解析字面量动态 import，并替换为 `window.__RF__.load(filename)`

`writeBundle` 会先用 `es-module-lexer` 解析 chunk 里的动态 import，再只改写满足以下条件的字面量导入：

1. 该 import 是字面量字符串
2. 解析出的文件名对应 `chunk.dynamicImports` 里的条目
3. 当前 chunk 所在构建已经通过规范化 base 比较门禁

改写结果是把匹配到的 `import()` 替换成 `window.__RF__.load(filename)`，例如：

```js
// 原始代码
const mod = await import('./Lazy.vue');

// 构建后
const mod = await window.__RF__.load('assets/Lazy-abc.js');
```

### 4. `transformIndexHtml`：注入运行时与 preconnect 标签

`transformIndexHtml` 会在 `<head>` 注入：

- `<link rel="preconnect">` 标签
- `<script>` 内联运行时 IIFE 和 `install(config)` 调用

### vite:preloadError 处理

运行时监听 Vite 的 `vite:preloadError` 事件。当 modulepreload 失败时：

- 读取 `event.payload`
- 提取出的 URL 若匹配已配置的 rule，就调用 `event.preventDefault()`
- 这里不会直接更新熔断器状态、发出恢复事件，也不会自己选下一个 fallback URL
- CSS `<link>` 失败仍然由 Observer 负责处理；这里的职责只是阻止 Vite 在 managed failure 上继续抛错

## 配置示例

```ts
resourceFallback({
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
  htmlInject: 'head-prepend',
});
```

## 与 @vitejs/plugin-legacy 配合

若项目使用 `@vitejs/plugin-legacy` 生成 SystemJS 格式的 legacy bundle，运行时会自动安装 SystemJS adapter，通过 hook `System.constructor.prototype.instantiate` 为 legacy 入口和异步 chunk 提供回退能力。

```ts
import legacy from '@vitejs/plugin-legacy';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn.example.com/',
  plugins: [
    legacy({ targets: ['defaults', 'not IE 11'] }),
    resourceFallback({
      rules: [{ base: 'https://cdn.example.com/', urls: ['/'] }],
    }),
  ],
});
```

## Vite Dev 模式

默认情况下插件在 `dev` 模式不激活（`enableDev: false`）。Vite dev server 使用原生 ESM，动态 import 失败无法拦截。

::: warning 验证方式
请使用 `vite build && vite preview` 验证回退逻辑。设置 `enableDev: true` 会在 dev 模式下也注入运行时，但仅同步 `<script>` / `<link>` 的 error 事件有效。
:::

## 同步/异步覆盖

| 场景                       | Vite (build/preview)                         | Vite (dev) |
| -------------------------- | -------------------------------------------- | ---------- |
| 同步 `<script>` / `<link>` | ✓ Observer                                   | ✓ Observer |
| 异步 chunk（`import()`）   | ✓ `__RF__.load` + `writeBundle` 改写         | ✗          |
| CSS 动态注入               | ✓ Observer                                   | ✓ Observer |
| SystemJS（legacy bundle）  | ✓ `instantiate` hook                         | —          |
| 图片 / 字体 / 媒体资源     | ✓ Hybrid SW（opt-in）                        | ✗          |
| CSS `url()` / `@font-face` | ✓ Hybrid SW（opt-in）                        | ✗          |
| CSS `@import`              | ✓ Hybrid SW（需 CSS referrer 命中 manifest） | ✗          |

## 相关文档

- [快速开始](./quick-start.md)
- [Hybrid Service Worker](./service-worker.md)
- [运行时事件](./runtime-events.md)
