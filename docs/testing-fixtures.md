# Crawler 与真实媒体 Fixture 测试规划

## 目标

测试必须同时满足：crawler 解析可重复、真实媒体问题可复现、默认测试不访问公网、大文件不进入 Git。
任何 crawler replay 未命中都立即终止且禁止回退公网。媒体 blob 未 hydrate 时，标准测试回退到仓库内置微型 Mock 素材；像素/编码级断言则显式跳过。

caseId 从媒体相对路径的文件名自动派生，例如 `SSIS-497.mp4` 对应 `ssis-497`。同一次任务发现重复 caseId 时立即失败，不再维护独立录制 plan。

录制与回放工具链是长期测试基础设施，常驻主分支。生产构建（Electron / Server）只打包应用产物，不包含 `tests/`；录制器仅在 `MDCZ_RECORD_CRAWLER=1` 时由 `createCrawlerNetworkClient()` 激活，终端用户路径不启用录制逻辑。

## Fixture 分层

### Source crawler fixture（纯文本 Cassette）

```text
tests/fixtures/crawler/<website>/<caseId>/
├── cassette.json
└── responses/          # 仅 .html / .json / .txt
```

只覆盖 `crawlerProvider.crawl()` 范围内的原始请求与响应。Cassette 只验证文本元数据解析：HTML、JSON 与其它文本。`image/*`、`video/*` 以及未知二进制不得写入 `responses/`，发布前 `validateCrawlerFiles` 会阻断任何媒体文件。

poster、thumb、fanart、scene、trailer 下载以及翻译、人物同步不进入 source cassette。

### 真实媒体 manifest

```text
tests/fixtures/media/<caseId>/manifest.json
```

manifest 提交 Git，保存下载阶段实际发生的 method、URL、最终 headers、顺序、响应 SHA-256 和 byte length。同一 URL 的 probe、range request 和完整下载分别记录。

### 真实媒体 blob pack（Git 排除）

```text
tests/fixtures/media/blobs/<sha256>
```

blob pack 被 `.gitignore` 排除。文件是录制时的真实响应 bytes，不格式化、不转码、不降采样。团队通过本地磁盘或私有网盘分发，不使用公网 GitHub Release。开发机挂载或同步到上述目录，或执行：

```bash
pnpm fixtures:media:hydrate /path/to/private-blobs
pnpm fixtures:media:verify
```

hydrate 与 `fixtures:media:verify` 都会校验 hash 与长度。缺文件或内容变化直接失败。

### 内置微型 Mock 素材

```text
tests/fixtures/mock-media/sample.jpg    # 1×1 合法 JPEG，补齐到生产 validateImage 的 8KB 下限
tests/fixtures/mock-media/sample.mp4    # 约 0.5 秒 H.264/AAC 空白 MP4
```

普通开发者与 CI 无需私有 Blob 即可跑通下载、命名、NFO 与 Sharp 读取。Mock 不是像素/编码金标准。

## 分层执行

| 层级 | 命令 / 条件 | 媒体来源 |
| :--- | :--- | :--- |
| 核心流程与单元测试 | `pnpm test:unit` | crawler 文本 Cassette；不依赖真实 Blob |
| 离线流程回放 | `pnpm test:e2e:fixtures` | manifest + 真实 Blob；缺失时自动回退 Mock |
| 真实像素与编码深度测试 | 按需；`MDCZ_MEDIA_REPLAY_STRICT=1` | 必须 hydrate 私有 Blob，否则 `MissingMediaBlobError` / `it.skip` |

## 录制边界

```text
ScrapeItemContext
├── CrawlerSourceContext     → source cassette（纯文本）
└── MediaFixtureContext      → media manifest + local/private blob pack
```

`MediaFixtureContext` 只包围 `DownloadManager.downloadAll()`。因此真实 poster、thumb、scene 和 trailer 可被录制，而翻译、人物同步、媒体服务器请求仍在范围外。

录制输出先进入：

```text
test-results/recording/staging/<website>/<caseId>
test-results/recording/media-staging/<caseId>
tests/fixtures/media/blobs/<sha256>
```

应用退出时先停止 scrape 服务，等待所有 recorder write chain，完整验证 crawler cassette、media manifest、blob hash、Website 隔离及凭据残留，再发布 Git 内文件。Desktop 必须阻止第一次 quit 直到清理完成；Web runner 必须等待 server 真正退出。

验证成功会生成 `test-results/recording/validated.json`，记录 staging manifest 的 hash。录制 wrapper 和手动发布都会核对该 receipt；空 staging、旧 receipt 或录制进程未完成凭据审计时禁止发布。

`pnpm record:webui` 将 codegen 输出保存到 `tests/recording/journeys/web-representative-batch.spec.ts`。`pnpm record:desktop` 构建 Desktop 后通过 Electron Playwright harness 启动 Inspector，用户完成操作并 Resume 后才关闭应用和发布 fixture。

## Replay 组合

### 单 crawler

使用 `CrawlerReplayNetworkClient` 加载一个 `<website>/<caseId>`，执行真实 crawler parser，并在结束时 `assertConsumed()`。

### 聚合

同一 caseId 可选择任意 Website 组合。聚合测试运行真实 `CrawlerProvider`，不得把处理后的 `CrawlerData` 当作 fixture 输入。

### 下游媒体

使用 `MediaReplayNetworkClient` 加载 manifest 和本地 blob。crawler 输出中的远程 URL 保持不变，网络客户端在最终 dispatch 处返回本地 bytes，不需要常驻 HTTP server。

- 本地存在 `blobs/<sha256>`：返回真实 bytes（字节精确匹配）。
- 本地缺失：默认使用 `tests/fixtures/mock-media/` 中的对应占位文件，并改写 `content-length`，避免 `ENOENT`。
- `MDCZ_MEDIA_REPLAY_STRICT=1` 或 `fallbackToMock: false`：抛出 `MissingMediaBlobError`，深度视觉/清晰度测试应 `it.skip` 并提示挂载私有网盘。

只有测试 redirect、Range、缓存头或浏览器原生加载时才启动进程内临时 HTTP server，或由 Playwright `page.route()` fulfill 原始 URL。

### Web/Desktop E2E

```bash
pnpm test:e2e:fixtures
```

fixture E2E 使用真实产品构建和 UI journey，设置 `MDCZ_REPLAY_CRAWLER=1`，关闭 thumb、poster、fanart、scene、trailer、翻译、人物同步和更新检查，仍生成 NFO。任何 crawler 请求未命中都会失败且不访问公网。

需要验证真实图片展示、裁剪或模糊度时，运行单独的 real-media journey，启用目标资产、hydrate 私有 Blob，并注入 `MediaReplayNetworkClient` 或 Playwright route。

## 视觉与媒体断言

- crawler 选图：断言 URL、来源 Website、候选顺序和最终 role。
- 文件真实性：断言 SHA-256、MIME、byte length、可解码性和像素尺寸。必须使用 hydrate 后的真实 Blob。
- 模糊度：对选定真实案例记录清晰度指标阈值，不用 Mock bytes 代替。
- 裁剪位置：对真实输入执行生产裁剪，比较 perceptual hash 或视觉 golden。
- 页面布局：Playwright 使用本地真实 blob 截图比较。
- 视频：普通下载行为使用内置微型 MP4；只有编码、封装或播放回归才保留真实代表性片段，不保存完整影片。

视觉 golden 可以与真实媒体 blob 一起放在私有存储中，Git 只保存其 hash 和测试阈值。

## 凭据规则

Cookie、Authorization、CSRF、query token、request-body token 和 Set-Cookie 使用进程内一致假值。真实值映射不得写盘。替换改变 body 长度时同步更新 `content-length`。自动发布持有完整进程内映射并执行残留扫描；独立 `record:publish` 只作为 staging 恢复工具，不能替代录制进程的凭据审计。

## 测试矩阵

录制与回放工具链留在主分支，作为维护 crawler 规则的基础设施。覆盖以行为与状态不变性为中心，收敛到最少的核心闭环，不叠加与现有契约重叠的单测。

主分支最小覆盖：

1. 每个已提交 Website 用一份代表 cassette 跑真实 crawler parser，未命中和残留 interaction fail fast。
2. 用一个代表 case 验证多 source 聚合，不穷举所有组合。
3. 未 hydrate 时用 Mock 素材跑通离线下载、命名与 NFO；hydrate 后用一个真实图片 blob 验证 hash、尺寸和目标视觉问题。视频仅在确有播放/封装回归时增加短片段。
4. 用一条 Web/Desktop 代表 journey 验证禁止公网和 NFO 终态，不为录制工具本身增加 E2E。

## 实施状态

- [x] item/source async context 与 raw dispatch
- [x] source cassette schema、hash 校验、发布与 replay
- [x] crawler cassette 拒绝媒体二进制，媒体由 manifest + blob 接管
- [x] media download async context
- [x] Git 内 media manifest 与 Git 外 content-addressed blob
- [x] media recorder、校验、hydrate 和 replay client
- [x] 内置 Mock 素材与缺失 Blob 时的回放降级
- [x] Desktop graceful quit 与 Web runner 等待退出
- [x] 应用级 crawler replay 环境开关与 fixture E2E 入口
- [x] fixture E2E 关闭所有下游公网行为
- [ ] 录制并审核首批 DMM/JavDB/JavBus source fixtures
- [ ] 用 cassette 替换各 source 的代表性手写 HTML 测试
- [ ] 增加 DMM + JavDB、JavDB + JavBus、三 source 聚合 fixture 测试
- [ ] 录制首批真实 poster/thumb/scene/trailer blob pack 并同步到私有网盘
- [ ] 增加真实图片清晰度、裁剪和 Playwright visual journey
- [ ] 完成 Web/Desktop fixture E2E 首次基线运行

## 最终验证

```bash
pnpm fixtures:media:verify
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e:fixtures
pnpm check
```
