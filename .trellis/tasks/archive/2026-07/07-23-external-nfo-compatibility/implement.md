# 兼容外部工具 NFO 标识 - Implementation Plan

1. 在 maintenance NFO parser 中提取表驱动 identifier resolver，保留标准 `uniqueid[type]` 优先级，并支持已验证的 MDCx `<{site}id>` 标签、`num` 与无 type 的 `uniqueid`；MetaTube 保持来源未知的通用读取。
2. 将本地快照数据和传输 DTO 的 `website` 建模为可选；收紧 NFO 写出与联网 crawler 边界，使它们在需要时仍取得有效网站，禁止默认 `javdb`。
3. 调整 maintenance 的 diff baseline、actor source hints 和输出调用点，确保来源未知数据可以读取和整理，联网刷新仍仅按番号聚合。
4. 在维护 parser 单元测试加入 mdcz round-trip、MDCx/MetaTube 代表 fixture、provider tag 映射表、未知 provider 和缺失番号的失败案例。
5. 在 maintenance runtime 或 renderer contract 测试覆盖来源未知的 `read_local`、`organize_files` 与 `refresh_data` 基线，不回归已有扫描错误展示。

## Validation

- 运行 NFO parser、maintenance runtime/preparation 与相关 renderer contract 的聚焦 Vitest 测试。
- 运行 TypeScript 检查，确认 `website?: Website` 的每个需要来源的边界均显式处理。
- 运行受影响工作区的完整测试命令，确认标准 mdcz NFO 和 NFO 生成没有回归。

## Risk Review

- 不得将未知来源默认为 `javdb`，也不得因为来源未知失去编号、标题或本地资源引用。
- 标准 `uniqueid[type]` 的解析优先级不可改变；外部 fallback 只能追加。
- `CrawlerData.website` 变为可选会影响跨层契约，必须审查 server DTO、NFO 生成和 actor-source hint 的 undefined 处理。
