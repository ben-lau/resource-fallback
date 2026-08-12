---
title: 配置参考
---

# 配置参考

完整 TypeScript 类型定义见 [`packages/core/src/types.ts`](https://github.com/ben-lau/resource-fallback/blob/main/packages/core/src/types.ts)。

Vite 与 Webpack 插件的配置类型 `ViteResourceFallbackOptions` / `WebpackPluginOptions` 均等同于 `PluginOptions`。

## PluginOptions

| 字段                  | 类型                              | 默认值               | 说明                                                                |
| --------------------- | --------------------------------- | -------------------- | ------------------------------------------------------------------- |
| `rules`               | `FallbackRule[]`                  | **必填**             | 回退规则数组；编译时按 `base` 长度降序排序，匹配时优先更长前缀      |
| `defaults`            | `{ retry?, circuit? }`            | —                    | 所有规则的默认重试/熔断配置                                         |
| `debug`               | `boolean \| 'auto'`               | `'auto'`             | `true` 始终打印日志；`'auto'` 通过 `localStorage.__RF_DEBUG__` 控制 |
| `sri`                 | `'strip' \| 'keep' \| 'strict'`   | `'strip'`            | fallback 时对 `integrity` 属性的处理策略                            |
| `enableDev`           | `boolean`                         | `false`              | 开发模式下是否启用                                                  |
| `nonce`               | `string`                          | —                    | 附加到注入的 `<script>` 标签的 CSP nonce                            |
| `externalRuntime`     | `boolean`                         | `false`              | 仅改变 runtime script 的放置方式；不会保留构建配置里的函数钩子      |
| `externalRuntimePath` | `string`                          | `'/__rf/runtime.js'` | 外链运行时的路径                                                    |
| `injectPreconnect`    | `boolean`                         | `true`               | 为每个 fallback 域名注入 `<link rel="preconnect">`                  |
| `htmlInject`          | `'head-prepend' \| 'head-append'` | `'head-prepend'`     | 注入到 `<head>` 的位置                                              |
| `serviceWorker`       | `boolean \| ServiceWorkerOptions` | `false`              | 启用 Hybrid SW，接管非脚本子资源和受控 CSS `@import`                |
| `hooks`               | `RuntimeHooks`                    | —                    | 序列化注入时函数会被丢弃；自动注入场景推荐监听 DOM `rf:*` 事件      |
| `disableGlobals`      | `string[]`                        | `['__RF_DISABLE__']` | 额外的 kill-switch 全局变量名                                       |
| `disableQueryParam`   | `string`                          | `'__rf'`             | 值为 `off` 时禁用运行时的查询参数名                                 |
| `disableCookie`       | `string`                          | `'__rf_disable'`     | 值为 `1` 时禁用运行时的 cookie 名                                   |

## FallbackRule

| 字段      | 类型             | 默认值   | 说明                                                                                                                                                         |
| --------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base`    | `string`         | **必填** | 资源 URL 前缀（区分大小写）。用于：前缀匹配失败 URL、剥路径后拼接到候选、Vite 裸文件名拼出首轮 CDN URL。可与 `urls` 分离：`base` 是首轮前缀，`urls` 是回退链 |
| `urls`    | `string[]`       | **必填** | 有序候选 URL 前缀列表（回退链）。最后一个通常为回源地址                                                                                                      |
| `retry`   | `RetryOptions`   | 见下表   | 覆盖该规则的重试配置                                                                                                                                         |
| `circuit` | `CircuitOptions` | 见下表   | 覆盖该规则的熔断配置                                                                                                                                         |

::: tip rule `base` 与 Vite `base`

Vite 的配置项 `base` 与 `FallbackRule.base` 同名：文中分别称为 Vite `base` 与 rule `base`。Vite `base` / Webpack `publicPath` 应等于 `rules[].base`。`base` 与 `urls` 可以不同——`base` 管首轮加载前缀，`urls` 管失败后的回退链。不再支持 RegExp / 函数匹配。
:::

当前页面侧规则与熔断行为需要精确理解：

- `window.__RF__.url(filename)` 使用第一条已编译规则的 `base` 构造首轮 URL，不感知熔断状态；
- 一次恢复会先根据初始 URL 选中一条规则，再沿该规则的有序 `urls` 候选继续 retry / fallback；
- 页面 runtime 当前只有一个 circuit registry，使用第一条已编译规则的 circuit 选项初始化；`FallbackRule.circuit` 仍是公开类型，但页面侧“每条规则独立熔断器”尚未实现。

## RetryOptions

| 字段        | 类型      | 默认值 | 说明                     |
| ----------- | --------- | ------ | ------------------------ |
| `max`       | `number`  | `2`    | 同一 URL 的最大重试次数  |
| `baseDelay` | `number`  | `300`  | 首次重试延迟（ms）       |
| `maxDelay`  | `number`  | `3000` | 指数退避的延迟上限（ms） |
| `jitter`    | `boolean` | `true` | 为延迟添加 ±25% 随机抖动 |

## CircuitOptions

| 字段              | 类型      | 默认值   | 说明                                     |
| ----------------- | --------- | -------- | ---------------------------------------- |
| `threshold`       | `number`  | `5`      | 同一 host 连续失败多少次后触发熔断       |
| `cooldown`        | `number`  | `30000`  | 熔断后冷却时长（ms），到期后重新尝试     |
| `shareAcrossTabs` | `boolean` | `true`   | 通过 `localStorage` 跨标签页共享熔断状态 |
| `storageTtl`      | `number`  | `120000` | localStorage 中熔断条目的存活时长（ms）  |

页面侧 RecoveryCoordinator 还会按 `owner + logical resource key` 共享一次进行中的恢复 Promise。同一个 owner 命中同一个逻辑资源时会加入同一条恢复链；不同 owner 或不同 logical key 不共享。ownership registry 会阻止 Observer 与构建器适配器分别接管同一个逻辑资源。

## hooks 与序列化限制

`buildInjectedTags()` 与插件自动生成的 `window.__RF__.install(...)` 调用都会先序列化配置对象，函数值会被丢弃。因此：

- 构建配置里的 `hooks` 不会在自动注入场景下保留下来；
- `externalRuntime` 只改变 runtime script 是否外链，不会改变上述序列化行为；
- 推荐用 DOM `rf:*` 事件作为自动注入场景的监控接入方式；
- 如需 JS hooks，请在页面代码里手动调用 `window.__RF__.install()`，直接传入函数对象。

## ServiceWorkerOptions

Hybrid SW 默认关闭。启用后，Vite/Webpack 插件会生成资源 manifest，并输出 SW asset；SW bundle 会预置 manifest/config，页面 runtime 负责注册 SW、补发配置，并把 SW `postMessage` 事件桥接为现有 `rf:*` 事件。

```ts
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

| 字段                  | 类型      | 默认值                                                        | 说明                                                                                                                                             |
| --------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`             | `boolean` | `true`（对象配置时）                                          | 设为 `false` 可在对象配置中关闭                                                                                                                  |
| `path`                | `string`  | 跟随 `scope`，如 `/` → `/rf-sw.js`、`/app/` → `/app/rf-sw.js` | SW 文件路径。默认与 scope 同层，避免依赖 `Service-Worker-Allowed` 响应头                                                                         |
| `scope`               | `string`  | `'/'`                                                         | SW 控制范围                                                                                                                                      |
| `includeStyleImports` | `boolean` | `true`                                                        | 允许 SW 在 `request.destination === 'style'` 且 referrer 命中 CSS manifest 时接管 CSS `@import`                                                  |
| `fallbackOnOpaque`    | `boolean` | `false`                                                       | 将跨源 opaque response 视为失败继续 fallback。适合 CDN 错误被浏览器隐藏成 opaque 的图片/CSS 子资源场景；开启后可能跳过本来可用的 opaque CDN 响应 |
| `cache.enabled`       | `boolean` | `true`                                                        | fallback 网络链路成功后写入 Cache API                                                                                                            |
| `cache.cacheOpaque`   | `boolean` | `false`                                                       | 是否缓存 opaque response。默认不缓存                                                                                                             |

::: info 缓存策略
缓存策略固定为保守模式：只缓存 fallback 成功后的可读 2xx 响应；网络 retry/fallback 全部失败后，才读取当前 manifest version 对应的 cache 兜底；新 manifest version 激活后会清理旧的 `resource-fallback-*` cache。manifest version 会纳入资源、fallback rules 和关键 SW cache 策略，避免 rules 或 cache 配置变化后继续命中旧 cache。
:::

::: warning SW 熔断器独立性
SW 内部 resolver 的熔断器始终使用独立内存状态，即使页面侧 `defaults.circuit.shareAcrossTabs` 为 `true`，SW 也不会读写 `localStorage`。若 SW fetch 链路最终 reject，会发出 `rf:error` 并返回 `Response.error()`，保持浏览器侧资源表现接近真实 network error。
:::

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
  defaults: {
    retry: { max: 2 },
    circuit: { threshold: 5, cooldown: 30000 },
  },
  debug: 'auto',
  sri: 'strip',
  nonce: 'my-csp-nonce',
  injectPreconnect: true,
  htmlInject: 'head-prepend',
});
```

## 相关文档

- [Vite 集成](./vite.md)
- [Webpack 集成](./webpack.md)
- [Hybrid Service Worker](./service-worker.md)
- [CSP 与 SRI](./csp-sri.md)
