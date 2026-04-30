# resource-fallback 开发与落地经验文档

面向 **维护者与二次集成方**：提炼本工程的 **亮点、难点、与其它开源路线的对比**，并按「遇到过的问题」整理 **背景 → 思考过程 → 解决方案（尽量落到机制与代码路径）**；文末收束为可复用的 **经验条目**。

> 下文若提及第三方包名，仅作能力与边界对照；具体 API 以实现时的 npm/GitHub 为准。

---

## 一、本工程亮点（与其它路线相比差异在哪）

1. **同源决策引擎**：`Resolver`（规则匹配 → 重试 / 换链 / 放弃）、`CircuitBreaker`、`Retry/backoff` 在 **Webpack、Vite、DOM Observer、SystemJS legacy** 多条入口下复用同一套语义，避免「Webpack 一套脚本、Vite 再拷一份分叉」的长期腐烂。

2. **覆盖「自有构建产物」全链路**：不仅入口 `<script>/<link>`，还针对 **Webpack chunk loader（`__webpack_require__.l` + `__webpack_require__.f` 中非 JS 的 CSS chunk loader）**、**Vite 产物内动态 `import()`**（`writeBundle` 后 `es-module-lexer` + `MagicString` 改写 + `__RF__.load`）、**`vite:preloadError` 与异步 CSS / JS 顺序**、**mini-css-extract 等注入的样式 chunk** 等与 **构建器强耦合**的路径；这与「只做第三方库 CDN 切换」类插件边界不同。

3. **对齐浏览器怪异行为**：`type="module"` / 动态 `import()` 的失败 **URL 缓存**、`<script>` 不能用 `cloneNode` 投机取巧替换、`getAttribute('src')` 与 `.src` 对「规则前缀 `/` vs 绝对 URL」的影响等，均在运行时 **显式处理**（如 `__rf=` cache bust、strip 时机），减少业务侧试错成本。

4. **职责划界以减少重复工作与竞态**：例如 Webpack **`data-webpack` 的 `<script>` 归 adapter、Observer 放行；同属性的 `<link>` 仍归 Observer**，避免异步 JS 与白屏链路被处理两次。

5. **可观测性与运维开关**：CustomEvent（`rf:retry` / `rf:fallback` / `rf:success` / `rf:error`）粒度足够排障对接监控；Kill switch、熔断跨 Tab（`localStorage`）等与「仅能发版改路径」的路线互补。

---

## 二、本工程难点（为什么不是「加个 onerror」级别）

| 维度 | 难点说明 |
| --- | --- |
| **语义** | 需同时满足：**先走初始 URL**、熔断主要约束 **备选 host**、**未 match 的资源不得误改语义**（仍会 `giveup`，但不同于进入回退链）。 |
| **Vite** | 动态 import 若在 **过早** 钩子改坏产物，会破坏 **`__vitePreload`/`__vite__mapDeps`** 与异步组件 **CSS**；必须在 **bundle 已定稿**后再做字面量动态 import 的定点替换。 |
| **Webpack** | 全局 `error` 与 **`__webpack_require__.l`** 注入脚本 **同一次失败可被两条链路看见**，不靠 DOM 标记切分则会 **双倍重试**；另：**异步 CSS chunk**（`mini-css-extract-plugin`、`experiments.css` 等写入 `__webpack_require__.f` 的非 `j` loader）失败时会 **reject promise**，若仅依赖 Observer 换 `<link>`，**`Promise.all` 仍会短路**，表现为 **JS 已回退成功但懒加载仍抛 ChunkLoadError**。 |
| **ESM** | 失败 module record 缓存导致「看似在回退、网络不涨」的假实现；必须与 **同一 URL + query** 的策略一致才能在各入口复现可控。 |
| **配置与现实** | `base`/`publicPath` 与规则的 `match` **不一致时**，若在 Node 侧对「任意 chunk 文件名」误判匹配，会把 **本应同源的异步 chunk** 整块改到外域——属于 **产品与工程双误判**，需 **`shouldRewriteUrls` 一类闸门**。 |
| **Legacy** | SystemJS 与 Observer 若不 **互斥登记 URL**，易产生 **双重回退** 或遗漏。 |

---

## 三、与其它开源方案的对比（优缺点）

说明：同类需求在社区往往被拆成 **「只服务于 Webpack」「只服务于把依赖换 CDN」「只在 SW 层统一拦请求」**。本仓库选择 **插件 + 小运行时**，与下列路线各有所长。

### 3.1 对比 [webpack-retry-chunk-load-plugin](https://www.npmjs.com/package/webpack-retry-chunk-load-plugin) 一类

|  | webpack-retry-chunk-load-plugin（典型） | resource-fallback（本仓库） |
| --- | --- | --- |
| **优点** | 聚焦 Webpack async chunk；社区久、切入点清晰。 | Webpack **之外**还提供 **Vite**；并统一 **熔断、多前缀 URLs、Kill switch、DOM CSS chunk** 等。 |
| **缺点**（相对本库目标） | 不天然覆盖 **Vite**、**纯 `<script>/<link>` 安全网**、**SystemJS legacy** 与同构 **resolver 语义**。 | 维护与适配面更广；需在 Webpack **与 Observer 之间避免双处理**。 |

### 3.2 对比 [vite-plugin-cdn-import](https://www.npmjs.com/package/vite-plugin-cdn-import)、[vite-plugin-cdn2](https://www.npmjs.com/package/vite-plugin-cdn2) 一类

|  | 典型 CDN-import 插件 | resource-fallback（本仓库） |
| --- | --- | --- |
| **优点** | 把 **React/Vue 等依赖** 指到 CDN，减包体、加速构建。 | 面向 **自家构建出来的 assets** 在 **运行时失败** 时的 **重试与多源回退**（含回源），与「构建时把依赖换 URL」正交。 |
| **缺点**（相对本库目标） | 多为 **静态 URL 策略**，对 **主 CDN 挂掉后按规则链切换** 不是同一问题域。 | 不替代「把业务依赖外置到 CDN」；若仅要外置依赖，应用专用 CDN 插件更简单。 |

### 3.3 对比 [webpack-fallback-directory-resolver-plugin](https://www.npmjs.com/package/webpack-fallback-directory-resolver-plugin) 一类

|  | Resolver 级「目录回退」 | resource-fallback（本仓库） |
| --- | --- | --- |
| **优点** | 在 **模块解析** 阶段解决「找不到文件」类问题。 | 解决 **已在浏览器里发起的 URL 加载失败**（网络/CDN/跨域等），与 **构建期 resolve** 层问题不同。 |
| **缺点**（相对运行时回退） | **无法**等价替代「线上 chunk URL 失效后的重试换源」。 | 构建期不参与「找不到源码」的回退逻辑。 |

### 3.4 对比基于 Service Worker（如结合 Workbox 自写路由）的路线

|  | Service Worker 拦截 fetch | resource-fallback（本仓库） |
| --- | --- | --- |
| **优点** | 可对 **更广泛资源类型** 做策略（字体、图片、子资源 fetch）；控制面极大。 | **无 SW 注册/更新/兼容性负担**；与 **Webpack/Vite 插件**对齐，上手路径接近常规 SPA deploy。 |
| **缺点** | 生命周期、HTTPS、同源策略、`fetch` **与 `<script>` 失败**关系需仔细建模；运维与排障更重。 | **不拦截**任意 fetch；覆盖面以 **脚本/样式加载与构建链能触达的路径**为主（README TODO 里也承认图片等缺口）。 |

### 3.5 对比纯运维（换 publicPath、DNS、多云调度）

|  | 运维侧切换 | resource-fallback（本仓库） |
| --- | --- | --- |
| **优点** | 全站一致、对用户「无补丁」体感。 | **单次页面生命周期内**对已下发 HTML/asset URL 仍可 **多级重试换源**，不依赖立刻发版。 |
| **缺点** | **已缓存的入口页**仍可能指向坏域；Regional 抖动时体验粗。 | **在客户端多跑逻辑**；需在团队内接受运行时脚本与语义边界。 |

**小结**：本工程的长处在于 **多端构建适配 + 统一运行时状态机 + 与浏览器/webpack/vite 特例对齐**；短处是 **非 SW**，对 **任意网络请求**不具备天然全集能力，**Vite dev 动态 import** 等也存在刻意未覆盖的范围。

---

## 四、本仓库内解决过的问题（背景 → 思考过程 → 解决方案）

### 4.1 Webpack：全局 Observer 与 chunk runtime 同时对同一失败做文章

#### 背景

Webpack 5 异步 chunk 由 runtime 调用类似 `__webpack_require__.l` 的流程往 DOM 里挂 `<script>`。为了覆盖 **入口脚本**、**异步 JS**、**CSS chunk**，工程里同时使用：

- 浏览器侧：**`window.addEventListener('error', …, true)`** 捕获 `script`/`link` 的目标阶段错误；
- Webpack 侧：在 **脚本加载路径**里注入重试/fallback。

于是 **同一次脚本加载失败** 会冒泡：runtime 可能已经根据 `script.onerror` 决定重试一次，捕获阶段 Listener 又一遍 `resolver.resolve` → scheduleReplace，等价于 **两条独立的状态机**。Network 上出现：主 CDN、备 CDN 各自被请求的轮数大约是「单链路 × 2」，与你在配置里填的 `retry.max`、`urls.length` **心算对不上**，熔断与日志也会「看起来特别吵」。

另外，Webpack 会给 **异步 chunk** 的 `<script>` 打上 **`data-webpack="..."`**。但 **extract 出来的样式** 常以 **`<link data-webpack="...">`** 形式出现；Webpack 自带的 chunk JS 加载器 **并不等同地处理 `<link>` 的失败链**——若_observer 整块退出，CSS chunk 又没人管。

#### 思考过程

首先确认 **是不是双订阅**：临时关掉一端，请求轮数是否减半。  
接着明确 **划界粒度不能是「有 data-webpack 就全不干」**：那样会放空 CSS。

结论应是：**同一种「已由 Webpack loader 管线明确 owning」的失败只走一条路径**；**CSS** 由于没有对称的 runtime adapter，必须由 **仍能看见 `<link>` error 的那一途**接管。

#### 解决方案（如何实现）

在 `packages/core/src/runtime/observer.ts` 内：

1. **`isWebpackChunkScript(el)`**：当 `tagName === 'SCRIPT'` 且存在 **`data-webpack`** 属性时，**直接 `return`**，不进入 resolver。这样 **异步 JS chunk** 只由 **`@resource-fallback/webpack-plugin` 注入的 runtime 模块**包装 `__webpack_require__.l`（或等价）处理。

2. **不对 `<link>` 做同样豁免**：即使有 `data-webpack`，**LINK 元素仍落入 Observer**。注释中写清：**mini-css-extract-plugin 的产物**要靠 Observer 兜底。

3. **入口 bundle**通常 **没有** `data-webpack`，仍可由 Observer 兜底（与异步 chunk 的 owning 区分开）。

实施后预期：**单次失败只驱动一条 retry/fallback 序列**；Webpack 控制台与 rf 事件对齐后，可对「每个 chunk 的失败次数上限」心里有数。

#### 延伸：异步 CSS chunk — Observer 不够，还须拦住 **`Promise.all` 里的 reject**

**背景**：`mini-css-extract-plugin`、webpack **`experiments.css`** 等会在运行时往 **`__webpack_require__.f`** 上挂 **除 `j`（JS）以外的 loader**（典型键名如 **`miniCss`**）。异步分包若带独立 **`.css` chunk**，`__webpack_require__.e(chunkId)` 实质是 **`Promise.all`** 收集 **`l.f.j`** 与各 CSS loader 推入的 promise。**CSS `<link>` 加载失败**时，插件生成的 **`onerror` 会直接 `reject(ChunkLoadError)`**（常见 **`code: 'CSS_CHUNK_LOAD_FAILED'`**，且 **`request`** 指向含 `.css` 的 URL）。

与此同时，Observer 仍可在 **`window` capture** 阶段 **替换 `<link>`** 并重试/fallback——**DOM 上样式最终可能修好**，但 **reject 已发生**，**整条 `import()` 仍失败**，React/Vue 懒路由表现为 **ErrorBoundary / 白屏**。这与 Vite 侧 **`vite:preloadError` 未 `preventDefault` 阻断后续执行**是同一类「**错误通道先于补救通道短路**」问题。

**并非仅限 mini-css**：任意往 **`__webpack_require__.f`** 注册的 **非 `j`** loader，只要失败形态满足「**reject + URL 像样式 chunk**」，都应走同一策略；**纯 style-loader 注入**（无独立 CSS chunk URL）则不在此列。

**解决**：在 **`@resource-fallback/webpack-plugin`** 注入的 **`RuntimeModule`**（与包装 **`__webpack_require__.l`** 同一段、**STAGE_TRIGGER** 保证晚于各 loader 注册）中：**遍历 `Object.keys(__webpack_require__.f)`，跳过 `"j"`**，对每个 **`typeof === 'function'`** 且未打 **`__rf_css`** 标记的 loader **包一层**：在 **`origFn(chunkId, promises)` 调用之后**，对 **`promises` 本次新增的条目**附加 **`.catch(err => { … })`**：
- 若 **`err.code === 'CSS_CHUNK_LOAD_FAILED'`** 或 **`err.request` 匹配「路径以 `.css` 结尾（可跟 query/hash）」**：**`resolver.recordFailure(err.request)`**（尽力而为），然后 **吞掉 reject**（resolved continuation），使 **`Promise.all` 不因 CSS 首屏失败而失败**；
- 其它错误 **原样 `throw`**，避免误伤 Module Federation **`remote`** 等非 CSS loader。

**CSS 实体加载**：仍依赖 §4.1 中 **Observer 对 `<link>`** 的处理（与 **`<script data-webpack>` 豁免** 分工不变）。集成验证可参考 **`examples/webpack-react`** 中带 **`lazy-b.css`** 的 Lazy B：构建后出现独立 **`*.css` chunk**，在 **`publicPath` 指向不可达 CDN** 时，**若无上述 RuntimeModule 补丁**，E2E 会出现 **`lazy-b-loaded` 永不挂载**。

---

### 4.2 Vite：`import()` 失败无法单靠 DOM 替换兜底；改产物过早会破坏 preload/CSS 拓扑

#### 背景

Vue/React Router 懒加载在打包结果里多半是：

```js
import('./views/About-xxxx.js')
```

失败后，错误路径主要来自 **运行时 `import()` 的 Promise**，**不一定**与「某一个你能替换的静态 `<script src>`」一一对应。若只依赖 Observer 监听 **后来插入的标签**，会出现：

- 白屏：**动态 import rejection** 没被转化成「换 URL 再请求」；
- 或更隐蔽：**异步路由组件的 CSS** 依赖 Vite 生成的 **`__vitePreload` / import 图谱**——若在 Rollup/Vite **尚未生成完毕依赖关系**前就改写源码，很容易导致 **preload 映射与真实 import 不一致**，表现为 **进到页面了但没样式**，或 hydration 边界异常。

早期若尝试仅用 `renderDynamicImport` 等钩子，常与 **preload 代码生成顺序**打架。

#### 思考过程

- **手工方案**（每个 `lazy` 外包 try/catch、业务里手写换 URL）：无法覆盖将来新增的懒加载入口，也不可维护。
- **纯 HTML/onerror**：只覆盖静态入口 `<script>`，**盖不住 `import()` 图**。
- **钩子时序**：改写动态 import 的 **最晚安全点**应当是「Vite 写完磁盘上的 chunk，`dynamicImports`、`__vitePreload`、CSS 侧的引用均已定型」——即 **bundle 已落地之后**再做 **文本级、可审计的替换**。

#### 解决方案（如何实现）

插件实现见 `packages/vite-plugin/src/index.ts`：

1. **不在 **过早** transform 阶段**去动含 `__vitePreload` 的整个块；改为注册 **`async writeBundle(options, bundle)`**。

2. 对每个 **Rollup chunk**：
   - 若无 `dynamicImports`，跳过；
   - 否则读 **`join(outDir, chunk.fileName)`** 的 **最终源码**；

3. 使用 **`es-module-lexer`** 的 `parse(code)`：
   - 仅处理 **`imp.d >= 0`** 的条目（动态 import，`imp.d === -1` 为静态 import）；
   - **`imp.n`** 必须为 **字符串字面量**（非变量形式的 `import(x)` 本策略不改写）；
   - 将 `./About-xxx.js` 相对于 **当前 chunk 目录**规范化，并校验该路径落在 **`chunk.dynamicImports`** 集合里——避免误伤非分包语句。

4. 用 **`MagicString`**：`s.overwrite(imp.ss, imp.se, …)` **整句替换**整条动态 import 语句为：

   `window.__RF__.load(JSON.stringify(normalizedRelativePath))`  
   （实际代码为模板字符串，`JSON.stringify(resolved)` 保证转义正确。）

5. 运行时 **`__RF__.load`** 实现在 `packages/core/src/runtime/adapter-vite.ts`：内部循环里调用 **`Function('u','return import(u)')`** 做 **原生 dynamic import**，与 **同一 `resolver`** 协同，从而在 **不改变「先由 Vite 生成 preload 拓扑」前提下**，把失败后的 **retry / fallback / cache bust**接进链路。

附加闸门见 **4.4**——只有 `shouldRewriteUrls` 为真时才执行上述磁盘改写，以免 **base 不匹配**时还去动 chunk。

#### 延伸：`vite:preloadError` 会「顺手」掐断后面的 JS 动态加载

**背景**：Vite 生成的 **`__vitePreload`** 在 **CSS 预加载失败**时会派发 **`vite:preloadError`**（可 `cancelable`），并在 **`defaultPrevented` 为假时 `throw`**。若插件把动态 import 改成了 **`__vitePreload(..., () => __RF__.load(...))`** 这类形态，则 **CSS 预加载一失败就先抛错**，**后续的 `__RF__.load()` 根本不会执行**——表现为 **直达异步路由时 About 等 chunk 的 JS 永远不加载**，与 CSS 是否最终被 Observer 修好无关。

**易踩坑**：事件载荷在 **`event.payload`**（不是常见的 `detail`）；监听里若不 **`event.preventDefault()`**，行为与「未监听」等价——仍会 throw。

**解决**：在 `installViteAdapter` 中对 **`vite:preloadError`**：**先 `preventDefault()`**，再从 **`payload`** 解析 URL（若有），按需 **`recordFailure`** / 打观测事件；**CSS 实体加载**仍交给 **`window` capture + Observer** 对 `<link rel="stylesheet">` 的替换链路与 §4.3 一致。

---

### 4.3 浏览器：ES Module 失败 URL / module map 缓存；重插「同一 URL」无效

#### 背景

对 **`type="module"`** 的 `<script>` 或运行时 **`import(specifier)`**：一旦某 **绝对 URL**（含 origin + path）对应 **失败的 module graph**，浏览器会 **缓存失败状态**。此时你在 DOM 上做：

- **同一个 `src` 的脚本节点 `replaceChild`**

往往 **不会再发起新的 GET**，或 **直接进入同一失败 module record**。于是监控里「rf:retry」触发了，Network 却只看到第一次失败。

另一类需求：**切换到 `urls` 里全新的 host** 时，若在 URL 上 **长期携带** 「仅用于重试去重缓存」的 query，会 **稀释 CDN 边缘缓存**，同一内容变成多个 cache key。

#### 思考过程

- Classic script：**每次插入新标签**更容易触发新请求，因此不必默认加 cache bust。
- **`type=\"module"` 与动态 import**：必须 **换一个「对 module loader 来说是新 URL」的字符串**，常见手段是 **`?__rf=attempt-nonce`**；换到 **fallback host**后应 **删掉**该类参数，只对 **同源重试 URL**短暂存在。

Observer 路径与 **`__RF__.load`** 路径必须 **语义对齐**（同一套 append/strip），否则一端能恢复一端不能。

#### 解决方案（如何实现）

**Observer**（`observer.ts`）：

1. **`needsCacheBust(el)`**：仅当 **`SCRIPT` + `type === 'module'`** 时返回 true。

2. **retry**：若需 bust，则在 **同一逻辑 URL**上调用 `appendRetryParam(result.url, attempt)`（内部 `strip` 旧的 `__rf=` 再接新 nonce）。

3. **fallback（换链）**：`fetchUrl = stripRetryParam(result.url)`，避免把上一轮重试的 query 带进新 CDN；同时 **`data-rf-attempt`** 重置，让 **新 host 独占一份 retry budget**（注释写明：不把「上轮在这 URL 上已经失败多次」误解成跳转瞬间耗尽预算）。

**Vite adapter**（`adapter-vite.ts`）：

- **`__RF__.load`** 内在 `catch` 后递增 `totalAttempts`，对 **再次 dynamic import** 使用带 **`appendRetryParam`** 的 URL，道理与 Observer 一致：打破 **失败 module record**。

这样 **可视化现象**应当是：每次「真重试」在 Network 里能看到 **URL 发生变化或 host 发生变化**的请求行，而不是静默 no-op。

---

### 4.4 `vite.config` 里 `base: '/'`，规则却写 CDN `match` —— 异步 chunk 被整块拼到 CDN 外域（或逻辑错位）

#### 背景

很常见的一种配置心理状态：

- **本地**：`base: '/'`，资源走同源；
- **生产**：本应 `base: 'https://cdn.example/'`，规则和线上对齐；
- 但仓库里 **提前写死了** CDN 前缀的 `match` / `urls`，或 CI 里 **`base` 未切到 CDN**就与 **CDN 形态的 rules**共存。

另一类根因是纯 **静态分析 bug**：解析「chunk 文件名」是否属于某规则的逻辑里，对 **string** 类型的 `match` **一律视为匹配任意 filename**（`matchesFilename` 里 `typeof pattern === 'string' → true`）。则 **只要在规则列表里出现过 string CDN 前缀**，就可能把 **resolveBuiltUrl(任意文件名)** 都拼装成 CDN URL——即 **开发与预览构建也会在运行时或二次解析时误认为「chunks 都来自 CDN」**。

表现出来的事故包括：

- `base`仍是 `/`，但懒加载请求的却是 **`https://cdn.../assets/xxx.js`**，出现 **Mixed Content/CORS**，或无故 **变慢**；
- 与产品设计「**不匹配就不改语义**」相反——**没在 CDN 发布的构建**却被 **构建插件硬改**.

#### 思考过程

需要两层闸门：

1. **构建期是否真的要去改写动态 import**：只有 **当前配置的 `base` 与规则的 `match` 对世界「真的一致」**，才说明你 **打算从该前缀发资源」，才应注入 `__RF__.load` 改写链路。

2. **运行时仍可保留 Observer**：页面里 **`document.createElement('script')`** 手动插的 CDN 地址若 **字面符合 `match`**，仍可走兜底（与 「不动 Vite 默认 chunk 管线」可同时成立）。

不应靠业务「记得删掉规则」人肉保证。

#### 解决方案（如何实现）

在 `vite-plugin` 的 **`config(userConfig)`**：

- 读 `base`（默认 `"/"`）。
- **`shouldRewriteUrls = options.rules.some(...)`**：  
  - string：`base === r.match`（严格相等）；  
  - RegExp：`r.match.test(base)`；  
  - function：`r.match(base)`。

在 **`writeBundle`** 首部：`if (!shouldRewriteUrls) return;` —— **整块「动态 import → `__RF__.load」」不写盘**。

效果归纳：

| 场景 | 行为 |
| --- | --- |
| `base` 与任一 `match` 对齐 | **改写**字面量动态 import，`__RF__.load`参与回退链。 |
| `base`为 `/`，规则只对 CDN（不相等） | **不改写**，Vite 默认行为加载 chunk；手写 `<script src="https://cdn...">` 仍可由 Observer 接管（若匹配规则）。 |

这样既避免 **误判 filename 匹配的爆炸半径**，又用 **单一布尔**把「是否要动产物」说清楚。

---

### 4.5 `<script>` 用 `cloneNode`「保留属性后再改 src」— 新脚本不执行或行为诡异

#### 背景

替换失败节点的直觉实现是：**`el.cloneNode(true)`**，改掉 `src`，再 **`replaceChild`**。在某些浏览器路径下，克隆的脚本元素 **继承「已开始执行」等内部槽位**，规范层面 **禁止对已完成生命周期的克隆再 fetch**，现象是：**Network 静默**、控制台无报错、页面卡在半初始化。

这和普通 `div` 的 clone **完全不是同一种心智模型**。

#### 思考过程

一旦确认 **「新建一个没有历史负担的脚本元素」是唯一稳妥路径**，就要系统化 **属性白名单**：不能无脑 copy 全部 attribute（部分安全或执行相关属性需要和 SRI/`nonce`/CSP 策略一致）。

#### 解决方案（如何实现）

在 `observer.ts` 的 `cloneTag`（函数名沿用历史语义，实际是 **create 而非 clone）：

1. **`document.createElement`** 建新 `script` 或 `link`。

2. **`SCRIPT_FORWARDED_ATTRS` / `LINK_FORWARDED_ATTRS`** 白名单逐键拷贝：`type`、`crossorigin`、`nonce`、`referrerpolicy`、`fetchpriority`、`async`、`defer`、`noModule`、`rel`、`as`、`media`、`disabled` 等。

3. **SRI 策略 `sri`**：`strip` 时故意不拷 `integrity`，避免 CDN 轮换后 hash 不符 **无限 error 循环**；`keep`/`strict`则保留，`integrity` 失败继续走下一轮 fallback。

4. 打上 **`data-rf-attempt` / `data-rf-managed` / `fallback`（若适用）**；对 script 赋 **`fresh.src = newUrl`**（或 link 的 `href`）。

5. 父节点上 **`replaceChild(replacement, el)`**，若延迟替换则 **`setTimeout(swap, delay)`**。

该路径可与 **§4.3** 的 URL 重写联合使用：**先建新节点**，再附上 **strip 过的或带 `__rf` 的 fetch URL**。

---

### 4.6 规则写 `match: '/'`，运行时用 `script.src` 得到绝对 URL —— 前缀匹配失败

#### 背景

配置里习惯写 **「相对站点根」**的前缀，例如 `match: '/'` 或 `match: 'https://app.example.com/'` 与 **部署时 publicPath** 对齐。但 DOM 里 **`<script src="/assets/index.js">`** 读出 **`.src` 属性**时，浏览器 **规范化为完整的 `https://origin/assets/…`**。

若 `resolver.matches` 对 string 使用的是 **`url.indexOf(pattern) === 0`**，则 **`/` 作为前缀**会与 **`https://…`**形态的字符串 **对不上**：表现为 **「首页明明挂了 CDN，Observer 永远不介入」**，或误以为库坏了。

#### 思考过程

必须统一 **「参与匹配的那一维 URL」**：要么 **规则全部写完整 origin**（对用户不友好），要么 **读 DOM 时使用与字面配置可比的形态**。业内常见做法是 **比对 `getAttribute('src')`/href**（保持 **HTML 字面量**，与 `href`/`src`写入时一致），而不是 **总是 canonicalize 之后的属性取值**。

#### 解决方案（如何实现）

`readUrl(el)`：**仅使用 `el.getAttribute('src')` 或 `el.getAttribute('href')`**（空串兜底），绝不为了「方便」改成 `HTMLScriptElement.prototype.src`。

这样 **`match: '/'` + `<script src="/assets/…">`** 字面仍 **以 `/` 起头**，前缀匹配与设计文档 **`string 为前缀`** 的描述一致。

注意：这与 **服务端渲染或某些框架用绝对 URL 写 attribute**的场景需自我一致——即 **match 要写与 attribute 字面一致的那一版**。

---

### 4.7 SystemJS（legacy）与 Observer 争抢同一加载 — 双倍回退或漏处理

#### 背景

`@vitejs/plugin-legacy` 等流水线会在不支持 `import` 的环境走 **SystemJS**。资源 URL、`fetch`/`instantiate` 路径与现代 **原生 `import`** 分叉。若在 **不知情**前提下仍只靠 **全局 `error` Observer**：

- **可能**看见 SystemJS 插入的脚本失败，再走一遍 Observer；
- **可能**SystemJS adapter 已经与 **resolver** 做了一轮；

两条链 **互不感知**，易出现 **双倍请求**，或一端 **改写 DOM** 另一端 **仍以旧 URL 重试**，状态机错乱。

#### 思考过程

与 **§4.1**同理：**ownership**先于算法。区别在于 **Webpack 可以用 `data-webpack` 判别**；SystemJS路径需要 **运行时登记「此 URL 由 SystemJS 适配器认领」**，Observer **看到同一个 URL（或等价键）就不再 resolve**。

曾评估过两种方案：

**方案 A（完全接管 instantiate，已弃用）**：覆写 `System.constructor.prototype.instantiate`，不再委托给原始实现，而是自行创建 `<script>` 元素并通过 `data-systemjs` 属性标记，让 Observer 跳过这些脚本。

- 优点：完全控制脚本创建、事件绑定和重试逻辑，不存在 Observer 与 adapter 的竞争
- 缺点：
  - 需要在 Observer 中增加 `isSystemJSScript` 检查
  - 自建脚本可能遗漏 SystemJS 内部附加的属性（`crossOrigin`、`fetchPriority` 等）
  - 如果 SystemJS 更新了 `instantiate` 的内部逻辑（如 integrity 校验、import map 支持），自建脚本不会自动获得这些改进

**方案 B（委托式，采纳）**：覆写 `instantiate`，但内部仍**委托给原始 `origInstantiate`**，保留 SystemJS 全部的脚本创建逻辑，仅在 `.catch()` 中加入 retry/fallback 循环。通过 `systemjsManagedUrls` 共享 Set 通知 Observer 跳过正在被管理的 URL。

方案 B 的核心优势：**不复制 SystemJS 内部实现**，当 SystemJS 升级或内部行为变化时自动兼容，维护成本显著低于方案 A。

#### 解决方案（如何实现）

采用 **方案 B（委托式）**：在 **`System.constructor.prototype.instantiate`** 上做薄封装：**内部仍调原始 instantiate**，在失败时通过 `.catch()` 接入 **`resolver`** 驱动 retry/fallback 循环。成功把 **进入 SystemJS 管线的 URL** 写入 **`systemjsManagedUrls`**（`Set`，见 `adapter-systemjs.ts` 与 Observer 头部的 import）。

Observer 在处理 error 目标时：**若 `readUrl(el)`落在 `systemjsManagedUrls`**，直接 **return**，把 **全权**留给 SystemJS adapter。

实施后：**legacy 与现代**共用 **熔断与 urls 语义**，且不 double-count 重试次数。

---

### 4.8 Resolver：初始链路先试、熔断与 `urls`、`findPrepared`/`isFallback`

#### 背景

产品上常同时要求：

1. **每次会话仍先打主 CDN**（不被「上一轮熔断关了」永远不试）；
2. **备选 CDN / 源站**上可以 **跳过明显挂掉的 host**；
3. **奇怪 URL** 不应因为「正巧以某个 url 前缀开头」就误入整套 fallback（误判成本：多一次失败、多一跳监控）。

若在实现上粗暴「所有失败都记入熔断并让 `match` 也吃熔断」，会违背 (1)。

若 **初始就用 `urls`前缀来匹配未知资源**，会违背 (3)。

多条规则 **`match`** 重复时若没有 **deterministic precedence**，配置文件一半生效一半不生效。

#### 思考过程（与实现对齐）

参阅 `packages/core/src/runtime/resolver.ts`：

- **`findPrepared(url, isFallback)`**  
  - 从数组 **末尾向前**扫（**后来者覆盖前者**，解决重复 define）。  
  - **始终**先试 **`matches(r.raw.match, url)`**（string 前缀 / RegExp / 函数）。  
  - **仅当 `isFallback === true`**时才允许用 **`url.indexOf(r.raw.urls[j])===0`** 命中规则——这样 **凭空出现的 URL** 不会仅靠「长得像 urls 里某前缀」套上规则。

- **`resolve`**：  
  - 无 Prepared → **`giveup: 'no-match'`**（Observer 会 `emitError`，但语义是 **不匹配而非失败链耗尽**，与 §4.9 观测有关）。  
  - `attemptOnUrl <= retry.max` → **retry**：**同一 logical URL**，Observer 再结合 **是否需要 module cache bust**。  
  - 超过 retry → **`breaker.recordFailure(hostOf(currentUrl))`** → **`pickNextUrl`**跳过 **打开的** host。

- **`findMatchContext`**：处理 **`match` 前缀与 urls 列表前缀不一致**时仍能从当前 URL **剥出路径段** swapping 到 **下一候选前缀**。

- **`resolveBuiltUrl`**：用于 **文件名 → 首轮 URL**。设计意图（见注释）：**不因熔断跳过「初始主推的 match URL」**，fallback 时再靠 **`resolve` + __RF__.load 循环**。`matchesFilename` 对 string仍 **恒 true**——因此 **必须与 Vite §4.4闸门**连用，以免 **离线 dev**误拼 CDN。

配置上：**重复 match**在 prepare 结束时 **可对用户 warn**（若实现中带 logger），最终以 **遍历顺序**体现的 **最后一次为准**。

#### 解决方案小结

把这些 **写成代码与注释**，比单纯文档承诺「先试主链路」更可维护；熔断 **作用在备选链上的 host**，与 **首轮 match**解耦。**`swap`/`joinAssetPrefix`** 等小函数避免 **CDN 前缀少写末尾 `/`**时 **字符串直连文件名** 拼成 **`…prod` + `js/foo.js` → `…prodjs/foo.js`** 的病态 URL（线上表现为路径缺一层目录、404）；实现上需在 **`joinAssetPrefix`** 中 **按需补 `/`**，并在 **`swap` 剥前缀后走同一拼接**。

---

### 4.9 观测与示例：`giveup`/no-match 也会 `rf:error`，不能当作「已走完整回退链」

#### 背景

为调试方便，项目在 HTML 早期注入 listener，把所有 **`rf:*`** push 进 **`window.__RF_EVENTS__`**。

**不匹配规则的脚本**失败后，Observer仍会进入 **`resolver.resolve` → `{ kind:'giveup', reason:'no-match' }`** → **`bus.emitError`**。若以 **「数组 length 变大」**作为「库里做了 fallback」的依据，就会把 **正确答案（未匹配应忽略 fallback）** 显示成 **「却被拦截」**的假阳性。

产品上 **监控**若把 **`rf:error` 全盘当成事故**，也会产生 **告警风暴**——其中大量可能是 **预期的 no-match（第三方脚本、无关域）**.

#### 思考过程

必须把 **语义细分**落实到 **示例与消费者指南**：

- **`rf:retry` / `rf:fallback`**：说明 **resolver 已经决定**，且 **下一轮会换 URL / 再加参数**。  
- **`rf:error`**：可能是 **`rules-exhausted`**（真·穷举失败），也可能是 **`no-match`**（**策略上未接管**）。

#### 解决方案（如何实现）

示例应用（Vue/React demo）改为：在点击「加载不匹配规则脚本」后，只扫描 **`__RF_EVENTS__` 新增的 slice**，若 **`type` 字段为 `'retry'` 或 `'fallback'`** 才认定为 **「本库已进入回退状态机」**；若仅有 **`error` 且无 retry/fallback**，则 UI 文案为 **符合预期的「未被拦截」**。

线上监控同理：按需 filter **`detail.reason`** 或拆分 dashboard。

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

## 五、经验总结（可带走的原则）

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
13. **要全集拦截与任意资源**：倾向 **SW**；要 **Webpack+Vite+cross-browser 一致运行时语义**：插件 + **`__RF__` + Observer**更合适。

---

*文档描述与源码一致；若后续实现变更，请以对应版本源码与根 README TODO 为准。*
