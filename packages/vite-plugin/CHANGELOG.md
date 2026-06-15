# @resource-fallback/vite-plugin

## [0.2.0](https://github.com/ben-lau/resource-fallback/compare/@resource-fallback/vite-plugin@0.1.5...@resource-fallback/vite-plugin@0.2.0) (2026-06-15)


### Features

* 0.0.2 ([db39ae0](https://github.com/ben-lau/resource-fallback/commit/db39ae09fe6d1ecf8c43fabee62906c3da7a449a))
* **core:** 增加 Hybrid SW 资源回退能力 ([b08f835](https://github.com/ben-lau/resource-fallback/commit/b08f8353c743357f7f1ead24f0ea253f6a05b8f9))
* version update ([6a09f67](https://github.com/ben-lau/resource-fallback/commit/6a09f673bfec1801297c8aca480cff442f99bc27))


### Bug Fixes

* **core:** JSON 序列化转义 &lt; 防止 script 注入，joinAssetPrefix 提升至 core 共享 ([724c4dd](https://github.com/ben-lau/resource-fallback/commit/724c4dd32a00d7ca43f6b190f29e8397b16d4acc))
* **core:** 修复异步模块中包含 css 时丢失依赖关系的问题，补充部分测试场景 ([dfcbc26](https://github.com/ben-lau/resource-fallback/commit/dfcbc2659e395acc950c143054b8434c51c10d4b))
* **resolver:** 修复资源路径拼接问题 ([7305e80](https://github.com/ben-lau/resource-fallback/commit/7305e804b58370853fee29e9544505512dcf1cef))
* **sw:** 修复图片在 cors 场景下的一些问题 ([05f98a4](https://github.com/ben-lau/resource-fallback/commit/05f98a4de974dbdd3c97b844971ab257fb653f57))
* **vite-plugin:** 修复vite 在加载异步模块时强制添加 match 内的 url 问题，补充测试用例 ([7927832](https://github.com/ben-lau/resource-fallback/commit/7927832b982f129837a140b4a365757c4ad02e6e))
* 修复代码问题并补充测试覆盖 ([b29a9e9](https://github.com/ben-lau/resource-fallback/commit/b29a9e905e6bff17fa18436f885220d2d4e3c4fc))

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
