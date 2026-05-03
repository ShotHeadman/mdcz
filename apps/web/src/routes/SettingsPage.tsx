import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "@mdcz/shared/actorSource";
import { TRANSLATION_TARGET_OPTIONS, Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import {
  POSTER_TAG_BADGE_POSITION_LABELS,
  POSTER_TAG_BADGE_POSITION_OPTIONS,
  POSTER_TAG_BADGE_TYPE_LABELS,
  POSTER_TAG_BADGE_TYPE_OPTIONS,
} from "@mdcz/shared/posterBadges";
import {
  FIELD_REGISTRY,
  flattenConfig,
  SECTION_FILTER_ALIASES,
  SECTION_LABELS,
  SECTION_ORDER,
  unflattenConfig,
} from "@mdcz/shared/settingsRegistry";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import { api, getApiBase, setApiBase } from "../client";
import { includesSearch, normalizeSearchText } from "../routeHelpers";
import { Badge, Button, Input } from "../ui";
import { AppLink, ErrorBanner } from "./common";

type FlatConfig = Record<string, unknown>;
type Option = { value: string; label: string };

type FieldKind = "boolean" | "number" | "secret" | "textarea" | "enum" | "array" | "text";

const proxyTypeOptions: Option[] = [
  { value: "none", label: "不使用代理" },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "socks5", label: "SOCKS5" },
];

const translateEngineOptions: Option[] = [
  { value: "openai", label: "LLM 翻译" },
  { value: "google", label: "Google 翻译（免费）" },
];

const languageOptions: Option[] = TRANSLATION_TARGET_OPTIONS.map((value) => ({ value, label: value }));

const nfoNamingOptions: Option[] = [
  { value: "both", label: "同时生成两种" },
  { value: "movie", label: "仅 movie.nfo" },
  { value: "filename", label: "仅 文件名.nfo" },
];

const assetNamingOptions: Option[] = [
  { value: "fixed", label: "固定命名" },
  { value: "followVideo", label: "跟随影片文件名" },
];

const partStyleOptions: Option[] = [
  { value: "RAW", label: "保持原始后缀" },
  { value: "CD", label: "统一为 CD1 / CD2" },
  { value: "PART", label: "统一为 PART1 / PART2" },
  { value: "DISC", label: "统一为 DISC1 / DISC2" },
];

const crawlerSiteOptions: Option[] = [
  Website.DMM,
  Website.DMM_TV,
  Website.MGSTAGE,
  Website.PRESTIGE,
  Website.FALENO,
  Website.DAHLIA,
  Website.KM_PRODUCE,
  Website.SOKMIL,
  Website.KINGDOM,
  Website.AVBASE,
  Website.JAVDB,
  Website.JAVBUS,
  Website.JAV321,
  Website.FC2,
  Website.FC2HUB,
  Website.PPVDATABANK,
  Website.R18_DEV,
  Website.AVWIKIDB,
].map((value) => ({ value, label: value }));

const tagBadgeTypeOptions: Option[] = POSTER_TAG_BADGE_TYPE_OPTIONS.map((value) => ({
  value,
  label: POSTER_TAG_BADGE_TYPE_LABELS[value],
}));

const tagBadgePositionOptions: Option[] = POSTER_TAG_BADGE_POSITION_OPTIONS.map((value) => ({
  value,
  label: POSTER_TAG_BADGE_POSITION_LABELS[value],
}));

const actorOverviewSourceOptions: Option[] = ACTOR_OVERVIEW_SOURCE_OPTIONS.map((value) => ({ value, label: value }));
const actorImageSourceOptions: Option[] = ACTOR_IMAGE_SOURCE_OPTIONS.map((value) => ({ value, label: value }));

const enumOptionsByKey: Record<string, Option[]> = {
  "network.proxyType": proxyTypeOptions,
  "translate.engine": translateEngineOptions,
  "translate.targetLanguage": languageOptions,
  "naming.assetNamingMode": assetNamingOptions,
  "naming.partStyle": partStyleOptions,
  "download.nfoNaming": nfoNamingOptions,
  "download.tagBadgePosition": tagBadgePositionOptions,
};

const arrayOptionsByKey: Record<string, Option[]> = {
  "scrape.sites": crawlerSiteOptions,
  "download.tagBadgeTypes": tagBadgeTypeOptions,
  "personSync.personOverviewSources": actorOverviewSourceOptions,
  "personSync.personImageSources": actorImageSourceOptions,
};

const textareaFieldKeys = new Set([
  "network.javdbCookie",
  "network.javbusCookie",
  "translate.llmPrompt",
  "download.tagBadgeImageOverrides",
]);

const secretFieldKeys = new Set(["translate.llmApiKey", "jellyfin.apiKey", "emby.apiKey"]);
const arrayFieldKeys = new Set([
  "scrape.sites",
  "download.tagBadgeTypes",
  "personSync.personOverviewSources",
  "personSync.personImageSources",
]);
const hiddenInWebKeys = new Set(["scrape.r18MetadataLanguage"]);

const settingsFields = FIELD_REGISTRY.filter(
  (entry) => entry.surface === "settings" && !hiddenInWebKeys.has(entry.key),
);

const fieldMatchesSearch = (query: string, entry: (typeof settingsFields)[number]): boolean => {
  if (!query) return true;
  return includesSearch(query, [
    entry.key,
    entry.label,
    entry.description ?? "",
    SECTION_LABELS[entry.anchor],
    ...SECTION_FILTER_ALIASES[entry.anchor],
    ...entry.aliases,
  ]);
};

const valuesEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const getFieldKind = (key: string, value: unknown, fallback: unknown): FieldKind => {
  if (textareaFieldKeys.has(key)) return "textarea";
  if (secretFieldKeys.has(key)) return "secret";
  if (enumOptionsByKey[key]) return "enum";
  if (arrayFieldKeys.has(key) || Array.isArray(value) || Array.isArray(fallback)) return "array";
  if (typeof value === "boolean" || typeof fallback === "boolean") return "boolean";
  if (typeof value === "number" || typeof fallback === "number") return "number";
  return "text";
};

const toArrayText = (value: unknown): string => (Array.isArray(value) ? value.join("\n") : "");

const parseArrayText = (value: string): string[] =>
  value
    .split(/[\n,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

const buildSingleFieldPatch = (key: string, value: unknown): Parameters<typeof api.config.update>[0] =>
  unflattenConfig({ [key]: value }) as Parameters<typeof api.config.update>[0];

const buildNamingPreviewPatch = (flatConfig: FlatConfig): Parameters<typeof api.config.previewNaming>[0] =>
  unflattenConfig({
    "naming.folderTemplate": flatConfig["naming.folderTemplate"],
    "naming.fileTemplate": flatConfig["naming.fileTemplate"],
    "naming.assetNamingMode": flatConfig["naming.assetNamingMode"],
    "naming.actorNameMax": flatConfig["naming.actorNameMax"],
    "naming.actorNameMore": flatConfig["naming.actorNameMore"],
    "naming.actorFallbackToStudio": flatConfig["naming.actorFallbackToStudio"],
    "naming.releaseRule": flatConfig["naming.releaseRule"],
    "naming.folderNameMax": flatConfig["naming.folderNameMax"],
    "naming.fileNameMax": flatConfig["naming.fileNameMax"],
    "naming.cnwordStyle": flatConfig["naming.cnwordStyle"],
    "naming.umrStyle": flatConfig["naming.umrStyle"],
    "naming.leakStyle": flatConfig["naming.leakStyle"],
    "naming.uncensoredStyle": flatConfig["naming.uncensoredStyle"],
    "naming.censoredStyle": flatConfig["naming.censoredStyle"],
    "naming.partStyle": flatConfig["naming.partStyle"],
    "download.nfoNaming": flatConfig["download.nfoNaming"],
    "download.downloadSceneImages": flatConfig["download.downloadSceneImages"],
    "behavior.successFileMove": flatConfig["behavior.successFileMove"],
    "behavior.successFileRename": flatConfig["behavior.successFileRename"],
  }) as Parameters<typeof api.config.previewNaming>[0];

export const SettingsPage = () => {
  const queryClient = useQueryClient();
  const [base, setBase] = useState(getApiBase());
  const [importContent, setImportContent] = useState("");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configQ = useQuery({ queryKey: ["config"], queryFn: () => api.config.read(), retry: false });
  const defaultsQ = useQuery({ queryKey: ["config-defaults"], queryFn: () => api.config.defaults(), retry: false });
  const persistenceQ = useQuery({ queryKey: ["persistence"], queryFn: () => api.persistence.status(), retry: false });
  const previewQ = useQuery({
    queryKey: ["config", "previewNaming", configQ.data],
    queryFn: () =>
      api.config.previewNaming(buildNamingPreviewPatch(flattenConfig(configQ.data as unknown as FlatConfig))),
    enabled: Boolean(configQ.data),
    retry: false,
  });
  const updateConfigM = useMutation({
    mutationFn: (patch: Parameters<typeof api.config.update>[0]) => api.config.update(patch),
  });
  const resetConfigM = useMutation({
    mutationFn: (input?: Parameters<typeof api.config.reset>[0]) => api.config.reset(input),
  });
  const exportConfigM = useMutation({ mutationFn: () => api.config.export() });
  const importConfigM = useMutation({ mutationFn: (content: string) => api.config.import({ content }) });

  const config = configQ.data;
  const defaults = defaultsQ.data;
  const flatConfig = useMemo(() => flattenConfig((config ?? {}) as unknown as FlatConfig), [config]);
  const flatDefaults = useMemo(() => flattenConfig((defaults ?? {}) as unknown as FlatConfig), [defaults]);
  const settingsSearch = normalizeSearchText(settingsQuery);

  const updateField = async (key: string, value: unknown) => {
    setError(null);
    try {
      await updateConfigM.mutateAsync(buildSingleFieldPatch(key, value));
      await queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch (updateError) {
      setError(toErrorMessage(updateError));
    }
  };

  const resetField = async (key?: string) => {
    setError(null);
    try {
      await resetConfigM.mutateAsync(key ? { path: key } : undefined);
      await queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch (resetError) {
      setError(toErrorMessage(resetError));
    }
  };

  const exportConfig = async () => {
    setError(null);
    try {
      const content = await exportConfigM.mutateAsync();
      const blob = new Blob([content], { type: "application/toml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "mdcz-default.toml";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(toErrorMessage(exportError));
    }
  };

  const importConfig = async () => {
    setError(null);
    try {
      await importConfigM.mutateAsync(importContent);
      setImportContent("");
      await queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch (importError) {
      setError(toErrorMessage(importError));
    }
  };

  const visibleFields = settingsFields.filter((entry) => {
    if (entry.visibility === "advanced" && !showAdvanced && !settingsSearch) return false;
    return fieldMatchesSearch(settingsSearch, entry);
  });
  const visibleKeys = new Set(visibleFields.map((entry) => entry.key));
  const visibleSectionCount = SECTION_ORDER.filter((anchor) =>
    visibleFields.some((entry) => entry.anchor === anchor),
  ).length;

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto flex max-w-6xl gap-6 px-6 pb-24 pt-10 md:px-10">
        <div className="min-w-0 flex-1 space-y-6">
          <header className="flex flex-col gap-5 rounded-[2rem] bg-surface-low/80 p-6 md:p-7">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">MDCz WebUI</p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground md:text-5xl">设置</h1>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                管理目录、刮削、网络、翻译、命名、下载和文件行为设置。
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="搜索设置"
                  className="pl-9"
                  placeholder="搜索代理、命名模板、LLM、下载、路径..."
                  value={settingsQuery}
                  onChange={(event) => setSettingsQuery(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!settingsQuery} variant="secondary" onClick={() => setSettingsQuery("")}>
                  清空搜索
                </Button>
                <Button variant="secondary" onClick={() => setShowAdvanced((current) => !current)}>
                  <SlidersHorizontal className="h-4 w-4" />
                  {showAdvanced ? "隐藏高级设置" : "显示高级设置"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {settingsSearch
                ? `匹配 ${visibleFields.length} 个设置项 / ${visibleSectionCount} 个分组`
                : showAdvanced
                  ? "当前显示高级设置"
                  : "显示桌面 public 设置项"}
            </p>
          </header>

          {error && <ErrorBanner>{error}</ErrorBanner>}

          <SettingsPanel title="服务 API 端点" description="设置浏览器连接到 MDCz 服务的地址。">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Button disabled={resetConfigM.isPending} variant="secondary" onClick={() => void resetField()}>
                恢复默认设置
              </Button>
              <Button disabled={exportConfigM.isPending} variant="secondary" onClick={() => void exportConfig()}>
                导出 TOML
              </Button>
              <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/setup">
                初始化
              </AppLink>
              <AppLink
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                to="/media-roots"
              >
                媒体目录
              </AppLink>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <Input value={base} onChange={(event) => setBase(event.target.value)} />
              <Button
                onClick={() => {
                  setApiBase(base);
                  void queryClient.invalidateQueries();
                }}
              >
                保存端点
              </Button>
            </div>
          </SettingsPanel>

          <SettingsPanel
            title="配置导入"
            description="粘贴导出的 TOML 配置后导入；导入会按共享配置 schema 校验并保存。"
          >
            <textarea
              className="min-h-40 w-full rounded-quiet border border-border/60 bg-surface-low px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setImportContent(event.target.value)}
              placeholder="# 粘贴 mdcz-default.toml 内容"
              value={importContent}
            />
            <Button disabled={!importContent.trim() || importConfigM.isPending} onClick={() => void importConfig()}>
              导入 TOML
            </Button>
          </SettingsPanel>

          {!config && !configQ.isError && <SettingsSkeleton />}
          {configQ.isError && <ErrorBanner>{toErrorMessage(configQ.error)}</ErrorBanner>}

          {config && (
            <div className="space-y-10">
              {SECTION_ORDER.map((anchor) => {
                const sectionFields = settingsFields.filter(
                  (entry) => entry.anchor === anchor && visibleKeys.has(entry.key),
                );
                if (sectionFields.length === 0) return null;
                return (
                  <SettingsPanel key={anchor} title={SECTION_LABELS[anchor]}>
                    <div className="divide-y divide-border/40 rounded-[1.5rem] border border-border/40 bg-surface">
                      {sectionFields.map((entry) => (
                        <SettingFieldRow
                          key={entry.key}
                          entry={entry}
                          value={flatConfig[entry.key]}
                          defaultValue={flatDefaults[entry.key]}
                          modified={!valuesEqual(flatConfig[entry.key], flatDefaults[entry.key])}
                          highlighted={Boolean(settingsSearch)}
                          onChange={(value) => void updateField(entry.key, value)}
                          onReset={() => void resetField(entry.key)}
                        />
                      ))}
                    </div>
                    {anchor === "naming" && (
                      <NamingPreview items={previewQ.data?.items ?? []} loading={previewQ.isFetching} />
                    )}
                  </SettingsPanel>
                );
              })}
              {visibleFields.length === 0 && (
                <div className="rounded-quiet-xl bg-surface-low p-8 text-center text-sm text-muted-foreground">
                  没有匹配的设置项。请尝试搜索路径、代理、命名、下载、翻译或高级设置。
                </div>
              )}
            </div>
          )}

          <SettingsPanel title="持久化">
            <p className="text-sm text-muted-foreground">{persistenceQ.data?.ok ? "可用" : "不可用"}</p>
            <p className="break-all font-mono text-sm text-muted-foreground">{persistenceQ.data?.path}</p>
          </SettingsPanel>
        </div>
        <aside className="sticky top-10 hidden h-fit w-48 shrink-0 space-y-2 lg:block">
          {SECTION_ORDER.map((anchor) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              className="block rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
            >
              {SECTION_LABELS[anchor]}
            </a>
          ))}
        </aside>
      </div>
    </main>
  );
};

function SettingsPanel({
  title,
  description,
  children,
}: React.PropsWithChildren<{ title: string; description?: string }>) {
  return (
    <section
      id={SECTION_ORDER.find((anchor) => SECTION_LABELS[anchor] === title)}
      className="rounded-[2rem] bg-surface-low/80 p-6 shadow-none md:p-7"
    >
      <div className="mb-6 max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function SettingFieldRow({
  entry,
  value,
  defaultValue,
  modified,
  highlighted,
  onChange,
  onReset,
}: {
  entry: (typeof settingsFields)[number];
  value: unknown;
  defaultValue: unknown;
  modified: boolean;
  highlighted: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
}) {
  const kind = getFieldKind(entry.key, value, defaultValue);
  return (
    <div
      className={`grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,420px)] md:items-start ${highlighted ? "bg-primary/5" : ""}`}
      data-setting-key={entry.key}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{entry.label}</span>
          {entry.visibility === "advanced" && <Badge>高级</Badge>}
          {modified && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-surface-low px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onReset}
            >
              <RotateCcw className="h-3 w-3" />
              恢复默认
            </button>
          )}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{entry.key}</p>
        {entry.description && <p className="text-xs leading-5 text-muted-foreground">{entry.description}</p>}
      </div>
      <FieldControl fieldKey={entry.key} kind={kind} value={value ?? defaultValue} onChange={onChange} />
    </div>
  );
}

function FieldControl({
  fieldKey,
  kind,
  value,
  onChange,
}: {
  fieldKey: string;
  kind: FieldKind;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (kind === "boolean") {
    return (
      <div className="flex justify-end">
        <input
          checked={Boolean(value)}
          className="h-4 w-4 rounded border-border bg-surface-low text-primary focus-visible:ring-2 focus-visible:ring-ring"
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
      </div>
    );
  }

  if (kind === "enum") {
    return (
      <select
        className="h-10 rounded-quiet border border-border/60 bg-surface-low px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      >
        {(enumOptionsByKey[fieldKey] ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (kind === "array") {
    const options = arrayOptionsByKey[fieldKey];
    const selected = Array.isArray(value) ? value.map(String) : [];
    if (options) {
      return (
        <div className="grid gap-2 rounded-[1.5rem] bg-surface-low/60 p-4 sm:grid-cols-2">
          {options.map((option) => (
            <label className="flex items-center gap-2 text-sm font-medium text-foreground" key={option.value}>
              <input
                checked={selected.includes(option.value)}
                className="h-4 w-4 rounded border-border bg-surface-low text-primary focus-visible:ring-2 focus-visible:ring-ring"
                type="checkbox"
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected.filter((item) => item !== option.value), option.value]
                    : selected.filter((item) => item !== option.value);
                  onChange(next);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      );
    }

    return (
      <textarea
        className="min-h-24 w-full rounded-quiet border border-border/60 bg-surface-low px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        defaultValue={toArrayText(value)}
        onBlur={(event) => onChange(parseArrayText(event.target.value))}
      />
    );
  }

  if (kind === "textarea") {
    return (
      <textarea
        className="min-h-28 w-full rounded-quiet border border-border/60 bg-surface-low px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        defaultValue={String(value ?? "")}
        onBlur={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      defaultValue={String(value ?? "")}
      type={kind === "number" ? "number" : kind === "secret" ? "password" : "text"}
      onBlur={(event) => onChange(kind === "number" ? Number(event.target.value) : event.target.value)}
    />
  );
}

function NamingPreview({ items, loading }: { items: NamingPreviewItem[]; loading: boolean }) {
  return (
    <div className="rounded-quiet border border-border/50 bg-surface-low p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">命名预览</p>
        <Badge>{loading ? "生成中" : "预览"}</Badge>
      </div>
      <div className="grid gap-2 font-mono text-xs text-muted-foreground">
        {items.length === 0 && <span>暂无预览</span>}
        {items.map((item) => (
          <span key={item.label} className="break-all">
            {item.label}：{item.folder}/{item.file}
          </span>
        ))}
      </div>
    </div>
  );
}

const skeletonRows = ["row-a", "row-b", "row-c", "row-d"];

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      {SECTION_ORDER.slice(0, 4).map((anchor) => (
        <section key={anchor} className="space-y-4 rounded-[2rem] bg-surface-low/80 p-6">
          <div className="h-7 w-40 animate-pulse rounded-full bg-foreground/8" />
          <div className="space-y-3 rounded-[1.5rem] border border-border/30 bg-surface px-5 py-5">
            {skeletonRows.map((rowKey) => (
              <div key={rowKey} className="flex flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <div className="h-4 w-36 animate-pulse rounded-full bg-foreground/8" />
                  <div className="h-3 w-56 animate-pulse rounded-full bg-foreground/6" />
                </div>
                <div className="h-8 w-48 animate-pulse rounded-[var(--radius-quiet)] bg-surface-low" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
