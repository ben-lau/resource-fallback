# @resource-fallback/vite-plugin

> **[中文](README.md)** | [English](README.en.md)

Vite 4+ 插件，为 Vite 构建产物（同步 JS/CSS、异步 chunk、modulepreload）提供运行时重试与多 CDN 回退能力。

## 安装

```bash
pnpm add @resource-fallback/vite-plugin -D
```

## 基本用法

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
          match: 'https://cdn.example.com/',
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

> **重要**：`base` 的值应当与 `match` 保持一致，确保构建产物的 URL 能被规则匹配。

## 工作原理

插件在构建时完成三件事：

### 1. HTML 注入

通过 `transformIndexHtml` 钩子在 `<head>` 中注入：

- `<link rel="preconnect">` 标签（为每个 fallback 域名预建连接）
- `<script>` 内联运行时 IIFE + `install(config)` 调用

### 2. 静态资源 URL 改写

利用 Vite 的 `experimental.renderBuiltUrl` 钩子，将 JS 资源的 URL 改写为运行时解析：

```js
// 原始输出
import('/assets/chunk-abc.js');

// 改写后（构建产物中）
window.__RF__.url('assets/chunk-abc.js');
// → 'https://cdn.example.com/assets/chunk-abc.js'（或熔断后跳过不可用 host）
```

### 3. 动态 import 包装

利用 Rollup 的 `renderDynamicImport` 钩子，将动态 `import()` 包装为带回退循环的加载函数：

```js
// 原始代码
const mod = await import('./Lazy.vue');

// 构建后
const mod = await window.__RF__.load('assets/Lazy-abc.js', import('./Lazy.vue'));
```

`__RF__.load` 内部执行完整的 retry → fallback 循环：

1. 通过 `resolveBuiltUrl` 确定首次请求 URL
2. 尝试 `import(url)`
3. 失败后按配置重试（指数退避 + 抖动）
4. 重试预算耗尽后切换到下一个候选 URL
5. ES Module 重试自动添加 `__rf=` 参数绕过浏览器模块缓存
6. 每步都发出对应的 `rf:retry` / `rf:fallback` / `rf:error` 事件
7. 所有候选耗尽后抛出原始错误

### vite:preloadError 处理

运行时还监听 Vite 的 `vite:preloadError` 事件，当 modulepreload 失败时记录 host 失败到熔断器，让后续的 `resolveBuiltUrl` 自动跳过不可用的 host。

## 配置

`ViteResourceFallbackOptions` 等同于 `@resource-fallback/core` 的 `PluginOptions`，完整字段参见[根目录 README](../../README.md#配置参考)。

### 常用配置示例

```ts
resourceFallback({
  rules: [
    {
      match: 'https://cdn.example.com/',
      urls: ['https://cdn-backup.example.com/', 'https://static.mysite.com/', '/'],
      retry: { max: 2, baseDelay: 300, maxDelay: 3000, jitter: true },
      circuit: { threshold: 3, cooldown: 30000 },
    },
  ],
  debug: 'auto', // localStorage.__RF_DEBUG__ 控制日志
  sri: 'strip', // fallback 时移除 integrity
  nonce: 'my-csp-nonce', // CSP nonce
  injectPreconnect: true, // 注入 <link rel="preconnect">
  htmlInject: 'head-prepend', // 注入到 <head> 最前面
});
```

### 与 @vitejs/plugin-legacy 配合

若项目使用 `@vitejs/plugin-legacy` 生成 SystemJS 格式的 legacy bundle，运行时会自动安装 SystemJS adapter，通过 hook `System.constructor.prototype.instantiate` 为 legacy 入口和异步 chunk 提供回退能力。

```ts
// vite.config.ts
import legacy from '@vitejs/plugin-legacy';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'https://cdn.example.com/',
  plugins: [
    legacy({ targets: ['defaults', 'not IE 11'] }),
    resourceFallback({
      rules: [{ match: 'https://cdn.example.com/', urls: ['/'] }],
    }),
  ],
});
```

## Vite Dev 模式

默认情况下插件在 `dev` 模式不激活（`enableDev: false`）。Vite dev server 使用原生 ESM，动态 import 失败无法拦截。如需调试回退逻辑，请使用：

```bash
vite build && vite preview
```

设置 `enableDev: true` 会在 dev 模式下也注入运行时，但仅同步 `<script>` / `<link>` 的 error 事件有效。

## 许可证

MIT
