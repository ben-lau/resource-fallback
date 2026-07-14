---
title: 开发与落地经验
---

# resource-fallback 开发与落地经验文档

面向 **维护者与二次集成方**：提炼本工程的 **亮点、难点、与其它开源路线的对比**，并按「遇到过的问题」整理 **背景 → 思考过程 → 解决方案（尽量落到机制与代码路径）**；文末收束为可复用的 **经验条目**。

> 下文若提及第三方包名，仅作能力与边界对照；具体 API 以实现时的 npm/GitHub 为准。

---

## 章节导航

### [工程亮点](./highlights.md)

与其它路线相比的差异：同源决策引擎、覆盖自有构建产物全链路、对齐浏览器怪异行为、职责划界、可观测性与运维开关。

### [技术难点](./challenges.md)

为什么不是「加个 onerror」级别：语义、Vite、Webpack、ESM、配置与现实、Legacy 等维度的难点说明。

### [开源方案对比](./comparison.md)

与 webpack-retry-chunk-load-plugin、vite-plugin-cdn-import、webpack-fallback-directory-resolver-plugin、Service Worker 路线、纯运维方案的优缺点对比。

### [问题案例](./case-studies.md)

本仓库内解决过的问题（背景 → 思考过程 → 解决方案），共 10 个案例：Webpack 双处理、Vite 动态 import、ESM 缓存、Vite base / rule base 闸门、cloneNode、URL 匹配、SystemJS、Resolver 语义、观测事件、Hybrid SW。

### [可复用原则](./principles.md)

经验总结：22 条可带走的原则，涵盖 ownership、ESM、Vite、Webpack、SystemJS、SW 等。

---

### 已知未在库内闭环（诚实记录）

- **Vue runtime `nextSibling` 为 null**（Observer `replaceChild` 与 Vue patch 链表竞态）：有现场栈，需个案上 **减少对框架控制边界的 DOM 强拆**或 **业务兜底刷新**。
- **Vite dev 动态 import**：**刻意不写**产物改写；完整验证请以 **preview / production** 为准。

---

### 社区常见「替代实现」里容易重复踩的坑（对照）

以下多为「只读产物字符串」类方案的经验，与本仓库当前实现对照即可，不必逐条点名具体仓库：

1. **`renderChunk` / `renderDynamicImport` 过早改写**：在未定型 **`__vite__mapDeps` / `__vitePreload`** 前替换 `import()`，易导致 **异步组件 CSS 整块丢失**；**`experimental.renderBuiltUrl` 对 `hostType === 'js'` 返回 runtime** 也可能阻断了 **mapDeps** 生成——症状同样是 **懒加载无样式**。
2. **硬编码 `__vitePreload` 源码**：minify 后变量名变化、边界括号扫描 fragile；维护成本高。
3. **仅用正则扫 `import(`**：注释/字符串里的假命中、嵌套括号易误伤；应用 **`es-module-lexer` + `MagicString`**（见 §4.2）定点替换整条语句更稳。
4. **运行时 `cloneNode(true)` 换 `<script src>`**：见 §4.5。
5. **Webpack：只包 DOM、不包 `__webpack_require__.f` 里的 CSS promise**：见 §4.1 延伸。

---

_文档描述与源码一致；若后续实现变更，请以对应版本源码与根 README TODO 为准。_

---

下一篇：[工程亮点](./highlights.md)
