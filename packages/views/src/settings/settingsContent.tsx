import { isSharedDirectoryMode } from "@mdcz/shared/assetNaming";
import {
  type Configuration,
  NFO_FIELD_OPTIONS,
  OFFICIAL_SITE_URLS,
  TRANSLATION_FIELD_OPTIONS,
} from "@mdcz/shared/config";
import { TRANSLATION_TARGET_OPTIONS, Website } from "@mdcz/shared/enums";
import {
  POSTER_TAG_BADGE_ASPECT_HEIGHT,
  POSTER_TAG_BADGE_ASPECT_WIDTH,
  POSTER_TAG_BADGE_IMAGE_EXTENSIONS,
  POSTER_TAG_BADGE_IMAGE_FILENAMES,
  POSTER_TAG_BADGE_POSITION_OPTIONS,
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
  Switch,
} from "@mdcz/ui";
import { CircleHelp, FolderOpen, Loader2, RotateCcw } from "lucide-react";
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
  NumberField,
  PathArrayFieldWrapper,
  PathFieldWrapper,
  PromptFieldWrapper,
  SecretField,
  ShortcutField,
  TextField,
  UrlField,
} from "../config-form/FieldRenderer";
import { useT } from "../i18n";
import { AggregationPriorityEditorField } from "./AggregationPriorityEditorField";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import { useSettingsSectionMode } from "./SettingsSectionModeContext";
import { useSettingsInFlightSaves, useSettingsNotifier, useSettingsServices } from "./SettingsServices";
import { SiteConnectivityPill } from "./SiteConnectivityPill";
import { useHasRenderableFields } from "./sectionVisibility";
import { AGGREGATION_PRIORITY_KEYS, getNestedValue, isRecord, unflattenConfig } from "./settingsRegistry";

// ── Constants ──

const PROXY_TYPE_OPTIONS = ["none", "http", "https", "socks5"];
const LANGUAGE_OPTIONS = [...TRANSLATION_TARGET_OPTIONS];
const TAG_BADGE_IMAGE_EXTENSION_LABEL = POSTER_TAG_BADGE_IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(
  " / ",
);
const TAG_BADGE_IMAGE_RATIO_LABEL = `${POSTER_TAG_BADGE_ASPECT_WIDTH}:${POSTER_TAG_BADGE_ASPECT_HEIGHT}`;

const toEnumOptions = (labels: Record<string, string>): Array<{ value: string; label: string }> =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

const NAMING_PREVIEW_FIELD_KEYS = [
  "paths.mediaPath",
  "paths.metadataPath",
  "paths.successOutputFolder",
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
  const services = useSettingsServices();
  return (
    <>
      <PathFieldWrapper name="paths.mediaPath" isDirectory />
      <PathArrayFieldWrapper name="paths.defaultScanExcludeDirs" />
      {services.isServer && (
        <>
          <BoolField name="watch.enabled" />
          <NumberField name="watch.intervalMinutes" min={1} max={1440} />
        </>
      )}
      <MediaOrganizeSection />
      <MetadataExportSection />
      <PathFieldWrapper name="paths.actorPhotoFolder" isDirectory />
      <TextField name="paths.sceneImagesFolder" />
      <PathFieldWrapper name="paths.outputSummaryPath" isDirectory />
      <PathFieldWrapper name="paths.configDirectory" isDirectory />
    </>
  );
}

export function ScrapePacingSection() {
  return (
    <>
      <NumberField name="scrape.threadNumber" min={1} max={128} />
      <NumberField name="scrape.javdbDelaySeconds" min={0} max={120} />
      <NumberField name="scrape.restAfterCount" min={1} max={500} />
      <DurationFieldWrapper name="scrape.restDuration" />
    </>
  );
}
export function FilenameFilteringSection() {
  return (
    <>
      <ChipArrayFieldWrapper name="scrape.filenameIgnoreTokens" />
      <ChipArrayFieldWrapper name="scrape.filenameBlacklistTokens" />
      <NumberField name="scrape.minVideoSizeMb" min={0} max={10240} />
    </>
  );
}

export function NetworkConnectionSection() {
  return (
    <>
      <EnumField name="network.proxyType" options={PROXY_TYPE_OPTIONS} />
      <TextField name="network.proxy" />
      <BoolField name="network.useProxy" />
      <NumberField name="network.timeout" min={1} max={300} />
      <NumberField name="network.retryCount" min={0} max={10} />
    </>
  );
}

export function NetworkSiteAccessSection() {
  return (
    <>
      <UrlField
        name="network.javdbUrl"
        placeholder={OFFICIAL_SITE_URLS[Website.JAVDB]}
        labelAddon={<SiteConnectivityPill site={Website.JAVDB} />}
      />
      <CookieFieldWrapper name="network.javdbCookie" />
      <UrlField
        name="network.javbusUrl"
        placeholder={OFFICIAL_SITE_URLS[Website.JAVBUS]}
        labelAddon={<SiteConnectivityPill site={Website.JAVBUS} />}
      />
      <CookieFieldWrapper name="network.javbusCookie" />
      <CookieFieldWrapper name="network.fantiaCookie" />
    </>
  );
}

export function AssetDownloadsSection() {
  const t = useT();
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
      <BoolField name="download.downloadThumb" />
      <BoolField name="download.downloadPoster" />
      {shouldMountConditionalSettings(Boolean(downloadPoster), search) && <BoolField name="download.tagBadges" />}
      {shouldMountConditionalSettings(showTagBadgeSettings, search) && (
        <>
          <ChipArrayFieldWrapper
            name="download.tagBadgeTypes"
            options={POSTER_TAG_BADGE_TYPE_OPTIONS.map((value) => ({ value, label: t.domain.posterBadgeTypes[value] }))}
            showBulkActions
          />
          <EnumField
            name="download.tagBadgePosition"
            options={POSTER_TAG_BADGE_POSITION_OPTIONS.map((value) => ({
              value,
              label: t.domain.posterBadgePositions[value],
            }))}
          />
          <PosterBadgeImageOverridesField />
        </>
      )}
      <BoolField name="download.downloadFanart" />
      <BoolField name="download.downloadSceneImages" />
      <BoolField name="download.downloadTrailer" />
      {shouldMountConditionalSettings(Boolean(downloadThumb), search) && <BoolField name="download.keepThumb" />}
      {shouldMountConditionalSettings(Boolean(downloadPoster), search) && <BoolField name="download.keepPoster" />}
      {shouldMountConditionalSettings(Boolean(downloadFanart), search) && <BoolField name="download.keepFanart" />}
      {shouldMountConditionalSettings(Boolean(downloadSceneImages), search) && (
        <BoolField name="download.keepSceneImages" />
      )}
      {shouldMountConditionalSettings(Boolean(downloadTrailer), search) && <BoolField name="download.keepTrailer" />}
      <NumberField name="download.sceneImageConcurrency" min={1} max={20} />
    </>
  );
}

function PosterBadgeImageOverridesField() {
  const t = useT();
  const services = useSettingsServices();
  const notifier = useSettingsNotifier();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [watermarkDirectoryPath, setWatermarkDirectoryPath] = useState("");
  const [openingDirectory, setOpeningDirectory] = useState(false);
  const directoryActionLabel = services.watermarkDirectoryActionLabel ?? t.settings.badgeOverrides.openFolder;

  const handleEnable = async () => {
    try {
      const result = await services.ensureWatermarkDirectory();
      setWatermarkDirectoryPath(result.path);
      setDialogOpen(true);
    } catch (error) {
      notifier.error(
        t.settings.badgeOverrides.createDirFailed(error instanceof Error ? error.message : t.common.unknownError),
      );
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
      notifier.error(
        t.settings.badgeOverrides.openDirFailed(error instanceof Error ? error.message : t.common.unknownError),
      );
    } finally {
      setOpeningDirectory(false);
    }
  };

  return (
    <>
      <BaseField name="download.tagBadgeImageOverrides" commitMode="immediate">
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
            <DialogTitle>{t.settings.badgeOverrides.title}</DialogTitle>
            <DialogDescription className="text-sm leading-6">{t.settings.badgeOverrides.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-border/50 bg-surface-low px-3 py-2">
              <div className="text-xs text-muted-foreground">{t.settings.badgeOverrides.directory}</div>
              <div className="mt-1 break-all font-mono text-xs">{watermarkDirectoryPath || "userdata/watermark"}</div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/50">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-low text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t.settings.badgeOverrides.badge}</th>
                    <th className="px-3 py-2 font-medium">{t.settings.badgeOverrides.fileNames}</th>
                  </tr>
                </thead>
                <tbody>
                  {POSTER_TAG_BADGE_TYPE_OPTIONS.map((type) => (
                    <tr key={type} className="border-t border-border/40">
                      <td className="px-3 py-2">{t.domain.posterBadgeTypes[type]}</td>
                      <td className="px-3 py-2 font-mono">{POSTER_TAG_BADGE_IMAGE_FILENAMES[type].join(" / ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 text-xs leading-5 text-muted-foreground">
              <p>{t.settings.badgeOverrides.formats(TAG_BADGE_IMAGE_EXTENSION_LABEL)}</p>
              <p>{t.settings.badgeOverrides.ratio(TAG_BADGE_IMAGE_RATIO_LABEL)}</p>
              <p>{t.settings.badgeOverrides.scaling}</p>
              <p>{t.settings.badgeOverrides.advice}</p>
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
              <Button type="button">{t.settings.gotIt}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NfoSection() {
  const t = useT();
  const search = useOptionalSettingsSearch();
  const form = useFormContext<FieldValues>();
  const generateNfo = Boolean(form.watch("download.generateNfo"));

  return (
    <>
      <BoolField name="download.generateNfo" />
      {shouldMountConditionalSettings(generateNfo, search) && (
        <>
          <EnumField name="download.nfoNaming" options={toEnumOptions(t.settings.options.nfoNaming)} />
          <ChipArrayFieldWrapper
            name="download.nfoIgnoreFields"
            options={NFO_FIELD_OPTIONS.map((value) => ({
              value,
              label: t.settings.nfoFieldOption(value, t.settings.nfoFields[value]),
            }))}
            showBulkActions
          />
          <BoolField name="download.keepNfo" />
        </>
      )}
    </>
  );
}

function NamingPreview() {
  const t = useT();
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
      <div className="mb-2 text-xs font-medium text-muted-foreground">{t.settings.namingPreview.title}</div>
      <div className="space-y-2">
        {previews.length === 0 && (
          <div role={previewError ? "alert" : undefined} className="text-xs text-muted-foreground">
            {loading ? t.settings.namingPreview.generating : previewError || t.settings.namingPreview.waiting}
          </div>
        )}
        {previews.map((p) => (
          <div key={p.sample} className="text-xs">
            <span className="mr-2 inline-block min-w-[4em] text-muted-foreground">
              {t.settings.namingPreviewSamples[p.sample]}
            </span>
            <div className="space-y-1 break-all font-mono">
              <div>{t.settings.namingPreview.source(p.sourcePath)}</div>
              <div>{t.settings.namingPreview.organized(p.mediaPath)}</div>
              {p.metadataDir !== p.folder ? <div>{t.settings.namingPreview.metadataDir(p.metadataDir)}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TitleRepairSection() {
  return (
    <>
      <BoolField name="titleRepair.enabled" />
      <BoolField name="titleRepair.stripTrailingActors" />
    </>
  );
}

type NamingTemplateHelpKind = "folder" | "file";

function NamingTemplateHelp({ kind }: { kind: NamingTemplateHelpKind }) {
  const t = useT();
  const help = t.settings.namingTemplateHelp;
  const label = help[kind];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label={help.viewPlaceholders(label)}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl gap-5 rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-6">
        <DialogHeader className="gap-2 text-left">
          <DialogTitle>{help.placeholdersTitle(label)}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="overflow-hidden rounded-xl border border-border/50">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-low text-muted-foreground">
                <tr>
                  <th className="w-[220px] px-3 py-2 font-medium">{help.placeholder}</th>
                  <th className="px-3 py-2 font-medium">{help.description}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(help.placeholders).map(([placeholder, description]) => (
                  <tr key={placeholder} className="border-t border-border/40">
                    <td className="px-3 py-2 align-top font-mono text-[11px] text-foreground">{placeholder}</td>
                    <td className="px-3 py-2 align-top leading-5 text-muted-foreground">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-border/50 bg-surface-low px-3 py-2.5">
            <div className="font-numeric text-xs font-bold text-foreground">{help.notesTitle(label)}</div>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
              {help.notes[kind].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button type="button">{t.settings.gotIt}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NamingSection() {
  const t = useT();
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
      <TextField name="naming.folderTemplate" labelAddon={<NamingTemplateHelp kind="folder" />} />
      <TextField name="naming.fileTemplate" labelAddon={<NamingTemplateHelp kind="file" />} />
      <EnumField name="naming.assetNamingMode" options={toEnumOptions(t.settings.options.assetNaming)} />
      {sectionMode === "public" && sharedDirectoryMode && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          {t.settings.sharedDirectoryNotice.lead}
          <code>{`{actor}/{number}`}</code>
          {t.settings.sharedDirectoryNotice.tail}
        </div>
      )}
      <TextField name="naming.nfoTitleTemplate" />
      <TitleRepairSection />
      {sectionMode === "public" && <NamingPreview />}
      <NumberField name="naming.actorNameMax" min={1} max={20} />
      <TextField name="naming.actorNameMore" />
      <BoolField name="naming.actorFallbackToStudio" />
      <TextField name="naming.releaseRule" />
      <EnumField name="naming.partStyle" options={toEnumOptions(t.settings.options.partStyle)} />
      <NumberField name="naming.folderNameMax" min={10} max={255} />
      <NumberField name="naming.fileNameMax" min={10} max={255} />
      <TextField name="naming.cnwordStyle" />
      <TextField name="naming.umrStyle" />
      <TextField name="naming.leakStyle" />
      <TextField name="naming.uncensoredStyle" />
      <TextField name="naming.censoredStyle" />
    </>
  );
}

export function TranslateSection() {
  const t = useT();
  const services = useSettingsServices();
  const notifier = useSettingsNotifier();
  const [testing, setTesting] = useState(false);
  const form = useFormContext<FieldValues>();
  const search = useOptionalSettingsSearch();
  const engine = useWatch({ control: form.control, name: "translate.engine" });
  const serviceType = useWatch({ control: form.control, name: "translate.llmServiceType" });
  const baiduService = useWatch({ control: form.control, name: "translate.baiduService" });
  const isLLM = engine === "openai";

  const handleTestTranslation = async () => {
    const input = {
      engine,
      targetLanguage: form.getValues("translate.targetLanguage"),
      deeplApiKey: String(form.getValues("translate.deeplApiKey") ?? ""),
      baiduService: form.getValues("translate.baiduService") ?? "general",
      baiduAppId: String(form.getValues("translate.baiduAppId") ?? ""),
      baiduSecretKey: String(form.getValues("translate.baiduSecretKey") ?? ""),
      baiduApiKey: String(form.getValues("translate.baiduApiKey") ?? ""),
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
      llmMaxRetries: Number(form.getValues("translate.llmMaxRetries") ?? 3),
      llmMaxRequestsPerSecond: Number(form.getValues("translate.llmMaxRequestsPerSecond") ?? 1),
    };

    setTesting(true);
    try {
      const result = await services.testTranslation(input);
      const text = t.settings.translationTest;
      if (result.status === "ok") notifier.success(text.ok(result.sample ?? ""));
      else if (result.status === "failed") notifier.error(`${text.failed}: ${result.error}`);
      else notifier.error(text[result.status]);
    } catch (error) {
      notifier.error(t.settings.testFailed(error instanceof Error ? error.message : t.common.unknownError));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <BaseField name="translate.enableTranslation">
        {(field) => (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleTestTranslation}
              disabled={testing}
            >
              {testing ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> {t.settings.verifying}
                </>
              ) : (
                t.settings.verifyTranslation
              )}
            </Button>
            <FormControl>
              <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
            </FormControl>
          </div>
        )}
      </BaseField>
      <ChipArrayFieldWrapper
        name="translate.fields"
        options={TRANSLATION_FIELD_OPTIONS.map((value) => ({ value, label: t.settings.translateFields[value] }))}
      />
      <EnumField name="translate.engine" options={toEnumOptions(t.settings.options.translateEngine)} />
      {shouldMountConditionalSettings(engine === "deepl", search) && <SecretField name="translate.deeplApiKey" />}
      {shouldMountConditionalSettings(engine === "baidu", search) && (
        <>
          <EnumField name="translate.baiduService" options={toEnumOptions(t.settings.options.baiduService)} />
          <TextField name="translate.baiduAppId" />
          {shouldMountConditionalSettings(baiduService !== "llm", search) && (
            <SecretField name="translate.baiduSecretKey" />
          )}
          {shouldMountConditionalSettings(baiduService === "llm", search) && (
            <SecretField name="translate.baiduApiKey" />
          )}
        </>
      )}
      {shouldMountConditionalSettings(isLLM, search) && (
        <>
          <TextField name="translate.llmModelName" />
          <SecretField name="translate.llmApiKey" />
          <UrlField name="translate.llmBaseUrl" />
          {serviceType === "openai-compatible" && (
            <EnumField name="translate.llmApiFormat" options={toEnumOptions(t.settings.options.llmApiFormat)} />
          )}
          <EnumField name="translate.llmServiceType" options={toEnumOptions(t.settings.options.llmServiceType)} />
          <PromptFieldWrapper name="translate.llmPrompt" />
          <NumberField name="translate.llmTemperature" min={0} max={2} step={0.1} optional />
          <EnumField
            name="translate.llmReasoning"
            description={
              t.settingsFields.llmReasoningDescription[
                serviceType === "google" || serviceType === "deepseek"
                  ? (serviceType as "google" | "deepseek")
                  : "default"
              ]
            }
            options={toEnumOptions(
              serviceType === "deepseek" ? t.settings.options.llmReasoningDeepseek : t.settings.options.llmReasoning,
            )}
          />
          <EnumField
            name="translate.llmOutputFormat"
            options={toEnumOptions(t.settings.options.llmOutputFormat).filter(
              (option) => serviceType !== "deepseek" || option.value !== "json_schema",
            )}
          />
          <NumberField name="translate.llmTimeout" min={1} max={300} />
          <NumberField name="translate.llmMaxRetries" min={1} max={20} />
          <NumberField name="translate.llmMaxRequestsPerSecond" min={1} max={100} />
        </>
      )}
      <EnumField name="translate.targetLanguage" options={LANGUAGE_OPTIONS} />
    </>
  );
}

export function AggregationScrapeSection() {
  return (
    <>
      <NumberField name="aggregation.maxParallelCrawlers" min={1} max={10} />
      <NumberField name="aggregation.perCrawlerTimeoutMs" min={5000} max={120000} step={1000} />
      <NumberField name="aggregation.globalTimeoutMs" min={10000} max={300000} step={1000} />
    </>
  );
}

export function AggregationBehaviorSection() {
  return (
    <>
      <NumberField name="aggregation.behavior.maxSceneImages" min={0} max={100} />
      <NumberField name="aggregation.behavior.maxActors" min={1} max={100} />
      <NumberField name="aggregation.behavior.maxGenres" min={1} max={100} />
    </>
  );
}

export function AggregationPrioritySection({ siteOptions }: { siteOptions: string[] }) {
  return (
    <>
      {AGGREGATION_PRIORITY_KEYS.map((key) => (
        <AggregationPriorityEditorField key={key} name={key} options={siteOptions} />
      ))}
    </>
  );
}

export function ShortcutsSection() {
  return (
    <>
      <ShortcutField name="shortcuts.startOrStopScrape" />
      <ShortcutField name="shortcuts.retryScrape" />
      <ShortcutField name="shortcuts.openFolder" />
      <ShortcutField name="shortcuts.editNfo" />
      <ShortcutField name="shortcuts.playVideo" />
    </>
  );
}

interface UiSectionProps {
  initialUseCustomTitleBar: boolean;
}

export function UiSection({ initialUseCustomTitleBar }: UiSectionProps) {
  const t = useT();
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
      notifier.info(t.settings.waitForAutosave);
      return;
    }

    setRelaunching(true);
    try {
      await services.relaunchApp();
    } catch (error) {
      setRelaunching(false);
      notifier.error(t.settings.relaunchFailed(error instanceof Error ? error.message : t.common.unknownError));
    }
  };

  return (
    <>
      <BoolField name="ui.showLogsPanel" />
      <BaseField name="ui.useCustomTitleBar">
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
              {t.settings.relaunchApp}
            </Button>
            <FormControl>
              <Switch checked={Boolean(field.value ?? true)} onCheckedChange={field.onChange} />
            </FormControl>
          </div>
        )}
      </BaseField>
      <BoolField name="ui.hideDock" />
      <BoolField name="ui.hideMenu" />
      <BoolField name="ui.hideWindowButtons" />
    </>
  );
}

export function MediaOrganizeSection() {
  const t = useT();
  const form = useFormContext<FieldValues>();
  const metadataOnly = Boolean(form.watch("behavior.metadataOnly"));
  const move = Boolean(form.watch("behavior.successFileMove"));

  return (
    <>
      {metadataOnly && (
        <div className="mb-3 rounded-md border border-border/70 bg-muted/50 p-3 text-xs text-muted-foreground">
          {t.settings.metadataOnlyNotice}
        </div>
      )}
      <BoolField name="behavior.successFileMove" disabled={metadataOnly} />
      <PathFieldWrapper name="paths.successOutputFolder" isDirectory disabled={!move || metadataOnly} />
      <BoolField name="behavior.successFileRename" disabled={metadataOnly} />
    </>
  );
}

export function MetadataExportSection() {
  const t = useT();
  const form = useFormContext<FieldValues>();
  const search = useOptionalSettingsSearch();
  const metadataOnly = Boolean(form.watch("behavior.metadataOnly"));
  const shouldMountChildren = shouldMountConditionalSettings(metadataOnly, search);

  return (
    <>
      <BoolField name="behavior.metadataOnly" />
      {shouldMountChildren && (
        <div className="space-y-4 pt-1 pl-4 border-l-2 border-border/50 animate-in fade-in duration-200">
          <PathFieldWrapper
            name="paths.metadataPath"
            isDirectory
            rules={{
              validate: (value) => {
                if (metadataOnly && !String(value ?? "").trim()) {
                  return t.settings.metadataPathRequired;
                }
                return true;
              },
            }}
          />
        </div>
      )}
    </>
  );
}
