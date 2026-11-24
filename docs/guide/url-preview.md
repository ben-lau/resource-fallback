---
title: URL 前缀预览
description: 输入资源地址与回退规则，预览 CDN 前缀替换、子路径回源与候选请求顺序。
---

# URL 前缀预览

填入页面地址、资源 URL 和规则，核对回退后的完整路径。预览使用与页面恢复引擎相同的规则编译和候选选择逻辑。

<UrlPrefixPreview />

## CDN 回退与子路径回源 {#origin-prefix}

主地址 `https://cdn1.example.com/app/assets/app.js` 匹配 base `https://cdn1.example.com/app/` 后，候选 `/app/` 得到页面源站的 `/app/assets/app.js`；候选 `/` 则得到 `/assets/app.js`。回源前缀应与源站实际发布目录一致。

## 如何核对

- `base` 会规范化尾斜杠，匹配区分大小写。多规则按前缀长度降序选择。
- 填入适配器用于匹配的原始地址。绝对 URL 和相对路径保持原值匹配，例如 `/app/` 不会自动匹配 `https://cdn.example.com/app/`。
- 预览假设前面的地址持续失败、没有 host 熔断且未触发超时；实际恢复会受这些条件影响。
- 页面地址只用于将回源候选解析为绝对 URL。示例的 `/app/` 回到页面源站的 `/app/`，不会跟随前一个 CDN 的 origin。

配置后按[生产部署](./deployment.md#paths)发布同一份文件，再用 Network 验证。路径缺失见[候选前缀排查](./troubleshooting.md#candidate-prefix)。
