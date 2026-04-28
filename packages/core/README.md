# @resource-fallback/core

浏览器运行时 + Node 端工具函数，是 `resource-fallback` 方案的核心包。

终端用户通常不需要直接依赖本包——请安装 [`@resource-fallback/vite-plugin`](../vite-plugin) 或 [`@resource-fallback/webpack-plugin`](../webpack-plugin)。仅当需要自定义集成或手动注入运行时时才需要直接使用。

## 安装

```bash
pnpm add @resource-fallback/core
```

## Node 端 API

```ts
import {
  defineConfig,
  buildInjectedTags,
  getRuntimeCode,
  getRuntimePath,
  serialiseConfig,
} from '@resource-fallback/core';
```

| 函数 | 说明 |
| --- | --- |
| `defineConfig(opts)` | 恒等辅助函数，提供类型安全的配置编写体验 |
| `getRuntimePath()` | 返回 IIFE 运行时文件的绝对路径 |
| `getRuntimeCode()` | 返回 IIFE 运行时文件的字符串内容（首次调用后缓存） |
| `buildInjectedTags(opts)` | 根据配置构建需要注入 HTML 的 `<script>` / `<link>` 标签描述数组 |
| `serialiseConfig(cfg)` | 将运行时配置序列化为 JSON 字符串，`RegExp` 保持为原生正则字面量 |

### defineConfig

```ts
import { defineConfig } from '@resource-fallback/core';

export default defineConfig({
  rules: [
    {
      match: 'https://cdn.example.com/',
      urls: ['https://backup.example.com/', '/'],
      retry: { max: 2, baseDelay: 300 },
      circuit: { threshold: 3 },
    },
  ],
  debug: 'auto',
});
```

### buildInjectedTags

为自定义插件/构建流程手动注入运行时：

```ts
import { buildInjectedTags } from '@resource-fallback/core';

const tags = buildInjectedTags({
  rules: [{ match: 'https://cdn.example.com/', urls: ['/'] }],
  nonce: 'abc123',
  injectPreconnect: true,
});

// tags 结构示例：
// [
//   { tagName: 'link', attributes: { rel: 'preconnect', href: 'https://cdn.example.com', crossorigin: 'anonymous' } },
//   { tagName: 'script', attributes: { nonce: 'abc123' }, innerHTML: '<IIFE code>;window.__RF__.install({...})' },
// ]
```

## 浏览器运行时

运行时以 IIFE 格式注入页面（约 5KB gzip），通过 `window.__RF__` 暴露接口：

```ts
interface RfGlobal {
  install(config: RuntimeConfig): void;
  url(filename: string): string;
  load(filename: string): Promise<unknown>;  // Vite 专用
  resolver?: Resolver;
  installed: boolean;
  version: string;
}
```

### 运行时模块

| 模块 | 职责 |
| --- | --- |
| **entry** | 初始化 `window.__RF__` 全局对象，调度各适配器安装 |
| **observer** | 监听 `window` 上的 `error` 事件（捕获阶段），拦截 `<script>` 和 `<link rel="stylesheet">` 加载失败，原地替换为重试/回退 URL |
| **resolver** | 规则匹配引擎，决定下一步操作（retry / fallback / giveup） |
| **circuit** | per-host 熔断器，通过 `localStorage` 实现跨标签页状态共享 |
| **retry** | 指数退避延迟计算（`baseDelay × 2^(attempt-1)`），可选 ±25% 抖动 |
| **hooks** | 事件总线，同时分发 DOM `CustomEvent` 和 JS 函数钩子 |
| **kill-switch** | 三重紧急开关检测（全局变量 / 查询参数 / Cookie） |
| **logger** | 可选的日志输出，支持 `debug: 'auto'`（通过 `localStorage.__RF_DEBUG__` 控制） |
| **adapter-vite** | Vite 动态 import 回退循环（`__RF__.load`）+ `vite:preloadError` 处理 |
| **adapter-webpack** | 拦截 `chunkLoadingGlobal` 的 `push` 方法 + 包装 `__webpack_require__.l` |
| **adapter-systemjs** | hook `System.constructor.prototype.instantiate`，为 legacy bundle 提供回退 |

### Observer 行为细节

- 仅处理顶层 `<script>` 和 `<link rel="stylesheet">` 的 `error` 事件
- 自动跳过 `<link rel="preload|prefetch|modulepreload">` 等预加载提示
- 自动跳过带 `data-webpack` 属性的 `<script>`（由 webpack adapter 处理）
- 自动跳过 `systemjsManagedUrls` 中的 URL（由 systemjs adapter 处理）
- ES Module 脚本重试时自动添加 `__rf=` 查询参数，绕过浏览器模块缓存
- 经典脚本和 CSS 不添加 cache-bust 参数，避免降低 CDN 缓存命中率
- 替换标签使用 `createElement` 而非 `cloneNode`，避免浏览器的 "already started" 标记

### 事件

运行时在每个决策点分发 DOM `CustomEvent`：

| 事件 | 触发时机 | `event.detail` |
| --- | --- | --- |
| `rf:retry` | 同一 URL 重试 | `{ url: string, attempt: number }` |
| `rf:fallback` | 切换到下一个候选 URL | `{ from: string, to: string, reason?: unknown }` |
| `rf:success` | 经过回退的资源加载成功 | `{ url: string, attempts: number }` |
| `rf:error` | 所有候选耗尽（giveup） | `{ url: string, reason?: unknown }` |

## 导出

```jsonc
// package.json exports
{
  ".": "Node 端 API（defineConfig / buildInjectedTags / 类型等）",
  "./runtime": "浏览器 IIFE 运行时文件（runtime.iife.js）"
}
```

## 类型导出

```ts
export type {
  CircuitOptions,
  ErrorEvent,
  FallbackEvent,
  FallbackRule,
  HtmlTag,
  HtmlTagAttributes,
  MatchPattern,
  PluginOptions,
  ResolveResult,
  RetryEvent,
  RetryOptions,
  RuntimeConfig,
  RuntimeHooks,
  SriPolicy,
  SuccessEvent,
} from '@resource-fallback/core';
```

## 许可证

MIT
