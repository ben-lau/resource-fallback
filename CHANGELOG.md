# Changelog

All notable changes to this project will be documented in this file.
Packages (`@resource-fallback/core`, `@resource-fallback/vite-plugin`, `@resource-fallback/webpack-plugin`) are released with the same version number.

## [0.3.0](https://github.com/ben-lau/resource-fallback/compare/v0.2.0...v0.3.0) (2026-09-01)


### Features

* **core:** add canonical resource identity ([df9810b](https://github.com/ben-lau/resource-fallback/commit/df9810bccdf8082d5000fe544c09ffc10ad1dcf1))
* **core:** add pure recovery state machine ([01c1964](https://github.com/ben-lau/resource-fallback/commit/01c19646b50ac0727f4c369c07cbffcb18e1cdee))
* **core:** add runtime ownership leases ([e162502](https://github.com/ben-lau/resource-fallback/commit/e1625021a5a4ee052deb019f711f5d2178a9af63))
* **core:** coordinate recovery sessions ([9196799](https://github.com/ben-lau/resource-fallback/commit/9196799611ccdb54325fb25a2a7c14c145640230))
* **core:** seed coordinator from external failures ([e9df896](https://github.com/ben-lau/resource-fallback/commit/e9df8964983c807a6828f40ac62551490749bcae))
* **core:** share same-entrance recovery sessions ([833ac18](https://github.com/ben-lau/resource-fallback/commit/833ac1808418c70ac3c9b632428ab5bf9294ac19))
* **webpack:** delegate runtime recovery to core coordinator ([49d9081](https://github.com/ben-lau/resource-fallback/commit/49d9081c51693da9c043cc4d81f0f79c9549f350))


### Bug Fixes

* **ci:** 修改 release-please 配置 ([e8b9476](https://github.com/ben-lau/resource-fallback/commit/e8b947677a168ce646078b66de57b2c9c0082af6))
* **ci:** 将 publish 和 docs 部署合并进 release-please workflow ([265e546](https://github.com/ben-lau/resource-fallback/commit/265e546506f47ccb337f7650913005f120b1c135))
* **core:** close recovery session reentrancy gaps ([9112f1d](https://github.com/ben-lau/resource-fallback/commit/9112f1d0877f09f654e87e98628112a570c7b02a))
* **core:** cover resource identity edge cases ([8ec7fbe](https://github.com/ben-lau/resource-fallback/commit/8ec7fbe0a7782edec19159e5ec19841bbfb984cb))
* **core:** expose injected tag options type ([d2bcfdc](https://github.com/ben-lau/resource-fallback/commit/d2bcfdcbeae05a458918481159e753c23127de96))
* **core:** harden recovery publication cleanup ([464f175](https://github.com/ben-lau/resource-fallback/commit/464f1752efc28e755c675cf198b258704d657ad3))
* **core:** settle mapped recovery failures ([ee269e5](https://github.com/ben-lau/resource-fallback/commit/ee269e53415c01ed1ed23c8e99391a7ffeb60c3d))
* **core:** 规则收口为 string base，runtime 改用原生 import ([7734b15](https://github.com/ben-lau/resource-fallback/commit/7734b159079cf35d63a9841044089070ffa2a704))


### Code Refactoring

* **core:** centralize runtime services ([09ce2ce](https://github.com/ben-lau/resource-fallback/commit/09ce2ce3edfb0dcfd113d7dca6252b35a65814a9))
* **core:** compile immutable runtime config ([39f9427](https://github.com/ben-lau/resource-fallback/commit/39f94277d0450546b92325cd0028d48b9051408b))
* **observer:** join shared recovery admissions ([9ec9229](https://github.com/ben-lau/resource-fallback/commit/9ec9229399f9250ae0757ec8125123fdd3be32bb))
* **runtime:** connect adapters to shared lifecycle ([a780d8f](https://github.com/ben-lau/resource-fallback/commit/a780d8f53cf8174a8b67b0dbff477a376dd31f3c))
* **runtime:** delegate observer recovery to coordinator ([1c085e7](https://github.com/ben-lau/resource-fallback/commit/1c085e789426de0afbe482e18c160cec510cb58a))
* **runtime:** make systemjs adapter disposable ([9bda25a](https://github.com/ben-lau/resource-fallback/commit/9bda25ab9f7a0600b74548e952793ac01ed55851))
* **runtime:** preserve webpack loading through coordinator ([7616484](https://github.com/ben-lau/resource-fallback/commit/761648431f0979806cbd208bfadd93dcd7e630bd))
* **runtime:** route vite imports through coordinator ([0e84ec4](https://github.com/ben-lau/resource-fallback/commit/0e84ec4d69f73edf5a105d4dbc6b82426c0e5f69))
* **systemjs:** join shared recovery admissions ([819217e](https://github.com/ben-lau/resource-fallback/commit/819217e039e7f6cad650dfb8983cc20f27f61e90))
* **vite:** join shared recovery admissions ([829b201](https://github.com/ben-lau/resource-fallback/commit/829b201b2907d781ba6b171b22c62e346335822f))
* **webpack:** enforce stable chunk admission ([e28d6b9](https://github.com/ben-lau/resource-fallback/commit/e28d6b90237e5dd1b7e1a8a1a43fc6353d5613a7))

## [0.2.0](https://github.com/ben-lau/resource-fallback/compare/v0.1.5...v0.2.0) (2026-06-15)

### Bug Fixes

* **core:** `installWebpackAdapter` 返回 `{ dispose() }` 支持清理内部轮询定时器，修复测试环境定时器泄漏 ([b29a9e9](https://github.com/ben-lau/resource-fallback/commit/b29a9e905e6bff17fa18436f885220d2d4e3c4fc))
* **webpack-plugin:** 加固 `html-webpack-plugin` 检测逻辑（fallback to `getHooks`）([b29a9e9](https://github.com/ben-lau/resource-fallback/commit/b29a9e905e6bff17fa18436f885220d2d4e3c4fc))

## [0.1.5](https://github.com/ben-lau/resource-fallback/compare/v0.1.4...v0.1.5) (2026-05-24)

### Bug Fixes

* **core:** 熔断器从全局单例改为每条规则独立持有——不同规则可配置不同的 `threshold` / `cooldown`，规则 A 的失败不会影响规则 B 的熔断状态
* **core:** 修复 `match` 与 `urls` 不一致时 fallback 路径解析错误：当 URL 通过 `match` 命中但不在 `urls` 列表中时，`urlIndex` 从 `-1` 开始而非 `0`
* **core:** `resolve()` / `resolveBuiltUrl()` 内部使用 per-rule breaker 的 `isOpen` 跳过已熔断 host
* **core:** `recordFailure` / `recordSuccess` 通过 `findPrepared` 查找匹配规则后再操作对应 breaker
* **core:** 运行时增加 `dispose()` 方法，支持卸载所有页面监听器并清理 `window.__RF__` 全局状态
* **core:** `installViteAdapter` 返回 `{ dispose() }`，移除 `vite:preloadError` 事件监听
* **core:** `installObserver` 返回 `{ dispose() }`，移除 `error` / `load` 事件监听（capture 阶段）
* **core:** `ensureGlobal()` 在非浏览器环境（SSR / Worker）返回 `null` 而非抛出异常
* **core:** JSON 序列化时将 `<` 转义为 `\x3c`，防止注入的 `</script>` 提前闭合 script 标签
* **core:** `joinAssetPrefix` 从 vite-plugin / webpack-plugin 提升为 core 包导出函数，统一处理 prefix 与 filename 的斜杠拼接
* **core:** kill-switch 全局变量严格化：仅接受 `true` / `1` / `'1'` / `'true'` 四种值触发禁用
* **core:** kill-switch cookie 匹配从 `indexOf` 前缀匹配改为精确相等
* **core:** 移除 `circuit-open` giveup reason——`ResolveResult` 类型简化为 `'rules-exhausted' | 'no-match'`
* **vite-plugin:** 改用 async `readFile` / `writeFile` 替换同步文件操作
* **vite-plugin:** `base` 从 `config` 钩子改为 `configResolved` 获取
* **vite-plugin:** `joinAssetPrefix` 改为从 `@resource-fallback/core` 导入
* **vite-plugin:** `es-module-lexer` 的 `init` 提取为模块级 `lexerReady` 变量
* **vite-plugin:** `writeBundle` 增加 `outDir` 空值守卫
* **webpack-plugin:** `joinAssetPrefix` 改为从 `@resource-fallback/core` 导入

## [0.1.4](https://github.com/ben-lau/resource-fallback/compare/v0.1.3...v0.1.4) (2026-05-18)

### Bug Fixes

* **core:** SW resolver 与页面侧 resolver 共享同一套 `createResolver` 实现
* **core:** SW manifest 中的 asset 查找从 `Array.some()` 改为 `Set` 查找（`buildManifestLookupSets`）+ `WeakMap` 缓存
* **core:** `fetchWithFallback` 支持外部传入 `resolver`，SW entry 复用共享实例
* **core:** SW 默认文件名从 `sw.js` 重命名为 `rf-sw.js`
* **core:** SW manifest 精简：仅保留 `owner === 'sw'` 和 `type === 'style'` 的 asset
* **core:** `createSwResolver` 从 `fetchWithFallback` 中提取为独立函数
* **core:** SW adapter 增加 `unregisterStaleWorkers`
* **core:** SW adapter 注册时设置 `updateViaCache: 'none'` 并主动调用 `registration.update()`

## [0.1.3](https://github.com/ben-lau/resource-fallback/compare/v0.1.2...v0.1.3) (2026-05-12)

### Bug Fixes

* **core:** 修复 CORS 探测请求的 credentials 问题——显式 `credentials: 'omit'`
* **core:** 引入 `corsVerifiedHosts`（原 `noCorsHosts` 语义反转）
* **core:** `fallbackOnOpaque` 选项 JSDoc 补充完整说明

## [0.1.2](https://github.com/ben-lau/resource-fallback/compare/v0.1.1...v0.1.2) (2026-05-06)

### Bug Fixes

* **core:** 修复 `fallbackOnOpaque` 对 fallback CDN 的误判——仅在主 CDN 上启用 opaque 检查
* **core:** opaque 响应不再重试——直接将 `attempt` 置为 `Infinity` 进入 fallback

## [0.1.1](https://github.com/ben-lau/resource-fallback/compare/v0.1.0...v0.1.1) (2026-04-28)

### Bug Fixes

* **core:** CORS 探测新增 host 级缓存（`swNoCorsHosts`）
* **core:** `fallbackOnOpaque` fetcher 先尝试 `cors` 模式获取可检查状态码，失败时降级为 `no-cors`

## [0.1.0](https://github.com/ben-lau/resource-fallback/compare/v0.0.4...v0.1.0) (2026-04-20)

### Features

* **core:** 新增 Hybrid Service Worker 资源回退能力——manifest 驱动 SW 拦截非脚本资源
* **vite-plugin:** `generateBundle` 生成 `rf-sw.js` 资产文件和 manifest
* **vite-plugin:** `renderBuiltUrl` 回调重写 matched URLs 为 `__RF__.url()`
* **webpack-plugin:** `processAssets` 生成 `rf-sw.js` + manifest
* **webpack-plugin:** `RuntimeModule` 注入 SW 预加载脚本

## [0.0.4](https://github.com/ben-lau/resource-fallback/compare/v0.0.3...v0.0.4) (2026-04-10)

### Bug Fixes

* **core:** 修复异步模块中包含 CSS 时丢失依赖关系的问题
* **vite-plugin:** `writeBundle` 钩子改用 `es-module-lexer` 解析动态 import

## [0.0.3](https://github.com/ben-lau/resource-fallback/compare/v0.0.2...v0.0.3) (2026-04-05)

### Bug Fixes

* **core:** 修复资源路径拼接问题——`swap()` 改为使用 `joinAssetPrefix`
* **vite-plugin:** 修复加载异步模块时强制添加 match 内 URL 的问题

## [0.0.2](https://github.com/ben-lau/resource-fallback/releases/tag/v0.0.2) (2026-03-28)

### Features

* **core:** ES5 IIFE 运行时：resolver、retry、circuit-breaker、observer、kill-switch
* **core:** `defineConfig` 类型安全配置 + `getRuntimeCode` IIFE 生成 + `buildInjectedTags`
* **vite-plugin:** Vite 4+ 插件——`experimental.renderBuiltUrl` 接入 `__RF__.url()`
* **webpack-plugin:** Webpack 5+ 插件——`RuntimeModule` 注入 patch `__webpack_require__.l`
