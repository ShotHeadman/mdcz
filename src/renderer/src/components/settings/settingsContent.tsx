import { isSharedDirectoryMode } from "@shared/assetNaming";
import type { Configuration } from "@shared/config";
import { TRANSLATION_TARGET_OPTIONS } from "@shared/enums";
import { DEFAULT_LLM_BASE_URL } from "@shared/llm";
import type { NamingPreviewItem } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
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
} from "@/components/config-form/FieldRenderer";
import { Button } from "@/components/ui/Button";
import { FormControl } from "@/components/ui/Form";
import { Switch } from "@/components/ui/Switch";
import { useSettingsSavingStore } from "@/store/settingsSavingStore";
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
        label="演员头像库目录"
        description="建议放在媒体目录下。这里的头像会优先使用；如希望优先使用在线头像，请在“人物头像来源顺序”中调整“本地”的位置或移除它。"
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
  const [downloadThumb, downloadPoster, downloadFanart, downloadSceneImages, downloadTrailer] = form.watch([
    "download.downloadThumb",
    "download.downloadPoster",
    "download.downloadFanart",
    "download.downloadSceneImages",
    "download.downloadTrailer",
  ]) as [boolean | undefined, boolean | undefined, boolean | undefined, boolean | undefined, boolean | undefined];
  const folderTemplate = String(form.watch("naming.folderTemplate") ?? "");
  const successFileMove = Boolean(form.watch("behavior.successFileMove"));
  const sharedDirectoryMode = isSharedDirectoryMode({ successFileMove, folderTemplate });

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
          description="按现有影片标签自动添加角标，当前支持中字、无码、破解、流出；仅处理本次新下载的海报。"
        />
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
      <TextField name="naming.folderTemplate" label="文件夹模板" description={NAMING_TEMPLATE_DESCRIPTION} />
      <TextField name="naming.fileTemplate" label="文件名模板" description={NAMING_TEMPLATE_DESCRIPTION} />
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
        options={ACTOR_OVERVIEW_SOURCE_OPTIONS}
      />
      <ChipArrayFieldWrapper
        name="personSync.personImageSources"
        label="人物头像来源顺序"
        options={ACTOR_IMAGE_SOURCE_OPTIONS}
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
