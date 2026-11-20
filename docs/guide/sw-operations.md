---
title: SW 运维
description: 检查当前 Service Worker、更新资源 manifest，定向停用本库注册并验证旧客户端。
outline: [2, 3]
---

# SW 运维

Hybrid SW 会跨页面生命周期保留。启用、更新与停用时，分别检查页面 runtime、SW 注册和当前受控客户端。

## 确认当前控制者 {#controller}

在目标页面的 Console 中检查：

```js
console.log('controller', navigator.serviceWorker.controller?.scriptURL);
console.table(
  (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
    scope: registration.scope,
    active: registration.active?.scriptURL,
    waiting: registration.waiting?.scriptURL,
    installing: registration.installing?.scriptURL,
  })),
);
```

以 `scope: '/app/'` 为例，默认脚本应为 `/app/rf-sw.js`，并由页面源站提供。核对 Network 中该 URL 返回脚本而非 HTML。`ready` 不等于当前页面已受预期 SW 控制，仍需检查 `controller`。

## 更新与缓存 {#updates}

1. 发布新产物时一并部署插件生成的 `rf-sw.js` 与 manifest，保持它们来自同一次构建。
2. runtime 注册时设置 `updateViaCache: 'none'` 并调用 `registration.update()`；仍需在 Application 面板核对实际安装和激活状态。
3. 新 manifest version 激活后清理旧的 `resource-fallback-*` cache。当前版本只在网络恢复链耗尽后读取该版本缓存。
4. 分别测试旧标签页和新页面、首次访问和受控访问、冷缓存和已有缓存。缓存命中前可能已收到 `rf:error`，不能只按事件判断资源最终失败。

manifest version 纳入资源、规则和关键缓存策略；SW 内的熔断状态独立于页面 localStorage。

## 关闭配置与紧急停用 {#disable}

页面 `?__rf=off`、Cookie 或全局 Kill Switch 只阻止本次 runtime 接线，不会立即停用已控制页面的 SW。停用时：

1. 在构建配置保留原 `path` / `scope` 并设置 `enabled: false`，防止清理目标退回默认 `/rf-sw.js`。
2. 发布新 HTML 与页面配置。当前 runtime 会尝试注销 **active script 路径等于该 path** 的旧注册；这不保证现有客户端立即脱离控制。
3. 需要人工操作时，先查看注册列表，确认脚本路径与 scope，再执行下方定向注销。
4. 关闭仍受旧 SW 控制的标签页后重新进入页面，核对 controller、实际资源与 Network。若 controller 是别的 PWA，按其集成方案判断。

```ts
serviceWorker: {
  enabled: false,
  path: '/app/rf-sw.js',
  scope: '/app/',
}
```

```js
const expectedScript = new URL('/app/rf-sw.js', location.origin).href;
const expectedScope = new URL('/app/', location.origin).href;
for (const registration of await navigator.serviceWorker.getRegistrations()) {
  const scripts = [registration.active, registration.waiting, registration.installing];
  if (
    registration.scope === expectedScope &&
    scripts.some((worker) => worker?.scriptURL === expectedScript)
  ) {
    console.log('unregistered', await registration.unregister());
  }
}
```

只注销已核对的本库注册。不要批量注销整个源站的 SW，也不要清空整个源站存储。仅在确认已无旧客户端需要缓存时，定向清理已核对的本库缓存名称；停用与删缓存是两件事。

## 已有 PWA / Workbox {#existing-pwa}

接入前核对现有 SW 的 scope。同一 scope 的不同脚本注册会影响原有注册，不能把独立 `rf-sw.js` 当作可以直接叠加的 PWA 插件。当前仓库没有持续验证与 Workbox 的合并集成；已有 PWA 的应用应先设计统一 SW 路由或隔离 scope，再验证 fetch ownership、缓存更新与停用路径。

恢复启用时，先部署匹配版本的资源与 SW，再打开 `enabled`，重新完成[发布验收](./deployment.md#verification)。
