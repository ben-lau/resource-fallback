# Contributing

感谢你对 resource-fallback 的关注！欢迎提交 issue 和 PR。

## 开发环境

```bash
# 克隆仓库
git clone https://github.com/ben-lau/resource-fallback.git
cd resource-fallback

# 安装依赖（需要 pnpm 和 Node >= 18）
pnpm install

# 构建所有包
pnpm build
```

## 常用命令

| 命令                 | 说明                  |
| -------------------- | --------------------- |
| `pnpm build`         | 构建所有 packages     |
| `pnpm test`          | 运行单元测试          |
| `pnpm test:coverage` | 运行测试 + 覆盖率报告 |
| `pnpm typecheck`     | TypeScript 类型检查   |
| `pnpm lint`          | oxlint 代码检查       |
| `pnpm fmt`           | oxfmt 代码格式化      |
| `pnpm fmt:check`     | 检查格式化（不修改）  |
| `pnpm publint`       | 检查发布配置          |
| `pnpm attw`          | 检查类型声明兼容性    |
| `pnpm size:check`    | 检查产物体积          |

## E2E 测试

```bash
pnpm --filter @resource-fallback-example/vite-vue test:e2e
pnpm --filter @resource-fallback-example/webpack-react test:e2e
```

## 提交规范

本项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式，由 commitlint 在 `commit-msg` hook 自动校验。

常用类型：

| 类型                        | 说明         | 版本影响   |
| --------------------------- | ------------ | ---------- |
| `feat`                      | 新功能       | minor      |
| `fix`                       | 修复 bug     | patch      |
| `perf`                      | 性能优化     | patch      |
| `docs`                      | 文档变更     | 不触发发版 |
| `chore`                     | 构建/工具/CI | 不触发发版 |
| `refactor`                  | 重构         | 不触发发版 |
| `test`                      | 测试         | 不触发发版 |
| `feat!` / `BREAKING CHANGE` | 破坏性变更   | major      |

示例：

```
feat: add retry timeout option
fix: resolve race condition in observer
chore: update CI workflow
feat!: rename config option `retryCount` to `maxRetries`
```

## Git Hooks

项目使用 lefthook 管理 git hooks，`pnpm install` 后自动安装：

- **pre-commit**: oxlint 检查 + oxfmt 自动格式化暂存文件
- **commit-msg**: commitlint 校验提交信息格式

## 发布流程

本项目使用 [release-please](https://github.com/googleapis/release-please) 自动管理版本和 changelog：

1. 提交 `feat:` / `fix:` 类型 commits 到 `main`
2. release-please 自动创建/更新 Release PR
3. 合并 Release PR → 自动创建 GitHub Release + tag
4. npm 发布由维护者手动执行 `pnpm release`

## 项目结构

```
resource-fallback/
├── packages/
│   ├── core/              # 运行时 + Node 工具函数
│   ├── vite-plugin/       # Vite 插件
│   └── webpack-plugin/    # Webpack 插件
├── examples/
│   ├── vite-vue/          # Vite + Vue 示例
│   └── webpack-react/     # Webpack + React 示例
└── tests/                 # 单元测试
```
