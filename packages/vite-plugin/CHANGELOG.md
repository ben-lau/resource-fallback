# @resource-fallback/vite-plugin

## 0.1.5

### Patch Changes

- 改用 async `readFile` / `writeFile` 替换同步文件操作，避免阻塞 Vite 构建管线
- `base` 从 `config` 钩子改为 `configResolved` 获取，确保读取的是 Vite 最终解析后的 base 值（考虑 plugin 间覆盖）
- `shouldRewriteUrls` 的判断移到 `configResolved` 中，使用最终 base 与 match 规则比较
- `joinAssetPrefix` 改为从 `@resource-fallback/core` 导入，移除插件内的重复实现
- `es-module-lexer` 的 `init` 提取为模块级 `lexerReady` 变量，避免重复初始化
- `writeBundle` 增加 `outDir` 空值守卫
- Updated dependencies
  - @resource-fallback/core@0.1.5

## 0.1.4

### Patch Changes

- SW 共享 resolver、优化查找逻辑、精简 manifest 并重命名为 `rf-sw`
- Updated dependencies
  - @resource-fallback/core@0.1.4

## 0.1.3

### Patch Changes

- 修复 SW CORS 探测请求的 credentials 问题
- Updated dependencies
  - @resource-fallback/core@0.1.3

## 0.1.2

### Patch Changes

- 修复 Service Worker 意外覆盖 opaque 响应的场景
- Updated dependencies
  - @resource-fallback/core@0.1.2

## 0.1.1

### Patch Changes

- 修复图片等资源在 CORS 场景下的加载问题
- Updated dependencies
  - @resource-fallback/core@0.1.1

## 0.1.0

### Minor Changes

- 新增 Hybrid Service Worker 资源回退能力
  - 插件在 `generateBundle` 中生成 `rf-sw.js` 资产文件和 manifest
  - `renderBuiltUrl` 回调将 match 规则命中的资源 URL 重写为 `__RF__.url()` 调用
  - 支持注入 SW 预加载脚本（`__RF_SW_PRELOAD__`）避免首次加载竞态

### Patch Changes

- Updated dependencies [207f03f]
  - @resource-fallback/core@0.1.0

## 0.0.4

### Patch Changes

- 修复异步模块中包含 CSS 时丢失依赖关系的问题
  - `writeBundle` 钩子改用 `es-module-lexer` 解析 chunk 内的动态 import，将 match 规则命中的 URL 替换为 `__RF__.url()` 调用
- Updated dependencies
  - @resource-fallback/core@0.0.4

## 0.0.3

### Patch Changes

- 修复 Vite 加载异步模块时强制添加 match 内 URL 的问题：`renderBuiltUrl` 回调中增加对动态 chunk 的判断，避免非 match 范围的资源被错误重写
- Updated dependencies [db39ae0]
- Updated dependencies
  - @resource-fallback/core@0.0.3

## 0.0.2

### Patch Changes

- 初始版本发布
  - Vite 4+ 插件，通过 `experimental.renderBuiltUrl` 接入 `__RF__.url()` 回调
  - 监听 `vite:preloadError` 事件，preload 失败时触发 resolver 的 retry / fallback 链路
  - `writeBundle` 钩子在构建后扫描 chunk，将 match 规则内的 import URL 重写为运行时调用
- Updated dependencies [7927832]
- Updated dependencies [95e33ca]
  - @resource-fallback/core@0.0.2
