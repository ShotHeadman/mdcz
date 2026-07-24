# 兼容外部工具 NFO 标识

## Goal

为工作台维护扫描中的 MDCx/MetaTube 代表性 NFO 提供受控的番号与网站标识兼容，解决 #63。该功能不是数据库导入：系统只读取媒体目录里的 NFO，用于“读取本地”、本地整理和联网刷新前的本地元数据/资源基线。

外部 NFO 的来源网站可以未知。来源未知不得妨碍本地读取、资源发现或按本地元数据整理；联网刷新则按番号走现有全站聚合，而不是伪造一个来源网站。

## Confirmed Facts

- `packages/runtime/src/maintenance/nfoSnapshot.ts:84` 当前只接受 `uniqueid` 且要求其 `type` 是内部 `Website` 枚举。
- MDCx 当前上游 NFO writer 固定写入 `num`，并将外部 ID 写成 `<{site}id>`。只验证并支持与 MDCz `Website` 枚举相交的标签：`dahliaid`、`dmmid`、`falenoid`、`fc2id`、`fc2hubid`、`jav321id`、`javbusid`、`javdbid`、`mgstageid`、`prestigeid`。
- MetaTube SDK 只定义 API 的 `provider` / `id` 数据模型，没有 NFO XML writer 或字段规范；没有代表性 fixture 前不为它推断专用标签或 URL。
- `CrawlerData.website` 与 `packages/shared/serverDtos.ts` 当前将网站视为必填，但维护预设的 `read_local`、`organize_files` 不读取该字段；`refresh_data` 仅按 `fileInfo.number` 聚合。
- `packages/runtime/src/scrape/nfo.ts:382` 另有更宽松 parser，但 maintenance 没有复用其标识解析，且其默认 `javdb` 的行为不适用于来源未知的本地快照。
- `LocalScanService` 在扫描视频旁的同名 `.nfo`、`movie.nfo` 或目录内首个 NFO 后调用该 parser；`read_local` 展示解析结果，`organize_files` 依赖它生成整理计划，联网刷新预设则把它作为本地基线/资源引用。

## Requirements

- 标准 `uniqueid[type]` 始终优先，兼容 fallback 集中在一个结构化 identifier resolver。
- 首批兼容 `num`、无 type 的 `uniqueid` 和已验证的 MDCx `<{site}id>` 标签；MetaTube 或未知格式只走来源未知的通用解析，实际专用字段必须以脱敏 fixture 固化。
- 无法可靠确定番号时继续拒绝，不静默生成错误记录。
- 无法可靠确定网站时，解析为来源未知的本地快照，而非默认任何 `Website`；这类快照必须能被读取本地、发现关联资源并用于本地整理。联网刷新按番号重新聚合，只有生成 mdcz 自有 NFO 的边界要求网站存在。
- 评估两个 NFO parser 的复用边界；兼容映射只在维护解析器维护，不能复用会默认 `javdb` 的 scrape parser，也不从未验证的 `website` 文本或 URL 推断来源。

## Acceptance Criteria

- [ ] 代表性 MDCx 与 MetaTube fixture 能在维护扫描中解析出正确 number/title；存在显式来源时解析正确 `website`，不存在时网站为空且仍能进入读取本地结果。
- [ ] mdcz 标准 NFO round-trip 测试保持通过。
- [ ] 未识别 provider 不被错误映射；存在番号时以来源未知的快照继续，缺少番号时错误消息明确指出缺失的是番号。
- [ ] provider tag 映射集中维护并有表驱动测试。
- [ ] 来源未知 fixture 能生成本地整理计划；联网刷新以其番号进入现有聚合路径并由聚合结果提供网站。

## Out of Scope

- 承诺兼容所有 Kodi/Jellyfin NFO 方言，自动改写用户原始 NFO 文件，或为来源未知的文件指定默认爬虫站点。
