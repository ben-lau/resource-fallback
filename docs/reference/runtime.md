---
title: 浏览器运行时 API
description: window.__RF__ 的安装、URL 构造、Vite 加载、状态检查与卸载条件。
---

# 浏览器运行时 API

runtime IIFE 在浏览器中建立 `window.__RF__`。插件通常已完成初始化；应用通过 DOM 事件观察恢复结果。

## 状态与版本 {#status}

```js
console.log(window.__RF__?.version);
console.log(window.__RF__?.installed);
```

`installed` 只是安装标记。Kill Switch 生效时也可能为 `true`，不代表恢复已经接线；验证一次受管资源失败并观察 retry/fallback 事件。

## install(config) {#install}

接受 `RuntimeConfig`，首次调用建立适配器、熔断器和事件总线。配置无效时抛错，安装后的重复调用直接返回，不更新规则或 hooks。

插件自动注入会序列化配置并丢弃函数。需要 live hooks 时，先加载未安装的 runtime，再在页面首次 `install()` 时传入函数，见[手动集成](../guide/manual-integration.md)。

## url(filename) 与 load(filename) {#loading}

`url(filename)` 对裸文件名使用第一条已编译规则的 base；规则按 base 长度降序排列。绝对 http(s) 地址或以 `/` 开头的路径保持原样。该方法不感知熔断，也不执行网络请求。

`load(filename)` 由 Vite adapter 安装，用于改写后的动态导入，返回模块 Promise。恢复失败时 reject，且可能先派发 `rf:error`。Kill Switch 下不应假设此方法可用。

```js
const runtime = window.__RF__;
if (runtime && typeof runtime.load === 'function') {
  const module = await runtime.load('assets/route-HASH.js');
  console.log(module);
}
```

日常业务仍沿用框架的动态 import。`window.__RF__.internal` 为构建器私有桥接，不作为应用集成接口。

## dispose() {#dispose}

取消进行中的页面恢复、移除监听器并清理全局对象。卸载后的旧恢复不会继续影响下一次安装。已注册 SW 及受控客户端需单独管理，见 SW 运维。

## TypeScript 接入 {#typescript}

包没有扩展全局 `Window` / `WindowEventMap`。需要手动接入时，在应用类型文件声明实际使用的表面：

```ts
import type { RuntimeConfig } from '@resource-fallback/core';

declare global {
  interface Window {
    __RF__?: {
      version: string;
      installed: boolean;
      install(config: RuntimeConfig): void;
      url(filename: string): string;
      load?: (filename: string) => Promise<unknown>;
      dispose(): void;
    };
  }
}
```

DOM 事件的类型与数据口径见[运行时事件](../guide/runtime-events.md)。
