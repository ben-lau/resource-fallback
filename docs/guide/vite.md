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

插件在构建时完成三件事：

### 1. HTML 注入

通过 `transformIndexHtml` 钩子在 `<head>` 中注入：

- `<link rel="preconnect">` 标签（为每个 fallback 域名预建连接）
- `<script>` 内联运行时 IIFE + `install(config)` 调用

### 2. renderBuiltUrl 机制

利用 Vite 的 `experimental.renderBuiltUrl` 钩子，将 JS 资源的 URL 改写为运行时解析：

```js
// 原始输出
import('/assets/chunk-abc.js');

// 改写后（构建产物中）
window.__RF__.url('assets/chunk-abc.js');
// → 'https://cdn.example.com/assets/chunk-abc.js'（或熔断后跳过不可用 host）
```

`__RF__.url()` 在运行时根据规则与熔断器状态解析最终 URL，跳过已熔断的 host。

### 3. 动态 import 改写

插件通过两种方式包装动态 `import()`：

#### renderDynamicImport

利用 Rollup 的 `renderDynamicImport` 钩子，将动态 `import()` 包装为带回退循环的加载函数：

```js
// 原始代码
const mod = await import('./Lazy.vue');

// 构建后
const mod = await window.__RF__.load('assets/Lazy-abc.js', import('./Lazy.vue'));
```

#### writeBundle + es-module-lexer

`writeBundle` 钩子使用 `es-module-lexer` 解析 chunk 内的动态 import，将需改写的 URL 替换为 `__RF__.load()` 调用。这解决了异步模块中包含 CSS 时依赖关系丢失的问题。

```js
// writeBundle 改写示例
window.__RF__.load('assets/About-xxx.js');
```

### shouldRewriteUrls 闸门

在 `configResolved` 阶段，插件会比较 Vite 最终解析后的 `base` 与 `rules[].base`（两侧都会做尾斜杠规范化，与 runtime 一致）：

```ts
shouldRewriteUrls = options.rules.some(
  (r) => ensureTrailingSlash(viteBase) === ensureTrailingSlash(r.base),
);
```

- 若规范化后 Vite `base` 与至少一条 rule `base` 相等，则启用 URL 改写（`renderBuiltUrl`、`writeBundle`）
- 否则跳过 URL 改写，避免 Vite `base` 未切到 CDN 时误把异步 chunk 拼到外域

::: info 为何在 configResolved 判断
Vite `base` 从 `configResolved` 获取，确保读取的是 Vite 最终解析后的值（考虑 plugin 间覆盖）。
:::

### **RF**.load 回退循环

`__RF__.load` 内部执行完整的 retry → fallback 循环：

1. 通过 `resolveBuiltUrl` 确定首次请求 URL
2. 尝试 `import(url)`
3. 失败后按配置重试（指数退避 + 抖动）
4. 重试预算耗尽后切换到下一个候选 URL
5. ES Module 重试自动添加 `__rf=` 参数绕过浏览器模块缓存
6. 每步都发出对应的 `rf:retry` / `rf:fallback` / `rf:error` 事件
7. 所有候选耗尽后抛出原始错误

### vite:preloadError 处理

运行时监听 Vite 的 `vite:preloadError` 事件。当 modulepreload 失败时：

- 记录 host 失败到熔断器
- 让后续的 `resolveBuiltUrl` 自动跳过不可用的 host
- 对 CSS preload 失败，通过 `chunk.dynamicImports` 追踪关联的动态 chunk，确保 CSS 依赖不会在 fallback 路径中被遗漏

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
| 异步 chunk（`import()`）   | ✓ `__RF__.load` + `renderDynamicImport`      | ✗          |
| CSS 动态注入               | ✓ Observer                                   | ✓ Observer |
| SystemJS（legacy bundle）  | ✓ `instantiate` hook                         | —          |
| 图片 / 字体 / 媒体资源     | ✓ Hybrid SW（opt-in）                        | ✗          |
| CSS `url()` / `@font-face` | ✓ Hybrid SW（opt-in）                        | ✗          |
| CSS `@import`              | ✓ Hybrid SW（需 CSS referrer 命中 manifest） | ✗          |

## 相关文档

- [快速开始](./quick-start.md)
- [Hybrid Service Worker](./service-worker.md)
- [运行时事件](./runtime-events.md)
