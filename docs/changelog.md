---
title: 更新日志
---

# 更新日志

本项目使用 [release-please](https://github.com/googleapis/release-please) 管理版本号。以下按包汇总各版本变更。

## @resource-fallback/core

### 0.1.5

#### Patch Changes

- 熔断器从全局单例改为每条规则独立持有——不同规则可配置不同的 `threshold` / `cooldown`，规则 A 的失败不会影响规则 B 的熔断状态
- 修复 `match` 与 `urls` 不一致时 fallback 路径解析错误：当 URL 通过 `match` 命中但不在 `urls` 列表中时，`urlIndex` 从 `-1` 开始而非 `0`，确保 `pickNextUrl` 从 `urls[0]` 起正确搜索可用 host
- `resolve()` / `resolveBuiltUrl()` 内部使用 per-rule breaker 的 `isOpen` 跳过已熔断 host
- `recordFailure` / `recordSuccess` 通过 `findPrepared` 查找匹配规则后再操作对应 breaker
- 运行时增加 `dispose()` 方法，支持卸载所有页面监听器并清理 `window.__RF__` 全局状态
- `installViteAdapter` 返回 `{ dispose() }`，移除 `vite:preloadError` 事件监听
- `installObserver` 返回 `{ dispose() }`，移除 `error` / `load` 事件监听（capture 阶段）
- `ensureGlobal()` 在非浏览器环境（SSR / Worker）返回 `null` 而非抛出异常
- JSON 序列化时将 `<` 转义为 `\x3c`，防止注入的 `</script>` 提前闭合 script 标签
- `joinAssetPrefix` 从 vite-plugin / webpack-plugin 提升为 core 包导出函数，统一处理 prefix 与 filename 的斜杠拼接，修复空 filename 和绝对 URL 场景
- kill-switch 全局变量严格化：仅接受 `true` / `1` / `'1'` / `'true'` 四种值触发禁用，不再对任意 truthy 值（如 `{}` 或 `'false'`）生效
- kill-switch cookie 匹配从 `indexOf` 前缀匹配改为精确相等，避免 `__rf_disable=10` 等误触
- 移除 `circuit-open` giveup reason——熔断器开放时规则被跳过而非整个 resolve 放弃，`ResolveResult` 类型简化为 `'rules-exhausted' | 'no-match'`

### 0.1.4

#### Patch Changes

- SW resolver 与页面侧 resolver 共享同一套 `createResolver` 实现，避免逻辑重复
- SW manifest 中的 asset 查找从 `Array.some()` 线性扫描改为 `Set` 查找（`buildManifestLookupSets`），并用 `WeakMap` 缓存结果
- `fetchWithFallback` 支持外部传入 `resolver`，SW entry 复用共享 resolver 实例
- SW 默认文件名从 `sw.js` 重命名为 `rf-sw.js`，避免与其他 Service Worker 冲突
- SW manifest 精简：仅保留 `owner === 'sw'` 和 `type === 'style'` 的 asset，移除脚本和 source map 等 SW 不使用的条目，减小预加载体积
- `createSwResolver` 从 `fetchWithFallback` 中提取为独立函数，供 SW entry 复用
- SW adapter 增加 `unregisterStaleWorkers`：当 `serviceWorker.enabled` 关闭时自动卸载旧的 rf-sw 注册
- SW adapter 注册时设置 `updateViaCache: 'none'` 并主动调用 `registration.update()`，确保始终获取最新 SW 版本

### 0.1.3

#### Patch Changes

- 修复 CORS 探测请求的 credentials 问题：`fetch(new Request(req, { mode: 'cors' }))` 改为显式 `credentials: 'omit'`，避免携带 cookie 触发 CORS 预检失败
- 引入 `corsVerifiedHosts`（原 `noCorsHosts` 语义反转）：首次 CORS 成功后记录 host，后续请求直接以 cors 模式发送；仅首次探测失败时才降级为 no-cors
- `fallbackOnOpaque` 选项的 JSDoc 补充完整说明：开启后 SW 对 no-cors 请求先尝试 cors 模式探测真实状态码，CORS 不可用时自动降级回 no-cors

### 0.1.2

#### Patch Changes

- 修复 `fallbackOnOpaque` 对 fallback CDN 的误判：仅在主 CDN（非 fallback）上启用 opaque 检查，fallback CDN 返回的 opaque 响应被接受为 best-effort，避免无限级联回退
- opaque 响应不再重试：`response.type === 'opaque'` 时直接将 `attempt` 置为 `Infinity`，跳过剩余重试预算进入 fallback——相同 no-cors 请求重试只会得到相同的 opaque 响应

### 0.1.1

#### Patch Changes

- CORS 探测新增 host 级缓存（`swNoCorsHosts`）：一旦某个 host 的 cors 探测失败（CDN 不支持 CORS），后续请求直接跳过 cors 尝试，避免每次都走一次无意义的 cors → catch → no-cors 流程
- `fallbackOnOpaque` 的 `fetcher` 改为先尝试 `cors` 模式获取可检查的状态码，失败时降级为 `no-cors`——解决之前图片等跨源资源因 opaque 响应无法判断 HTTP 错误（如 502/503）而无法触发 fallback 的问题

### 0.1.0

#### Minor Changes

- 新增 Hybrid Service Worker 资源回退能力

  通过 manifest 驱动 Service Worker 拦截非脚本资源（图片、字体、媒体、CSS 子资源及受控 `@import`），脚本加载仍由页面侧 adapter 负责。
  - `fetchWithFallback` 核心回退循环：支持 retry → fallback → cache fallback 全链路
  - `shouldHandleSwRequest` 按 destination 过滤，仅处理 manifest 中声明的资源
  - SW 通过 `__RF_SW_PRELOAD__` 预加载配置，避免首次 fetch 时 manifest 尚未就绪的竞态
  - SW 事件通过 `postMessage` 传递给页面（retry / fallback / success / error），页面 adapter 转发至 HookBus
  - Vite / Webpack 插件支持生成 SW 资产文件和 manifest，注入预加载脚本
  - `fallbackOnOpaque` 选项：将跨源 opaque 响应视为失败继续 fallback
  - Cache API 策略：仅缓存 fallback 成功的非 opaque 2xx 响应，提供 `cleanupOldFallbackCaches` 清理旧版本缓存

### 0.0.4

#### Patch Changes

- 修复异步模块中包含 CSS 时丢失依赖关系的问题：Vite adapter 的 `onPreloadError` 处理 CSS preload 失败时，通过 `chunk.dynamicImports` 追踪关联的动态 chunk，确保 CSS 依赖不会在 fallback 路径中被遗漏
- Vite 插件的 `writeBundle` 钩子改用 `es-module-lexer` 解析 chunk 内的动态 import，将 match 规则命中的 URL 替换为 `__RF__.url()` 调用

### 0.0.3

#### Patch Changes

- 修复资源路径拼接问题：resolver 中 `swap()` 函数原来直接用 `toPrefix + currentUrl.slice(fromPrefix.length)` 拼接，当 prefix 缺少末尾 `/` 时会产生 `...prodjs/x.js` 这类错误路径，改为使用 `joinAssetPrefix` 统一处理斜杠
- `resolveBuiltUrl` 中 `rule.match + filename` 改为 `joinAssetPrefix(rule.match, filename)`，避免同样的拼接问题

### 0.0.2

#### Patch Changes

- 初始版本发布
  - ES5 IIFE 运行时：resolver（match / urls 匹配 + fallback 路径解析）、retry（指数退避 + jitter）、circuit-breaker（per-host 熔断 + cooldown 恢复）、observer（error/load 事件 capture 监听 + script/link 自动替换）、kill-switch（全局变量 / cookie / query-param 三种禁用方式）
  - `defineConfig` 类型安全配置定义
  - `getRuntimeCode` 生成 IIFE 注入代码
  - `buildInjectedTags` 生成 `<script>` / `<link rel="preconnect">` 标签

---

## @resource-fallback/vite-plugin

### 0.1.5

#### Patch Changes

- 改用 async `readFile` / `writeFile` 替换同步文件操作，避免阻塞 Vite 构建管线
- `base` 从 `config` 钩子改为 `configResolved` 获取，确保读取的是 Vite 最终解析后的 base 值（考虑 plugin 间覆盖）
- `shouldRewriteUrls` 的判断移到 `configResolved` 中，使用最终 base 与 match 规则比较
- `joinAssetPrefix` 改为从 `@resource-fallback/core` 导入，移除插件内的重复实现
- `es-module-lexer` 的 `init` 提取为模块级 `lexerReady` 变量，避免重复初始化
- `writeBundle` 增加 `outDir` 空值守卫
- Updated dependencies
  - @resource-fallback/core@0.1.5

### 0.1.4

#### Patch Changes

- SW 共享 resolver、优化查找逻辑、精简 manifest 并重命名为 `rf-sw`
- Updated dependencies
  - @resource-fallback/core@0.1.4

### 0.1.3

#### Patch Changes

- 修复 SW CORS 探测请求的 credentials 问题
- Updated dependencies
  - @resource-fallback/core@0.1.3

### 0.1.2

#### Patch Changes

- 修复 Service Worker 意外覆盖 opaque 响应的场景
- Updated dependencies
  - @resource-fallback/core@0.1.2

### 0.1.1

#### Patch Changes

- 修复图片等资源在 CORS 场景下的加载问题
- Updated dependencies
  - @resource-fallback/core@0.1.1

### 0.1.0

#### Minor Changes

- 新增 Hybrid Service Worker 资源回退能力
  - 插件在 `generateBundle` 中生成 `rf-sw.js` 资产文件和 manifest
  - `renderBuiltUrl` 回调将 match 规则命中的资源 URL 重写为 `__RF__.url()` 调用
  - 支持注入 SW 预加载脚本（`__RF_SW_PRELOAD__`）避免首次加载竞态

#### Patch Changes

- Updated dependencies
  - @resource-fallback/core@0.1.0

### 0.0.4

#### Patch Changes

- 修复异步模块中包含 CSS 时丢失依赖关系的问题
  - `writeBundle` 钩子改用 `es-module-lexer` 解析 chunk 内的动态 import，将 match 规则命中的 URL 替换为 `__RF__.url()` 调用
- Updated dependencies
  - @resource-fallback/core@0.0.4

### 0.0.3

#### Patch Changes

- 修复 Vite 加载异步模块时强制添加 match 内 URL 的问题：`renderBuiltUrl` 回调中增加对动态 chunk 的判断，避免非 match 范围的资源被错误重写
- Updated dependencies
  - @resource-fallback/core@0.0.3

### 0.0.2

#### Patch Changes

- 初始版本发布
  - Vite 4+ 插件，通过 `experimental.renderBuiltUrl` 接入 `__RF__.url()` 回调
  - 监听 `vite:preloadError` 事件，preload 失败时触发 resolver 的 retry / fallback 链路
  - `writeBundle` 钩子在构建后扫描 chunk，将 match 规则内的 import URL 重写为运行时调用
- Updated dependencies
  - @resource-fallback/core@0.0.2

---

## @resource-fallback/webpack-plugin

### 0.1.5

#### Patch Changes

- `joinAssetPrefix` 改为从 `@resource-fallback/core` 导入，移除插件内的重复实现
- Updated dependencies
  - @resource-fallback/core@0.1.5

### 0.1.4

#### Patch Changes

- SW 共享 resolver、优化查找逻辑、精简 manifest 并重命名为 `rf-sw`
- Updated dependencies
  - @resource-fallback/core@0.1.4

### 0.1.3

#### Patch Changes

- 修复 SW CORS 探测请求的 credentials 问题
- Updated dependencies
  - @resource-fallback/core@0.1.3

### 0.1.2

#### Patch Changes

- 修复 Service Worker 意外覆盖 opaque 响应的场景
- Updated dependencies
  - @resource-fallback/core@0.1.2

### 0.1.1

#### Patch Changes

- 修复图片等资源在 CORS 场景下的加载问题
- Updated dependencies
  - @resource-fallback/core@0.1.1

### 0.1.0

#### Minor Changes

- 新增 Hybrid Service Worker 资源回退能力
  - 插件在 `compilation.hooks.processAssets` 中生成 `rf-sw.js` 资产文件和 manifest
  - 通过 `RuntimeModule` 注入 SW 预加载脚本，避免首次加载竞态
  - 支持 `chunkLoadingGlobal` 配置转发

#### Patch Changes

- Updated dependencies
  - @resource-fallback/core@0.1.0

### 0.0.4

#### Patch Changes

- 修复异步模块中包含 CSS 时丢失依赖关系的问题
- Updated dependencies
  - @resource-fallback/core@0.0.4

### 0.0.3

#### Patch Changes

- 修复资源路径拼接问题
- Updated dependencies
  - @resource-fallback/core@0.0.3

### 0.0.2

#### Patch Changes

- 初始版本发布
  - Webpack 5+ 插件，通过 `RuntimeModule` 注入 patch `__webpack_require__.l` 实现运行时 fallback
  - 集成 `html-webpack-plugin`，自动注入 `<script>` / `<link rel="preconnect">` 标签
  - 自动转发 `chunkLoadingGlobal` 配置到运行时
- Updated dependencies
  - @resource-fallback/core@0.0.2
