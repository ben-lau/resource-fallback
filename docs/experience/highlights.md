---
title: 工程亮点
---

# 一、本工程亮点（与其它路线相比差异在哪）

1. **同源决策引擎**：`Resolver`（规则匹配 → 重试 / 换链 / 放弃）、`CircuitBreaker`、`Retry/backoff` 在 **Webpack、Vite、DOM Observer、SystemJS legacy** 多条入口下复用同一套语义，避免「Webpack 一套脚本、Vite 再拷一份分叉」的长期腐烂。

2. **覆盖「自有构建产物」全链路**：不仅入口 `<script>/<link>`，还针对 **Webpack chunk loader（`__webpack_require__.l` + `__webpack_require__.f` 中非 JS 的 CSS chunk loader）**、**Vite 产物内动态 `import()`**（`writeBundle` 后 `es-module-lexer` + `MagicString` 改写 + `__RF__.load`）、**`vite:preloadError` 与异步 CSS / JS 顺序**、**mini-css-extract 等注入的样式 chunk** 等与 **构建器强耦合**的路径；这与「只做第三方库 CDN 切换」类插件边界不同。

3. **对齐浏览器怪异行为**：`type="module"` / 动态 `import()` 的失败 **URL 缓存**、`<script>` 不能用 `cloneNode` 投机取巧替换、`getAttribute('src')` 与 `.src` 对「规则前缀 `/` vs 绝对 URL」的影响等，均在运行时 **显式处理**（如 `__rf=` cache bust、strip 时机），减少业务侧试错成本。

4. **职责划界以减少重复工作与竞态**：例如 Webpack **`data-webpack` 的 `<script>` 归 adapter、Observer 放行；同属性的 `<link>` 仍归 Observer**，避免异步 JS 与白屏链路被处理两次。

5. **可观测性与运维开关**：CustomEvent（`rf:retry` / `rf:fallback` / `rf:success` / `rf:error`）粒度足够排障对接监控；Kill switch、熔断跨 Tab（`localStorage`）等与「仅能发版改路径」的路线互补。

---

上一篇：[开发与落地经验](./index.md) · 下一篇：[技术难点](./challenges.md)
