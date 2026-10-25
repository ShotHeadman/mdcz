import type { Messages } from "../en";

export const libraries: Messages["libraries"] = {
  title: "库配置",
  description: "媒体库定义了新视频的来源目录、整理输出目录、命名模板及文件放置方式，刮削结果将归档到对应的媒体库中。",
  add: "新建库",
  createFirst: "创建第一个库",
  createFirstDescription: "配置视频来源与整理输出目录，刮削完成后将自动归档入库。",
  importExisting: "我已有媒体库",
  importExistingDescription: "指向一个已有视频和 NFO 的目录，MDCz 只读取现有内容，不移动也不改写任何文件。",
  importTitle: "导入已有媒体库",
  importSave: "保存并导入",
  health: {
    title: "健康状况",
    movies: (count: number) => `已索引 ${count} 部影片`,
    notImported: "该媒体库尚未建立索引。导入后可查看缺失的元数据与海报。",
    import: "立即导入",
    view: "查看",
    pending: (count: number) => `${count} 个文件在待处理列表`,
    allGood: "元数据与海报均完整。",
  },
  edit: "编辑",
  delete: "删除",
  deleteTitle: (name: string) => `删除库「${name}」？`,
  deleteDescription: "仅删除该库配置与监控状态，现有视频与 NFO 保持不变。",
  loadFailed: (error: string) => `无法加载库：${error}`,
  editorCreateTitle: "新建库",
  editorEditTitle: "编辑库",
  save: "保存",
  fields: {
    name: "名称",
    sourcePath: "来源目录",
    sourcePathHint: "新视频到达的位置，例如下载目录或网盘挂载目录。",
    importSourcePathHint: "已经存放视频和 NFO 的目录。",
    outputPath: "输出目录",
    outputPathHint: "整理好的影片及元数据存放的位置，媒体服务器指向这个目录。",
    placement: "放置方式",
    folderTemplate: "文件夹模板",
    fileTemplate: "文件名模板",
    automation: "自动化",
    discovery: "发现方式",
    cloudPath: "CloudDrive2 路径",
    cloudPathHint: "这个库的根目录在 CloudDrive2 中的路径，例如 /115/Downloads。",
    scanIntervalMinutes: "完整重扫间隔（分钟）",
    scanIntervalHint: "补上变更事件遗漏的文件，例如不发送事件的网络挂载。",
  },
  placements: {
    move: {
      label: "移动",
      description: "把视频移动到输出目录，按模板重命名。轮询的 qBittorrent 分类中的视频改为硬链接，以便继续做种。",
    },
    hardlink: {
      label: "硬链接",
      description: "在输出目录创建硬链接并保留源文件，种子可以继续做种；两个目录必须在同一卷上。",
    },
    copy: { label: "复制", description: "把视频复制到输出目录并保留源文件。" },
    symlink: { label: "软链接", description: "视频留在原处，在输出目录的元数据旁放一个符号链接。" },
    strm: {
      label: "STRM 虚拟文件 (.strm)",
      description:
        "视频留在原处（本地或网盘均可），在输出目录的元数据旁为每个视频写入指向它的 .strm 存根文件。媒体服务器需能以与 MDCz 相同的路径访问视频。",
    },
    metadataOnly: {
      label: "仅元数据",
      description:
        "视频保留原位，仅将 NFO 和图片导出到输出目录用于归档备份（输出目录不含视频，媒体服务器无法直接播放）。",
    },
    inPlace: { label: "原地整理", description: "视频保留原始位置和文件名，元数据写在视频同级目录，无需指定输出目录。" },
  },
  automationLevels: {
    off: { label: "关闭", description: "只处理手动发起的刮削。" },
    register: { label: "仅登记", description: "新文件自动登记到待处理列表，等待手动确认刮削。" },
    scrape: { label: "登记并刮削", description: "新文件写入或传输完成后自动开始刮削。" },
  },
  discoveryModes: {
    events: { label: "本地变更事件", description: "监听来源目录的文件系统事件。" },
    clouddrive: {
      label: "CloudDrive2 Webhook",
      description: "由 CloudDrive2 把变更通知给 MDCz；在其文件系统监控中设置向下方 Webhook 发送 POST。",
    },
  },
  baselineNotice:
    "首次开启自动化时，来源目录中现存的文件仅作为基线记录，不会自动触发刮削；存量文件请前往工作台手动刮削。",
  issues: {
    libraryPathNotAbsolute: "请输入绝对路径",
    libraryOutputRequired: "这种放置方式需要输出目录",
    libraryOutputOverlapsSource: "输出目录与来源目录不能互相包含或重叠",
    libraryCloudPathInvalid: "请输入以 / 开头的 CloudDrive2 库根路径",
    optionalSegmentPathSeparator: "[] 可选段不能包含路径分隔符",
  },
  card: {
    source: "来源",
    output: "输出",
    noOutput: "视频同级目录",
    automationOff: "手动",
    cloudDriveLastEvent: (time) =>
      time
        ? `该媒体库最近一次收到 CloudDrive2 事件：${time}`
        : "MDCz 启动以来该媒体库尚未收到 CloudDrive2 事件，请检查 Webhook 和云端路径。",
  },
  stubSourceHint:
    "来源目录中包含 .strm 文件。建议选择「原地整理」：元数据写在每个 .strm 同级目录，.strm 文件保留在 STRM 助手预期的位置。",
};
