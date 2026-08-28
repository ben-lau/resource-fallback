---
title: CSP 与 SRI
---

# CSP 与 SRI

resource-fallback 在设计时考虑了 Content Security Policy（CSP）和 Subresource Integrity（SRI）的兼容性，并提供三重 Kill Switch 用于线上紧急关停。

## CSP 支持

运行时默认以**内联 `<script>`** 注入 `<head>`，需要配合 CSP 使用。默认模式会在同一段内联脚本中运行 runtime IIFE 并调用 `install(...)`；开启 `externalRuntime` 后，只有 runtime IIFE 改为外链，自动 `install(...)` 调用仍是内联脚本。

::: tip 不需要 `unsafe-eval`
运行时 IIFE 目标为 es2020，动态加载使用浏览器原生 `import()`，**不**通过 `Function('u','return import(u)')` 等方式求值。因此 CSP **不必**放行 `script-src 'unsafe-eval'`。任何自动注入的内联脚本仍需 `nonce`；`externalRuntime` 本身不能免除自动 `install(...)` 调用的授权。
:::

### 方式一：nonce 支持

通过 `nonce` 选项为每个注入的 `<script>` 标签附加 CSP nonce（包括外链模式下的内联 `install(...)`）：

```ts
resourceFallback({
  nonce: 'XYZ123',
  rules: [...],
});
```

对应的 CSP 策略：

```
script-src 'self' 'nonce-XYZ123' https://cdn1.example.com https://cdn2.example.com;
```

### 方式二：externalRuntime 外链模式（自动初始化仍需 nonce）

将 runtime IIFE 作为独立资源输出并通过 `<script src>` 引用，可以减少内联代码体积；插件自动生成的 `window.__RF__.install(...)` 仍会作为第二段内联 `<script>` 注入。因此 CSP 禁止未授权内联脚本时，需要同时配置 `nonce`：

```ts
resourceFallback({
  nonce: 'XYZ123',
  externalRuntime: true,
  externalRuntimePath: '/static/__rf/runtime.js',
  rules: [...],
});
```

::: tip 部署 runtime 文件
外链模式需自行部署 `runtime.js`。可通过 `@resource-fallback/core` 的 `getRuntimeCode()` 获取文件内容；若它不在同源，还需在 `script-src` 中允许该来源。
:::

### externalRuntime 与 hooks

`externalRuntime` 只解决 CSP 下 runtime script 的放置方式；它**不会**让构建配置里的函数变得可序列化。`buildInjectedTags()` 与插件自动生成的 `window.__RF__.install(...)` 调用都会先序列化配置对象，因此自动注入场景下 `hooks` 里的函数始终会被丢弃。

若你在页面代码里**手动**调用 `window.__RF__.install()`，并直接传入 live 函数对象，hooks 可以生效；这**不要求** `externalRuntime: true`，关键在于绕过构建期序列化：

```ts
window.__RF__.install({
  rules: [...],
  hooks: {
    onError:    (e) => sentry.captureMessage('rf.error', e),
    onFallback: (e) => analytics.send('rf.fallback', e),
  },
});
```

自动注入场景推荐优先使用 DOM `rf:*` 事件。严格 CSP 下，`nonce` 与 `externalRuntime` 是可组合的：前者授权内联初始化脚本，后者只决定 runtime IIFE 是否外链。

### 按资源类型配置 CSP

当 CSP 会限制对应资源类型的来源时，请把实际使用的主、备用资源来源加入相应 directive：

| 资源类型               | resource-fallback 路径         | 相关 CSP directive |
| ---------------------- | ------------------------------ | ------------------ |
| JavaScript             | 页面 Observer / 构建器 adapter | `script-src`       |
| 样式表与 CSS `@import` | 页面 Observer / Hybrid SW      | `style-src`        |
| 图片（含 CSS `url()`） | Hybrid SW                      | `img-src`          |
| 字体                   | Hybrid SW                      | `font-src`         |
| 音频与视频             | Hybrid SW                      | `media-src`        |

这张表只覆盖 CSP 来源限制；跨源字体和 Hybrid SW 的网络请求仍需满足 CORS、MIME、SRI 等浏览器安全约束。

## SRI 策略

fallback 到不同 CDN 时，文件的 hash 可能不一致。resource-fallback 提供三种 SRI 处理策略：

| 策略            | 行为                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `strip`（默认） | fallback 时移除 `integrity` 属性，因为不同 CDN 的文件 hash 通常不匹配 |
| `keep`          | 保留属性，浏览器校验不匹配时触发 error，继续下一个回退                |
| `strict`        | 同 `keep`，语义化更明确                                               |

```ts
resourceFallback({
  sri: 'strip', // 默认
  rules: [...],
});
```

::: warning 多 CDN SRI 前提
若需在所有 CDN 上保留 SRI，请确保**同一文件在所有 CDN 上的 hash 一致**（推荐：将构建产物同步到多个对象存储桶）。
:::

### SW 与 SRI 的限制

SW 只能返回不同响应，**不能修改**页面中原始标签上的 `integrity`、`nonce`、`crossorigin` 等属性。如果原始标签带有 SRI，而 fallback CDN 的内容 hash 不一致，浏览器仍会拒绝该响应。

## Kill Switch 三重机制

三种方式可在不发版的情况下紧急禁用运行时：

| 方式     | 示例                           | 适用场景                                                   |
| -------- | ------------------------------ | ---------------------------------------------------------- |
| 全局变量 | `window.__RF_DISABLE__ = true` | 在 runtime 前执行的带 nonce 内联脚本或已授权外链 bootstrap |
| 查询参数 | 访问 `?__rf=off`               | 临时排查问题                                               |
| Cookie   | `__rf_disable=1`               | 网关按会话/用户维度禁用                                    |

可通过配置自定义 kill-switch 名称：

```ts
resourceFallback({
  disableGlobals: ['__RF_DISABLE__', '__MY_DISABLE__'],
  disableQueryParam: '__rf',
  disableCookie: '__rf_disable',
  rules: [...],
});
```

::: info 严格匹配
kill-switch 全局变量仅接受 `true` / `1` / `'1'` / `'true'` 四种值触发禁用。cookie 匹配为精确相等，避免 `__rf_disable=10` 等误触。
:::

::: warning 严格 CSP 下的全局 Kill Switch
表中的“内联”设置也受 `script-src` 限制。请使用与 CSP 响应头、`resourceFallback({ nonce })` 相同的每响应 nonce（以下的 `XYZ123` 为占位值），并确保它在 runtime 前执行：

```html
<script nonce="XYZ123">
  window.__RF_DISABLE__ = true;
</script>
<!-- resource-fallback 注入的 runtime 位于其后 -->
```

若策略不允许任何内联 bootstrap，请将相同代码放入已被 `script-src` 授权、且在 runtime 前执行的外链脚本。
:::

## 完整配置示例

```ts
// CSP nonce 模式
resourceFallback({
  nonce: 'XYZ123',
  sri: 'strip',
  rules: [
    {
      base: 'https://cdn.example.com/',
      urls: ['https://cdn-backup.example.com/', '/'],
    },
  ],
});

// 外链 runtime 模式；严格 CSP 下仍需授权自动内联 install(...)
resourceFallback({
  nonce: 'XYZ123',
  externalRuntime: true,
  externalRuntimePath: '/static/__rf/runtime.js',
  sri: 'keep',
  rules: [...],
});
```

## 相关文档

- [配置参考](./configuration.md)
- [Hybrid Service Worker — SRI 限制](./service-worker.md#注意事项)
- [运行时事件 — hooks](./runtime-events.md#js-函数钩子)
