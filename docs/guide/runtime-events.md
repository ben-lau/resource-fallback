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

### rf:retry：同一地址重试 {#rf-retry}

`attempt` 从 `1` 开始，表示当前 URL 的第几次重试，不包括该 URL 的首次请求。`retry.max: 1` 允许首次请求后再重试一次。

### rf:fallback：切换候选 {#rf-fallback}

`from` 和 `to` 是切换前后的地址。一次恢复可以切换多个候选，因此事件次数不等于受影响资源数。

### rf:success：成功与 attempts {#rf-success}

| 来源             | `attempts` 的当前含义                   | 主 CDN 失败两次、备用首次成功 |
| ---------------- | --------------------------------------- | ----------------------------- |
| 页面 Coordinator | 本次恢复累计尝试次数，包含初始失败      | `3`                           |
| Hybrid SW        | 最终 URL 上的尝试次数，每次切换候选重置 | `1`                           |

两种来源均只报告经历恢复后的网络成功。首页请求演练展示页面侧口径。

### rf:error：终态与缓存恢复 {#rf-error}

页面侧表示恢复终止，可能由候选耗尽、单次或 session 超时等原因引起。SW 表示网络链路失败，随后仍可能命中 Cache API。**它不是统一的用户侧失败信号。** 超时边界见[超时与重试预算](./configuration.md)。

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

    window.addEventListener('app:ready', () => window.removeEventListener('rf:error', onRfError), {
      once: true,
    });
  })();
</script>
```

应用成功启动后，在入口代码里派发事件，监听器会在原作用域内清理：

```js
window.dispatchEvent(new Event('app:ready'));
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

| 指标            | 推荐来源                                                  |
| --------------- | --------------------------------------------------------- |
| 重试次数        | `rf:retry` 按 host 计数                                   |
| 候选切换次数    | `rf:fallback` 的 `from` → `to`                            |
| 错误信号次数    | `rf:error` 总量                                           |
| SW 网络耗尽次数 | **仅在 SW 透传语境下**统计 `reason === 'rules-exhausted'` |
| 熔断命中        | 结合 debug 日志或 circuit state 观测被跳过的 host         |

事件次数不能直接作为失败率：一次恢复可能产生多条重试或切换事件，首轮直接成功也没有 `rf:success`。恢复成功率需要明确恢复流程的去重口径；全部资源失败率还需要全部加载的分母。SW 的 `rf:error` 之后可能返回缓存，应结合图片、字体或应用的实际加载结果判断用户侧失败。

当前公开事件没有 `source` 或 `sessionId` 字段，不能靠 `reason` 猜测来源或可靠关联并发恢复。需要精确统计时，在可明确资源来源的场景单独采集，并保留该限制。

### JS 函数钩子

函数钩子必须在页面 runtime 的**首次安装**时直接传入。插件已自动调用 `install()` 后，再次调用会被忽略，不能补加 hooks。自动注入场景使用 DOM 事件；完整的首次手动安装见[手动集成](./manual-integration.md)。

下面仅适用于 runtime 已加载、尚未安装的页面：

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
`buildInjectedTags()` 与插件自动生成的 `install(...)` 调用都会先序列化配置对象，因此构建配置里的函数钩子总会被丢弃。`externalRuntime` 只把 runtime IIFE 改为外链，自动 `install(...)` 仍是内联脚本；它同样不会保留这些函数。自动注入场景请使用 DOM `rf:*` 事件；如需 hooks，请按[手动集成](./manual-integration.md)在首次安装时传入；重复 `install()` 不会更新订阅。
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
