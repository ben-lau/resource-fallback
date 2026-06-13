---
title: 最佳实践
---

# 最佳实践

本文汇总 resource-fallback 在生产环境中的配置建议、调试技巧与部署注意事项。

## 规则配置建议

1. **`urls` 顺序就是回退顺序** — 建议依次写入：备用 CDN → 自建 CDN → 回源（`'/'`）
2. **`match` 应等于 `base` / `publicPath`** — 确保首次加载的资源 URL 能被规则匹配
3. **回源 URL 使用相对路径** — 避免再次遇到 CDN 故障（如 `'/'`）
4. **`retry.max` 不宜过大** — 过多重试会延长用户等待时间，建议 1~3 次
5. **为入口失败兜底** — 在 `index.html` 中添加 `rf:error` 监听，显示降级 UI

### 推荐规则结构

```ts
{
  match: 'https://cdn.example.com/',  // 与 base / publicPath 一致
  urls: [
    'https://cdn-backup.example.com/', // 备用 CDN
    'https://static.mysite.com/',      // 自建静态源
    '/',                               // 同源回源
  ],
  retry: { max: 2, baseDelay: 300 },
  circuit: { threshold: 3, cooldown: 30000 },
}
```

## CDN 前缀注意事项

::: warning match 对齐
Vite 项目的 `match` 必须对齐 `base`；Webpack 项目的 `match` 必须对齐 `output.publicPath`。如果首次资源 URL 匹配不上 `match`，运行时不会进入 retry/fallback。
:::

- `match` 和 `urls` 中的每一项都应为 **base URL 前缀**（含末尾 `/`），例如 `https://cdn.example.com/`
- 最后一个 `urls` 条目通常指向同源回源，避免主 CDN 故障时再次命中 CDN
- 重复 `match` 以最后一条规则为准

## 调试技巧

### debug 模式

生产环境保持 `debug: 'auto'`（默认）。线上排查时设置：

```js
localStorage.__RF_DEBUG__ = '1';
```

刷新页面后即可在控制台看到详细日志。排查完成后清除：

```js
delete localStorage.__RF_DEBUG__;
```

### Kill Switch 临时禁用

排查问题时可通过以下方式临时禁用运行时，无需发版：

- 访问 `?__rf=off`
- 设置 Cookie `__rf_disable=1`
- 在 runtime script 之前设置 `window.__RF_DISABLE__ = true`

### Vite 验证环境

Vite dev server 使用原生 ESM，动态 `import()` 失败无法完整拦截。请使用：

```bash
vite build && vite preview
```

或使用项目提供的 Demo 与 E2E 测试验证。

### Hybrid SW 调试

SW 调试请使用 `localhost` / `127.0.0.1` / HTTPS。普通局域网 IP 的 HTTP 不是 secure context，浏览器不会注册 SW。

## 线上监控

推荐通过 DOM 事件对接监控系统，详见 [运行时事件](./runtime-events.md)：

```ts
window.addEventListener('rf:retry', (e) => {
  monitor.send('resource.retry', e.detail);
});

window.addEventListener('rf:fallback', (e) => {
  monitor.send('resource.fallback', e.detail);
});

window.addEventListener('rf:error', (e) => {
  monitor.send('resource.error', e.detail);
});
```

建议监控的关键指标：

- **fallback 频率** — 按 host 统计 `rf:fallback` 事件，识别 CDN 故障
- **error 率** — `rf:error` 表示所有候选 URL 耗尽，需要告警
- **熔断状态** — 通过 debug 日志或自定义上报观察 per-host 熔断

## 同步脚本限制

`<script>`（非 module）失败后，浏览器只触发 `error` 事件，**已执行的部分不可撤回**。插件会替换 DOM 为下一个 URL 并重新加载，但如果原脚本已挂载全局变量，再次执行可能产生副作用。

所有候选 URL 耗尽后**仅触发 `rf:error`，不自动刷新页面**——由业务决定如何兜底。

Hybrid SW 不在本轮接管 script，也不实现同步 classic script 的强顺序保证。若后续需要强顺序，应作为独立的 opt-in ScriptSequencer 能力设计。

## 部署与验证

### Demo 验证

项目提供了两个无需 mock 服务器的示例：

```bash
pnpm install
pnpm build

# Vite + Vue — http://127.0.0.1:4174
pnpm --filter @resource-fallback-example/vite-vue build
pnpm --filter @resource-fallback-example/vite-vue start

# Webpack + React — http://127.0.0.1:4173
pnpm --filter @resource-fallback-example/webpack-react build
pnpm --filter @resource-fallback-example/webpack-react start
```

打开 DevTools → Network 可以看到完整的重试→回退→回源链路。

### externalRuntime 部署

若 CSP 禁止 `unsafe-inline`，使用外链模式：

```ts
resourceFallback({
  externalRuntime: true,
  externalRuntimePath: '/static/__rf/runtime.js',
  rules: [...],
});
```

构建后通过 `getRuntimeCode()` 获取 runtime 内容，部署到 CDN 或静态资源目录。

### Preconnect 优化

默认 `injectPreconnect: true` 会为每个 fallback 域名注入 `<link rel="preconnect">`，减少 DNS + TLS 耗时。若页面已有全局 preconnect 策略，可按需关闭。

## 版本升级建议

本项目使用 [release-please](https://github.com/googleapis/release-please) 管理版本号和 changelog：

1. 正常提交代码到 `main`（使用 conventional commits 格式）
2. release-please 自动创建/更新 Release PR（包含版本号 bump + CHANGELOG 更新）
3. 合并 Release PR → 自动创建 GitHub Release + git tag
4. npm 发布：`pnpm release`

升级时注意：

- 查看 [更新日志](../changelog.md) 了解 breaking changes
- Hybrid SW 启用后，确保 `rf-sw.js` 正确部署到 scope 对应路径
- SW 更新时浏览器会自动获取新版本（`updateViaCache: 'none'`）

## React / Vue 异步组件

- **React**：`React.lazy()` 失败时 `<Suspense>` 不处理错误，需包裹 `ErrorBoundary`（参见 [Webpack 集成](./webpack.md#reactlazy-错误处理)）
- **Vue**：`defineAsyncComponent` 和 Vue Router 懒加载无需改动，插件自动拦截 chunk 加载失败

## 相关文档

- [快速开始](./quick-start.md)
- [配置参考](./configuration.md)
- [运行时事件](./runtime-events.md)
- [CSP 与 SRI](./csp-sri.md)
