---
title: 工程亮点
---

# 一、本工程亮点（与其它路线相比差异在哪）

1. **分层决策引擎**：页面侧由 `RecoveryCoordinator` 统一 Webpack、Vite、DOM Observer、SystemJS 的恢复决策，并用 ownership / in-flight registry 约束谁能接管同一个 `logicalKey`；Service Worker 保留独立的 legacy `Resolver` 做 fetch 层子资源回退。这样共享页面侧语义的同时，不把 SW 的 worker 约束混进页面 adapter。

2. **覆盖「自有构建产物」全链路**：不仅入口 `<script>/<link>`，还针对 **Webpack chunk loader（`__webpack_require__.l` + `__webpack_require__.f` 中非 JS 的 CSS chunk loader）**、**Vite 产物内动态 `import()`**（当前实现为 `writeBundle` 后 `es-module-lexer` + `MagicString` 改写到 `__RF__.load`）、**`vite:preloadError` 与异步 CSS / JS 顺序**、**mini-css-extract 等注入的样式 chunk** 等与 **构建器强耦合**的路径；这与「只做第三方库 CDN 切换」类插件边界不同。

3. **对齐浏览器怪异行为**：`type="module"` / 动态 `import()` 的失败 **URL 缓存**、`<script>` 不能用 `cloneNode` 投机取巧替换、`getAttribute('src')` 与 `.src` 对「规则前缀 `/` vs 绝对 URL」的影响等，均在运行时 **显式处理**（如 `__rf=` cache bust、strip 时机），减少业务侧试错成本。

4. **职责划界以减少重复工作与竞态**：例如 Webpack **`data-webpack` 的 `<script>` 归 adapter、Observer 放行；同属性的 `<link>` 仍归 Observer**。页面侧先由 ownership registry 认领 owner，再由 `RecoveryCoordinator` 让同 owner 的并发请求共享一个 in-flight recovery Promise，避免异步 JS 与白屏链路被处理两次。

5. **可观测性与运维开关**：CustomEvent（`rf:retry` / `rf:fallback` / `rf:success` / `rf:error`）粒度足够排障对接监控；判断页面是否真正进入回退链，应优先看 `rf:retry` / `rf:fallback`，而不是依赖旧 `Resolver` 的 reason 字符串。Kill switch、熔断跨 Tab（`localStorage`）等与「仅能发版改路径」的路线互补。

---

上一篇：[开发与落地经验](./index.md) · 下一篇：[技术难点](./challenges.md)
