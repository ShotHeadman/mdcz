# Crawler 与真实媒体 Fixture 测试规划

## 目标

测试必须同时满足：crawler 解析可重复、真实媒体问题可复现、默认测试不访问公网、大文件不进入 Git。
任何 replay 未命中、manifest 缺失或 blob 校验失败都立即终止测试，禁止回退公网。

caseId 从媒体相对路径的文件名自动派生，例如 `SSIS-497.mp4` 对应 `ssis-497`。同一次任务发现重复 caseId 时立即失败，不再维护独立录制 plan。

## Fixture 分层

### Source crawler fixture

```text
tests/fixtures/crawler/<website>/<caseId>/
├── cassette.json
└── responses/
```

只覆盖 `crawlerProvider.crawl()` 范围内的原始请求与响应。HTML、JSON、crawler 主动读取的二进制响应按原始 bytes 提交 Git。poster、thumb、fanart、scene、trailer 下载以及翻译、人物同步不进入 source cassette。

### 真实媒体 manifest

```text
tests/fixtures/media/<caseId>/manifest.json
```

manifest 提交 Git，保存下载阶段实际发生的 method、URL、最终 headers、顺序、响应 SHA-256 和 byte length。同一 URL 的 probe、range request 和完整下载分别记录。

### 真实媒体 blob pack

```text
tests/fixtures/media/blobs/<sha256>
```

blob pack 被 `.gitignore` 排除。文件是录制时的真实响应 bytes，不格式化、不转码、不降采样。团队通过私有 artifact、NAS 或挂载目录分发；开发机只 hydrate 一次，之后完全离线。

```bash
pnpm fixtures:media:hydrate /path/to/artifact
pnpm fixtures:media:verify
```

hydrate 和 replay 都会校验 hash 与长度。缺文件或内容变化直接失败。

## 录制边界

```text
ScrapeItemContext
├── CrawlerSourceContext     → source cassette
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

使用 `MediaReplayNetworkClient` 加载 manifest 和本地 blob。crawler 输出中的远程 URL 保持不变，网络客户端在最终 dispatch 处返回真实本地 bytes，不需要常驻 HTTP server。

只有测试 redirect、Range、缓存头或浏览器原生加载时才启动进程内临时 HTTP server，或由 Playwright `page.route()` fulfill 原始 URL。

### Web/Desktop E2E

```bash
pnpm test:e2e:fixtures
```

fixture E2E 使用真实产品构建和 UI journey，设置 `MDCZ_REPLAY_CRAWLER=1`，关闭 thumb、poster、fanart、scene、trailer、翻译、人物同步和更新检查，仍生成 NFO。任何 crawler 请求未命中都会失败且不访问公网。

需要验证真实图片展示、裁剪或模糊度时，运行单独的 real-media journey，启用目标资产并注入 `MediaReplayNetworkClient` 或 Playwright route。

## 视觉与媒体断言

- crawler 选图：断言 URL、来源 Website、候选顺序和最终 role。
- 文件真实性：断言 SHA-256、MIME、byte length、可解码性和像素尺寸。
- 模糊度：对选定真实案例记录清晰度指标阈值，不用合成 bytes 代替。
- 裁剪位置：对真实输入执行生产裁剪，比较 perceptual hash 或视觉 golden。
- 页面布局：Playwright 使用本地真实 blob 截图比较。
- 视频：普通下载行为使用小型有效 MP4；只有编码、封装或播放回归才保留真实代表性片段，不保存完整影片。

视觉 golden 可以与真实媒体 blob 一起放在私有 artifact 中，Git 只保存其 hash 和测试阈值。

## 凭据规则

Cookie、Authorization、CSRF、query token、request-body token 和 Set-Cookie 使用进程内一致假值。真实值映射不得写盘。替换改变 body 长度时同步更新 `content-length`。自动发布持有完整进程内映射并执行残留扫描；独立 `record:publish` 只作为 staging 恢复工具，不能替代录制进程的凭据审计。

## 测试矩阵

录制器是一次性脚手架，不合入 main，也不建立长期单元测试矩阵。录制分支只做一次人工 smoke：一个 item 命中多个 Website、一个真实媒体响应、退出后 receipt 与自动发布成功。

main 中只保留与 fixture 消费有关的最小覆盖：

1. 每个已提交 Website 用一份代表 cassette 跑真实 crawler parser，未命中和残留 interaction fail fast。
2. 用一个代表 case 验证多 source 聚合，不穷举所有组合。
3. 用一个真实图片 blob 验证离线媒体 replay、hash、尺寸和目标视觉问题；视频仅在确有播放/封装回归时增加短片段。
4. 用一条 Web/Desktop 代表 journey 验证禁止公网和 NFO 终态，不为录制工具本身增加 E2E。

录制结束后 stash：raw recorder、凭据替换、staging/finalizer、dev/codegen/Inspector 包装和录制期 package scripts。main 只接收 raw dispatch/context、schema/loader、replay、审核后的 fixture 与上述最小测试。

## 实施状态

- [x] item/source async context 与 raw dispatch
- [x] source cassette schema、hash 校验、发布与 replay
- [x] media download async context
- [x] Git 内 media manifest 与 Git 外 content-addressed blob
- [x] media recorder、校验、hydrate 和 replay client
- [x] Desktop graceful quit 与 Web runner 等待退出
- [x] 应用级 crawler replay 环境开关与 fixture E2E 入口
- [x] fixture E2E 关闭所有下游公网行为
- [x] 临时 recorder 沿用原有 smoke 覆盖，不再扩展录制器测试
- [ ] 录制并审核首批 DMM/JavDB/JavBus source fixtures
- [ ] 用 cassette 替换各 source 的代表性手写 HTML 测试
- [ ] 增加 DMM + JavDB、JavDB + JavBus、三 source 聚合 fixture 测试
- [ ] 录制首批真实 poster/thumb/scene/trailer blob pack并发布私有 artifact
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
