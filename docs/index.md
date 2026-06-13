---
layout: home

hero:
  name: Resource Fallback
  text: 零心智负担的前端资源回退
  tagline: 为 Webpack 与 Vite 构建产物提供 重试 → 多 CDN 回退 → 回源 能力，业务代码无需改动
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/ben-lau/resource-fallback

features:
  - title: 业务零侵入
    details: 构建配置注册插件即可。React.lazy、Vue defineAsyncComponent、Vue Router 懒加载等异步模式完全不需要改动。
  - title: 脚本与样式回退
    details: JS 与 CSS 的同步/异步加载链路拦截，覆盖 Webpack chunk loader、Vite dynamic import 以及 script 与 link 的 error 事件。
  - title: Hybrid SW
    details: 可选启用 Service Worker，补齐 img、@font-face、CSS url()、媒体资源和受控 CSS @import 的资源回退；脚本仍由现有 adapter 负责。
  - title: 智能重试 + 熔断
    details: 指数退避与随机抖动避免失败风暴；per-host 熔断器连续失败后自动跳过该 host，冷却后恢复，并支持跨标签页状态共享。
  - title: CSP / SRI 兼容
    details: 支持 nonce 属性与 externalRuntime 外链模式；SRI 可选 strip、keep、strict 三种策略，配合三重 Kill Switch 线上紧急关停。
  - title: 事件系统
    details: DOM CustomEvent（rf:retry / rf:fallback / rf:success / rf:error）与 JS 函数钩子，便于对接监控上报与降级 UI。
---

<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin-top:24px">

[![npm](https://img.shields.io/npm/v/@resource-fallback/core)](https://www.npmjs.com/package/@resource-fallback/core)
[![vite-plugin](https://img.shields.io/npm/v/@resource-fallback/vite-plugin?label=vite-plugin)](https://www.npmjs.com/package/@resource-fallback/vite-plugin)
[![webpack-plugin](https://img.shields.io/npm/v/@resource-fallback/webpack-plugin?label=webpack-plugin)](https://www.npmjs.com/package/@resource-fallback/webpack-plugin)
[![CI](https://github.com/ben-lau/resource-fallback/actions/workflows/ci.yml/badge.svg)](https://github.com/ben-lau/resource-fallback/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/ben-lau/resource-fallback/graph/badge.svg)](https://codecov.io/gh/ben-lau/resource-fallback)

</div>
