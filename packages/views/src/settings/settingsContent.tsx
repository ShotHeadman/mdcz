import { isSharedDirectoryMode } from "@mdcz/shared/assetNaming";
import { type Configuration, NFO_FIELD_OPTIONS, type NfoField } from "@mdcz/shared/config";
import { TRANSLATION_TARGET_OPTIONS } from "@mdcz/shared/enums";
import { DEFAULT_LLM_BASE_URL } from "@mdcz/shared/llm";
import {
  POSTER_TAG_BADGE_ASPECT_HEIGHT,
  POSTER_TAG_BADGE_ASPECT_WIDTH,
  POSTER_TAG_BADGE_IMAGE_EXTENSIONS,
  POSTER_TAG_BADGE_IMAGE_FILENAMES,
  POSTER_TAG_BADGE_POSITION_LABELS,
  POSTER_TAG_BADGE_POSITION_OPTIONS,
  POSTER_TAG_BADGE_TYPE_LABELS,
  POSTER_TAG_BADGE_TYPE_OPTIONS,
} from "@mdcz/shared/posterBadges";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormControl,
  Input,
  Switch,
} from "@mdcz/ui";
import { CircleHelp, FolderOpen, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import {
  BaseField,
  BoolField,
  ChipArrayFieldWrapper,
  CookieFieldWrapper,
  DurationFieldWrapper,
  EnumField,
  type EnumOption,
  NumberField,
  PathArrayFieldWrapper,
  PathFieldWrapper,
  PromptFieldWrapper,
  SecretField,
  ShortcutField,
  TextField,
  UrlField,
} from "../config-form/FieldRenderer";
import { AggregationPriorityEditorField } from "./AggregationPriorityEditorField";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import { useSettingsSectionMode } from "./SettingsSectionModeContext";
import { useSettingsInFlightSaves, useSettingsNotifier, useSettingsServices } from "./SettingsServices";
import { useHasRenderableFields } from "./sectionVisibility";
import { AGGREGATION_PRIORITY_FIELDS, getNestedValue, isRecord, unflattenConfig } from "./settingsRegistry";

// ── Constants ──

const PROXY_TYPE_OPTIONS = ["none", "http", "https", "socks5"];
const TRANSLATE_ENGINE_OPTIONS: EnumOption[] = [
  { value: "openai", label: "LLM 翻译" },
  { value: "google", label: "Google 翻译（免费）" },
];
const LANGUAGE_OPTIONS = [...TRANSLATION_TARGET_OPTIONS];
const LLM_REASONING_FIELD_OPTIONS: EnumOption[] = [
  { value: "default", label: "服务端默认" },
  { value: "disabled", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
const LLM_API_FORMAT_FIELD_OPTIONS: EnumOption[] = [
  { value: "responses", label: "Responses" },
  { value: "chat-completions", label: "Chat Completions" },
];
const LLM_SERVICE_TYPE_FIELD_OPTIONS: EnumOption[] = [
  { value: "openai-compatible", label: "OpenAI 兼容" },
  { value: "google", label: "Google" },
  { value: "deepseek", label: "DeepSeek" },
];
const LLM_OUTPUT_FORMAT_FIELD_OPTIONS: EnumOption[] = [
  { value: "none", label: "提示词 JSON" },
  { value: "json_object", label: "JSON Object" },
  { value: "json_schema", label: "JSON Schema" },
];
const PART_STYLE_OPTIONS: EnumOption[] = [
  { value: "RAW", label: "保持原始后缀" },
  { value: "CD", label: "统一为 CD1 / CD2" },
  { value: "PART", label: "统一为 PART1 / PART2" },
  { value: "DISC", label: "统一为 DISC1 / DISC2" },
];
const ASSET_NAMING_OPTIONS: EnumOption[] = [
  { value: "fixed", label: "固定命名" },
  { value: "followVideo", label: "跟随影片文件名" },
];
const NFO_NAMING_OPTIONS: EnumOption[] = [
  { value: "both", label: "同时生成两种" },
  { value: "movie", label: "仅 movie.nfo" },
  { value: "filename", label: "仅 文件名.nfo" },
];
const NFO_ENABLED_FIELD_LABELS: Record<NfoField, string> = {
  num: "番号兼容字段",
  plot: "简介与摘要",
  release: "发行信息",
  runtime: "片长",
  fileinfo: "视频技术信息",
  rating: "评分",
  studio: "片商",
  director: "导演",
  publisher: "发行商",
  series: "系列",
  genres: "类型",
  tags: "标签",
  poster: "海报",
  thumb: "横版缩略图",
  fanart: "背景图",
  sceneImages: "剧照来源",
  trailer: "预告片",
  sourceComment: "聚合来源注释",
};
const NFO_ENABLED_FIELD_OPTIONS: EnumOption[] = NFO_FIELD_OPTIONS.map((value) => ({
  value,
  label: `${value}（${NFO_ENABLED_FIELD_LABELS[value]}）`,
}));
const TAG_BADGE_TYPE_OPTIONS = POSTER_TAG_BADGE_TYPE_OPTIONS.map((value) => ({
  value,
  label: POSTER_TAG_BADGE_TYPE_LABELS[value],
}));
const TAG_BADGE_POSITION_OPTIONS: EnumOption[] = POSTER_TAG_BADGE_POSITION_OPTIONS.map((value) => ({
  value,
  label: POSTER_TAG_BADGE_POSITION_LABELS[value],
}));
const TAG_BADGE_IMAGE_EXTENSION_LABEL = POSTER_TAG_BADGE_IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(
  " / ",
);
const TAG_BADGE_IMAGE_RATIO_LABEL = `${POSTER_TAG_BADGE_ASPECT_WIDTH}:${POSTER_TAG_BADGE_ASPECT_HEIGHT}`;

const NAMING_TEMPLATE_PLACEHOLDERS = [
  ["{actor}", "用于文件命名的演员显示名；会按“演员名最大数量”截断，超出时追加当前配置的后缀，默认是“等演员”"],
  ["{actorFallbackPrefix}", "只有 {actor} 回退到片商或卖家时才输出，如“片商：”或“卖家：”"],
  ["{firstActor}", "首位演员；没有演员时使用当前 {actor} 的值"],
  ["{allActors}", "完整演员列表，不受“演员名最大数量”和“演员名超出后缀”影响；没有演员时使用当前 {actor} 的值"],
  ["{number}", "番号，包含当前命名规则追加的字幕、无码、流出等标识"],
  ["{rawNumber}", "原始番号，不追加命名标识"],
  ["{letters}", "番号前缀，如 ABC-123 输出 ABC，FC2-123456 输出 FC2"],
  ["{firstLetter}", "番号首字符；非字母数字时输出 #"],
  ["{title}", "中文标题优先；没有中文标题时使用原标题"],
  ["{originaltitle}", "抓取到的原标题"],
  ["{outline} / {plot}", "中文简介优先；没有中文简介时使用原始简介"],
  ["{date} / {release}", "按“发行日期格式”处理后的发行日期"],
  ["{year}", "发行年份"],
  ["{runtime}", "片长，单位为分钟"],
  ["{director}", "导演"],
  ["{series}", "系列"],
  ["{studio}", "片商"],
  ["{publisher}", "发行商"],
  ["{filename}", "原始视频文件名，不含扩展名"],
  ["{definition} / {resolution}", "视频分辨率，如 1080P、2160P"],
  ["{4K}", "分辨率达到 4K 或 8K 时输出对应标识"],
  ["{cnword}", "检测到中文字幕时输出配置的字幕标识"],
  ["{subtitle}", "字幕标签，如 中文字幕"],
  ["{censorshipType}", "码制类型，按番号、本地选择、标题和标签线索推导，如 有码、无码、无码破解、无码流出"],
  ["{score} / {rating}", "评分"],
  ["{website}", "最终采用的抓取站点标识"],
] as const;

const NAMING_TEMPLATE_NOTES = {
  folder: [
    "该配置里的 / 或 \\ 会创建多级文件夹；",
    "移动视频与字幕或仅输出元数据时，会按文件夹模板创建目录；",
    "如果模板不包含影片级唯一字段，保存时会按共享目录模式校验附属文件和 NFO 命名",
  ],
  file: [
    "文件名模板只决定视频基础文件名，不会创建子目录；路径分隔符和非法文件名字符都会被清理",
    "文件扩展名会自动沿用源文件，不需要在模板里写 .mp4、.mkv 等扩展名",
    "分盘视频会在模板结果后按“分盘样式”追加后缀；需要不带命名标识的番号时使用 {rawNumber}",
  ],
} as const;

const NAMING_PREVIEW_FIELD_KEYS = [
  "paths.mediaPath",
  "paths.metadataPath",
  "paths.successOutputFolder",
  "paths.strmPathMappings",
  "paths.sceneImagesFolder",
  "download.generateNfo",
  "download.downloadThumb",
  "download.downloadPoster",
  "download.downloadFanart",
  "download.downloadTrailer",
  "naming.folderTemplate",
  "naming.fileTemplate",
  "naming.assetNamingMode",
  "naming.actorNameMax",
  "naming.actorNameMore",
  "naming.actorFallbackToStudio",
  "naming.releaseRule",
  "naming.folderNameMax",
  "naming.fileNameMax",
  "naming.cnwordStyle",
  "naming.umrStyle",
  "naming.leakStyle",
  "naming.uncensoredStyle",
  "naming.censoredStyle",
  "naming.partStyle",
  "download.nfoNaming",
  "download.downloadSceneImages",
  "behavior.successFileMove",
  "behavior.successFileRename",
] as const;

const ASSET_DOWNLOAD_FIELD_KEYS = [
  "download.downloadThumb",
  "download.downloadPoster",
  "download.tagBadges",
  "download.tagBadgeTypes",
  "download.tagBadgePosition",
  "download.tagBadgeImageOverrides",
  "download.downloadFanart",
  "download.downloadSceneImages",
  "download.downloadTrailer",
  "download.keepThumb",
  "download.keepPoster",
  "download.keepFanart",
  "download.keepSceneImages",
  "download.keepTrailer",
  "download.sceneImageConcurrency",
] as const;

const NAMING_SECTION_FIELD_KEYS = [
  "naming.folderTemplate",
  "naming.fileTemplate",
  "naming.assetNamingMode",
  "naming.nfoTitleTemplate",
  "naming.actorNameMax",
  "naming.actorNameMore",
  "naming.actorFallbackToStudio",
  "naming.releaseRule",
  "naming.folderNameMax",
  "naming.fileNameMax",
  "naming.cnwordStyle",
  "naming.umrStyle",
  "naming.leakStyle",
  "naming.uncensoredStyle",
  "naming.censoredStyle",
  "naming.partStyle",
  "titleRepair.enabled",
] as const;

export function buildNamingPreviewConfig(values: Record<string, unknown>): Partial<Configuration> {
  const flat: Record<string, unknown> = {};
  for (const key of NAMING_PREVIEW_FIELD_KEYS) {
    const value = values[key] ?? getNestedValue(values, key);
    if (value !== undefined) {
      flat[key] = value;
    }
  }

  return unflattenConfig(flat) as Partial<Configuration>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toSiteOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const outputs: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      outputs.push(item);
      continue;
    }
    if (isRecord(item) && typeof item.site === "string") {
      outputs.push(item.site);
    }
  }
  return outputs;
}

function shouldMountConditionalSettings(
  normalVisible: boolean,
  search: ReturnType<typeof useOptionalSettingsSearch>,
): boolean {
  return normalVisible || Boolean(search?.hasActiveFilters);
}

export function useCrawlerSiteOptions(flatDefaults: Record<string, unknown>): string[] {
  const services = useSettingsServices();
  const [sites, setSites] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    services
      .listCrawlerSites()
      .then((result) => {
        if (!cancelled) {
          setSites(toSiteOptions(result.sites));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSites([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [services]);

  return useMemo(() => {
    const fromConfig = toStringArray(flatDefaults["scrape.sites"]);
    return Array.from(new Set([...sites, ...fromConfig]));
  }, [sites, flatDefaults]);
}

// ── Section renderers ──

export function PathsSection() {
  return (
    <>
      <PathFieldWrapper name="paths.mediaPath" label="媒体目录" isDirectory />
      <PathArrayFieldWrapper
        name="paths.defaultScanExcludeDirs"
        label="排除目录"
        description="扫描媒体库时自动跳过这些文件夹。"
      />
      <MediaOrganizeSection />
      <MetadataExportSection />
      <PathFieldWrapper
        name="paths.actorPhotoFolder"
        label="本地演员头像库目录"
        description="仅当“人物头像来源顺序”启用“本地”时读取，用于本地头像覆盖和媒体服务器头像同步。"
        isDirectory
      />
      <TextField name="paths.sceneImagesFolder" label="剧照目录名" />
      <PathFieldWrapper
        name="paths.outputSummaryPath"
        label="概览统计目录"
        description="留空则使用整理目标目录"
        isDirectory
      />
      <PathFieldWrapper name="paths.configDirectory" label="配置文件目录" isDirectory />
    </>
  );
}

export function ScrapePacingSection() {
  return (
    <>
      <NumberField name="scrape.threadNumber" label="并发线程数" min={1} max={128} />
      <NumberField name="scrape.javdbDelaySeconds" label="JavDB 请求延迟(秒)" min={0} max={120} />
      <NumberField name="scrape.restAfterCount" label="连续刮削后休息(条数)" min={1} max={500} />
      <DurationFieldWrapper name="scrape.restDuration" label="休息时长" />
    </>
  );
}
export function FilenameFilteringSection() {
  return (
    <>
      <ChipArrayFieldWrapper
        name="scrape.filenameIgnoreTokens"
        label="番号识别忽略词"
        description="番号识别前忽略这些文字；仅影响识别，不修改文件名。支持 Enter、逗号或空格分割添加。"
      />
      <ChipArrayFieldWrapper
        name="scrape.filenameBlacklistTokens"
        label="自动扫描黑名单词"
        description="自动扫描时排除包含这些文字的文件；匹配时不区分大小写。支持 Enter、逗号或空格分割添加。"
      />
    </>
  );
}

export function NetworkConnectionSection() {
  return (
    <>
      <EnumField name="network.proxyType" label="代理类型" options={PROXY_TYPE_OPTIONS} />
      <TextField name="network.proxy" label="代理地址" />
      <BoolField name="network.useProxy" label="启用代理" />
      <NumberField name="network.timeout" label="超时时间(秒)" min={1} max={300} />
      <NumberField name="network.retryCount" label="重试次数" min={0} max={10} />
    </>
  );
}

export function NetworkCookiesSection() {
  return (
    <>
      <CookieFieldWrapper name="network.javdbCookie" label="JavDB Cookie" />
      <CookieFieldWrapper name="network.javbusCookie" label="JavBus Cookie" />
      <CookieFieldWrapper name="network.fantiaCookie" label="Fantia Cookie" />
    </>
  );
}

export function AssetDownloadsSection() {
  const hasRenderableFields = useHasRenderableFields(ASSET_DOWNLOAD_FIELD_KEYS);
  const search = useOptionalSettingsSearch();
  const form = useFormContext<FieldValues>();
  const [downloadThumb, downloadPoster, tagBadges, downloadFanart, downloadSceneImages, downloadTrailer] = form.watch([
    "download.downloadThumb",
    "download.downloadPoster",
    "download.tagBadges",
    "download.downloadFanart",
    "download.downloadSceneImages",
    "download.downloadTrailer",
  ]) as [
    boolean | undefined,
    boolean | undefined,
    boolean | undefined,
    boolean | undefined,
    boolean | undefined,
    boolean | undefined,
  ];
  const showTagBadgeSettings = Boolean(downloadPoster) && Boolean(tagBadges);

  if (!hasRenderableFields) {
    return null;
  }

  return (
    <>
      <BoolField name="download.downloadThumb" label="下载横版缩略图" />
      <BoolField name="download.downloadPoster" label="下载海报" />
      {shouldMountConditionalSettings(Boolean(downloadPoster), search) && (
        <BoolField
          name="download.tagBadges"
          label="为封面添加标签角标"
          description="按现有影片标签自动添加角标；可配置启用类型与角落位置，仅处理本次新下载的海报。"
        />
      )}
      {shouldMountConditionalSettings(showTagBadgeSettings, search) && (
        <>
          <ChipArrayFieldWrapper
            name="download.tagBadgeTypes"
            label="角标类型"
            description="选择允许自动渲染的内建角标类型。未选中的类型即使被识别到，也不会叠加到海报上。"
            options={TAG_BADGE_TYPE_OPTIONS}
            showBulkActions
          />
          <EnumField
            name="download.tagBadgePosition"
            label="角标位置"
            description="多个角标会按顺序堆叠在同一个角落。"
            options={TAG_BADGE_POSITION_OPTIONS}
          />
          <PosterBadgeImageOverridesField />
        </>
      )}
      <BoolField name="download.downloadFanart" label="下载背景图" />
      <BoolField name="download.downloadSceneImages" label="下载剧照" />
      <BoolField name="download.downloadTrailer" label="下载预告片" />
      {shouldMountConditionalSettings(Boolean(downloadThumb), search) && (
        <BoolField name="download.keepThumb" label="保留已有横版缩略图" />
      )}
      {shouldMountConditionalSettings(Boolean(downloadPoster), search) && (
        <BoolField name="download.keepPoster" label="保留已有海报" />
      )}
      {shouldMountConditionalSettings(Boolean(downloadFanart), search) && (
        <BoolField name="download.keepFanart" label="保留已有背景图" />
      )}
      {shouldMountConditionalSettings(Boolean(downloadSceneImages), search) && (
        <BoolField name="download.keepSceneImages" label="保留已有剧照" />
      )}
      {shouldMountConditionalSettings(Boolean(downloadTrailer), search) && (
        <BoolField name="download.keepTrailer" label="保留已有预告片" />
      )}
      <NumberField
        name="download.sceneImageConcurrency"
        label="剧照下载并发"
        description="仅影响剧照下载任务的并发请求数；关闭“下载剧照”时此设置不会生效。"
        min={1}
        max={20}
      />
    </>
  );
}

function PosterBadgeImageOverridesField() {
  const services = useSettingsServices();
  const notifier = useSettingsNotifier();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [watermarkDirectoryPath, setWatermarkDirectoryPath] = useState("");
  const [openingDirectory, setOpeningDirectory] = useState(false);
  const directoryActionLabel = services.watermarkDirectoryActionLabel ?? "打开文件夹";

  const handleEnable = async () => {
    try {
      const result = await services.ensureWatermarkDirectory();
      setWatermarkDirectoryPath(result.path);
      setDialogOpen(true);
    } catch (error) {
      notifier.error(`创建角标图片目录失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleOpenDirectory = async () => {
    setOpeningDirectory(true);
    try {
      const result = await services.openWatermarkDirectory();
      if (result?.message) {
        if (result.unsupported) {
          notifier.info(result.message);
        } else {
          notifier.success(result.message);
        }
      }
    } catch (error) {
      notifier.error(`打开角标图片目录失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setOpeningDirectory(false);
    }
  };

  return (
    <>
      <BaseField
        name="download.tagBadgeImageOverrides"
        label="覆盖角标图片"
        description="开启后，使用用户数据目录 watermark 文件夹中的匹配图片替换内建角标。"
        commitMode="immediate"
      >
        {(field) => (
          <FormControl>
            <Switch
              checked={Boolean(field.value)}
              onCheckedChange={(checked) => {
                field.onChange(checked);
                if (checked) {
                  void handleEnable();
                }
              }}
            />
          </FormControl>
        )}
      </BaseField>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl gap-5 rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-6">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle>覆盖角标图片</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              将自定义图片放入下方目录。文件名匹配时会优先使用图片，未匹配或读取失败时继续使用内建角标。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-border/50 bg-surface-low px-3 py-2">
              <div className="text-xs text-muted-foreground">目录</div>
              <div className="mt-1 break-all font-mono text-xs">{watermarkDirectoryPath || "userdata/watermark"}</div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/50">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-low text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">角标</th>
                    <th className="px-3 py-2 font-medium">可用文件名</th>
                  </tr>
                </thead>
                <tbody>
                  {POSTER_TAG_BADGE_TYPE_OPTIONS.map((type) => (
                    <tr key={type} className="border-t border-border/40">
                      <td className="px-3 py-2">{POSTER_TAG_BADGE_TYPE_LABELS[type]}</td>
                      <td className="px-3 py-2 font-mono">{POSTER_TAG_BADGE_IMAGE_FILENAMES[type].join(" / ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 text-xs leading-5 text-muted-foreground">
              <p>支持格式：{TAG_BADGE_IMAGE_EXTENSION_LABEL}。</p>
              <p>推荐比例：{TAG_BADGE_IMAGE_RATIO_LABEL}。角标高度按海报短边约 8% 计算，并限制在 28-64px。</p>
              <p>图片会按角标槽位等比缩放，不会拉伸；方形图片会以槽位高度 x 槽位高度靠左放置。</p>
              <p>建议使用透明 PNG 或 WebP。图片过大时会自动缩小，损坏或无法读取的图片会回退到内建角标。</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleOpenDirectory} disabled={openingDirectory}>
              {openingDirectory ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5" />
              )}
              {directoryActionLabel}
            </Button>
            <DialogClose asChild>
              <Button type="button">知道了</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NfoSection() {
  const search = useOptionalSettingsSearch();
  const form = useFormContext<FieldValues>();
  const generateNfo = Boolean(form.watch("download.generateNfo"));

  return (
    <>
      <BoolField name="download.generateNfo" label="生成 NFO" />
      {shouldMountConditionalSettings(generateNfo, search) && (
        <>
          <EnumField name="download.nfoNaming" label="NFO 文件命名" options={NFO_NAMING_OPTIONS} />
          <ChipArrayFieldWrapper
            name="download.nfoIgnoreFields"
            label="NFO 忽略字段"
            description="选择不写入 NFO 的可选字段；标题、番号、演员等核心字段始终保留。空白表示写入全部可选字段。"
            options={NFO_ENABLED_FIELD_OPTIONS}
            showBulkActions
          />
          <BoolField name="download.keepNfo" label="保留已有 NFO" />
        </>
      )}
    </>
  );
}

function NamingPreview() {
  const services = useSettingsServices();
  const form = useFormContext<FieldValues>();
  const previewValues = useWatch({
    control: form.control,
    name: NAMING_PREVIEW_FIELD_KEYS,
  }) as unknown[];
  const [previews, setPreviews] = useState<NamingPreviewItem[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [loading, setLoading] = useState(false);
  const previewConfig = useMemo(() => {
    const flatValues: Record<string, unknown> = {};
    for (const [index, key] of NAMING_PREVIEW_FIELD_KEYS.entries()) {
      flatValues[key] = previewValues[index];
    }
    return buildNamingPreviewConfig(flatValues);
  }, [previewValues]);
  const previewConfigRef = useRef(previewConfig);
  const previewConfigKey = useMemo(() => JSON.stringify(previewConfig), [previewConfig]);

  useEffect(() => {
    previewConfigRef.current = previewConfig;
  }, [previewConfig]);

  useEffect(() => {
    const requestKey = previewConfigKey;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await services.previewNaming(previewConfigRef.current as Partial<Configuration>);
        if (!cancelled && requestKey === previewConfigKey) {
          setPreviews(result.items);
          setPreviewError("");
        }
      } catch (error) {
        if (!cancelled && requestKey === previewConfigKey) {
          setPreviews([]);
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled && requestKey === previewConfigKey) {
          setLoading(false);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewConfigKey, services.previewNaming]);

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">命名预览</div>
      <div className="space-y-2">
        {previews.length === 0 && (
          <div role={previewError ? "alert" : undefined} className="text-xs text-muted-foreground">
            {loading ? "生成预览中..." : previewError || "等待示例数据"}
          </div>
        )}
        {previews.map((p) => (
          <div key={p.label} className="text-xs">
            <span className="mr-2 inline-block min-w-[4em] text-muted-foreground">{p.label}</span>
            <div className="space-y-1 break-all font-mono">
              <div>源文件：{p.sourcePath ?? p.file}</div>
              <div>整理后：{p.mediaPath ?? `${p.folder}/${p.file}`}</div>
              {p.metadataDir && p.metadataDir !== p.folder ? <div>元数据目录：{p.metadataDir}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TitleRepairSection() {
  return (
    <BoolField
      name="titleRepair.enabled"
      label="标题屏蔽词还原"
      description="自动将官方标题中的避讳符号（●、〇 等）还原为原始词汇（例如把「催●」还原为「催眠」，「盗●」还原为「盗撮」）；原始标题仍会保留在 NFO 中。"
    />
  );
}

type NamingTemplateHelpKind = "folder" | "file";

function NamingTemplateHelp({ kind }: { kind: NamingTemplateHelpKind }) {
  const label = kind === "folder" ? "文件夹模板" : "文件名模板";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`查看${label}占位符`}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl gap-5 rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-6">
        <DialogHeader className="gap-2 text-left">
          <DialogTitle>{label}占位符</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="overflow-hidden rounded-xl border border-border/50">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-low text-muted-foreground">
                <tr>
                  <th className="w-[220px] px-3 py-2 font-medium">占位符</th>
                  <th className="px-3 py-2 font-medium">说明</th>
                </tr>
              </thead>
              <tbody>
                {NAMING_TEMPLATE_PLACEHOLDERS.map(([placeholder, description]) => (
                  <tr key={placeholder} className="border-t border-border/40">
                    <td className="px-3 py-2 align-top font-mono text-[11px] text-foreground">{placeholder}</td>
                    <td className="px-3 py-2 align-top leading-5 text-muted-foreground">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-border/50 bg-surface-low px-3 py-2.5">
            <div className="font-numeric text-xs font-bold text-foreground">{label}注意事项</div>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
              {NAMING_TEMPLATE_NOTES[kind].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button type="button">知道了</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NamingSection() {
  const sectionMode = useSettingsSectionMode();
  const hasRenderableFields = useHasRenderableFields(NAMING_SECTION_FIELD_KEYS);
  const form = useFormContext<FieldValues>();
  const folderTemplate = String(form.watch("naming.folderTemplate") ?? "");
  const successFileMove = Boolean(form.watch("behavior.successFileMove"));
  const sharedDirectoryMode = isSharedDirectoryMode({
    metadataOnly: Boolean(form.watch("behavior.metadataOnly")),
    successFileMove,
    folderTemplate,
    metadataPath: String(form.watch("paths.metadataPath") ?? ""),
  });

  if (!hasRenderableFields) {
    return null;
  }

  return (
    <>
      <TextField name="naming.folderTemplate" label="文件夹模板" labelAddon={<NamingTemplateHelp kind="folder" />} />
      <TextField name="naming.fileTemplate" label="文件名模板" labelAddon={<NamingTemplateHelp kind="file" />} />
      <EnumField
        name="naming.assetNamingMode"
        label="附属文件命名"
        description="海报、横版缩略图、背景图与预告片的文件名规则。"
        options={ASSET_NAMING_OPTIONS}
      />
      {sectionMode === "public" && sharedDirectoryMode && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          当前文件夹模板不会为每部影片创建独立目录，属于共享目录模式。推荐默认使用 <code>{`{actor}/{number}`}</code>；
          如需共享目录，保存时会校验相关命名规则。
        </div>
      )}
      <TextField
        name="naming.nfoTitleTemplate"
        label="NFO 标题模板"
        description="NFO 中 title 字段的格式。可用占位符：{number} {title} {originaltitle}"
      />
      <TitleRepairSection />
      {sectionMode === "public" && <NamingPreview />}
      <NumberField name="naming.actorNameMax" label="演员名最大数量" min={1} max={20} />
      <TextField name="naming.actorNameMore" label="演员名超出后缀" />
      <BoolField
        name="naming.actorFallbackToStudio"
        label="演员为空时使用片商或卖家"
        description="开启后，{actor} 在没有演员名时会回退到片商或卖家名称；如需显示来源，可在模板中使用 {actorFallbackPrefix}{actor}。"
      />
      <TextField name="naming.releaseRule" label="发行日期格式" />
      <EnumField
        name="naming.partStyle"
        label="分盘样式"
        description="分盘的视频在输出时保留原始后缀，或统一改写为 CD / PART / DISC 风格"
        options={PART_STYLE_OPTIONS}
      />
      <NumberField name="naming.folderNameMax" label="文件夹名最大长度" min={10} max={255} />
      <NumberField name="naming.fileNameMax" label="文件名最大长度" min={10} max={255} />
      <TextField name="naming.cnwordStyle" label="中文字幕标记" />
      <TextField name="naming.umrStyle" label="UMR 标记" />
      <TextField name="naming.leakStyle" label="流出标记" />
      <TextField name="naming.uncensoredStyle" label="无码标记" />
      <TextField name="naming.censoredStyle" label="有码标记" />
    </>
  );
}

export function TranslateSection() {
  const services = useSettingsServices();
  const notifier = useSettingsNotifier();
  const [testing, setTesting] = useState(false);
  const form = useFormContext<FieldValues>();
  const search = useOptionalSettingsSearch();
  const engine = useWatch({ control: form.control, name: "translate.engine" });
  const serviceType = useWatch({ control: form.control, name: "translate.llmServiceType" });
  const isLLM = engine !== "google";

  const handleTestLlm = async () => {
    const input = {
      llmModelName: String(form.getValues("translate.llmModelName") ?? ""),
      llmApiKey: String(form.getValues("translate.llmApiKey") ?? ""),
      llmBaseUrl: String(form.getValues("translate.llmBaseUrl") ?? ""),
      llmApiFormat: form.getValues("translate.llmApiFormat") ?? "responses",
      llmServiceType: form.getValues("translate.llmServiceType") ?? "openai-compatible",
      llmPrompt: String(form.getValues("translate.llmPrompt") ?? ""),
      llmTemperature: form.getValues("translate.llmTemperature"),
      llmReasoning: form.getValues("translate.llmReasoning") ?? "default",
      llmOutputFormat: form.getValues("translate.llmOutputFormat") ?? "none",
      llmTimeout: Number(form.getValues("translate.llmTimeout") ?? 120),
    };

    setTesting(true);
    try {
      const result = await services.testLLM(input);
      if (result.success) {
        notifier.success(result.message);
      } else {
        notifier.error(result.message);
      }
    } catch (error) {
      notifier.error(`测试失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <BaseField name="translate.enableTranslation" label="启用内容翻译">
        {(field) => (
          <div className="flex items-center gap-2">
            {isLLM && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleTestLlm}
                disabled={testing}
              >
                {testing ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" /> 验证中...
                  </>
                ) : (
                  "验证元数据翻译"
                )}
              </Button>
            )}
            <FormControl>
              <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
            </FormControl>
          </div>
        )}
      </BaseField>
      <EnumField name="translate.engine" label="翻译引擎" options={TRANSLATE_ENGINE_OPTIONS} />
      {shouldMountConditionalSettings(isLLM, search) && (
        <>
          <TextField name="translate.llmModelName" label="LLM 模型名称" />
          <SecretField
            name="translate.llmApiKey"
            label="LLM 密钥（可选）"
            description="默认 OpenAI 地址通常必须填写；本地或兼容服务是否需要密钥取决于服务端配置"
          />
          <UrlField
            name="translate.llmBaseUrl"
            label="LLM API 地址"
            description={`默认值：${DEFAULT_LLM_BASE_URL}。Google Gemini 示例：https://generativelanguage.googleapis.com/v1beta/openai。本地示例：Ollama 用 http://127.0.0.1:11434/v1`}
          />
          {serviceType === "openai-compatible" && (
            <EnumField name="translate.llmApiFormat" label="请求形式" options={LLM_API_FORMAT_FIELD_OPTIONS} />
          )}
          <EnumField
            name="translate.llmServiceType"
            label="服务类型"
            description="自定义代理需要显式选择 Google 或 DeepSeek；不要依赖网址域名识别。"
            options={LLM_SERVICE_TYPE_FIELD_OPTIONS}
          />
          <PromptFieldWrapper name="translate.llmPrompt" label="LLM 翻译提示词" />
          <NumberField
            name="translate.llmTemperature"
            label="LLM 温度（高级，可选）"
            description="留空时使用服务端默认值。"
            min={0}
            max={2}
            step={0.1}
            optional
          />
          <EnumField
            name="translate.llmReasoning"
            label="LLM 推理强度"
            description={
              serviceType === "google"
                ? "默认省略推理字段。Gemini 2.5 Pro 和 Gemini 3 系列不能关闭推理；其他模型由服务端校验。"
                : serviceType === "deepseek"
                  ? "默认省略开关和强度；开启可使用服务端默认强度，或选择 low / high / max。思考模式下 temperature 不生效。"
                  : "默认省略推理字段；关闭与指定强度是否可用由模型和服务端校验。"
            }
            options={
              serviceType === "deepseek"
                ? [
                    { value: "default", label: "服务端默认" },
                    { value: "disabled", label: "关闭" },
                    { value: "enabled", label: "开启（服务端默认强度）" },
                    { value: "low", label: "low" },
                    { value: "high", label: "high" },
                    { value: "max", label: "max" },
                  ]
                : LLM_REASONING_FIELD_OPTIONS
            }
          />
          <EnumField
            name="translate.llmOutputFormat"
            label="输出格式"
            description="提示词 JSON 省略结构化输出参数；元数据翻译始终要求 JSON 并在本地校验。"
            options={LLM_OUTPUT_FORMAT_FIELD_OPTIONS.filter(
              (option) =>
                serviceType !== "deepseek" || (typeof option === "string" ? option : option.value) !== "json_schema",
            )}
          />
          <NumberField name="translate.llmTimeout" label="LLM 请求超时(秒)" min={1} max={300} />
          <NumberField name="translate.llmMaxRetries" label="LLM 最大重试次数" min={1} max={20} />
          <NumberField name="translate.llmMaxRequestsPerSecond" label="LLM 每秒最大请求数" min={1} max={100} />
        </>
      )}
      <EnumField name="translate.targetLanguage" label="目标语言" options={LANGUAGE_OPTIONS} />
    </>
  );
}

export function AggregationScrapeSection() {
  return (
    <>
      <NumberField
        name="aggregation.maxParallelCrawlers"
        label="聚合并行站点数"
        description="同一影片聚合抓取时，最多同时请求多少个站点。"
        min={1}
        max={10}
      />
      <NumberField
        name="aggregation.perCrawlerTimeoutMs"
        label="单站超时 (ms)"
        description="单个站点在聚合阶段允许的最长等待时间。"
        min={5000}
        max={120000}
        step={1000}
      />
      <NumberField
        name="aggregation.globalTimeoutMs"
        label="全局超时 (ms)"
        description="单部影片整次聚合抓取允许的总超时时间，必须大于单站超时。"
        min={10000}
        max={300000}
        step={1000}
      />
    </>
  );
}

export function AggregationBehaviorSection() {
  return (
    <>
      <BoolField
        name="aggregation.behavior.preferLongerPlot"
        label="简介优先取更长内容"
        description="多个站点都提供简介时，优先采用信息量更高的版本。"
      />
      <NumberField
        name="aggregation.behavior.maxSceneImages"
        label="最多保留剧照数"
        description="聚合后的剧照数量上限。"
        min={0}
        max={100}
      />
      <NumberField
        name="aggregation.behavior.maxActors"
        label="最多保留演员数"
        description="聚合后的演员数量上限。"
        min={1}
        max={100}
      />
      <NumberField
        name="aggregation.behavior.maxGenres"
        label="最多保留标签数"
        description="聚合后的类型或标签数量上限。"
        min={1}
        max={100}
      />
    </>
  );
}

export function AggregationPrioritySection({ siteOptions }: { siteOptions: string[] }) {
  return (
    <>
      {AGGREGATION_PRIORITY_FIELDS.map((entry) => (
        <AggregationPriorityEditorField
          key={entry.key}
          name={entry.key}
          label={entry.label}
          description={entry.description}
          options={siteOptions}
        />
      ))}
    </>
  );
}

export function ShortcutsSection() {
  return (
    <>
      <ShortcutField name="shortcuts.startOrStopScrape" label="开始/停止刮削" description="示例: S" />
      <ShortcutField name="shortcuts.retryScrape" label="重新刮削" description="示例: R" />
      <ShortcutField name="shortcuts.openFolder" label="打开所在目录" description="示例: F" />
      <ShortcutField name="shortcuts.editNfo" label="编辑 NFO" description="示例: E" />
      <ShortcutField name="shortcuts.playVideo" label="播放视频" description="示例: P" />
    </>
  );
}

interface UiSectionProps {
  initialUseCustomTitleBar: boolean;
}

export function UiSection({ initialUseCustomTitleBar }: UiSectionProps) {
  const services = useSettingsServices();
  const notifier = useSettingsNotifier();
  const [relaunching, setRelaunching] = useState(false);
  const form = useFormContext<FieldValues>();
  const currentUseCustomTitleBar = Boolean(useWatch({ control: form.control, name: "ui.useCustomTitleBar" }) ?? true);
  const titleBarChanged = currentUseCustomTitleBar !== initialUseCustomTitleBar;
  const inFlightSaves = useSettingsInFlightSaves();
  const canRelaunch = titleBarChanged && inFlightSaves === 0;

  const handleRelaunch = async () => {
    if (inFlightSaves > 0) {
      notifier.info("请等待自动保存完成，再重启应用");
      return;
    }

    setRelaunching(true);
    try {
      await services.relaunchApp();
    } catch (error) {
      setRelaunching(false);
      notifier.error(`重启失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  return (
    <>
      <BoolField name="ui.showLogsPanel" label="显示日志面板" />
      <BaseField name="ui.useCustomTitleBar" label="使用自定义标题栏" description="切换后需要重启应用">
        {(field) => (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={titleBarChanged ? "default" : "outline"}
              size="sm"
              className="h-7 rounded-lg text-xs"
              disabled={!canRelaunch || relaunching}
              onClick={handleRelaunch}
            >
              {relaunching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              重启应用
            </Button>
            <FormControl>
              <Switch checked={Boolean(field.value ?? true)} onCheckedChange={field.onChange} />
            </FormControl>
          </div>
        )}
      </BaseField>
      <BoolField name="ui.hideDock" label="隐藏 Dock 图标" />
      <BoolField name="ui.hideMenu" label="隐藏菜单栏" />
      <BoolField name="ui.hideWindowButtons" label="隐藏窗口按钮" />
    </>
  );
}

export function MediaOrganizeSection() {
  const form = useFormContext<FieldValues>();
  const metadataOnly = Boolean(form.watch("behavior.metadataOnly"));
  const move = Boolean(form.watch("behavior.successFileMove"));

  return (
    <>
      {metadataOnly && (
        <div className="mb-3 rounded-md border border-border/70 bg-muted/50 p-3 text-xs text-muted-foreground">
          已开启「仅输出元数据」模式，已停用视频移动与重命名。
        </div>
      )}
      <BoolField
        name="behavior.successFileMove"
        label="移动视频与字幕"
        description="刮削成功后将视频与字幕移动到指定目录归档；关闭时保留在原目录就地保存。"
        disabled={metadataOnly}
      />
      <PathFieldWrapper
        name="paths.successOutputFolder"
        label="整理目标目录"
        description="移动归档后的存放目录，支持绝对路径或相对路径（留空则保存在媒体目录下）。"
        isDirectory
        disabled={!move || metadataOnly}
      />
      <BoolField
        name="behavior.successFileRename"
        label="重命名视频与字幕"
        description="按命名规则重命名视频与字幕文件；关闭时保留原始文件名。"
        disabled={metadataOnly}
      />
    </>
  );
}

export function MetadataExportSection() {
  const form = useFormContext<FieldValues>();
  const services = useSettingsServices();
  const search = useOptionalSettingsSearch();
  const metadataOnly = Boolean(form.watch("behavior.metadataOnly"));
  const generateStrm = Boolean(form.watch("behavior.generateStrm"));

  const shouldMountChildren = shouldMountConditionalSettings(metadataOnly, search);
  const isStrmMappingsVisible =
    generateStrm || Boolean(search?.hasActiveFilters && search.isFieldVisible("paths.strmPathMappings"));

  return (
    <>
      <BoolField
        name="behavior.metadataOnly"
        label="仅输出元数据"
        description="不移动原视频，仅将海报与 NFO 输出到独立目录（适合网盘挂载等场景）。"
      />
      {shouldMountChildren && (
        <div className="space-y-4 pt-1 pl-4 border-l-2 border-border/50 animate-in fade-in duration-200">
          <PathFieldWrapper
            name="paths.metadataPath"
            label="元数据输出目录"
            isDirectory
            description="存放 NFO、海报及 .strm 播放流文件的目录。"
            rules={{
              validate: (value) => {
                if (metadataOnly && !String(value ?? "").trim()) {
                  return "启用仅输出元数据时，必须指定元数据输出目录";
                }
                return true;
              },
            }}
          />
          <BoolField
            name="behavior.generateStrm"
            label="同时生成 .strm 播放流文件"
            description="在元数据目录生成 .strm 文件，供 Emby / Jellyfin 挂载串流播放。"
          />
          {isStrmMappingsVisible && (
            <div className="space-y-4 pt-1 pl-4 border-l-2 border-border/40 animate-in fade-in duration-200">
              {services.isServer && (
                <p className="text-xs text-muted-foreground">
                  源路径和输出目录属于 MDCz 服务端文件系统；STRM 映射目标属于播放器可见路径，无需服务端能够访问。
                </p>
              )}
              <BaseField
                name="paths.strmPathMappings"
                label="STRM 路径映射（可选）"
                layout="vertical"
                commitMode="debounce"
                description="当媒体服务器访问视频的路径与本机不同时（如 Docker 或 NAS），替换 .strm 中的路径。"
              >
                {(field) => {
                  const mappings = (field.value ?? []) as Configuration["paths"]["strmPathMappings"];
                  return (
                    <div className="space-y-2">
                      {mappings.length > 0 && (
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-0.5 text-xs font-medium text-muted-foreground">
                          <span>MDCz 可见路径前缀</span>
                          <span>播放器可见路径前缀</span>
                          <span className="w-8" />
                        </div>
                      )}
                      {mappings.map((mapping, index) => (
                        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                          {(["from", "to"] as const).map((key) => {
                            const error = form.getFieldState(
                              `paths.strmPathMappings.${index}.${key}`,
                              form.formState,
                            ).error;
                            return (
                              <div key={key}>
                                <Input
                                  aria-label={`${index + 1} ${key === "from" ? "MDCz 可见路径前缀" : "播放器可见路径前缀"}`}
                                  aria-invalid={Boolean(error)}
                                  placeholder={key === "from" ? "D:\\Downloads" : "/mnt/downloads"}
                                  value={mapping[key]}
                                  onBlur={field.onBlur}
                                  onChange={(event) =>
                                    field.onChange(
                                      mappings.map((rule, i) =>
                                        i === index ? { ...rule, [key]: event.target.value } : rule,
                                      ),
                                    )
                                  }
                                />
                                {error?.message && <span className="text-xs text-destructive">{error.message}</span>}
                              </div>
                            );
                          })}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-9 text-muted-foreground hover:text-foreground"
                            onClick={() => field.onChange(mappings.filter((_, i) => i !== index))}
                            aria-label={`删除第 ${index + 1} 条路径映射`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => field.onChange([...mappings, { from: "", to: "" }])}
                        >
                          添加路径映射
                        </Button>
                        {mappings.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            未配置路径映射时，.strm 将直接使用原始媒体路径。
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }}
              </BaseField>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export { EmbySection, JellyfinSection, PersonSyncSharedSection } from "./sections/MediaServerSections";
