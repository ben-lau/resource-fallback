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

- **pre-commit**: 对暂存文件跑 oxlint（`--fix --deny-warnings`）与 oxfmt（`--write`），并自动 `git add` 修复结果；覆盖范围与 CI `pnpm lint` / `pnpm fmt:check` 同一套规则（含 `.md` 等），CI 再全量复检
- **commit-msg**: commitlint 校验提交信息格式

## 发布流程

本项目使用 [release-please](https://github.com/googleapis/release-please) 自动管理版本和 changelog：

1. 提交 `feat:` / `fix:` 类型 commits 到 `main`
2. release-please 自动创建/更新 Release PR
3. 合并 Release PR → 自动创建 GitHub Release + tag
4. `Verify Release` 从该提交构建并打包三个 npm 包，用独立消费项目安装候选 `.tgz`，验证包入口、生产构建和 Chromium 中的入口及懒加载回退
5. 验收通过后，自动将同一批 `.tgz` 按 core、Vite 插件、Webpack 插件的顺序发布到 npm

手动触发 `Publish` 也会先跑同一套验收。想单独检查某个分支或 tag 的候选包，可以手动触发 `Verify Release`。验收组合见[兼容性](./docs/guide/compatibility.md)。

如果 npm 发布中途失败，用原工作流的 **Re-run failed jobs** 继续发布。发布脚本会核对 npm 中已有版本的包完整性，跳过内容相同的包。

如果连续推送导致 Release Please 创建的 tag 与工作流的提交不同，自动发布会停止。用该 tag 触发 `Publish`，让验收、发布包和 npm provenance 都对应同一个提交。

## 未发版预览包

维护者先为本仓库安装 [pkg.pr.new GitHub App](https://github.com/apps/pkg-pr-new/installations/new)，选择 `ben-lau/resource-fallback` 即可。CLI 已固定在开发依赖和锁文件中；预览发布不需要 npm token。

| 触发方式            | 构建与安装命令位置                                                     |
| ------------------- | ---------------------------------------------------------------------- |
| push 仓库内任意分支 | 所有 CI 检查通过后发布；安装命令显示在 `CI` → `preview / publish` 摘要 |
| 提交或更新 PR       | 所有 CI 检查通过后发布；安装命令显示在 PR 评论和上述运行摘要中         |
| push 到 `main`      | 同样等待所有 CI 检查；待发版 PR 评论另提供 `@main` 和固定 SHA 链接     |

预览一次发布 `core`、`vite-plugin`、`webpack-plugin`，包内版本为 `0.0.0-preview-<sha>`，内部依赖指向同一批预览包。普通 PR 评论由 pkg.pr.new 自动更新，外部 fork PR 也使用同一流程。自动评论对所有包都显示 `pnpm add`；插件作为开发依赖时可加 `-D`，CI 摘要已按包区分命令。CI 对 PR 测试模拟合并结果，预览构建则检出 PR head，使预览链接中的 SHA 与构建源码对应；因此完整 CI 检查的是合并结果，而不是单独的 head。若旧分支尚无 `pkg-pr-new` 依赖，需先同步接入配置。首次贡献的 fork PR 可能需要维护者批准运行 workflow。

`@main` 指向最近一次成功生成的预览，新提交后请先确认对应 CI 成功；需要复现时使用固定 SHA 链接，并在切换预览时更新锁文件。没有待发版 PR 时，仍可从运行摘要或[预览列表](https://pkg.pr.new/~/ben-lau/resource-fallback)获取安装入口。仓库内已有 PR 的分支 push 可能同时触发 push 和 PR 两次构建；较旧的分支构建可能被新的 push 取消。

预览包会被服务定期清理，仅用于临时测试，长期使用请换回正式 npm 版本。npm 12 安装插件预览时，其 core 预览也是远程依赖，可能需要 `--allow-remote=all`；后续重新安装时也需保留相应设置。

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

## 文档开发与检查

```bash
pnpm docs:dev
pnpm docs:typecheck
pnpm docs:build
pnpm docs:check
pnpm --filter @resource-fallback-example/vite-vue exec playwright install chromium
pnpm docs:test
```

`docs:check` 检查构建页面中的站内链接、锚点、重复 ID 和双语路由。`docs:test` 用生产构建验证搜索目标、手机配置表、URL 预览、请求演练和主题状态，截图位于被 git 忽略的 `test-results/docs/`。本机也可通过 `DOCS_BROWSER_PATH` 指定 Chrome 可执行文件。

指南负责接入步骤、限制与部署；根 README 保留定位与快速入口；配置类型与 API 注释在 `packages/core/src/` 修改，随后运行 `docs:typedoc`。`docs/api/` 是生成目录，`docs/reference/` 是手写 API 使用说明。中英文路由同步维护；替换标题或章节时保留已发布锚点。早期的两份 monolithic 报告已归档并排除出站点，维护拆分后的指南与案例。
