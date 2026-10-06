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

`test:integration` 同时运行 Node integration、Desktop integration 与 contract tests。`test:coverage` 对 Server 与核心 packages 执行 V8 覆盖率非回退门禁，并在 `coverage/` 生成 HTML/JSON 报告。组件测试通过 Vitest project 直接选择，避免继续增加根脚本。测试策略与设计原则参见 [AGENTS.md](AGENTS.md)。

### 网络录制与回放

- `pnpm dev:webui` 与 `pnpm dev:desktop` 联网刮削，并把每部影片的全部请求录制到 `.tmp/network-recordings/<编号>/`，失败也一并保留（超时除外）。设置 `MDCZ_NETWORK=replay` 则离线回放：先查 `.tmp/network-recordings`，再查 `tests/fixtures/network`，两处都没有的影片直接失败；`MDCZ_REPLAY_DELAY_MS` 为每个回放响应加延迟，用于验证暂停、恢复与停止。
- 回放按请求方法、规范化后的 URL 与请求体匹配，不比较请求头。录制中的 Cookie、Token 等凭据会替换为确定性的测试值；图片只保存尺寸与哈希，回放时生成同尺寸替身；视频不保存，回放统一使用 `tests/fixtures/mock-media/sample.mp4`。
- 场景测试位于 `apps/server/src/app.scrape-replay.integration.test.ts`。本地运行 `pnpm test:integration` 时，缺少录制的影片会联网录制并写入 `tests/fixtures/network`；已有录制但请求未命中时测试失败，不会静默重录；`pnpm test:integration -u` 重新录制并更新快照；CI 只读回放。
- 测试录制只保留与影片本身有关的结果（成功、`not_found`、`parse_error`）。因录制网络导致的失败（地区封锁、登录墙、Cloudflare、限流、IP 封禁、超时、连接失败）记入 `skippedSites`，回放时以相同原因立即失败。`-u` 使用当前机器的网络重录，例如在日本以外重录会把 DMM 记为 `region_blocked`。

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
