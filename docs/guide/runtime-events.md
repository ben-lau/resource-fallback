---
title: 运行时事件
---

# 运行时事件

resource-fallback 通过 DOM CustomEvent 和可选 JS 函数钩子暴露运行时状态，便于对接监控上报与降级 UI。自动注入场景下推荐优先监听 DOM 事件，因为构建配置中的函数会在序列化时被丢弃。

## 事件列表

| 事件名        | 触发时机                                 | detail                  |
| ------------- | ---------------------------------------- | ----------------------- |
| `rf:retry`    | 同一 URL 重试                            | `{ url, attempt }`      |
| `rf:fallback` | 切换到下一个候选 URL                     | `{ from, to, reason? }` |
| `rf:success`  | 页面或 SW 经 retry / fallback 后恢复成功 | `{ url, attempts }`     |
| `rf:error`    | 页面侧 session 失败，或 SW 透传错误      | `{ url, reason? }`      |

::: info 事件来源
页面侧 adapter（Observer、Vite、Webpack、SystemJS）会先把失败交给 RecoveryCoordinator，再由 HookBus 派发 DOM CustomEvent。Hybrid SW 模式下，SW 通过 `postMessage` 将事件送回页面，再由页面 runtime 转发为相同的 `rf:*` 事件。

- 页面侧 Coordinator 事件里的 `reason` 是 transport / coordinator 产生的 opaque failure value，类型为 `unknown`
- SW 透传到页面的 `reason` 可能包含 resolver giveup 原因，例如 `'rules-exhausted'` 或 `'no-match'`
- 页面侧和 SW 的 `rf:success` 都只在经历 retry / fallback 后恢复成功时触发；首轮直接成功不会触发
- SW 的恢复成功事件只针对可用的**网络**响应；若网络链路耗尽后命中缓存，当前实现会先发 `rf:error`，不会补发 `rf:success`
  :::

## 监听示例

::: tip TypeScript
库没有扩展 `WindowEventMap`，因此 `rf:*` 监听器的参数会被推断为 `Event`。在读取 `detail` 前请显式断言为 `CustomEvent`，如下例所示。
:::

### 基础监听

```ts
window.addEventListener('rf:retry', (e) => {
  console.log('重试:', (e as CustomEvent).detail);
  // { url: 'https://cdn1.example.com/assets/app.js', attempt: 1 }
});

window.addEventListener('rf:fallback', (e) => {
  console.log('回退:', (e as CustomEvent).detail);
  // { from: 'https://cdn1.example.com/assets/app.js', to: 'https://cdn2.example.com/assets/app.js' }
});

window.addEventListener('rf:success', (e) => {
  console.log('成功:', (e as CustomEvent).detail);
  // { url: 'https://cdn2.example.com/assets/app.js', attempts: 3 }
});

window.addEventListener('rf:error', (e) => {
  console.log('失败:', (e as CustomEvent).detail);
  // 页面侧 reason 是 unknown；SW 透传时也可能是 'rules-exhausted' / 'no-match'
});
```

### 入口失败降级 UI

页面侧 `rf:error.detail.url` 是恢复终止时的当前地址。给入口脚本做降级时，将构建产物对应的主 CDN、备用 CDN 和回源 URL 都纳入匹配。下面的监听只处理同一入口脚本，应用启动后可以移除。

```html
<p id="rf-entry-fallback" hidden>资源加载失败，请刷新页面</p>
<script>
  (function () {
    const entryUrls = new Set(
      [
        'https://cdn1.example.com/assets/main.js',
        'https://cdn2.example.com/assets/main.js',
        '/assets/main.js',
      ].map((url) => new URL(url, window.location.href).href),
    );

    function onRfError(event) {
      const url = event.detail?.url;
      if (typeof url !== 'string' || !entryUrls.has(new URL(url, window.location.href).href))
        return;

      const fallback = document.getElementById('rf-entry-fallback');
      if (fallback) fallback.hidden = false;
    }

    window.addEventListener('rf:error', onRfError);

    // 应用成功启动后请在入口代码里执行：
    // window.removeEventListener('rf:error', onRfError);
  })();
</script>
```

将示例路径替换为实际发布的入口文件名（包括构建哈希），并在入口加载前注册监听。入口兜底使用通用失败文案。判断请求是否进入过回退链时，观察 `rf:retry` 和 `rf:fallback`。

## 与监控系统对接

推荐通过 DOM 事件对接监控系统：

```ts
window.addEventListener('rf:retry', (e) => {
  monitor.send('resource.retry', (e as CustomEvent).detail);
});

window.addEventListener('rf:fallback', (e) => {
  monitor.send('resource.fallback', (e as CustomEvent).detail);
});

window.addEventListener('rf:error', (e) => {
  monitor.send('resource.error', (e as CustomEvent).detail);
});
```

### 判断是否真的进入回退链

测试或监控时，若要区分“终态失败”与“确实发生过 retry / fallback”，推荐单独记录 `rf:retry` / `rf:fallback`：

```ts
const events: Array<{ type: string; detail: unknown }> = [];

['rf:retry', 'rf:fallback', 'rf:success', 'rf:error'].forEach((type) => {
  window.addEventListener(type, (e) => {
    events.push({ type, detail: (e as CustomEvent).detail });
  });
});

function didFallbackRun(since: number) {
  return events.slice(since).some((e) => e.type === 'rf:retry' || e.type === 'rf:fallback');
}
```

### 监控指标建议

| 指标       | 推荐来源                                                  |
| ---------- | --------------------------------------------------------- |
| 重试率     | `rf:retry` 按 host 计数                                   |
| 回退率     | `rf:fallback` 的 `from` → `to`                            |
| 终态失败率 | `rf:error` 总量                                           |
| SW 耗尽率  | **仅在 SW 透传语境下**统计 `reason === 'rules-exhausted'` |
| 熔断命中   | 结合 debug 日志或 circuit state 观测被跳过的 host         |

### JS 函数钩子

如需函数钩子，请在页面里手动调用 `window.__RF__.install()`；只有直接传入函数对象时这些钩子才会保留：

```ts
window.__RF__.install({
  rules: [...],
  hooks: {
    onRetry:    (e) => analytics.send('rf.retry', e),
    onFallback: (e) => analytics.send('rf.fallback', e),
    onSuccess:  (e) => analytics.send('rf.success', e),
    onError:    (e) => sentry.captureMessage('rf.error', e),
  },
});
```

::: warning hooks 限制
`buildInjectedTags()` 与插件自动生成的 `install(...)` 调用都会先序列化配置对象，因此构建配置里的函数钩子总会被丢弃。`externalRuntime` 只把 runtime IIFE 改为外链，自动 `install(...)` 仍是内联脚本；它同样不会保留这些函数。自动注入场景请使用 DOM `rf:*` 事件；如需 hooks，请在页面代码里手动调用 `window.__RF__.install()`。
:::

## HookBus 与 adapter 关系

```mermaid
flowchart LR
  OBS["Observer"] --> RC["RecoveryCoordinator"]
  VA["Vite Adapter"] --> RC
  WA["Webpack Adapter"] --> RC
  SA["SystemJS Adapter"] --> RC
  SWA["SW Adapter<br/>(postMessage 桥接)"] --> HB["HookBus<br/>rf:retry / rf:fallback<br/>rf:success / rf:error"]
  RC --> HB
  HB --> DOM["window.dispatchEvent"]
  HB --> HOOKS["hooks.onRetry / onFallback / ..."]
```

## Hybrid SW 事件桥

SW 事件会优先投递给触发该 fetch 的页面客户端（`FetchEvent.clientId`）；只有极少数没有 `clientId` 的场景才会回退为窗口广播。讨论 `rules-exhausted` / `no-match` 这类 reason 时，也应明确它们属于 **SW resolver 透传语境**，而不是页面侧稳定 API。

## 调试

生产环境保持 `debug: 'auto'`，线上排查时设置：

```js
localStorage.__RF_DEBUG__ = '1';
```

刷新页面后即可在控制台看到详细日志。

## 相关文档

- [故障排查](./troubleshooting.md#terminal-result) — 区分终态失败与缓存恢复

- [快速开始 — 验证](./quick-start.md#验证)
- [最佳实践 — 线上监控](./best-practices.md#线上监控)
- [CSP 与 SRI — externalRuntime](./csp-sri.md)
