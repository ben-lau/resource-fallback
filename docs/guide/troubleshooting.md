---
title: 故障排查
outline: [2, 3]
---

# 故障排查

从一条失败的静态资源请求开始。用 Network 核对请求过的 URL，用 `rf:*` 事件确认运行时走到了哪一步。

## 按现象定位 {#symptoms}

| 看到的信号                                      | 下一步                                        |
| ----------------------------------------------- | --------------------------------------------- |
| 主 CDN 失败，未看到 `rf:retry` 或 `rf:fallback` | [确认运行时和规则匹配](#rule-match)           |
| 发生 `rf:fallback`，候选请求仍失败              | [检查候选地址和响应](#candidate-response)     |
| 收到 `rf:error`，需要判断用户侧结果             | [区分终态失败与缓存恢复](#terminal-result)    |
| 脚本能回退，图片或字体仍失败                    | [检查 Hybrid Service Worker](#service-worker) |

::: tip 先复现一次独立的失败
用生产构建和新的浏览器上下文。打开 Network 后，只屏蔽主 CDN 上一个懒加载 chunk，再触发该路由。这能保留正常启动的页面，也便于关联同一资源的事件。
:::

## 确认运行时和规则匹配 {#rule-match}

1. 在 Network 找到首次失败的 URL，包含完整路径。Vite 对照构建配置的 `base`，Webpack 对照 `output.publicPath`，再核对 `rules[].base` 是否匹配实际发出的 URL。多条规则命中时优先匹配最长前缀。
2. 检查产出的 HTML 和 Console。确认运行时与初始化脚本都已加载，当前页面没有通过 [Kill Switch](./csp-sri.md) 禁用回退。使用 `externalRuntime` 时，也要检查外链资源路径和内联初始化脚本的 CSP 授权。
3. 在触发懒加载前注册 [事件监听](./runtime-events.md)。Vite 默认只在构建模式启用完整的动态导入回退，按[快速开始的验证步骤](./quick-start.md#验证)复现。

出现 `rf:retry` 后，如果同一 URL 已恢复，预期下一条终态事件是 `rf:success`。将 `retry.max` 设为 `0` 时，匹配的加载失败可以直接进入候选切换。

## 检查候选地址和响应 {#candidate-response}

- 用 `rf:fallback.detail.from` 和 `to` 找到对应的两条请求。确认主前缀被替换后，构建生成的文件名和资源子目录仍能在候选服务器上命中。
- 检查实际响应正文和 `Content-Type`。例如，静态服务器的 SPA 路由兜底可能为缺失的 JS 文件返回 HTML，即使 Network 显示状态为 `200`，模块也可能加载失败。
- 核对候选是否部署了同一份产物，以及 Console 是否报告跨域、CSP 或完整性问题。启用 SRI 时，对照 [CSP 与 SRI](./csp-sri.md) 核对候选文件和校验策略。
- 某个候选始终没被请求时，检查 `urls` 的顺序、前一候选是否已经成功，以及主机是否处在熔断冷却期。可用[调试日志](./best-practices.md#debug-模式)辅助判断。

### 切换后少了一段路径 {#candidate-prefix}

假设首次请求是 `https://cdn1.example.com/app/assets/app.js`，规则的 `base` 是 `https://cdn1.example.com/app/`。切到首个候选时，回退引擎会替换整个匹配前缀，保留后面的 `assets/app.js`。

| `urls` 中的首个候选             | Network 中的回退地址                         |
| ------------------------------- | -------------------------------------------- |
| `https://cdn2.example.com/`     | `https://cdn2.example.com/assets/app.js`     |
| `https://cdn2.example.com/app/` | `https://cdn2.example.com/app/assets/app.js` |

如果备用 CDN 也把文件部署在 `/app/` 下，就选第二种前缀。回源同理，候选写成 `'/app/'`。排查时先比对 `rf:fallback.detail.to` 与发布路径，再确认响应正文是预期的资源文件。

## 区分终态失败与缓存恢复 {#terminal-result}

`rf:success.detail.url` 指向恢复成功的资源。页面侧 `rf:error.detail.url` 指向终止时的当前候选，可能是备用 CDN 或源站。入口降级界面应匹配同一入口的[完整候选 URL](./runtime-events.md#入口失败降级-ui)。

Hybrid SW 的网络候选耗尽后仍可能命中 Cache API。此时 `rf:error` 表示网络链路失败。结合 Network 和页面里的实际资源状态，确认用户是否已经拿到缓存响应。

## 检查 Hybrid Service Worker {#service-worker}

1. 在安全上下文中检查 `navigator.serviceWorker.controller?.scriptURL`。确认控制当前页面的是预期的 SW，且页面 URL 在配置的 `scope` 内。首次打开页面时，可在 SW 就绪后重新进入页面验证。
2. 在 Network 里确认请求类型与资源归属。图片、字体、媒体和符合条件的 CSS 子资源走 [Hybrid SW](./service-worker.md)，脚本仍由页面侧适配器负责。
3. 跨源 `no-cors` 请求可能返回 opaque 响应，SW 读不到真实状态码。需要按可读的 HTTP 状态继续回退时，核对候选服务器的 CORS 响应和 `fallbackOnOpaque` 配置。

## 发布前验证 {#release-checks}

| 测试场景         | Network 里确认               | 运行时事件与页面表现                                        |
| ---------------- | ---------------------------- | ----------------------------------------------------------- |
| 主 CDN 正常      | 首次请求直接成功             | 首轮成功不触发恢复事件                                      |
| 备用 CDN 可用    | 资源从备用 CDN 加载          | `rf:fallback.detail.to` 指向备用 CDN，最后收到 `rf:success` |
| 仅源站可用       | 资源从页面源站的预期路径加载 | `rf:success.detail.url` 指向源站                            |
| 所有地址都不可用 | 配置中的候选已经耗尽         | 收到 `rf:error`，确认页面显示预期的降级界面                 |

可以在[首页的请求演练](../index.md#rf-trace-title)切换后三种场景，展开事件记录核对顺序。演练允许每个地址重试一次。主 CDN 连续失败两次、备用 CDN 首次请求成功时，`rf:success.detail.attempts` 为 `3`。

分别验证入口脚本与懒加载 chunk。启用 Hybrid SW 的项目再选一个实际使用的图片或字体，分别用冷缓存和已有缓存验证。
