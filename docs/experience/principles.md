---
title: 可复用原则
---

# 五、经验总结（可带走的原则）

1. **多套加载机制共存时先划 ownership**（Webpack script / Observer / SW / SystemJS）；再写 retry，否则请求量按乘积涨。
2. **ESM 失败是可缓存状态**：必须以 **URL 变化策略**显性打破，而不是仅靠「换一种 DOM API」。
3. **Vite 改动态 import 宁晚勿早**：`writeBundle` 后改写 + **`es-module-lexer` + `MagicString`**，保住 **`__vitePreload` / `__vite__mapDeps` / 异步 CSS** 拓扑；避免 **`experimental.renderBuiltUrl`/`renderDynamicImport` 破坏分析**。
4. **Vite：`vite:preloadError` 必须 `preventDefault()`，载荷读 `payload`**，否则 **CSS 预加载失败会 throw，阻断后续 `__RF__.load()`**。
5. **`base` 与 `match`不一致时别开构建闸门**：用 **`shouldRewriteUrls`** 一刀切掉「误入 CDN URL 拼装」的工程事故。
6. **不要用 `cloneNode` 换新 script src**；新建元素 + **属性白名单 + SRI 策略**。
7. **`getAttribute(src)`维系与配置前缀的一致性**，避免 **`/` vs 绝对 URL** 玄学。
8. **CDN 前缀与文件名拼接用 `joinAssetPrefix`**，避免 **`prod` + `js/x.js` → `prodjs`**。
9. **Webpack：CSS chunk 除 Observer 外，须在 RuntimeModule 抑制 CSS 类 loader 的 reject**，否则 **`import()` 仍失败**；遍历 **`__webpack_require__.f` 中非 `j`**，不限死 **`miniCss`** 键名。
10. **SystemJS 与 Observer必须登记 URL 互斥**。
11. **Resolver `isFallback` 才允许 urls-prefix 命中**，避免误判；**熔断与首轮 match语义**拆开；**duplicate match 后来者胜**。
12. **`rf:error` ≠ 一定走了回退**：展示与告警要拆开 **no-match**。
13. **SW 默认路径必须与 scope 对齐**：默认 `scope: '/'` 就输出 `/rf-sw.js`，不要把 `Service-Worker-Allowed` 变成默认部署负担。
14. **SW 配置不要只靠页面 `postMessage`**：早期图片/字体/CSS 子资源可能先于消息发生，构建期应把 manifest 预置进 SW 文件。
15. **opaque response 是策略问题，不是实现细节**：默认保守不当失败；若要演示或业务确认“跨源 opaque 错误也继续回源”，用显式 `fallbackOnOpaque`。
16. **SW 本地调试必须看 origin**：`localhost`、`127.0.0.1`、局域网 IP 是不同 origin；局域网 IP 的 HTTP 不是 secure context，SW 不会注册。
17. **验证视觉资源要验真实加载**：图片看 `naturalWidth`，字体看 `document.fonts.check()`，背景图结合 Network/SW 事件；`toBeVisible()` 只能证明 DOM 存在。
18. **SW preload 里有 `RegExp` 就不能裸 `JSON.stringify`**：否则规则会变 `{}`，manifest 看似存在但 fetch 永远匹配不上。
19. **SW 事件要按 `clientId` 定向**：同一个 SW 控制多个 tab 时，广播会污染观测和业务 hook。
20. **SW 的最终失败应返回 `Response.error()`**：补发 `rf:error` 但不伪造内容响应，让资源语义仍像真实 network error。
21. **SW 内 circuit 不应共享页面 `localStorage`**：SW 是跨客户端上下文，页面侧跨 tab 熔断状态不应反向污染 SW fetch 决策。
22. **要全集拦截与任意资源**：倾向 **SW**；要 **Webpack+Vite+cross-browser 一致运行时语义**：插件 + **`__RF__` + Observer**更合适。

---

上一篇：[问题案例](./case-studies.md) · 返回：[开发与落地经验](./index.md)
