---
title: API 使用导航
description: 按插件配置、浏览器运行时、Node 构建工具与 Service Worker 查找 Resource Fallback 接口。
---

# API 使用导航

从要完成的任务找到接口，再进入完整类型参考。自动注入的业务接入通常只需要插件配置与 DOM 事件。

## 插件配置

| 任务                       | 接口与说明                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装插件并验证             | [Vite](../guide/vite.md)、[Webpack](../guide/webpack.md)、[快速开始](../guide/quick-start.md)                                                                  |
| 配置前缀和候选             | [PluginOptions / FallbackRule](../guide/configuration.md)、[URL 预览](../guide/url-preview.md)                                                                 |
| 配置重试和熔断             | [RetryOptions](../guide/configuration.md#retryoptions)、[CircuitOptions](../guide/configuration.md#circuitoptions)、[超时](../guide/configuration.md#timeouts) |
| 启用图片、字体等子资源恢复 | [Hybrid SW](../guide/service-worker.md)、[覆盖范围](../guide/coverage.md)                                                                                      |

## 浏览器运行时

| 任务                   | 接口与说明                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------- |
| 查看版本与安装标记     | [`window.__RF__`](./runtime.md#status)                                              |
| 首次初始化、live hooks | [`install()`](./runtime.md#install)、[完整手动集成](../guide/manual-integration.md) |
| Vite 加载与 URL 构造   | [`load()` / `url()`](./runtime.md#loading)                                          |
| 卸载页面 runtime       | [`dispose()`](./runtime.md#dispose)                                                 |
| 监控恢复结果           | [四类 DOM 事件](../guide/runtime-events.md)，注意页面 / SW 口径                     |

## Node 构建工具

| 接口                                                                              | 用途                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`defineConfig()`](../api/index.md#defineconfig)                                  | 保留配置类型推断                                |
| [`getRuntimeCode()`](../api/index.md#getruntimecode)                              | 获取可部署的浏览器 IIFE                         |
| [`buildInjectedTags()`](../api/index.md#buildinjectedtags)                        | 生成标签与自动初始化；函数 hooks 会被序列化丢弃 |
| [`buildServiceWorkerAssets()`](../api/service-worker.md#buildserviceworkerassets) | 自定义构建中的 SW 与 manifest 生成              |

## 完整参考

- [函数与工具](../api/index.md)：全部 Node 导出。
- [类型与接口](../api/types.md)：完整字段、继承关系与源码链接。
- [Service Worker 工具](../api/service-worker.md)：manifest 与 worker 构建接口。

完整参考由 TypeDoc 从源码生成，注释可能包含中文；英文核心使用说明位于英文导航与运行时页面。API 的修改入口指向对应源码，避免编辑下次生成会覆盖的文件。
