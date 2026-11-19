---
title: 生产部署
description: 对齐 CDN 与源站路径，发布同一份构建产物，部署外链 runtime，并验证回退与回滚。
outline: [2, 3]
---

# 生产部署

先把同一份构建产物放到每个候选的正确路径，再发布引用它们的 HTML。以下示例以 `/app/` 子目录为例。

## 对齐发布路径 {#paths}

| 项目                                      | 示例值                                           |
| ----------------------------------------- | ------------------------------------------------ |
| 页面地址                                  | `https://app.example.com/app/`                   |
| Vite `base` / Webpack `output.publicPath` | `https://cdn1.example.com/app/`                  |
| 规则 `base`                               | `https://cdn1.example.com/app/`                  |
| 回退前缀                                  | `https://cdn2.example.com/app/`、`/app/`         |
| 构建文件                                  | `assets/app-HASH.js`                             |
| 源站必须提供                              | `https://app.example.com/app/assets/app-HASH.js` |

```ts
resourceFallback({
  rules: [
    {
      base: 'https://cdn1.example.com/app/',
      urls: ['https://cdn2.example.com/app/', '/app/'],
      retry: { max: 1 },
    },
  ],
});
```

回退替换整个 `base`，保留 `assets/app-HASH.js`。`'/'` 指页面源站根目录；部署在 `/app/` 时应使用 `'/app/'`。可用 URL 前缀预览器核对。

## 发布与保留旧文件 {#release}

1. 只构建一次，把同一批带 hash 的 JS、CSS 和子资源同步到所有 CDN 与源站。使用 SRI 时，各端文件内容必须一致。
2. 逐一检查候选地址能返回真实资源、正确的 `Content-Type`，并满足实际需要的 CORS 与 CSP。
3. 候选就绪后再发布 HTML。保留旧版本 hash 文件，覆盖仍可能持有旧 HTML 或打开旧页面的客户端；保留时长由业务缓存与会话周期决定。
4. 用旧页面触发一次尚未加载的路由，验证旧 chunk 仍可下载。回滚时先确认旧资源仍在，再恢复对应 HTML 与配置。

源站的回退路径必须直接提供文件，不能再次转发到同一个故障 CDN。静态目录缺文件时返回真实 404，避免 SPA 路由兜底返回 HTML 200。

## 部署外链 runtime {#external-runtime}

`externalRuntime` 只生成引用，runtime 文件需要自行部署。先添加直接依赖，再在应用构建前导出文件：

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

```ts
resourceFallback({
  externalRuntime: true,
  externalRuntimePath: '/app/__rf/runtime.js',
  rules: [
    {
      base: 'https://cdn1.example.com/app/',
      urls: ['https://cdn2.example.com/app/', '/app/'],
    },
  ],
});
```

Vite 会把 public 文件复制到输出目录；Webpack 项目需在发布步骤把该文件放到同一 URL。检查 runtime 与后面的初始化脚本都先于应用入口执行。严格 CSP 下自动内联 `install(...)` 仍需授权。

## 每响应 nonce {#nonce}

`nonce` 是字符串配置，插件不会自动生成动态值。需要每响应 nonce 时：

1. 构建配置使用专用占位值，例如 `nonce: '__RF_NONCE__'`。
2. 服务端或边缘层为每次 HTML 响应生成新的安全随机值，把注入标签的占位值替换为该值。
3. 同一响应的 CSP `script-src` 使用相同的 `'nonce-值'`，并允许实际使用的资源来源。
4. 确认 HTML 缓存层不会把旧 nonce 的 HTML 与新 CSP 响应头混用。

纯静态托管无法执行这一步时，应选择适合部署环境的 CSP hash 授权或[手动外链初始化](./manual-integration.md)。完整策略见 [CSP 与 SRI](./csp-sri.md)。

## 发布验收 {#verification}

| 场景             | 必须确认                                     |
| ---------------- | -------------------------------------------- |
| 主 CDN 正常      | 资源首次成功，无恢复事件                     |
| 主 CDN 屏蔽      | 备用 CDN 实际成功；事件与 Network 对应       |
| CDN 都屏蔽       | 源站路径、正文、MIME 正确                    |
| 全部候选失败     | 入口降级或路由错误边界可见，无无限刷新       |
| 旧页面加载新路由 | 旧 hash 文件仍可下载                         |
| Hybrid SW        | 首次访问与受控页面、冷缓存与已有缓存分别验证 |

故障验证步骤见[快速开始](./quick-start.md#验证)；SW 更新和停用见 SW 运维。
