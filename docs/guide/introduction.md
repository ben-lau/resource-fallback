---
title: 简介
---

# 简介

Resource Fallback 为 Vite 和 Webpack 构建的 JavaScript 和 CSS 资源提供运行时恢复。加载失败时，它先重试原地址，再按配置切换 CDN，最后可以回到页面源站。

## 什么是 resource-fallback

在构建配置中注册插件，插件会注入运行时。React.lazy、Vue 异步组件和懒加载路由可以沿用现有写法。需要恢复图片、字体等子资源时，可以启用 [Hybrid Service Worker](./service-worker.md)。

| 资源                                       | 恢复链路                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| 入口脚本、静态或动态注入的样式表           | 页面侧 Observer 监听对应标签的加载错误                                              |
| 动态加载的 JS chunk                        | Vite 或 Webpack 适配器接入各自的加载链路                                            |
| 图片、字体、媒体和符合条件的 CSS `@import` | 可选的 Hybrid Service Worker，详见[覆盖范围](./service-worker.md#同步-异步覆盖矩阵) |

## 为什么需要资源回退

前端静态资源通常托管在 CDN 上。当主 CDN 出现 DNS 故障、网络抖动或区域性不可用时，页面可能出现白屏、样式丢失或懒加载模块失败。

传统做法需要在业务代码中手动处理加载失败，或在网关层做复杂路由。resource-fallback 在**构建时注入运行时、运行时自动拦截失败**，按配置依次重试同一 URL、切换到备用 CDN、最终回源，整个过程对业务透明。

::: tip 适用场景

- 多 CDN 容灾与主备切换
- 静态资源加载失败时的自动降级
- 需要监控上报的资源 fallback 链路
  :::

## 接入路径

1. 对照[覆盖范围](./coverage.md)和[兼容性](./compatibility.md)，确认目标资源与环境。
2. 在[快速开始](./quick-start.md)选择构建器，配置同一资源的候选前缀。
3. 发布同一份构建产物，在生产构建中屏蔽主 CDN，核对 Network 与恢复事件。
4. 按[生产部署](./deployment.md)验证回源、全部失败和旧页面；启用 SW 时再验证更新与停用。

## 核心架构总览

页面侧由构建器适配器和 Observer 接收加载失败，再统一重试与切换候选。图片、字体等资源可交给独立 Hybrid SW。完整图解见[工作原理](../design/architecture.md)。

### 回退流程

首次加载失败 → 重试同一 URL → 按顺序切换候选 → 成功或终止。熔断和超时可能提前跳过候选或结束流程，详见[配置参考](./configuration.md)。

## 包结构

### @resource-fallback/core

浏览器运行时、配置类型与 Node 构建工具。普通业务接入由插件间接使用。

### @resource-fallback/vite-plugin

Vite HTML 注入与生产构建动态导入改写，见 [Vite 集成](./vite.md)。

### @resource-fallback/webpack-plugin

Webpack RuntimeModule 与 HTML 注入，见 [Webpack 集成](./webpack.md)。

## 下一步

- [快速开始](./quick-start.md) — 安装与最小配置
- [配置参考](./configuration.md) — 完整选项说明
- [Hybrid Service Worker](./service-worker.md) — 图片、字体等子资源回退
