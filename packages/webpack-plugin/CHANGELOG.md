# @resource-fallback/webpack-plugin

## 0.1.5

### Patch Changes

- `joinAssetPrefix` 改为从 `@resource-fallback/core` 导入，移除插件内的重复实现
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
  - 插件在 `compilation.hooks.processAssets` 中生成 `rf-sw.js` 资产文件和 manifest
  - 通过 `RuntimeModule` 注入 SW 预加载脚本，避免首次加载竞态
  - 支持 `chunkLoadingGlobal` 配置转发

### Patch Changes

- Updated dependencies [207f03f]
  - @resource-fallback/core@0.1.0

## 0.0.4

### Patch Changes

- 修复异步模块中包含 CSS 时丢失依赖关系的问题
- Updated dependencies
  - @resource-fallback/core@0.0.4

## 0.0.3

### Patch Changes

- 修复资源路径拼接问题
- Updated dependencies [db39ae0]
- Updated dependencies
  - @resource-fallback/core@0.0.3

## 0.0.2

### Patch Changes

- 初始版本发布
  - Webpack 5+ 插件，通过 `RuntimeModule` 注入 patch `__webpack_require__.l` 实现运行时 fallback
  - 集成 `html-webpack-plugin`，自动注入 `<script>` / `<link rel="preconnect">` 标签
  - 自动转发 `chunkLoadingGlobal` 配置到运行时
- Updated dependencies [7927832]
- Updated dependencies [95e33ca]
  - @resource-fallback/core@0.0.2
