# Changesets

此文件夹由 [`@changesets/cli`](https://github.com/changesets/changesets) 自动管理。

## 工作流

```bash
pnpm changeset           # 为当前变更生成一个 changeset
pnpm version             # 升版本号 + 写 CHANGELOG（消耗 changesets）
pnpm release             # 发布到 npm（会先重新构建）
```

三个可发布包（`@resource-fallback/core`、`@resource-fallback/webpack-plugin`、
`@resource-fallback/vite-plugin`）配置为 **fixed group**，始终以相同版本号一起发布。示例项目不参与发布。
