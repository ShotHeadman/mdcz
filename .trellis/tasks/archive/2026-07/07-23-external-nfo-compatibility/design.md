# 兼容外部工具 NFO 标识 - Design

## Boundary And Contract

维护扫描读取的是本地快照，不等同于一次成功的联网爬取。将 `CrawlerData.website` 放宽为可选，表达“本地元数据来源未知”；联网 aggregation 的返回值以及写出 mdcz 自有 NFO 的边界仍要求有效的 `Website`。

`parseNfoSnapshot` 返回的本地数据契约如下：

| 条件 | number | website | 结果 |
| --- | --- | --- | --- |
| 标准 `uniqueid[type]` | 该节点文本 | 已验证的枚举值 | 成功，优先级最高 |
| MDCx 外部标识 | `num`，再无 type 的 `uniqueid` | 已验证的 MDCx `<{site}id>` 映射 | 成功 |
| 有番号、无可识别来源 | `num` 或无 type 的 `uniqueid` | `undefined` | 成功，标记来源未知 |
| 无番号 | 无 | 任意 | 失败：`NFO missing number` |

不会从 NFO 文件名或目录名推断番号：`parseNfoSnapshot` 没有路径输入，且错误番号比拒绝更危险。原迁移脚本的文件名 fallback 不进入本次实现。

## Identifier Resolver

在 `packages/runtime/src/maintenance/nfoSnapshot.ts` 内新增无副作用的 resolver。它只读取已解析的 `<movie>` 节点，并返回 `{ number?: string; website?: Website }`。

解析顺序固定为：

1. 第一个带有可识别 `type` 的 `uniqueid`，同时取其文本为番号。
2. `num`，再无 `type` 的 `uniqueid`，取得外部番号。
3. 固定表驱动的、已验证 MDCx provider id 标签。

provider id 标签的表在 resolver 模块内唯一维护，且只包含 MDCx 当前上游写出的、可映射到 MDCz 的 `<{site}id>` 交集标签。标签只决定网站，不覆盖已经从高优先级路径获得的有效网站。MetaTube SDK 没有 NFO XML writer，故在没有 fixture 前不为它定义标签或 URL 映射；模糊文本和未知标签均不映射为任何默认站点。

现有 `scrape/nfo.ts` 不复用：它接收路径、可从路径推断番号并默认 `javdb`，与维护扫描的来源未知契约冲突。

## Flow

```text
external XML -> maintenance identifier resolver -> Local CrawlerData { number, website? }
                                                  -> read_local / asset discovery / organize_files
                                                  -> refresh_data: aggregate(fileInfo.number) -> CrawlerData { website }
                                                  -> generate mdcz NFO only with aggregation website
```

`read_local` 和 `organize_files` 继续直接使用本地快照。`refresh_data` 本来就忽略快照网站并按 `fileInfo.number` 聚合，故无需选定默认 provider。diff baseline、DTO 和 UI 传输需要接受省略的 `website`；所有需要生成 NFO 或构造 actor 来源 hint 的调用点应显式处理 `undefined`，而非填入假值。

## Compatibility And Rollback

- mdcz 标准 `<uniqueid type="...">` 行为不变，且优先于所有外部字段。
- 来源未知只影响本地扫描数据，刷新成功后以聚合产生的站点覆盖它。
- 未能提取番号仍是硬错误，避免组织操作把无身份文件移入错误目录。
- 变更限制在共享数据契约、maintenance parser/调用边界及其测试；删除 resolver fallback 即可恢复旧的严格行为。
