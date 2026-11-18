---
title: 兼容性
description: 区分构建器的支持声明、示例依赖、浏览器运行要求与 CI 持续验证范围。
---

# 兼容性

支持声明、示例依赖和 CI 验证范围分别列出。生产项目应使用自己的构建配置完成故障验证。

## 构建器与插件

| 组合                     | 声明或当前依赖                              | 持续验证范围                                       |
| ------------------------ | ------------------------------------------- | -------------------------------------------------- |
| Vite                     | peer dependency `>=4`；示例使用 Vite 7.x    | Vite + Vue 生产构建与 Chromium E2E                 |
| Webpack                  | peer dependency `>=5`；示例使用 Webpack 5.x | Webpack + React 生产构建与 Chromium E2E            |
| html-webpack-plugin      | peer dependency `>=4`，可选                 | 示例通过它自动注入 HTML；缺省时需手动注入          |
| SystemJS / plugin-legacy | 具备 instantiate 接入路径                   | 以示例测试覆盖的场景为准，不代表所有 legacy target |
| Workbox / 其他 PWA       | 无独立合并集成保证                          | 先设计 scope 与路由，见 SW 运维                    |

`Vite 4+` 是包的支持声明，不等于每个 Vite 大版本都在 CI 矩阵内。构建插件和浏览器运行环境也有不同要求：包声明 Node `>=18`，当前单元测试矩阵为 Node 20/22/24。

## 浏览器与运行模式

runtime IIFE 的编译目标为 ES2020，并使用原生动态 `import()`。SystemJS adapter 不会把整段 runtime 自动降级为旧浏览器语法，因此不能由“支持 SystemJS”推导出 IE 等旧环境支持。

| 环境                      | 当前状态                                       |
| ------------------------- | ---------------------------------------------- |
| Chromium                  | 示例浏览器 E2E 的持续验证引擎                  |
| Firefox / WebKit / Safari | 当前 CI 未列入浏览器矩阵，发布前按目标版本验证 |
| Hybrid SW                 | 需要浏览器支持、安全上下文及受控页面           |
| Vite dev                  | 默认关闭，动态导入恢复不在完整支持范围         |
| Worker / SSR              | 当前页面 runtime 在非浏览器环境跳过安装        |

对照[覆盖范围](./coverage.md)与发布验收，分别验证入口、懒加载、CSS 和需要的 SW 资源。
