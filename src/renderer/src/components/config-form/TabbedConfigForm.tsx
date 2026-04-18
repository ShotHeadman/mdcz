import { isSharedDirectoryMode } from "@shared/assetNaming";
import type { Configuration } from "@shared/config";
import { TRANSLATION_TARGET_OPTIONS } from "@shared/enums";
import { DEFAULT_LLM_BASE_URL } from "@shared/llm";
import type { NamingPreviewItem } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck,
  FileCog,
  FileText,
  FolderOpen,
  Globe,
  Keyboard,
  Languages,
  Loader2,
  Monitor,
  Plus,
  RotateCcw,
  Search,
  Server,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useForm, useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Form, FormControl } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { TabButton } from "@/components/ui/TabButton";
import { cn } from "@/lib/utils";
import {
  BaseField,
  BoolField,
  ChipArrayFieldWrapper,
  CookieFieldWrapper,
  DurationFieldWrapper,
  EnumField,
  type EnumOption,
  NumberField,
  OrderedSiteFieldWrapper,
  PathFieldWrapper,
  PromptFieldWrapper,
  SecretField,
  ShortcutField,
  TextField,
  UrlField,
} from "./FieldRenderer";
import { SiteConfigSection } from "./SiteConfigSection";

interface TabDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { key: "paths", label: "目录与路径", icon: FolderOpen },
  { key: "naming", label: "命名规则", icon: Type },
  { key: "scrape", label: "刮削设置", icon: FileCheck },
  { key: "translate", label: "翻译服务", icon: Languages },
  { key: "personSync", label: "人物同步", icon: Server },
  { key: "network", label: "网络连接", icon: Globe },
  { key: "download", label: "下载选项", icon: Download },
  { key: "shortcuts", label: "快捷键", icon: Keyboard },
  { key: "ui", label: "界面设置", icon: Monitor },
  { key: "behavior", label: "文件行为", icon: FileCog },
];

const PROXY_TYPE_OPTIONS = ["none", "http", "https", "socks5"];
const TRANSLATE_ENGINE_OPTIONS: EnumOption[] = [
  { value: "openai", label: "LLM 翻译" },
  { value: "google", label: "Google 翻译（免费）" },
];
const LANGUAGE_OPTIONS = [...TRANSLATION_TARGET_OPTIONS];
const ACTOR_OVERVIEW_SOURCE_OPTIONS = ["official", "avjoho", "avbase"];
const ACTOR_IMAGE_SOURCE_OPTIONS = ["local", "gfriends", "official", "avbase"];
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

export const NAMING_TEMPLATE_DESCRIPTION =
  "可用占位符：{actor} {actorFallbackPrefix} {number} {date} {title} {originaltitle} {studio} {publisher}";

// ── Field registry for search/filter ──

interface FieldEntry {
  key: string;
  label: string;
  section: string;
}

const FIELD_REGISTRY: FieldEntry[] = [
  // paths
  { key: "paths.mediaPath", label: "媒体目录", section: "paths" },
  { key: "paths.actorPhotoFolder", label: "演员头像库目录", section: "paths" },
  { key: "paths.softlinkPath", label: "软链接目录", section: "paths" },
  { key: "paths.successOutputFolder", label: "成功输出目录", section: "paths" },
  { key: "paths.failedOutputFolder", label: "失败输出目录", section: "paths" },
  { key: "paths.sceneImagesFolder", label: "剧照目录名", section: "paths" },
  { key: "paths.configDirectory", label: "配置文件目录", section: "paths" },
  // scrape
  { key: "scrape.sites", label: "启用站点与优先级", section: "scrape" },
  { key: "scrape.threadNumber", label: "并发线程数", section: "scrape" },
  { key: "scrape.javdbDelaySeconds", label: "JavDB 请求延迟(秒)", section: "scrape" },
  { key: "scrape.restAfterCount", label: "连续刮削后休息(条数)", section: "scrape" },
  { key: "scrape.restDuration", label: "休息时长", section: "scrape" },
  // network
  { key: "network.proxyType", label: "代理类型", section: "network" },
  { key: "network.proxy", label: "代理地址", section: "network" },
  { key: "network.useProxy", label: "启用代理", section: "network" },
  { key: "network.timeout", label: "超时时间(秒)", section: "network" },
  { key: "network.retryCount", label: "重试次数", section: "network" },
  { key: "network.javdbCookie", label: "JavDB 凭证", section: "network" },
  { key: "network.javbusCookie", label: "JavBus 凭证", section: "network" },
  // download
  { key: "download.downloadThumb", label: "下载横版缩略图", section: "download" },
  { key: "download.downloadPoster", label: "下载海报", section: "download" },
  { key: "download.tagBadges", label: "封面标签角标", section: "download" },
  { key: "download.downloadFanart", label: "下载背景图", section: "download" },
  { key: "download.downloadSceneImages", label: "下载剧照", section: "download" },
  { key: "download.downloadTrailer", label: "下载预告片", section: "download" },
  { key: "download.generateNfo", label: "生成 NFO", section: "download" },
  { key: "download.nfoNaming", label: "NFO 文件命名", section: "download" },
  { key: "download.keepThumb", label: "保留已有横版缩略图", section: "download" },
  { key: "download.keepPoster", label: "保留已有海报", section: "download" },
  { key: "download.keepFanart", label: "保留已有背景图", section: "download" },
  { key: "download.keepSceneImages", label: "保留已有剧照", section: "download" },
  { key: "download.keepTrailer", label: "保留已有预告片", section: "download" },
  { key: "download.keepNfo", label: "保留已有 NFO", section: "download" },
  // naming
  { key: "naming.folderTemplate", label: "文件夹模板", section: "naming" },
  { key: "naming.fileTemplate", label: "文件名模板", section: "naming" },
  { key: "naming.assetNamingMode", label: "附属文件命名", section: "naming" },
  { key: "naming.nfoTitleTemplate", label: "NFO 标题模板", section: "naming" },
  { key: "naming.actorNameMax", label: "演员名最大数量", section: "naming" },
  { key: "naming.actorNameMore", label: "演员名超出后缀", section: "naming" },
  { key: "naming.actorFallbackToStudio", label: "演员为空时使用片商或卖家", section: "naming" },
  { key: "naming.releaseRule", label: "发行日期格式", section: "naming" },
  { key: "naming.folderNameMax", label: "文件夹名最大长度", section: "naming" },
  { key: "naming.fileNameMax", label: "文件名最大长度", section: "naming" },
  { key: "naming.cnwordStyle", label: "中文字幕标记", section: "naming" },
  { key: "naming.umrStyle", label: "UMR 标记", section: "naming" },
  { key: "naming.leakStyle", label: "流出标记", section: "naming" },
  { key: "naming.uncensoredStyle", label: "无码标记", section: "naming" },
  { key: "naming.censoredStyle", label: "有码标记", section: "naming" },
  { key: "naming.partStyle", label: "分盘样式", section: "naming" },
  // translate
  { key: "translate.enableTranslation", label: "启用内容翻译", section: "translate" },
  { key: "translate.engine", label: "翻译引擎", section: "translate" },
  { key: "translate.llmModelName", label: "LLM 模型名称", section: "translate" },
  { key: "translate.llmApiKey", label: "LLM 密钥（可选）", section: "translate" },
  { key: "translate.llmBaseUrl", label: "LLM API 地址", section: "translate" },
  { key: "translate.llmPrompt", label: "LLM 翻译提示词", section: "translate" },
  { key: "translate.llmTemperature", label: "LLM 温度", section: "translate" },
  { key: "translate.llmMaxRetries", label: "LLM 最大重试次数", section: "translate" },
  { key: "translate.llmMaxRequestsPerSecond", label: "LLM 每秒最大请求数", section: "translate" },
  { key: "translate.targetLanguage", label: "目标语言", section: "translate" },
  // person sync
  { key: "personSync.personOverviewSources", label: "人物简介来源", section: "personSync" },
  { key: "personSync.personImageSources", label: "人物头像来源", section: "personSync" },
  { key: "jellyfin.url", label: "Jellyfin 服务器地址", section: "personSync" },
  { key: "jellyfin.apiKey", label: "Jellyfin API Key", section: "personSync" },
  { key: "jellyfin.userId", label: "Jellyfin 用户 ID", section: "personSync" },
  { key: "jellyfin.refreshPersonAfterSync", label: "Jellyfin 同步后刷新人物", section: "personSync" },
  { key: "jellyfin.lockOverviewAfterSync", label: "Jellyfin 锁定人物简介", section: "personSync" },
  { key: "emby.url", label: "Emby 服务器地址", section: "personSync" },
  { key: "emby.apiKey", label: "Emby API Key", section: "personSync" },
  { key: "emby.userId", label: "Emby 用户 ID", section: "personSync" },
  { key: "emby.refreshPersonAfterSync", label: "Emby 同步后刷新人物", section: "personSync" },
  // shortcuts
  { key: "shortcuts.startOrStopScrape", label: "开始/停止刮削", section: "shortcuts" },
  { key: "shortcuts.retryScrape", label: "重新刮削", section: "shortcuts" },
  { key: "shortcuts.deleteFile", label: "删除文件", section: "shortcuts" },
  { key: "shortcuts.deleteFileAndFolder", label: "删除文件及文件夹", section: "shortcuts" },
  { key: "shortcuts.openFolder", label: "打开所在目录", section: "shortcuts" },
  { key: "shortcuts.editNfo", label: "编辑 NFO", section: "shortcuts" },
  { key: "shortcuts.playVideo", label: "播放视频", section: "shortcuts" },
  // ui
  { key: "ui.showLogsPanel", label: "显示日志面板", section: "ui" },
  { key: "ui.hideDock", label: "隐藏 Dock 图标", section: "ui" },
  { key: "ui.hideMenu", label: "隐藏菜单栏", section: "ui" },
  { key: "ui.hideWindowButtons", label: "隐藏窗口按钮", section: "ui" },
  // behavior
  { key: "behavior.successFileMove", label: "成功后移动文件", section: "behavior" },
  { key: "behavior.failedFileMove", label: "失败后移动文件", section: "behavior" },
  { key: "behavior.successFileRename", label: "成功后重命名文件", section: "behavior" },
  { key: "behavior.deleteEmptyFolder", label: "删除空文件夹", section: "behavior" },
  { key: "behavior.scrapeSoftlinkPath", label: "刮削软链接目录", section: "behavior" },
  { key: "behavior.saveLog", label: "保存日志到文件", section: "behavior" },
];

// ── Section descriptions ──

const SECTION_DESCRIPTIONS: Record<string, string> = {
  paths: "配置媒体库、本地演员头像库及输出目录路径",
  scrape: "配置刮削行为、站点及并发策略",
  network: "代理、超时、重试及 Cookie 设置",
  download: "控制缩略图、海报、背景图、剧照与 NFO 的生成与保留",
  naming: "文件、文件夹和附属资源的命名规则",
  translate: "LLM 翻译引擎配置",
  personSync: "共享人物来源顺序，以及 Jellyfin 与 Emby 的人物同步设置",
  shortcuts: "自定义快捷键，留空可禁用（工作台快捷键仅在工作台页生效）",
  ui: "调整界面显示选项",
  behavior: "控制刮削后的文件操作行为",
};

// ── Helpers ──

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const tail = parts.at(-1);
  if (tail) cursor[tail] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenConfig(data: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const entry of FIELD_REGISTRY) {
    flat[entry.key] = getNestedValue(data, entry.key);
  }

  const siteConfigs = getNestedValue(data, "scrape.siteConfigs");
  if (isRecord(siteConfigs)) {
    for (const [site, config] of Object.entries(siteConfigs)) {
      if (!isRecord(config)) {
        continue;
      }
      if ("customUrl" in config) {
        flat[`scrape.siteConfigs.${site}.customUrl`] = config.customUrl;
      }
    }
  }

  return flat;
}

function unflattenConfig(flat: Record<string, unknown>): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (value !== undefined) setNestedValue(nested, key, value);
  }
  return nested;
}

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

// ── Section renderers ──

type SectionRenderProps = {
  siteOptions: string[];
};

type CrawlerSiteInfo = {
  site: string;
  name: string;
  enabled: boolean;
  native: boolean;
};

function PathsSection(_props: SectionRenderProps) {
  return (
    <>
      <PathFieldWrapper name="paths.mediaPath" label="媒体目录" isDirectory />
      <PathFieldWrapper
        name="paths.actorPhotoFolder"
        label="演员头像库目录"
        description="建议放在媒体库目录下。这里的头像会优先使用；如果希望优先使用在线头像，请在“人物头像来源顺序”中调整“本地”的位置或移除它。"
        isDirectory
      />
      <PathFieldWrapper name="paths.softlinkPath" label="软链接目录" isDirectory />
      <PathFieldWrapper name="paths.successOutputFolder" label="成功输出目录" isDirectory />
      <PathFieldWrapper name="paths.failedOutputFolder" label="失败输出目录" isDirectory />
      <TextField name="paths.sceneImagesFolder" label="剧照目录名" />
      <PathFieldWrapper name="paths.configDirectory" label="配置文件目录" isDirectory />
    </>
  );
}

function ScrapeSection({ siteOptions }: SectionRenderProps) {
  return (
    <>
      <OrderedSiteFieldWrapper
        name="scrape.sites"
        label="启用站点与优先级"
        description="勾选启用站点，上下移动调整优先级。未勾选的站点不会参与刮削。"
        options={siteOptions}
      />
      <NumberField name="scrape.threadNumber" label="并发线程数" min={1} max={128} />
      <NumberField name="scrape.javdbDelaySeconds" label="JavDB 请求延迟(秒)" min={0} max={120} />
      <NumberField name="scrape.restAfterCount" label="连续刮削后休息(条数)" min={1} max={500} />
      <DurationFieldWrapper name="scrape.restDuration" label="休息时长" />
    </>
  );
}

function NetworkSection(_props: SectionRenderProps) {
  return (
    <>
      <EnumField name="network.proxyType" label="代理类型" options={PROXY_TYPE_OPTIONS} />
      <TextField name="network.proxy" label="代理地址" />
      <BoolField name="network.useProxy" label="启用代理" />
      <NumberField name="network.timeout" label="超时时间(秒)" min={1} max={300} />
      <NumberField name="network.retryCount" label="重试次数" min={0} max={10} />
      <CookieFieldWrapper name="network.javdbCookie" label="JavDB 凭证" />
      <CookieFieldWrapper name="network.javbusCookie" label="JavBus 凭证" />
    </>
  );
}

function DownloadSection(_props: SectionRenderProps) {
  const form = useFormContext<FieldValues>();
  const [downloadThumb, downloadPoster, downloadFanart, downloadSceneImages, downloadTrailer, generateNfo] = form.watch(
    [
      "download.downloadThumb",
      "download.downloadPoster",
      "download.downloadFanart",
      "download.downloadSceneImages",
      "download.downloadTrailer",
      "download.generateNfo",
    ],
  ) as [
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

  return (
    <>
      {sharedDirectoryMode && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          当前为共享目录模式：多个影片会写入同一目录。保存时会校验 NFO 命名与剧照下载设置。
        </div>
      )}
      <BoolField name="download.downloadThumb" label="下载横版缩略图" />
      <BoolField name="download.downloadPoster" label="下载海报" />
      {downloadPoster && (
        <BoolField
          name="download.tagBadges"
          label="为封面添加标签角标"
          description="按现有影片标签自动添加角标，当前支持中字、无码、破解、流出；仅处理本次新下载的海报。"
        />
      )}
      <BoolField name="download.downloadFanart" label="下载背景图" />
      <BoolField name="download.downloadSceneImages" label="下载剧照" />
      <BoolField name="download.downloadTrailer" label="下载预告片" />
      <BoolField name="download.generateNfo" label="生成 NFO" />
      {generateNfo && <EnumField name="download.nfoNaming" label="NFO 文件命名" options={NFO_NAMING_OPTIONS} />}
      {downloadThumb && <BoolField name="download.keepThumb" label="保留已有横版缩略图" />}
      {downloadPoster && <BoolField name="download.keepPoster" label="保留已有海报" />}
      {downloadFanart && <BoolField name="download.keepFanart" label="保留已有背景图" />}
      {downloadSceneImages && <BoolField name="download.keepSceneImages" label="保留已有剧照" />}
      {downloadTrailer && <BoolField name="download.keepTrailer" label="保留已有预告片" />}
      {generateNfo && <BoolField name="download.keepNfo" label="保留已有 NFO" />}
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

export function NamingSection(_props: SectionRenderProps) {
  const form = useFormContext<FieldValues>();
  const folderTemplate = String(form.watch("naming.folderTemplate") ?? "");
  const successFileMove = Boolean(form.watch("behavior.successFileMove"));
  const sharedDirectoryMode = isSharedDirectoryMode({ successFileMove, folderTemplate });

  return (
    <>
      <TextField name="naming.folderTemplate" label="文件夹模板" description={NAMING_TEMPLATE_DESCRIPTION} />
      <TextField name="naming.fileTemplate" label="文件名模板" description={NAMING_TEMPLATE_DESCRIPTION} />
      <EnumField
        name="naming.assetNamingMode"
        label="附属文件命名"
        description="海报、横版缩略图、背景图与预告片的文件名规则。"
        options={ASSET_NAMING_OPTIONS}
      />
      {sharedDirectoryMode && (
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
      <NamingPreview />
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

function TranslateSection(_props: SectionRenderProps) {
  const [testing, setTesting] = useState(false);
  const form = useFormContext<FieldValues>();
  const engine = useWatch({ control: form.control, name: "translate.engine" });
  const isLLM = engine !== "google";

  const handleTestLlm = async () => {
    const input = {
      llmModelName: String(form.getValues("translate.llmModelName") ?? ""),
      llmApiKey: String(form.getValues("translate.llmApiKey") ?? ""),
      llmBaseUrl: String(form.getValues("translate.llmBaseUrl") ?? ""),
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
      {isLLM && (
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

function PersonSyncSection(_props: SectionRenderProps) {
  return (
    <>
      <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">共享人物资料源</h3>
          <p className="text-xs text-muted-foreground">
            同时服务 Jellyfin 和 Emby。人物简介会按顺序选择一个质量达标的主资料源。
          </p>
        </div>
        <ChipArrayFieldWrapper
          name="personSync.personOverviewSources"
          label="人物简介来源顺序"
          options={ACTOR_OVERVIEW_SOURCE_OPTIONS}
        />
        <ChipArrayFieldWrapper
          name="personSync.personImageSources"
          label="人物头像来源顺序"
          options={ACTOR_IMAGE_SOURCE_OPTIONS}
        />
      </div>

      <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Jellyfin</h3>
          <p className="text-xs text-muted-foreground">用于 Jellyfin 人物信息和头像同步。</p>
        </div>
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
      </div>

      <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Emby</h3>
          <p className="text-xs text-muted-foreground">
            用于 Emby 人物信息和头像同步。头像上传按官方接口要求通常需要管理员 API Key。
          </p>
        </div>
        <UrlField name="emby.url" label="Emby 服务器地址" />
        <CookieFieldWrapper name="emby.apiKey" label="Emby API Key" />
        <TextField name="emby.userId" label="Emby 用户 ID" description="用于人物列表读取，留空则按服务端默认处理。" />
        <BoolField
          name="emby.refreshPersonAfterSync"
          label="同步后刷新人物"
          description="同步简介或头像后，额外请求 Emby 刷新人物元数据与图片。"
        />
      </div>
    </>
  );
}

function ShortcutsSection(_props: SectionRenderProps) {
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

function UiSection(_props: SectionRenderProps) {
  return (
    <>
      <BoolField name="ui.showLogsPanel" label="显示日志面板" />
      <BoolField name="ui.hideDock" label="隐藏 Dock 图标" />
      <BoolField name="ui.hideMenu" label="隐藏菜单栏" />
      <BoolField name="ui.hideWindowButtons" label="隐藏窗口按钮" />
    </>
  );
}

function BehaviorSection(_props: SectionRenderProps) {
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

const SECTION_COMPONENTS: Record<string, (props: SectionRenderProps) => React.JSX.Element> = {
  paths: PathsSection,
  scrape: ScrapeSection,
  network: NetworkSection,
  download: DownloadSection,
  naming: NamingSection,
  translate: TranslateSection,
  personSync: PersonSyncSection,
  shortcuts: ShortcutsSection,
  ui: UiSection,
  behavior: BehaviorSection,
};

// ── Props ──

interface TabbedConfigFormProps {
  data: Record<string, unknown>;
  onSubmit: (data: FieldValues) => Promise<unknown> | unknown;
  serverErrors?: string[];
  serverFieldErrors?: Record<string, string>;
  onDirtyChange?: (dirty: boolean) => void;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
  // Profile management
  profiles?: string[];
  activeProfile?: string;
  onSwitchProfile?: (name: string) => void;
  onCreateProfile?: () => void;
  onDeleteProfile?: () => void;
  onResetConfig?: () => void;
  configPath?: string;
}

export interface TabbedConfigFormHandle {
  submit: () => Promise<boolean>;
}

export const TabbedConfigForm = forwardRef<TabbedConfigFormHandle, TabbedConfigFormProps>(function TabbedConfigForm(
  {
    data,
    onSubmit,
    serverErrors,
    serverFieldErrors,
    onDirtyChange,
    initialTab,
    onTabChange,
    profiles = [],
    activeProfile = "",
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onResetConfig,
    configPath,
  }: TabbedConfigFormProps,
  ref,
) {
  const defaultTab = TABS[0]?.key || "";
  const resolvedInitialTab = initialTab && TABS.some((tab) => tab.key === initialTab) ? initialTab : defaultTab;
  const flatDefaults = useMemo(() => flattenConfig(data), [data]);
  const submitPromiseRef = useRef<Promise<boolean> | null>(null);

  const form = useForm<FieldValues>({
    defaultValues: flatDefaults,
    mode: "onChange",
  });

  useEffect(() => {
    form.reset(flatDefaults);
  }, [flatDefaults, form]);

  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as {
        sites: CrawlerSiteInfo[];
      };
      return result.sites;
    },
    staleTime: 60_000,
  });

  const siteOptions = useMemo(() => {
    const fromApi = toSiteOptions(sitesQ.data);
    const fromConfig = toStringArray(flatDefaults["scrape.sites"]);
    return Array.from(new Set([...fromApi, ...fromConfig]));
  }, [sitesQ.data, flatDefaults]);

  const handleFormSubmit = useCallback(
    async (values: FieldValues) => {
      await onSubmit(unflattenConfig(values));
      // Mark current values as the new baseline after successful save.
      form.reset(values);
      onDirtyChange?.(false);
    },
    [form, onDirtyChange, onSubmit],
  );

  const submit = useCallback(async () => {
    if (submitPromiseRef.current) {
      return submitPromiseRef.current;
    }

    const submission = (async () => {
      let wasSuccessful = false;

      await form.handleSubmit(
        async (values) => {
          try {
            await handleFormSubmit(values);
            wasSuccessful = true;
          } catch {
            wasSuccessful = false;
          }
        },
        () => {
          wasSuccessful = false;
        },
      )();

      return wasSuccessful;
    })();

    submitPromiseRef.current = submission.finally(() => {
      submitPromiseRef.current = null;
    });

    return submitPromiseRef.current;
  }, [form, handleFormSubmit]);

  useImperativeHandle(
    ref,
    () => ({
      submit,
    }),
    [submit],
  );

  // Notify parent of dirty state
  const isDirty = form.formState.isDirty;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Apply server errors to form fields
  useEffect(() => {
    if (!serverErrors?.length) return;
    for (const fieldPath of serverErrors) {
      form.setError(fieldPath, {
        type: "server",
        message: serverFieldErrors?.[fieldPath] ?? "校验失败",
      });
    }
    const firstError = serverErrors[0];
    if (firstError) {
      const entry = FIELD_REGISTRY.find((f) => f.key === firstError);
      if (entry) setActiveTab(entry.section);
    }
  }, [serverErrors, serverFieldErrors, form]);

  // Tab state
  const [activeTab, setActiveTab] = useState<string>(resolvedInitialTab);

  useEffect(() => {
    onTabChange?.(activeTab);
  }, [activeTab, onTabChange]);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [showModifiedOnly, setShowModifiedOnly] = useState(false);
  const isSearchActive = searchQuery.trim().length > 0;

  const matchingSections = useMemo(() => {
    if (!isSearchActive && !showModifiedOnly) return null;
    const q = searchQuery.toLowerCase();
    const matching = new Map<string, string[]>();

    for (const entry of FIELD_REGISTRY) {
      const labelMatch =
        !isSearchActive || entry.label.toLowerCase().includes(q) || entry.key.toLowerCase().includes(q);
      const modified = showModifiedOnly
        ? JSON.stringify(form.getValues(entry.key)) !== JSON.stringify(flatDefaults[entry.key])
        : true;
      if (labelMatch && modified) {
        const arr = matching.get(entry.section) ?? [];
        arr.push(entry.key);
        matching.set(entry.section, arr);
      }
    }
    return matching;
  }, [searchQuery, isSearchActive, showModifiedOnly, form, flatDefaults]);

  // Error count per tab
  const formErrors = form.formState.errors;
  const errorCountByTab = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of FIELD_REGISTRY) {
      if (formErrors[entry.key]) {
        counts.set(entry.section, (counts.get(entry.section) ?? 0) + 1);
      }
    }
    return counts;
  }, [formErrors]);

  // Navigation arrows logic
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 2);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 2);
    }
  }, []);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { clientWidth } = scrollRef.current;
      const scrollAmount = clientWidth * 0.5;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const visibleTabs = matchingSections ? TABS.filter((t) => matchingSections.has(t.key)) : TABS;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheelNative = (e: WheelEvent) => {
      // Check if horizontal scroll is possible
      if (el.scrollWidth > el.clientWidth) {
        // If it's mainly a vertical scroll or there's some delta, handle it
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          e.stopPropagation();
          el.scrollLeft += e.deltaY;
        } else if (Math.abs(e.deltaX) > 0) {
          // If it's already a horizontal scroll, just ensure it doesn't bubble if we handle it
          e.stopPropagation();
        }
      }
    };

    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll]);

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="h-full w-full overflow-y-auto relative scroll-smooth"
      >
        <div className="sticky top-0 z-10 bg-background/60 backdrop-blur-xl border-b">
          <PageHeader
            title="设置"
            subtitle="管理媒体库、刮削策略及系统偏好"
            icon={Server}
            extra={
              <div className="flex items-center gap-3">
                {configPath && (
                  <div
                    className="hidden lg:flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-mono text-muted-foreground/70 max-w-[280px] truncate hover:text-muted-foreground transition-colors"
                    title={configPath}
                  >
                    <FileText className="h-2.5 w-2.5" />
                    <span className="truncate">{configPath}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {profiles.length > 0 && (
                    <div className="flex items-center h-9 bg-muted/40 rounded-lg p-1 border">
                      <Select value={activeProfile || "default"} onValueChange={onSwitchProfile}>
                        <SelectTrigger className="h-full min-w-[90px] max-w-[150px] text-[10px] border-none bg-transparent focus:ring-0 shadow-none px-2">
                          <SelectValue placeholder="默认配置" />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles
                            .filter((p) => p.length > 0)
                            .map((p) => (
                              <SelectItem key={p} value={p}>
                                {p}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <div className="h-3 w-px bg-border/60 mx-1" />
                      <div className="flex items-center pr-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full hover:bg-background/80"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCreateProfile?.();
                          }}
                          title="新建配置档案"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        {profiles.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteProfile?.();
                            }}
                            title="删除当前配置档案"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-lg text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/5"
                    onClick={onResetConfig}
                    title="恢复默认设置"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>

                  <div className="h-6 w-px bg-border mx-1" />

                  <Button
                    type="submit"
                    className="rounded-lg px-6 h-9 font-semibold text-xs shadow-sm"
                    disabled={!form.formState.isDirty || form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting ? "保存中..." : "保存设置"}
                  </Button>
                </div>
              </div>
            }
          />
          {/* Sub Header / Tab Bar */}
          <div className="px-8 pb-2 h-11 flex items-center">
            <div className="max-w-4xl w-full mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索..."
                    className="pl-8 pr-7 h-9 w-40 rounded-lg bg-muted/50 border-transparent focus:bg-background focus:border-primary/20 transition-all text-xs"
                  />
                  {isSearchActive && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <Button
                  type="button"
                  variant={showModifiedOnly ? "secondary" : "ghost"}
                  className={cn(
                    "rounded-lg h-9 px-3 gap-1.5 text-[12px] font-medium transition-all",
                    showModifiedOnly
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => setShowModifiedOnly(!showModifiedOnly)}
                >
                  <div className="relative">
                    <RotateCcw className="h-3.5 w-3.5" />
                    {showModifiedOnly && (
                      <span className="absolute -top-1 -right-1 h-1.5 w-1.5 bg-primary rounded-full" />
                    )}
                  </div>
                  已修改
                </Button>
              </div>

              {/* Tab bar container */}
              <div className="relative flex items-center flex-1 min-w-0 group/tabs">
                {canScrollLeft && (
                  <div className="absolute left-0 inset-y-0 z-10 flex items-center pr-10 bg-gradient-to-r from-background via-background/80 to-transparent pointer-events-none rounded-l-lg">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 ml-0.5 rounded-full bg-background shadow-md border pointer-events-auto hover:bg-accent hover:text-accent-foreground transition-all duration-200"
                      onClick={() => scroll("left")}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                <div
                  ref={scrollRef}
                  onScroll={checkScroll}
                  className="flex-1 flex gap-1 p-1 bg-muted/40 rounded-lg overflow-x-auto no-scrollbar scroll-smooth"
                >
                  {visibleTabs.map((tab) => {
                    const errorCount = errorCountByTab.get(tab.key);
                    const isActive = activeTab === tab.key;
                    const Icon = tab.icon;
                    return (
                      <TabButton key={tab.key} type="button" isActive={isActive} onClick={() => setActiveTab(tab.key)}>
                        <Icon className="h-3.5 w-3.5 mr-1.5" />
                        {tab.label}
                        {errorCount && (
                          <span className="inline-flex items-center justify-center h-3.5 min-w-3.5 rounded-full bg-destructive text-white text-[8px] font-bold px-1 ml-1.5">
                            {errorCount}
                          </span>
                        )}
                      </TabButton>
                    );
                  })}
                </div>

                {canScrollRight && (
                  <div className="absolute right-0 inset-y-0 z-10 flex items-center pl-10 bg-gradient-to-l from-background via-background/80 to-transparent pointer-events-none rounded-r-lg">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 mr-0.5 rounded-full bg-background shadow-md border pointer-events-auto hover:bg-accent hover:text-accent-foreground transition-all duration-200"
                      onClick={() => scroll("right")}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="max-w-4xl mx-auto p-6 space-y-8">
          {(matchingSections ? visibleTabs : visibleTabs.filter((t) => t.key === activeTab)).map((tab) => {
            const SectionComp = SECTION_COMPONENTS[tab.key];
            if (!SectionComp) return null;
            return (
              <div
                key={tab.key}
                id={`group-${tab.key}`}
                className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
              >
                <div className="px-1">
                  <h2 className="text-base font-semibold mb-1 text-foreground">{tab.label}</h2>
                  {SECTION_DESCRIPTIONS[tab.key] && (
                    <p className="text-muted-foreground text-xs">{SECTION_DESCRIPTIONS[tab.key]}</p>
                  )}
                </div>
                <div className="bg-card rounded-xl border shadow-sm overflow-hidden divide-y divide-border/50">
                  <SectionComp siteOptions={siteOptions} />
                </div>
              </div>
            );
          })}

          {/* Site-specific config section under the scrape tab */}
          {activeTab === "scrape" && !matchingSections && <SiteConfigSection />}

          {matchingSections && visibleTabs.length === 0 && (
            <div className="text-center text-muted-foreground py-20">
              {showModifiedOnly ? "没有已修改的设置项" : `未找到匹配"${searchQuery}"的设置项`}
            </div>
          )}

          <div className="h-10" />
        </div>
      </form>
    </Form>
  );
});
