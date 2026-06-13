---
title: CSP 与 SRI
---

# CSP 与 SRI

resource-fallback 在设计时考虑了 Content Security Policy（CSP）和 Subresource Integrity（SRI）的兼容性，并提供三重 Kill Switch 用于线上紧急关停。

## CSP 支持

运行时默认以**内联 `<script>`** 注入 `<head>`，需要配合 CSP 使用。

### 方式一：nonce 支持

通过 `nonce` 选项为注入的 `<script>` 标签附加 CSP nonce：

```ts
resourceFallback({
  nonce: 'XYZ123',
  rules: [...],
});
```

对应的 CSP 策略：

```
script-src 'nonce-XYZ123' https://cdn1.example.com https://cdn2.example.com;
```

### 方式二：externalRuntime 外链模式

将运行时作为独立资源输出并通过 `<script src>` 引用，无需 nonce：

```ts
resourceFallback({
  externalRuntime: true,
  externalRuntimePath: '/static/__rf/runtime.js',
  rules: [...],
});
```

::: tip 部署 runtime 文件
外链模式需自行部署 `runtime.js`。可通过 `@resource-fallback/core` 的 `getRuntimeCode()` 获取文件内容。
:::

### externalRuntime 与 hooks

`externalRuntime` 模式下可以使用 JS 函数钩子（`hooks`），因为函数无法 JSON 序列化到内联 script 中：

```ts
window.__RF__.install({
  rules: [...],
  hooks: {
    onError:    (e) => sentry.captureMessage('rf.error', e),
    onFallback: (e) => analytics.send('rf.fallback', e),
  },
});
```

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

| 方式     | 示例                           | 适用场景                         |
| -------- | ------------------------------ | -------------------------------- |
| 全局变量 | `window.__RF_DISABLE__ = true` | 在运行时 `<script>` 之前内联设置 |
| 查询参数 | 访问 `?__rf=off`               | 临时排查问题                     |
| Cookie   | `__rf_disable=1`               | 网关按会话/用户维度禁用          |

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

## 完整配置示例

```ts
// CSP nonce 模式
resourceFallback({
  nonce: 'XYZ123',
  sri: 'strip',
  rules: [
    {
      match: 'https://cdn.example.com/',
      urls: ['https://cdn-backup.example.com/', '/'],
    },
  ],
});

// 外链 runtime 模式
resourceFallback({
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
