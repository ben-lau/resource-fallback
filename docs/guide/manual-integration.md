---
title: 手动集成
description: 自定义 HTML 的 runtime 文件导出、首次初始化、函数 hooks 与卸载生命周期。
---

# 手动集成

使用插件自动注入的项目，通过 DOM `rf:*` 事件订阅状态。只有需要自己管理 HTML 启动顺序时，才按本页完成首次手动初始化。

## 导出 runtime

```bash
pnpm add -D @resource-fallback/core
```

```js
// scripts/copy-rf-runtime.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { getRuntimeCode } from '@resource-fallback/core';

await mkdir('public/__rf', { recursive: true });
await writeFile('public/__rf/runtime.js', getRuntimeCode());
```

在应用构建前运行 `node scripts/copy-rf-runtime.mjs`，并部署生成文件。下面只加载 runtime IIFE，不调用 `buildInjectedTags()`；后者会自动初始化并序列化函数。

## 第一次初始化 {#first-install}

把初始化写在外链文件里，并在应用入口之前顺序执行：

```js
// public/__rf/bootstrap.js
window.__RF__.install({
  rules: [
    {
      base: 'https://cdn1.example.com/',
      urls: ['https://cdn2.example.com/', '/'],
      retry: { max: 1 },
    },
  ],
  hooks: {
    onFallback: (event) => console.info('resource fallback', event),
    onError: (event) => console.error('resource recovery ended', event),
  },
});
```

```html
<script src="/__rf/runtime.js"></script>
<script src="/__rf/bootstrap.js"></script>
<!-- 应用入口放在后面；这两个初始化脚本不使用 async/defer -->
<script type="module" src="https://cdn1.example.com/assets/app.js"></script>
```

两个初始化脚本都应在 CSP 授权范围内。若应用发布在 `/app/`，同步调整文件发布路径与标签地址。

此示例接入页面 Observer。Vite 动态导入的构建改写、Webpack RuntimeModule 和 SW manifest 仍需要对应构建集成；仅复制 runtime 不会生成它们。已有插件自动注入的页面应继续使用[DOM 事件](./runtime-events.md)，不要再执行此初始化。

## 安装与卸载边界

- `install()` 是幂等的：第二次调用不更新规则，也不补加 hooks。
- `dispose()` 取消页面侧恢复并清理页面监听与全局对象；不等同于立即停用已注册 SW，见 [SW 运维](./sw-operations.md)。
- 不要用卸载再安装作为普通事件订阅方式。确需重装时，完整重建初始化路径并重新验证正在加载的资源。

浏览器 API 的使用条件见[运行时 API](../reference/runtime.md)。
