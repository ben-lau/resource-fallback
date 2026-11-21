---
title: 升级与迁移
description: 升级 resource-fallback 时核对规则、事件、熔断器、SW 与旧页面资源。
---

# 升级与迁移

本页面向使用者。文档显示的版本来自仓库 package.json；main 上的代码仍可能包含未发布变更，发布记录以[更新日志](../changelog.md)为准。

## 升级前检查

1. 记录当前安装版本、构建配置和线上 SW path/scope；保留可回滚的 HTML 与构建产物。
2. 升级实际使用的插件。三个包同步发布，直接依赖 core 的项目应同时核对 core 版本，避免自定义 runtime 文件与插件来自不同版本。
3. 重新构建并发布 runtime、SW 和资源。externalRuntime 的文件不会因为升级插件自动更新部署位置。

```bash
# 根据项目选择一个插件
pnpm up -D @resource-fallback/vite-plugin
# 或
pnpm up -D @resource-fallback/webpack-plugin
```

## 当前行为与旧配置 {#behavior}

| 旧假设或用法                       | 当前迁移方式                                                           |
| ---------------------------------- | ---------------------------------------------------------------------- |
| RegExp / 函数匹配规则              | 使用 string `base`，与构建前缀对齐                                     |
| 用页面 `reason` 字符串判定失败类型 | 按 `rf:retry` / `rf:fallback` 判断恢复是否发生；页面 reason 为 unknown |
| 每条页面规则有独立熔断器           | 当前页面只创建一个 registry，按第一条已编译规则初始化                  |
| `__RF__.url()` 会跳过熔断 host     | 它只按第一条已编译规则构造首轮 URL                                     |
| 构建配置 hooks 可序列化            | 自动注入使用 DOM 事件；live hooks 仅在首次手动安装时传入               |
| 页面和 SW 的 attempts 都是总次数   | 分别采用[事件口径](./runtime-events.md#rf-success)                     |
| 每次首次成功都会派发 success       | 当前只在经历 retry/fallback 后网络成功时派发                           |

旧版本 changelog 保留当时事实，排查当前行为时以对应版本指南与源码为准。

## 验证与回滚

按[发布验收](./deployment.md#verification)验证入口、懒路由和 CSS，确认旧页面仍能加载旧 hash 文件。启用 SW 时，再分别验证首次访问、旧标签页与新页面、冷缓存与已有缓存。

回滚时恢复同一版本的 HTML、配置、runtime 和资源；SW 注册不会随页面文件回滚而立即消失，按 [SW 运维](./sw-operations.md)处理。确认旧文件与目标 scope 后再执行停用或缓存清理。
