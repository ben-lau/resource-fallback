# Service Worker 资源回退对比设计

## 结论摘要

Service Worker 能显著扩展资源回退的覆盖面，尤其适合 `img`、`video`、`@font-face` 字体文件、CSS `url()` 子资源和 CSS `@import` 这类 DOM Observer 不容易感知的请求。但 SW 不是当前 DOM Observer、Webpack adapter、Vite adapter 的严格超集。它解决的是 fetch 层请求兜底，不能完整替代页面侧对脚本执行语义、构建器运行时 Promise、SRI 标签属性和首次加载时机的处理。

推荐路线不是直接做 SW-first，而是采用分层方案：保留现有脚本和构建器 adapter 的 ownership，引入 Hybrid SW 补齐非脚本资源和 CSS 子资源；后续若需要同步 classic script 的强顺序保证，用 opt-in ScriptSequencer 在构建期和运行时串行编排，而不是把这个问题强行压给 SW。

## 当前实现状态

Hybrid SW 已实现为 opt-in 能力。Vite/Webpack 插件会生成资源 manifest、输出 SW asset，并把 manifest 预置到 SW 文件中，避免图片、背景图、字体等早期子资源在 SW 尚未收到页面 `postMessage` 配置时直接透传到主 CDN。

默认 SW path 跟随 scope 派生，避免把 `Service-Worker-Allowed` 响应头变成默认心智负担：`scope: '/'` 时输出 `/rf-sw.js`，`scope: '/app/'` 时输出 `/app/rf-sw.js`。只有用户显式把 `path` 配到 scope 目录之外时，才需要自行配置 `Service-Worker-Allowed`。

图片和 CSS 背景图常以 `no-cors` 发起，SW 可能只能看到 opaque response，无法读取真实 status。默认不会把 opaque response 当失败，以避免跳过本来可用的跨源图片；示例项目为了演示假 CDN 失败后的视觉 fallback，显式启用了 `serviceWorker.fallbackOnOpaque`。

## 当前事实基线

README 的 TODO 将 Service Worker 拦截模式、图片/字体资源支持、同步脚本执行顺序保证列为相关但独立的升级点。也就是说，SW 是扩展覆盖面的方向，但不是已经定义好的完整替代方案。

当前运行时由 `packages/core/src/runtime/entry.ts` 统一安装：

```ts
installObserver({ resolver, bus, log, sri: config.sri || 'strip' });
installWebpackAdapter({
  resolver,
  bus,
  log,
  chunkLoadingGlobals: config.webpackChunkLoadingGlobals,
});
installViteAdapter({ resolver, bus, log });
installSystemJSAdapter({ resolver, bus, log });
```

这些 adapter 共用 `Resolver`、retry、circuit breaker 和 hook bus，但处理的是不同层面的失败语义。

`packages/core/src/runtime/observer.ts` 负责捕获 `<script>` 和 `<link rel="stylesheet">` 的 `error` / `load` 事件，并原地替换为 retry 或 fallback URL。它明确不处理 `<img>`、`video`、字体文件和 CSS 内部 `url()` / `@import`。它还记录了同步 classic script 的限制：失败后再 `replaceChild` 无法让已经继续执行的后续脚本重新排序。

`packages/core/src/runtime/adapter-vite.ts` 负责 Vite 动态 `import()` 的 Promise 语义、module map 失败缓存的 cache busting，以及 `vite:preloadError` 的 `preventDefault()`。这些不是单纯 fetch 成功或失败能完整表达的行为。

`packages/core/src/runtime/adapter-webpack.ts` 和 `packages/webpack-plugin/src/index.ts` 负责 Webpack async chunk、`__webpack_require__.l`、`data-webpack` ownership，以及 CSS chunk promise 被 reject 后如何避免 `Promise.all` 提前短路。经验文档也强调了这些路径必须与 Observer 划分 ownership，避免同一次失败被两条状态机重复处理。

## 能力覆盖对比

### Script

classic script、module script、Webpack async chunk、Vite dynamic import 和 SystemJS 不能被简单视为同一种资源。

当前方案对入口 `<script>` 依赖 Observer，对 Webpack async chunk 依赖 Webpack adapter，对 Vite dynamic import 依赖 `__RF__.load()`，对 SystemJS 依赖 instantiate hook。它们不仅切换 URL，也处理 module cache、构建器 Promise、runtime loader 标记和事件上报。

SW 在已控制页面且 fetch 层能成功 fallback 时，可以让浏览器拿到成功脚本响应，然后按原本解析或 loader 语义继续执行。这对已受控页面是有价值的。但 SW 无法保证首次访问的早期脚本请求已经被控制，也无法修改原始 `<script integrity="...">` 上的 SRI 属性。一旦 SW 无法在 fetch 层修复，仍需要现有页面侧 adapter 处理失败 Promise、cache bust 和事件。

结论：SW 可以增强 script 成功率，但不应在第一阶段替代现有 script adapter。

### Style 和 CSS 子资源

当前 Observer 覆盖顶层 `<link rel="stylesheet">`，也能处理部分运行时注入的 CSS chunk `<link>`。它不能感知 CSS 文件内部的 `@import` 失败，也不能感知 `background-image: url(...)`、`@font-face src: url(...)` 等 CSS 子资源失败。

SW 天然适合补这个缺口。只要页面已被 SW 控制，这些 CSS 内部请求都会经过 fetch 事件，理论上可以按同一套规则做 retry 和 fallback。

顶层 stylesheet 是否交给 SW，需要谨慎。若 Observer 和 SW 同时处理同一个 `<link>` 请求，可能出现重复 retry、事件顺序混乱和熔断计数放大。第一阶段更稳妥的做法是让 SW own CSS 子资源和可选的 `style` destination，并明确 Observer 对顶层 stylesheet 的边界。

结论：CSS `url()`、`@font-face`、`@import` 是 SW 的高价值目标；顶层 stylesheet 需要 ownership 设计。

### Font

`@font-face` 的字体文件请求适合由 SW 做 fallback。它能补齐当前库无法覆盖字体资源的缺口。

前提是 fallback URL 必须满足浏览器对字体的要求：跨域字体通常需要正确的 CORS 响应头；MIME、CORP、缓存策略也要与浏览器安全模型一致。SW 不能把一个被浏览器安全策略拒绝的字体响应强行变成可用响应。

结论：实现 SW 后可以支持字体资源回退，但文档和测试必须明确 CORS/MIME 前提。

### Image 和 Media

`img`、`picture`、CSS image、`video`、`audio` 等资源通常没有脚本执行语义，也不涉及 Vite/Webpack runtime Promise。它们是 SW fallback 最适合优先覆盖的资源。

需要注意的是，很多跨域图片可能以 `no-cors` 模式请求，SW 看到的是 opaque response。opaque response 无法读取 status、headers 或 body。对于“DNS 失败、网络错误、连接失败”这类 fetch rejection，SW 可以可靠 fallback；对于 CDN 返回 404 但 response 是 opaque 的情况，SW 不一定能判断它是否应该 fallback。

结论：图片和媒体应作为 Hybrid SW MVP 的主要目标，但要把 opaque response 的判断限制写清楚。

### Fetch 和业务 API

SW 可以拦截页面发出的 `fetch()` 和 XHR 对应请求，但资源 fallback 不应默认接管业务 API。API 请求往往有认证、幂等性、跨域凭证、状态码语义和数据一致性要求，和静态资源 CDN fallback 不是同一问题。

如果未来支持 `fetch` destination，应作为显式 opt-in，并建议通过规则限定为静态资源路径，例如 `/assets/`、`.js`、`.css`、`.woff2`、`.png` 等。

结论：默认不把业务 API 纳入资源 fallback。

### Worker 和 SharedWorker

当前页面 runtime 依赖 `window`、`document`、DOM 事件和标签替换，因此不支持 Worker / SharedWorker 内部资源加载。引入 SW 不等于自动支持所有 Worker 场景。

SW 能拦截其 scope 下 client 发起的部分请求，但 Worker 自身的生命周期、importScripts、module worker、跨域脚本和 CSP 仍需要单独建模。

结论：Worker 支持应保持独立 TODO，不应混入 SW MVP 的成功标准。

## Service Worker 的边界

### SW 控制的是页面 client，不是 CDN origin

如果业务页面是 `https://app.example.com/`，SW 必须从 `app.example.com` 同源注册，并且只能控制其 scope 下的页面 client。页面请求 `https://cdn.example.com/assets/a.js` 时，受控页面的 SW 可以拦截这次请求并决定先 fetch CDN，失败后 fetch fallback。

但 SW 不能安装到 `cdn.example.com` 上，不能控制用户直接访问 CDN URL 的页面，也不能控制不在 scope 下的 iframe 或另一个 origin 的页面。

### 首次访问无法保证覆盖

SW 注册、安装、激活、接管页面是异步流程。第一次访问页面时，HTML 解析期间发出的早期 `<script>`、`<link>`、图片和字体请求可能已经开始或完成，尚未进入 SW 的 `fetch` 事件。

可以通过 `clients.claim()`、注册脚本前置、二次 reload 等方式改善，但不能让“第一次 HTML 解析开始前”就存在一个已经控制该页面的 SW。

这也是当前内联 runtime 和 Observer 仍有价值的原因：它们能在首个页面生命周期中处理部分 DOM 可感知资源失败。

### SW 不能修改 HTML 标签属性

当前 Observer 替换 `<script>` 或 `<link>` 时可以根据 `sri` 配置 strip 或保留 `integrity`。SW 只能返回不同响应，不能修改页面中原始标签上的 `integrity`、`nonce`、`crossorigin`、`referrerpolicy` 等属性。

如果原始标签带有 SRI，而 fallback CDN 的内容 hash 不一致，浏览器仍会拒绝该响应。即使 SW fetch fallback 成功，也可能在浏览器校验阶段失败。

### Opaque response 限制

对于 `no-cors` 请求，SW 得到的 response 可能是 opaque。opaque response 无法读取 `status`、`ok`、headers 和 body。

这意味着 SW 不能可靠区分“CDN 返回了可用图片”和“CDN 返回了 404 HTML 错误页但因 opaque 不可见”。SW 可以可靠处理 network error 和 fetch rejection，但对 opaque HTTP 错误的判断能力有限。

### 浏览器安全策略仍然生效

字体、脚本、样式和 worker 脚本仍受 CORS、MIME、CORP、COEP、CSP、SRI 等策略约束。SW 不是这些策略的绕过机制。

例如跨域字体 fallback 必须让 fallback 源站返回允许当前 origin 的 CORS header；module script fallback 也必须满足脚本 MIME 和 CORS 要求。

### 事件桥不是零成本

现有事件系统直接在页面上派发 `rf:retry`、`rf:fallback`、`rf:success`、`rf:error`。SW 不能直接调用 `window.dispatchEvent()`，只能通过 `client.postMessage()` 将事件送回页面，再由页面 runtime 转发为 DOM CustomEvent。

这会引入事件丢失、页面尚未监听、多个 client、事件顺序和调试复杂度等问题。事件桥需要作为核心设计，而不是实现细节。

## 方案候选

### 方案 A：现状增强

做法是继续扩展 DOM Observer，例如监听 `<img>`、`video`、`source` 等元素的 `error`，在 DOM 层替换 `src` 或 `srcset`。

优点是实现成本低，不引入 SW 生命周期和更新问题，也能沿用当前 hook bus、SRI 处理和 DOM 属性复制逻辑。

缺点是覆盖面仍然有限。它无法处理 CSS 内部 `@font-face`、CSS `url()`、CSS `@import`，也不适合任意 fetch 请求。对 responsive image、`srcset`、`picture/source` 的处理也会变复杂。

适用场景是只想低成本覆盖显式 DOM 元素，不追求 CSS 子资源和全资源请求。

### 方案 B：Hybrid SW

做法是新增 SW fetch 层，但保留现有 adapter ownership。第一阶段建议让 SW 负责 `image`、`font`、`media`、CSS 子资源和可选 `style`；现有 Observer、Webpack adapter、Vite adapter、SystemJS adapter 继续负责脚本、构建器运行时和顶层 DOM error。

优点是能补齐当前最明显的资源缺口，同时不打散已有处理过的脚本语义。它能覆盖 `img`、`@font-face`、CSS `url()`、CSS `@import` 等高价值目标，也能避免 SW 和页面 runtime 对同一个 Webpack/Vite 脚本失败重复 retry。

缺点是需要明确 ownership 和事件桥。它不是“一个 SW 解决全部问题”，而是分层协作。实现中还要处理 SW 文件产物、注册时机、scope、kill switch、旧 SW 更新和 Playwright E2E。

适用场景是本库当前最现实的下一步：扩大资源覆盖，同时保持已有 Webpack/Vite 能力稳定。

### 方案 C：SW-first

做法是启用后尽量让 SW 接管 `script`、`style`、`image`、`font`、`media` 和可选 `fetch`，页面 runtime 主要负责注册、事件桥和极少量兜底。

优点是架构表面更统一，网络请求层的覆盖面最大。对已被 SW 控制的页面，如果 fetch 层能完成 fallback，浏览器可按原有解析顺序执行脚本或应用样式。

缺点是它不是当前能力的严格超集。首次访问、SRI 标签属性、opaque response、Vite dynamic import rejection、Webpack CSS chunk promise、module cache、CSS loader promise 和事件桥仍然需要页面侧逻辑处理。若强行关闭现有 adapter，会在部分边界场景退化。

适用场景是做长期研究或特定业务环境的强约束方案，例如确定所有资源同源代理、无 SRI 冲突、CORS/MIME 可控、可接受首次访问二次 reload。

### 方案 D：完整分层方案

做法是把能力拆成四层：

1. 构建期生成资源 manifest，明确资源类型、原始 URL、fallback URL、SRI 策略和 ownership。
2. 页面 runtime 负责注册 SW、kill switch、事件桥、现有 adapter 和首屏兜底。
3. SW 负责 fetch 层 retry/fallback，优先处理非脚本资源和 CSS 子资源。
4. ScriptSequencer 作为 opt-in 能力，解决同步 classic script 的强顺序保证。

这个方案比单独 Hybrid SW 更完整。它承认 SW 的价值，也承认页面侧语义不可完全移除。manifest 能减少 SW 里靠 URL 后缀猜资源类型的脆弱性，也能为后续 per-resource 策略、调试面板和性能指标打基础。

缺点是实现周期最长，需要设计新的构建产物和兼容策略。它适合作为 Hybrid SW MVP 后的演进方向，而不是第一阶段一次性完成。

## 成本与风险评估

### 现状增强

改动范围主要在 `packages/core/src/runtime/observer.ts`、`types.ts`、`tests/observer.test.ts` 和文档。测试以 Vitest 为主，少量 Playwright 验证真实图片加载即可。

发布风险低，但收益也有限。最大风险是 DOM 属性处理变复杂，例如 `srcset`、`picture/source`、媒体子资源和跨域图片错误事件差异。

### Hybrid SW

改动范围包括 core 新增 SW 入口、SW 侧 resolver 复用或轻量状态机、页面侧注册 adapter、构建标签或插件产物输出、事件桥、examples 和 Playwright E2E。

测试复杂度中高。Vitest 可覆盖纯 resolver 决策、配置序列化和注册逻辑；真实 SW 生命周期、字体、CSS `url()`、`@import`、opaque response 必须用 Playwright 或浏览器集成测试。

发布风险中等。只要默认关闭或明确 opt-in，就不会改变现有用户行为。主要风险是 SW 更新和旧配置滞留，以及与现有 Observer/adapter 的 ownership 不清导致重复 retry。

### SW-first

改动范围最大，几乎会影响 core runtime、SW bundle、Vite/Webpack 插件、examples、E2E 和文档。还需要重新定义现有 adapter 在 SW 模式下是否启用、如何让位、如何事件桥接。

测试复杂度最高。除了 Hybrid 的所有测试，还必须覆盖 script、style、dynamic import、Webpack async chunk、CSS chunk promise、SRI、首次加载、SW 更新、kill switch 和降级策略。

发布风险高。即使 opt-in，也容易让用户误以为 SW 可以替代所有场景。一旦默认启用，会引入难以排查的 SW 缓存和生命周期问题。

### 完整分层方案

改动范围最大但方向最稳。manifest 会增加构建器插件复杂度，但能降低 SW 运行时猜测成本。ScriptSequencer 又是独立子系统，需额外设计构建期 HTML 改写和运行时串行加载。

风险主要是范围过大。建议拆成 Hybrid SW MVP、manifest 增强、ScriptSequencer 三个可独立验证的阶段。

## 推荐路线

第一阶段先不要实现 SW 代码，而是用本文档和 spike 验证关键假设。只有确认字体 CORS、opaque response、SRI、首次加载和构建器语义边界后，再进入实现计划。

第二阶段实现 Hybrid SW MVP。默认 opt-in，目标只包含非脚本资源和明确 ownership 的 CSS 子资源：`image`、`font`、`media`、CSS `url()`、CSS `@import`。现有 script、Vite dynamic import、Webpack async chunk、SystemJS 继续由现有 adapter 负责。

第三阶段补 manifest。让 Vite/Webpack 插件输出资源类型与 URL 映射，SW 根据 manifest 决策，而不是仅靠 `request.destination` 和文件后缀猜测。manifest 也可记录哪些资源由页面 adapter owning，避免重复处理。

第四阶段评估是否扩大 SW ownership 到顶层 `style`。只有在测试证明不会与 Observer 重复 retry、不会破坏 Webpack CSS chunk promise 处理时再启用。

第五阶段如果业务确实需要同步 classic script 强顺序，单独实现 ScriptSequencer。它应是 opt-in：构建期将阻塞 `<script src>` 改写为 `data-rf-src` 队列，运行时按 DOM 顺序串行加载，当前脚本成功后才加载下一个。这个方案直接解决顺序问题，不依赖 SW 是否已经控制页面。

## 验证 Spike 清单

在进入实现前，应先做以下最小验证：

1. 首次访问控制验证：构建一个最小页面，注册 SW，并记录首屏 `<script>`、`<link>`、`img`、font 请求是否进入 `fetch` 事件。分别测试首次访问、刷新、关闭重开、`clients.claim()` 和 `skipWaiting()`。
2. Opaque image 验证：跨域图片使用 `no-cors` 请求，分别让 CDN 返回正常图片、404、DNS 失败，观察 SW 是否能区分并 fallback。
3. 字体验证：用 `@font-face` 请求跨域 `.woff2`，分别配置有无 CORS header 的 fallback 源，确认可用条件。
4. SRI 验证：给 script/style 添加 `integrity`，让 SW fallback 到内容一致和内容不一致的 URL，确认浏览器校验结果。
5. Vite dynamic import 验证：在 SW 成功 fallback 和 SW giveup 两种情况下，观察 `import()` Promise、module map cache 和当前 `__RF__.load()` cache bust 的必要性。
6. Webpack CSS chunk 验证：构建带独立 CSS chunk 的 async component，确认即使 SW 处理 fetch，页面侧 CSS chunk promise 兜底是否仍需要保留。
7. 事件桥验证：SW 连续发生 retry、fallback、success、error 时，通过 `postMessage` 到页面再转发 `rf:*`，确认事件顺序、丢失情况和多个 tab 的行为。
8. Kill switch 验证：`window.__RF_DISABLE__`、query、cookie 禁用页面 runtime 时，SW 是否也停止处理或切换到 pass-through。

## 同步脚本执行顺序

SW 对同步 classic script 有帮助，但不是完整答案。

在已被 SW 控制的页面里，如果某个阻塞 classic script 的主 CDN 请求失败，SW 在 fetch 层成功 fallback 后，浏览器收到的是一个成功响应。此时脚本仍处在原始 HTML 解析流程里，后续阻塞脚本会等待当前脚本完成。这比 Observer 的事后 `replaceChild` 更接近原始顺序。

但以下情况 SW 不能保证顺序：

- ƒ首次访问时该 script 请求没有进入 SW。
- 所有候选 URL 都失败，浏览器继续触发 script error，HTML 解析仍可能继续。
- SRI、MIME、CORS、CSP 等校验在 fetch 成功后仍失败。
- 页面侧后续脚本已经因其他原因执行，SW 无法回滚副作用。

因此，同步脚本强顺序保证不应作为 SW MVP 的目标。更可靠的方案是 ScriptSequencer：构建期接管阻塞 classic script 的加载顺序，运行时串行加载并等待每个脚本完成 retry/fallback 后再继续下一个。它可以与 SW 共存，但属于独立能力。

## 决策建议

短期建议采用 Hybrid SW，而不是 SW-first。

原因不是为了降低工作量，而是因为 SW-first 无法跨越首次控制、SRI 标签属性、opaque response、浏览器安全策略和构建器运行时语义这些平台边界。保留现有 adapter 能保护已经解决过的脚本和构建器问题，让 SW 专注于它最擅长的资源请求层。

中期建议演进为完整分层方案：manifest 提供精确资源信息，SW 扩展资源覆盖，页面 runtime 保留脚本语义与事件桥，ScriptSequencer 解决同步 classic script 顺序。这样比单纯按 TODO 逐项实现更完整，也更符合这个库“零心智负担但语义明确”的目标。
