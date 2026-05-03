import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "@mdcz/shared/actorSource";
import { isSharedDirectoryMode } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import { TRANSLATION_TARGET_OPTIONS } from "@mdcz/shared/enums";
import { DEFAULT_LLM_BASE_URL } from "@mdcz/shared/llm";
import {
  POSTER_TAG_BADGE_ASPECT_HEIGHT,
  POSTER_TAG_BADGE_ASPECT_WIDTH,
  POSTER_TAG_BADGE_IMAGE_EXTENSIONS,
  POSTER_TAG_BADGE_IMAGE_FILENAMES,
  POSTER_TAG_BADGE_MAX_WIDTH,
  POSTER_TAG_BADGE_MAX_WIDTH_RATIO,
  POSTER_TAG_BADGE_MIN_WIDTH,
  POSTER_TAG_BADGE_POSITION_LABELS,
  POSTER_TAG_BADGE_POSITION_OPTIONS,
  POSTER_TAG_BADGE_TYPE_LABELS,
  POSTER_TAG_BADGE_TYPE_OPTIONS,
  POSTER_TAG_BADGE_WIDTH_RATIO,
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
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@mdcz/ui";
import { useQuery } from "@tanstack/react-query";
import { CircleHelp, FolderOpen, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ipc } from "../../client/ipc";
import { useSettingsSavingStore } from "../../store/settingsSavingStore";
import {
  BaseField,
  BoolField,
  ChipArrayFieldWrapper,
  CookieFieldWrapper,
  DurationFieldWrapper,
  EnumField,
  type EnumOption,
  NumberField,
  PathFieldWrapper,
  PromptFieldWrapper,
  SecretField,
  ShortcutField,
  TextField,
  UrlField,
} from "../config-form/FieldRenderer";
import { AggregationPriorityEditorField } from "./AggregationPriorityEditorField";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import { shouldRenderFieldInSectionMode, useSettingsSectionMode } from "./SettingsSectionModeContext";
import { AGGREGATION_PRIORITY_FIELDS, getNestedValue, isRecord, unflattenConfig } from "./settingsRegistry";

// ── Constants ──

const PROXY_TYPE_OPTIONS = ["none", "http", "https", "socks5"];
const TRANSLATE_ENGINE_OPTIONS: EnumOption[] = [
  { value: "openai", label: "LLM 翻译" },
  { value: "google", label: "Google 翻译（免费）" },
];
const LANGUAGE_OPTIONS = [...TRANSLATION_TARGET_OPTIONS];
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
const TAG_BADGE_IMAGE_DEFAULT_SIZE_LABEL = `${POSTER_TAG_BADGE_ASPECT_WIDTH}x${POSTER_TAG_BADGE_ASPECT_HEIGHT}px`;
const TAG_BADGE_IMAGE_WIDTH_PERCENT_LABEL = `${Math.round(POSTER_TAG_BADGE_WIDTH_RATIO * 100)}%`;
const TAG_BADGE_IMAGE_MAX_WIDTH_PERCENT_LABEL = `${Math.round(POSTER_TAG_BADGE_MAX_WIDTH_RATIO * 100)}%`;

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
    "如果关闭“成功后移动文件”，不会按文件夹模板创建新目录；",
    "如果模板不包含影片级唯一字段，保存时会按共享目录模式校验附属文件和 NFO 命名",
  ],
  file: [
    "文件名模板只决定视频基础文件名，不会创建子目录；路径分隔符和非法文件名字符都会被清理",
    "文件扩展名会自动沿用源文件，不需要在模板里写 .mp4、.mkv 等扩展名",
    "分盘视频会在模板结果后按“分盘样式”追加后缀；需要不带命名标识的番号时使用 {rawNumber}",
  ],
} as const;

const NAMING_PREVIEW_FIELD_KEYS = [
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
] as const;

const PERSON_SYNC_SHARED_FIELD_KEYS = ["personSync.personOverviewSources", "personSync.personImageSources"] as const;

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

function useHasRenderableFields(fieldNames: readonly string[]): boolean {
  const search = useOptionalSettingsSearch();
  const sectionMode = useSettingsSectionMode();

  return fieldNames.some((name) => {
    if (!shouldRenderFieldInSectionMode(name, sectionMode)) {
      return false;
    }

    return search ? search.isFieldVisible(name) : true;
  });
}

function shouldMountConditionalSettings(
  normalVisible: boolean,
  search: ReturnType<typeof useOptionalSettingsSearch>,
): boolean {
  return normalVisible || Boolean(search?.hasActiveFilters);
}

type CrawlerSiteInfo = {
  site: string;
  name: string;
  enabled: boolean;
  native: boolean;
};

export function useCrawlerSiteOptions(flatDefaults: Record<string, unknown>): string[] {
  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as { sites: CrawlerSiteInfo[] };
      return result.sites;
    },
    staleTime: 60_000,
  });

  return useMemo(() => {
    const fromApi = toSiteOptions(sitesQ.data);
    const fromConfig = toStringArray(flatDefaults["scrape.sites"]);
    return Array.from(new Set([...fromApi, ...fromConfig]));
  }, [sitesQ.data, flatDefaults]);
}

// ── Section renderers ──

export function PathsSection() {
  return (
    <>
      <PathFieldWrapper name="paths.mediaPath" label="媒体目录" isDirectory />
      <PathFieldWrapper
        name="paths.actorPhotoFolder"
        label="本地演员头像库目录"
        description="仅当“人物头像来源顺序”启用“本地”时读取，用于本地头像覆盖和媒体服务器头像同步。"
        isDirectory
      />
      <PathFieldWrapper name="paths.softlinkPath" label="软链接目录" isDirectory />
      <PathFieldWrapper name="paths.successOutputFolder" label="成功输出目录" isDirectory />
      <PathFieldWrapper name="paths.failedOutputFolder" label="失败输出目录" isDirectory />
      <PathFieldWrapper
        name="paths.outputSummaryPath"
        label="概览统计目录"
        description="留空则使用成功输出目录"
        isDirectory
      />
      <TextField name="paths.sceneImagesFolder" label="剧照目录名" />
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
    </>
  );
}

export function AssetDownloadsSection() {
  const sectionMode = useSettingsSectionMode();
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
  const folderTemplate = String(form.watch("naming.folderTemplate") ?? "");
  const successFileMove = Boolean(form.watch("behavior.successFileMove"));
  const sharedDirectoryMode = isSharedDirectoryMode({ successFileMove, folderTemplate });
  const showTagBadgeSettings = Boolean(downloadPoster) && Boolean(tagBadges);

  if (!hasRenderableFields) {
    return null;
  }

  return (
    <>
      {sectionMode === "public" && sharedDirectoryMode && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          当前为共享目录模式：多个影片会写入同一目录。保存时会校验 NFO 命名与剧照下载设置。
        </div>
      )}
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [watermarkDirectoryPath, setWatermarkDirectoryPath] = useState("");
  const [openingDirectory, setOpeningDirectory] = useState(false);

  const handleEnable = async () => {
    try {
      const result = await ipc.app.ensureWatermarkDirectory();
      setWatermarkDirectoryPath(result.path);
      setDialogOpen(true);
    } catch (error) {
      toast.error(`创建角标图片目录失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleOpenDirectory = async () => {
    setOpeningDirectory(true);
    try {
      await ipc.app.openWatermarkDirectory();
    } catch (error) {
      toast.error(`打开角标图片目录失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setOpeningDirectory(false);
    }
  };

  return (
    <>
      <BaseField
        name="download.tagBadgeImageOverrides"
        label="覆盖角标图片"
        description="开启后，放在 userdata/watermark 中的匹配图片会替换内建角标样式。"
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
              <p>
                推荐比例：{TAG_BADGE_IMAGE_RATIO_LABEL}，推荐素材尺寸 {TAG_BADGE_IMAGE_DEFAULT_SIZE_LABEL}
                。角标槽位宽度约为海报宽度的 {TAG_BADGE_IMAGE_WIDTH_PERCENT_LABEL}，并限制在{" "}
                {POSTER_TAG_BADGE_MIN_WIDTH}-{POSTER_TAG_BADGE_MAX_WIDTH}px；低分辨率海报会继续压到不超过海报宽度的{" "}
                {TAG_BADGE_IMAGE_MAX_WIDTH_PERCENT_LABEL}，高度按比例计算。
              </p>
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
              打开文件夹
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
          <BoolField name="download.keepNfo" label="保留已有 NFO" />
        </>
      )}
    </>
  );
}

function NamingPreview() {
  const form = useFormContext<FieldValues>();
  const previewValues = useWatch({
    control: form.control,
    name: NAMING_PREVIEW_FIELD_KEYS,
  }) as unknown[];
  const [previews, setPreviews] = useState<NamingPreviewItem[]>([]);
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
        const result = await ipc.config.previewNaming(previewConfigRef.current as Partial<Configuration>);
        if (!cancelled && requestKey === previewConfigKey) {
          setPreviews(result.items);
        }
      } catch {
        if (!cancelled && requestKey === previewConfigKey) {
          setPreviews([]);
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
  }, [previewConfigKey]);

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">命名预览</div>
      <div className="space-y-2">
        {previews.length === 0 && (
          <div className="text-xs text-muted-foreground">{loading ? "生成预览中..." : "暂无预览"}</div>
        )}
        {previews.map((p) => (
          <div key={p.label} className="text-xs">
            <span className="mr-2 inline-block min-w-[4em] text-muted-foreground">{p.label}</span>
            <span className="font-mono">
              {p.folder}/{p.file}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type NamingTemplateHelpKind = "folder" | "file";

function NamingTemplateHelp({ kind }: { kind: NamingTemplateHelpKind }) {
  const label = kind === "folder" ? "文件夹模板" : "文件名模板";

  return (
    <Dialog>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent>{label}占位符</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
  const sharedDirectoryMode = isSharedDirectoryMode({ successFileMove, folderTemplate });

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
  const [testing, setTesting] = useState(false);
  const form = useFormContext<FieldValues>();
  const search = useOptionalSettingsSearch();
  const engine = useWatch({ control: form.control, name: "translate.engine" });
  const isLLM = engine !== "google";

  const handleTestLlm = async () => {
    const input = {
      llmModelName: String(form.getValues("translate.llmModelName") ?? ""),
      llmApiKey: String(form.getValues("translate.llmApiKey") ?? ""),
      llmBaseUrl: String(form.getValues("translate.llmBaseUrl") ?? ""),
      llmPrompt: String(form.getValues("translate.llmPrompt") ?? ""),
      llmTemperature: Number(form.getValues("translate.llmTemperature") ?? 0),
    };

    setTesting(true);
    try {
      const result = await ipc.translate.testLlm(input);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(`测试失败: ${error instanceof Error ? error.message : "未知错误"}`);
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
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" /> 测试中...
                  </>
                ) : (
                  "测试连通性"
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
            description={`默认值：${DEFAULT_LLM_BASE_URL}。本地常见示例：Ollama 用 http://127.0.0.1:11434/v1，LM Studio 用 http://127.0.0.1:1234/v1`}
          />
          <PromptFieldWrapper name="translate.llmPrompt" label="LLM 翻译提示词" />
          <NumberField name="translate.llmTemperature" label="LLM 温度" min={0} max={2} step={0.1} />
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

export function PersonSyncSharedSection() {
  const hasRenderableFields = useHasRenderableFields(PERSON_SYNC_SHARED_FIELD_KEYS);

  if (!hasRenderableFields) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">共享人物资料源</h4>
        <p className="text-xs text-muted-foreground">
          同时服务 Jellyfin 和 Emby。人物简介会按顺序选择一个质量达标的主资料源。
        </p>
      </div>
      <ChipArrayFieldWrapper
        name="personSync.personOverviewSources"
        label="人物简介来源顺序"
        options={[...ACTOR_OVERVIEW_SOURCE_OPTIONS]}
      />
      <ChipArrayFieldWrapper
        name="personSync.personImageSources"
        label="人物头像来源顺序"
        options={[...ACTOR_IMAGE_SOURCE_OPTIONS]}
      />
    </div>
  );
}

export function JellyfinSection() {
  return (
    <>
      <UrlField name="jellyfin.url" label="Jellyfin 服务器地址" />
      <CookieFieldWrapper name="jellyfin.apiKey" label="Jellyfin API Key" />
      <TextField
        name="jellyfin.userId"
        label="Jellyfin 用户 ID"
        description="必须是 UUID。用于人物列表读取，留空则按服务端默认处理。"
      />
      <BoolField
        name="jellyfin.refreshPersonAfterSync"
        label="同步后刷新人物"
        description="同步简介或头像后，额外请求 Jellyfin 刷新人物元数据与图片。"
      />
      <BoolField
        name="jellyfin.lockOverviewAfterSync"
        label="同步后锁定人物简介"
        description="写入简介后把 Overview 加入 LockedFields，降低被 Jellyfin 元数据刷新覆盖的概率。"
      />
    </>
  );
}

export function EmbySection() {
  return (
    <>
      <UrlField name="emby.url" label="Emby 服务器地址" />
      <CookieFieldWrapper name="emby.apiKey" label="Emby API Key" />
      <TextField name="emby.userId" label="Emby 用户 ID" description="用于人物列表读取，留空则按服务端默认处理。" />
      <BoolField
        name="emby.refreshPersonAfterSync"
        label="同步后刷新人物"
        description="同步简介或头像后，额外请求 Emby 刷新人物元数据与图片。"
      />
    </>
  );
}

export function ShortcutsSection() {
  return (
    <>
      <ShortcutField name="shortcuts.startOrStopScrape" label="开始/停止刮削" description="示例: S" />
      <ShortcutField name="shortcuts.retryScrape" label="重新刮削" description="示例: R" />
      <ShortcutField name="shortcuts.deleteFile" label="删除文件" description="示例: D" />
      <ShortcutField name="shortcuts.deleteFileAndFolder" label="删除文件及文件夹" description="示例: ⇧ + D" />
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
  const [relaunching, setRelaunching] = useState(false);
  const form = useFormContext<FieldValues>();
  const currentUseCustomTitleBar = Boolean(useWatch({ control: form.control, name: "ui.useCustomTitleBar" }) ?? true);
  const titleBarChanged = currentUseCustomTitleBar !== initialUseCustomTitleBar;
  const inFlightSaves = useSettingsSavingStore((state) => state.inFlight);
  const canRelaunch = titleBarChanged && inFlightSaves === 0;

  const handleRelaunch = async () => {
    if (inFlightSaves > 0) {
      toast.info("请等待自动保存完成，再重启应用");
      return;
    }

    setRelaunching(true);
    try {
      await ipc.app.relaunch();
    } catch (error) {
      setRelaunching(false);
      toast.error(`重启失败: ${error instanceof Error ? error.message : "未知错误"}`);
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

export function BehaviorSection() {
  return (
    <>
      <BoolField name="behavior.successFileMove" label="成功后移动文件" />
      <BoolField name="behavior.failedFileMove" label="失败后移动文件" />
      <BoolField name="behavior.successFileRename" label="成功后重命名文件" />
      <BoolField name="behavior.deleteEmptyFolder" label="删除空文件夹" />
      <BoolField name="behavior.scrapeSoftlinkPath" label="刮削软链接目录" />
      <BoolField name="behavior.saveLog" label="保存日志到文件" />
    </>
  );
}
