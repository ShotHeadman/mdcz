# 开发

## 环境准备

工具链版本固定在 [mise.toml](mise.toml) 中。安装 [mise](https://mise.jdx.dev/) 后在仓库根目录执行：

```bash
mise install
pnpm install
pnpm dev:webui      # WebUI 模式（server + web）
pnpm dev:desktop    # 桌面端模式
```

## 测试

```bash
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:coverage
pnpm exec playwright install chromium # 组件测试首次运行或浏览器版本更新后
pnpm exec vitest run --project component --silent
```

`test:integration` 同时运行 Node integration、Desktop integration 与 contract tests。`test:coverage` 对 Server 与核心 packages 执行 V8 覆盖率非回退门禁，并在 `coverage/` 生成 HTML/JSON 报告。组件测试通过 Vitest project 直接选择，避免继续增加根脚本。测试策略与设计原则参见 [AGENTS.md](AGENTS.md)，网络录制与回放规则参见 [测试 Fixture 指南](docs/testing-fixtures.md)。

## 代码风格

使用 [Biome](https://biomejs.dev/) 进行格式化和代码检查：

```bash
pnpm format
```

## 类型检查

```bash
pnpm typecheck
```

## 代码结构

```
apps/
├── desktop/      # Electron 桌面端：main 主进程、preload、renderer 界面
├── server/       # WebUI / Docker 后端：HTTP 与 tRPC 路由、任务队列
└── web/          # WebUI 前端
packages/
├── runtime/      # 刮削、爬虫、媒体库整理、媒体服务器同步、翻译等核心业务
├── views/        # 桌面端与 WebUI 共用的页面、状态与 i18n
├── ui/           # 基础 UI 组件
├── shared/       # 跨进程共享的类型、配置 schema 与 IPC 契约
├── persistence/  # Drizzle/SQLite 持久化与迁移
└── media-store/  # 媒体根目录与文件系统访问
```

## 发版

1. 在 `feat/<版本>` 分支开发，完成后向 `main` 提 PR，CI 通过后合并。
2. 合并后 `release.yml` 会按 Conventional Commits 递增版本号、推送 tag、构建全部平台并创建 **草稿** Release。
3. 补充 Release 说明后手动发布。

如果构建在 tag 推送之后失败，请在原来那次 run 上点「Re-run failed jobs」。手动触发 `workflow_dispatch` 会因最新 commit 已是 `chore(release)` 而跳过全部任务。
