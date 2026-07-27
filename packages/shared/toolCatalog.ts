export type ToolId =
  | "single-file-scraper"
  | "crawler-tester"
  | "amazon-poster"
  | "media-library-tools"
  | "symlink-manager"
  | "file-cleaner"
  | "batch-nfo-translator";

export type ToolOverviewLayout = "featuredThird" | "standardHalf" | "compactHalf" | "compactFull";

export interface ToolDefinition {
  id: ToolId;
  title: string;
  description: string;
  detailTitle: string;
  detailDescription: string;
  overviewLayout: ToolOverviewLayout;
  overviewIcon: "file" | "bug" | "amazon" | "folder" | "link" | "trash" | "translate" | "search";
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: "single-file-scraper",
    title: "单文件刮削",
    description: "针对单个媒体文件快速发起元数据提取任务。",
    detailTitle: "单文件刮削",
    detailDescription: "输入文件路径，快速处理指定视频并自动提交到后台任务队列。",
    overviewLayout: "featuredThird",
    overviewIcon: "file",
  },
  {
    id: "crawler-tester",
    title: "爬虫测试",
    description: "验证站点规则、连通性和抓取结果是否符合预期。",
    detailTitle: "爬虫测试",
    detailDescription: "选择目标站点和番号，立即验证规则、浏览器连接以及字段提取效果。",
    overviewLayout: "featuredThird",
    overviewIcon: "bug",
  },
  {
    id: "amazon-poster",
    title: "Amazon 海报增强",
    description: "扫描媒体目录并获取更适合展示的高质量海报。",
    detailTitle: "Amazon 海报增强",
    detailDescription: "扫描已刮削目录中的条目，从 Amazon.co.jp 拉取更适合展示的竖版海报。",
    overviewLayout: "featuredThird",
    overviewIcon: "amazon",
  },
  {
    id: "media-library-tools",
    title: "Emby / Jellyfin 维护",
    description: "补全人物资料并检查库状态，让媒体信息保持一致。",
    detailTitle: "人物工具",
    detailDescription: "诊断连接状态并同步人物头像与简介。",
    overviewLayout: "standardHalf",
    overviewIcon: "folder",
  },
  {
    id: "symlink-manager",
    title: "软链接管理",
    description: "批量创建或校验目录映射，保持库结构整洁稳定。",
    detailTitle: "软链接管理",
    detailDescription: "在不同目录间建立文件组织结构映射，适合分离原始存储与媒体展示目录。",
    overviewLayout: "standardHalf",
    overviewIcon: "link",
  },
  {
    id: "file-cleaner",
    title: "文件清理",
    description: "扫描并删除无用附件、临时文件和冗余产物。",
    detailTitle: "文件清理",
    detailDescription: "根据扩展名扫描目标目录，先预览待删文件，再批量确认清理。",
    overviewLayout: "standardHalf",
    overviewIcon: "trash",
  },
  {
    id: "batch-nfo-translator",
    title: "批量翻译 NFO",
    description: "扫描待翻译字段并批量回写标题、简介等文本。",
    detailTitle: "批量翻译 NFO",
    detailDescription: "扫描现有媒体库中的 NFO，使用当前 LLM 配置批量翻译标题和简介后回写。",
    overviewLayout: "standardHalf",
    overviewIcon: "translate",
  },
] as const;

export const TOOL_DEFINITIONS_BY_ID = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.id, tool])) as Record<
  ToolId,
  ToolDefinition
>;
