---
title: Hybrid Service Worker
---

# Hybrid Service Worker

Hybrid Service Worker（SW）是 resource-fallback 的 **opt-in** 扩展能力。启用后，SW 在 fetch 层补齐 DOM Observer 无法感知的子资源回退，而脚本加载仍由现有页面 adapter 负责。

## 概述

Service Worker 能显著扩展资源回退的覆盖面，尤其适合 `img`、`video`、`@font-face` 字体文件、CSS `url()` 子资源和 CSS `@import` 这类 DOM Observer 不容易感知的请求。

推荐采用 **Hybrid SW** 分层方案：保留现有脚本和构建器 adapter 的 ownership，引入 SW 补齐非脚本资源和 CSS 子资源。

::: info 当前实现状态
Hybrid SW 已实现为 opt-in 能力。Vite/Webpack 插件会生成资源 manifest、输出 SW asset，并把 manifest 预置到 SW 文件中，避免图片、背景图、字体等早期子资源在 SW 尚未收到页面 `postMessage` 配置时直接透传到主 CDN。
:::

## 启用方式

```ts
// 简写
resourceFallback({
  rules: [...],
  serviceWorker: true,
});

// 完整配置
resourceFallback({
  rules: [...],
  serviceWorker: {
    scope: '/',
    includeStyleImports: true,
    fallbackOnOpaque: false,
    cache: { enabled: true, cacheOpaque: false },
  },
});
```

完整选项见 [配置参考](./configuration.md#serviceworkeroptions)。

## manifest 预置

构建时，Vite/Webpack 插件会：

1. 扫描构建产物，生成 `ResourceFallbackManifest`（包含资源 URL、类型、ownership）
2. 输出 `rf-sw.js` SW 资产文件
3. 将 manifest 预置到 SW 文件中（`__RF_SW_PRELOAD__`），避免首次 fetch 时 manifest 尚未就绪的竞态

规则侧仅为 string 形式的 rule `base`（构建期会规范化尾斜杠），preload 使用普通 `JSON.stringify`，不再需要 RegExp 字面量特判。

manifest 精简策略：仅保留 `owner === 'sw'` 和 `type === 'style'` 的 asset，减小预加载体积。

默认 SW path 跟随 scope 派生：`scope: '/'` 时输出 `/rf-sw.js`，`scope: '/app/'` 时输出 `/app/rf-sw.js`。只有用户显式把 `path` 配到 scope 目录之外时，才需要自行配置 `Service-Worker-Allowed` 响应头。

## ownership 划分

| 资源类型                       | 负责方                                               | 说明                             |
| ------------------------------ | ---------------------------------------------------- | -------------------------------- |
| classic / module script        | 页面 adapter（Observer / Vite / Webpack / SystemJS） | SW 不接管 script                 |
| Webpack async chunk            | Webpack adapter（`__webpack_require__.l`）           | 处理 Promise 语义与 module cache |
| Vite dynamic import            | Vite adapter（`__RF__.load`）                        | 处理 module map 与 cache busting |
| 顶层 `<link rel="stylesheet">` | Observer                                             | SW 不默认接管顶层 stylesheet     |
| CSS `url()` / `@font-face`     | SW                                                   | fetch 层拦截                     |
| CSS `@import`                  | SW（需 referrer 命中 CSS manifest）                  | 受 `includeStyleImports` 控制    |
| `<img>` / 媒体资源             | SW                                                   | fetch 层拦截                     |
| 字体文件                       | SW                                                   | 需满足 CORS/MIME 要求            |

::: warning 避免重复处理
Observer 和 SW 不应同时处理同一个资源请求。带 `data-webpack` 的 `<script>` 由 Webpack adapter 负责；Observer 跳过这些标签。CSS chunk 的 `<link>` 虽带 `data-webpack`，但 webpack adapter 不处理 CSS，Observer 仍是 CSS chunk 的唯一安全网。
:::

### 事件桥接

SW 不能直接调用 `window.dispatchEvent()`。SW 事件通过 `client.postMessage()` 送回页面，再由页面 runtime 转发为 DOM CustomEvent（`rf:retry` / `rf:fallback` / `rf:success` / `rf:error`）。

SW 事件会优先按 `FetchEvent.clientId` 定向投递，避免多标签页串台。

## 配置选项

| 字段                  | 类型      | 默认值               | 说明                                         |
| --------------------- | --------- | -------------------- | -------------------------------------------- |
| `enabled`             | `boolean` | `true`（对象配置时） | 设为 `false` 可在对象配置中关闭              |
| `path`                | `string`  | 跟随 scope           | SW 文件路径                                  |
| `scope`               | `string`  | `'/'`                | SW 控制范围                                  |
| `includeStyleImports` | `boolean` | `true`               | 允许 SW 接管受控 CSS `@import`               |
| `fallbackOnOpaque`    | `boolean` | `false`              | 将跨源 opaque response 视为失败继续 fallback |
| `cache.enabled`       | `boolean` | `true`               | fallback 成功后写入 Cache API                |
| `cache.cacheOpaque`   | `boolean` | `false`              | 是否缓存 opaque response                     |

### fallbackOnOpaque

图片和 CSS 背景图常以 `no-cors` 发起，SW 可能只能看到 opaque response，无法读取真实 status。默认不会把 opaque response 当失败，以避免跳过本来可用的跨源图片。

开启 `fallbackOnOpaque` 后，SW 对 no-cors 请求先尝试 cors 模式探测真实状态码；CORS 不可用时自动降级回 no-cors。

### 缓存策略

- 只缓存 fallback 成功后的可读 2xx 响应
- 网络 retry/fallback 全部失败后，才读取当前 manifest version 对应的 cache 兜底
- 新 manifest version 激活后会清理旧的 `resource-fallback-*` cache

SW 内部 resolver 的熔断器始终使用独立内存状态，不会读写 `localStorage`。

## 注意事项

::: warning Secure Context
SW 调试请使用 `localhost` / `127.0.0.1` / HTTPS。普通局域网 IP 的 HTTP 不是 secure context，浏览器不会注册 SW。
:::

::: warning 首次访问限制
SW 注册、安装、激活、接管页面是异步流程。第一次访问页面时，HTML 解析期间发出的早期请求可能尚未进入 SW 的 `fetch` 事件。现有内联 runtime 和 Observer 仍能在首个页面生命周期中处理部分 DOM 可感知资源失败。
:::

::: tip 字体与 CORS
跨域字体 fallback 必须让 fallback 源站返回允许当前 origin 的 CORS header。SW 不能绕过浏览器安全策略。
:::

::: info Kill Switch
`window.__RF_DISABLE__`、query 参数、`cookie` 禁用页面 runtime 时，SW adapter 也会停止处理或切换到 pass-through。
:::

## 同步/异步覆盖矩阵

| 场景                       | Webpack                                      | Vite (build/preview)                         | Vite (dev) |
| -------------------------- | -------------------------------------------- | -------------------------------------------- | ---------- |
| 图片 / 字体 / 媒体资源     | ✓ Hybrid SW（opt-in）                        | ✓ Hybrid SW（opt-in）                        | ✗          |
| CSS `url()` / `@font-face` | ✓ Hybrid SW（opt-in）                        | ✓ Hybrid SW（opt-in）                        | ✗          |
| CSS `@import`              | ✓ Hybrid SW（需 CSS referrer 命中 manifest） | ✓ Hybrid SW（需 CSS referrer 命中 manifest） | ✗          |

## 相关文档

- [配置参考 — ServiceWorkerOptions](./configuration.md#serviceworkeroptions)
- [SW 对比设计](../design/sw-comparison.md)
- [CSP 与 SRI](./csp-sri.md)
