---
title: 覆盖范围与限制
description: 判断资源类型、构建环境、Service Worker 控制范围与浏览器限制是否满足接入条件。
---

# 覆盖范围与限制

先确认资源由谁加载、页面是否受 Service Worker 控制，再选择接入方式。插件处理资源加载恢复，备用文件和降级界面仍需由应用部署。

## 选择恢复方式

| 资源或场景                                 | 默认页面 runtime               | Hybrid SW 的条件                                                 |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| 入口 `<script>`、`<link rel="stylesheet">` | Observer 监听标签加载错误      | 仍由页面处理                                                     |
| Vite 生产构建的字面量动态 import           | 构建改写与 Vite adapter        | 仍由页面处理                                                     |
| Webpack JS chunk、独立 CSS chunk           | RuntimeModule 与 Observer 分工 | 仍由页面处理                                                     |
| 图片、字体、媒体、CSS `url()`              | 不覆盖                         | 页面受控，请求 URL 在构建 manifest 的 SW 资源集合中              |
| CSS `@import`                              | 不覆盖                         | 页面受控，`includeStyleImports` 开启，CSS referrer 命中 manifest |
| HTML 文档首次请求、业务 fetch/API          | 不覆盖                         | 当前 Hybrid SW 不接管                                            |
| Worker / SharedWorker、服务端 SSR 请求     | 不覆盖                         | 当前 Hybrid SW 不接管                                            |

“图片回退”针对构建 manifest 中的资源。运行时拼接的任意外部图片 URL，即使看起来符合 CDN 前缀，也不自动进入 SW 恢复。

## 图片与字体的接管条件 {#images-and-fonts}

图片、背景图和字体需要启用 Hybrid SW，并同时满足：页面已由预期 SW 控制、资源 URL 命中构建 manifest、候选响应满足浏览器的 CORS/MIME 等条件。首次访问没有 controller，或图片 URL 是业务运行时拼接的外部地址时，先按这些条件排查。

## 首次访问与启动边界

SW 的注册、安装、激活和接管是异步的，第一次打开页面时，早期图片、字体等资源可能已经发出。以 `navigator.serviceWorker.controller` 确认当前页面是否受控，并分别验证首次访问和后续访问。

页面恢复依赖 HTML、runtime 及初始化脚本先加载成功。使用 `externalRuntime` 时，把 runtime 放在独立可用的同源路径，并验证初始化顺序。runtime 自身还未执行时，不能恢复它自己的加载失败。

入口候选全部失败时，React/Vue 尚未启动。将[入口降级监听](./runtime-events.md#入口失败降级-ui)放在入口之前；懒加载终止则由应用的错误边界处理。

## 环境与执行限制

- Vite 完整动态导入恢复以 build/preview 为验证环境；`enableDev: true` 只开启 dev 中可观察的脚本和样式错误。
- 同步 classic script 失败后替换节点，无法保证与后续脚本的原始执行顺序，也不会撤销已产生的副作用。
- 跨源字体、模块和 SW 请求继续受 CORS、CSP、MIME、SRI 约束。opaque 响应的实际 HTTP 状态不可读，见 [Hybrid SW](./service-worker.md#fallbackonopaque)。
- 页面侧当前共享一个 circuit registry；每条规则的独立页面熔断器尚未实现。多规则的 URL 构造限制见[配置参考](./configuration.md#fallbackrule)。

## 下一步

- 兼容性：支持声明与 CI 验证范围。
- [快速开始](./quick-start.md)：验证一次主 CDN 失败。
- 生产部署：发布同一份产物并验证全部候选。
- [故障排查](./troubleshooting.md)：按现象定位。
