---
layout: home

hero:
  name: Resource Fallback
  text: Zero-Intrusion Frontend Resource Fallback
  tagline: Runtime retry → multi-CDN fallback → origin recovery for Webpack and Vite build outputs — no business code changes required
  actions:
    - theme: brand
      text: Quick Start
      link: /en/guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/ben-lau/resource-fallback

features:
  - title: Zero Business Intrusion
    details: Register the plugin in your build config and you're done. React.lazy, Vue defineAsyncComponent, Vue Router lazy-loaded routes, and other async patterns work without changes.
  - title: Script & Style Fallback
    details: Intercepts sync/async JS and CSS loading — Webpack chunk loader, Vite dynamic import, and script/link error events.
  - title: Hybrid SW
    details: Optional Service Worker covers img, @font-face, CSS url(), media resources, and controlled CSS @import; scripts remain owned by existing adapters.
  - title: Smart Retry + Circuit Breaker
    details: Exponential backoff with jitter avoids thundering herd; per-host circuit breaker skips failed hosts and recovers after cooldown, with cross-tab state sharing.
  - title: CSP / SRI Compatible
    details: Supports nonce and externalRuntime modes; SRI strip / keep / strict strategies, plus triple kill switch for emergency shutoff.
  - title: Event System
    details: DOM CustomEvents (rf:retry / rf:fallback / rf:success / rf:error) and JS function hooks for monitoring and degraded UI.
---

<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin-top:24px">

[![npm](https://img.shields.io/npm/v/@resource-fallback/core)](https://www.npmjs.com/package/@resource-fallback/core)
[![vite-plugin](https://img.shields.io/npm/v/@resource-fallback/vite-plugin?label=vite-plugin)](https://www.npmjs.com/package/@resource-fallback/vite-plugin)
[![webpack-plugin](https://img.shields.io/npm/v/@resource-fallback/webpack-plugin?label=webpack-plugin)](https://www.npmjs.com/package/@resource-fallback/webpack-plugin)
[![CI](https://github.com/ben-lau/resource-fallback/actions/workflows/ci.yml/badge.svg)](https://github.com/ben-lau/resource-fallback/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/ben-lau/resource-fallback/graph/badge.svg)](https://codecov.io/gh/ben-lau/resource-fallback)

</div>
