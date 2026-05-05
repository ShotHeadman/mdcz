import { Website } from "@mdcz/shared/enums";
import { OrderedSiteFieldEditor, parseBufferedNumberValue, ServerPathField } from "@mdcz/views/config-form";
import { dedupePathAutocompleteSuggestions } from "@mdcz/views/path";
import {
  AdvancedSettingsFooterContent,
  AssetDownloadsSection,
  buildAutoSaveFlatPayload,
  buildNamingPreviewConfig,
  buildSettingsBrowseState,
  buildSitePrioritySummary,
  FIELD_REGISTRY,
  FileBehaviorTopLevelSection,
  flattenConfig,
  getSettingsSuggestions,
  mergeConfigWithFlatPayload,
  moveSitePriorityOption,
  NamingSection,
  NetworkTopLevelSection,
  ProfileCapsule,
  resolveSettingsDeepLink,
  resolveSitePriorityOptions,
  runLatestRevisionTask,
  SectionAnchor,
  SettingsEditorAutosaveProvider,
  SettingsSectionModeProvider,
  type SettingsServices,
  SettingsServicesProvider,
  shouldRenderFieldInSectionMode,
  TranslateTopLevelSection,
  toggleSitePriorityOption,
  unflattenConfig,
} from "@mdcz/views/settings";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type FieldValues, FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

const noop = vi.fn();
const testSettingsServices = {
  browsePath: vi.fn(async () => ({})),
  checkCookies: vi.fn(async () => ({ results: [] })),
  decrementInFlightSaves: vi.fn(),
  ensureWatermarkDirectory: vi.fn(async () => ({ path: "" })),
  getInFlightSaves: vi.fn(() => 0),
  incrementInFlightSaves: vi.fn(),
  listCrawlerSites: vi.fn(async () => ({ sites: [] })),
  openWatermarkDirectory: vi.fn(async () => undefined),
  previewNaming: vi.fn(async () => ({ items: [] })),
  probeSiteConnectivity: vi.fn(async () => ({ ok: true, message: "" })),
  relaunchApp: vi.fn(async () => undefined),
  resetConfig: vi.fn(async () => undefined),
  saveConfig: vi.fn(async () => undefined),
  testLlm: vi.fn(async () => ({ success: true, message: "" })),
} satisfies SettingsServices;
const createTestSettingsServices = (overrides: Partial<SettingsServices> = {}): SettingsServices => ({
  ...testSettingsServices,
  ...overrides,
});
const testSettingsNotifier = {
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
};

function entry(key: string) {
  return FIELD_REGISTRY.find((candidate) => candidate.key === key);
}

function FormHarness({
  children,
  services = testSettingsServices,
  values = {},
}: {
  children?: ReactNode;
  services?: SettingsServices;
  values?: Record<string, unknown>;
}) {
  const form = useForm<FieldValues>({ defaultValues: values });
  const flatValues = flattenConfig(values);

  return createElement(
    SettingsServicesProvider,
    { notifier: testSettingsNotifier, services },
    createElement(
      FormProvider,
      form as ComponentProps<typeof FormProvider>,
      createElement(
        SettingsEditorAutosaveProvider,
        {
          savedValues: flatValues,
          defaultValues: flatValues,
          defaultValuesReady: true,
        },
        children,
      ),
    ),
  );
}

function SectionHarness({ section }: { section: "network" | "translate" | "fileBehavior" }) {
  const values = {
    network: {
      proxyType: "none",
      proxy: "",
      useProxy: false,
      timeout: 30,
      retryCount: 3,
      javdbCookie: "",
      javbusCookie: "",
    },
    translate: {
      enableTranslation: false,
      engine: "google",
      targetLanguage: "zh-CN",
    },
    behavior: {
      successFileMove: false,
      failedFileMove: false,
      successFileRename: false,
      deleteEmptyFolder: false,
      scrapeSoftlinkPath: false,
      saveLog: false,
    },
  };
  const sectionElement =
    section === "network"
      ? createElement(NetworkTopLevelSection, { forceOpen: true })
      : section === "translate"
        ? createElement(TranslateTopLevelSection, { forceOpen: true })
        : createElement(FileBehaviorTopLevelSection, { forceOpen: true });

  return createElement(FormHarness, { values }, sectionElement);
}

describe("settings editor metadata and filtering", () => {
  it("keeps the settings search surface explicit and hides unrelated config keys", () => {
    expect(entry("translate.engine")?.anchor).toBe("translate");
    expect(entry("translate.llmApiKey")?.anchor).toBe("translate");
    expect(entry("download.sceneImageConcurrency")?.visibility).toBe("advanced");
    expect(entry("download.tagBadgeTypes")).toMatchObject({ anchor: "download", visibility: "public" });
    expect(entry("download.tagBadgePosition")).toMatchObject({ anchor: "download", visibility: "public" });
    expect(entry("download.tagBadgeImageOverrides")).toMatchObject({ anchor: "download", visibility: "public" });
    expect(entry("aggregation.fieldPriorities.durationSeconds")?.visibility).toBe("advanced");
    expect(entry("naming.partStyle")?.visibility).toBe("public");
    expect(entry("scrape.r18MetadataLanguage")).toMatchObject({ anchor: "scrape", visibility: "hidden" });
    expect(entry("jellyfin.url")).toMatchObject({ surface: "tools" });

    const keys = new Set(FIELD_REGISTRY.map((candidate) => candidate.key));
    expect(keys.has("behavior.updateCheck")).toBe(false);
    expect(keys.has("ui.theme")).toBe(false);
    expect(keys.has("ui.language")).toBe(false);
  });

  it("round-trips registered settings, including scrape order and aggregation paths", () => {
    const flat = flattenConfig({
      translate: { engine: "openai", llmApiKey: "secret" },
      download: {
        tagBadgeTypes: ["subtitle", "leak"],
        tagBadgePosition: "bottomRight",
        tagBadgeImageOverrides: true,
      },
      scrape: {
        sites: ["javdb"],
        r18MetadataLanguage: "en",
      },
      aggregation: {
        fieldPriorities: {
          durationSeconds: ["dmm_tv", "avbase"],
        },
      },
    });

    expect(flat).toMatchObject({
      "translate.engine": "openai",
      "translate.llmApiKey": "secret",
      "download.tagBadgeTypes": ["subtitle", "leak"],
      "download.tagBadgePosition": "bottomRight",
      "download.tagBadgeImageOverrides": true,
      "scrape.sites": ["javdb"],
      "scrape.r18MetadataLanguage": "en",
      "aggregation.fieldPriorities.durationSeconds": ["dmm_tv", "avbase"],
    });
    expect(unflattenConfig(flat)).toMatchObject({
      translate: { engine: "openai", llmApiKey: "secret" },
      download: {
        tagBadgeTypes: ["subtitle", "leak"],
        tagBadgePosition: "bottomRight",
        tagBadgeImageOverrides: true,
      },
      scrape: { sites: ["javdb"], r18MetadataLanguage: "en" },
      aggregation: { fieldPriorities: { durationSeconds: ["dmm_tv", "avbase"] } },
    });
  });

  it("applies PRD visibility rules for normal, advanced, modified, group, and deep-link browsing", () => {
    const normal = buildSettingsBrowseState({ query: "", showAdvanced: false, modifiedKeys: new Set<string>() });
    expect(normal.visibleKeySet.has("paths.mediaPath")).toBe(true);
    expect(normal.visibleKeySet.has("download.sceneImageConcurrency")).toBe(false);
    expect(normal.visibleKeySet.has("jellyfin.url")).toBe(false);

    const advanced = buildSettingsBrowseState({ query: "", showAdvanced: true, modifiedKeys: new Set<string>() });
    expect(advanced.visibleKeySet.has("download.sceneImageConcurrency")).toBe(true);
    expect(advanced.visibleAdvancedAnchorSet.has("download")).toBe(true);

    const modified = buildSettingsBrowseState({
      query: "@modified",
      showAdvanced: false,
      modifiedKeys: new Set(["download.sceneImageConcurrency", "paths.mediaPath"]),
    });
    expect(modified.visibleEntries.map((candidate) => candidate.key)).toEqual(["paths.mediaPath"]);

    const grouped = buildSettingsBrowseState({
      query: "@group:系统 日志面板",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    expect(grouped.hasActiveFilters).toBe(true);
    expect(grouped.visibleEntries.map((candidate) => candidate.key)).toEqual(["ui.showLogsPanel"]);

    expect(resolveSettingsDeepLink(" paths.mediaPath ")).toEqual({
      fieldKey: "paths.mediaPath",
      sectionId: "paths",
    });
    expect(resolveSettingsDeepLink("aggregation.maxParallelCrawlers")).toEqual({
      fieldKey: null,
      sectionId: null,
    });
  });

  it("reveals normal conditional rows in search while preserving the advanced visibility gate", () => {
    const hiddenDownloadChildSearch = buildSettingsBrowseState({
      query: "保留已有横版缩略图",
      showAdvanced: false,
      modifiedKeys: new Set(["download.keepThumb"]),
    });
    expect(hiddenDownloadChildSearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["download.keepThumb"]);

    const hiddenLlmField = buildSettingsBrowseState({
      query: "LLM 模型名称",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    expect(hiddenLlmField.visibleEntries.map((candidate) => candidate.key)).toEqual(["translate.llmModelName"]);

    const hiddenAdvancedField = buildSettingsBrowseState({
      query: "剧照下载并发",
      showAdvanced: false,
      modifiedKeys: new Set(["download.sceneImageConcurrency"]),
    });
    expect(hiddenAdvancedField.visibleEntries).toEqual([]);

    const visibleAdvancedField = buildSettingsBrowseState({
      query: "剧照下载并发",
      showAdvanced: true,
      modifiedKeys: new Set(["download.sceneImageConcurrency"]),
    });
    expect(visibleAdvancedField.visibleEntries.map((candidate) => candidate.key)).toEqual([
      "download.sceneImageConcurrency",
    ]);
  });

  it("matches poster badge settings through their registered search aliases", () => {
    const badgeTypeAliasSearch = buildSettingsBrowseState({
      query: "subtitle",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const badgeResolutionAliasSearch = buildSettingsBrowseState({
      query: "4k",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const badgePositionAliasSearch = buildSettingsBrowseState({
      query: "top right",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const badgeImageAliasSearch = buildSettingsBrowseState({
      query: "watermark",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });

    expect(badgeTypeAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain("download.tagBadgeTypes");
    expect(badgeResolutionAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain(
      "download.tagBadgeTypes",
    );
    expect(badgePositionAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain(
      "download.tagBadgePosition",
    );
    expect(badgeImageAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain(
      "download.tagBadgeImageOverrides",
    );
  });

  it("does not expose per-site URL rows through settings search", () => {
    const siteUrlSearch = buildSettingsBrowseState({
      query: "javdb 站点地址",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const siteEditorSearch = buildSettingsBrowseState({
      query: "启用站点与优先级",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });

    expect(siteUrlSearch.visibleEntries).toEqual([]);
    expect(siteEditorSearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["scrape.sites"]);
  });

  it("matches grouped site-priority aliases without exposing per-site URL rows", () => {
    const dmmFamilySearch = buildSettingsBrowseState({
      query: "fanza",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const officialSearch = buildSettingsBrowseState({
      query: "厂商官网",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });

    expect(dmmFamilySearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["scrape.sites"]);
    expect(officialSearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["scrape.sites"]);
  });

  it("matches independent site-priority aliases for FC2 and wiki/aggregation sources", () => {
    const fc2HubSearch = buildSettingsBrowseState({
      query: "fc2hub",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const wikiSearch = buildSettingsBrowseState({
      query: "avwikidb",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });

    expect(fc2HubSearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["scrape.sites"]);
    expect(wikiSearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["scrape.sites"]);
  });

  it("matches the R18.dev site row through the grouped site-priority field only", () => {
    const r18Search = buildSettingsBrowseState({
      query: "r18.dev",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const hiddenPreferenceSearch = buildSettingsBrowseState({
      query: "R18.dev 元数据语言",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });

    expect(r18Search.visibleEntries.map((candidate) => candidate.key)).toEqual(["scrape.sites"]);
    expect(hiddenPreferenceSearch.visibleEntries.map((candidate) => candidate.key)).toEqual([]);
  });

  it("offers only the supported query tokens and section-mode row split", () => {
    const labels = getSettingsSuggestions("@").map((suggestion) => suggestion.label);

    expect(labels).toEqual(expect.arrayContaining(["@modified", "@group:"]));
    expect(getSettingsSuggestions("@foo")).toEqual([]);
    expect(shouldRenderFieldInSectionMode("download.sceneImageConcurrency", "public")).toBe(false);
    expect(shouldRenderFieldInSectionMode("download.sceneImageConcurrency", "advanced")).toBe(true);
    expect(shouldRenderFieldInSectionMode("paths.mediaPath", "advanced")).toBe(false);
  });
});

describe("settings editor save and content helpers", () => {
  it("builds autosave payloads for related server-error fields and merges cache updates", () => {
    const payload = buildAutoSaveFlatPayload(
      "translate.llmApiKey",
      "secret",
      {
        translate: {
          engine: { type: "server", message: "缺少 API Key" },
          llmApiKey: { type: "server", message: "缺少 API Key" },
        },
      },
      (fieldPath) => (fieldPath === "translate.engine" ? "openai" : undefined),
    );

    expect(payload).toEqual({
      "translate.engine": "openai",
      "translate.llmApiKey": "secret",
    });
    expect(
      mergeConfigWithFlatPayload(
        { translate: { engine: "google", llmApiKey: "" } },
        { "translate.engine": "openai", "translate.llmApiKey": "secret" },
      ),
    ).toEqual({
      translate: { engine: "openai", llmApiKey: "secret" },
    });
  });

  it("finalizes stale autosave revisions without running superseded work", async () => {
    const revisions = new Map([["paths.mediaPath", 2]]);
    const run = vi.fn(async () => {});
    const finalize = vi.fn();

    await runLatestRevisionTask({
      revisions,
      path: "paths.mediaPath",
      revision: 1,
      run,
      finalize,
    });

    expect(run).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);

    await runLatestRevisionTask({
      revisions,
      path: "paths.mediaPath",
      revision: 2,
      run,
      finalize,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it("keeps buffered numeric and compact editor helper behavior stable", () => {
    expect(parseBufferedNumberValue("45", 30)).toBe(45);
    expect(parseBufferedNumberValue("", 30)).toBe(30);
    expect(parseBufferedNumberValue("abc", 30)).toBe(30);
    expect(
      buildNamingPreviewConfig({
        "naming.folderTemplate": "{actorFallbackPrefix}{actor}/{number}",
        "naming.fileTemplate": "{number}{originaltitle}",
        "behavior.successFileMove": true,
      }),
    ).toMatchObject({
      naming: {
        folderTemplate: "{actorFallbackPrefix}{actor}/{number}",
        fileTemplate: "{number}{originaltitle}",
      },
      behavior: { successFileMove: true },
    });
    expect(
      buildSitePrioritySummary(["dmm", "dmm_tv", "mgstage", "dmm"], ["dmm", "dmm_tv", "mgstage", "faleno"]),
    ).toMatchObject({
      enabledCount: 2,
      totalCount: 2,
      preview: ["DMM/FANZA 系", "厂商官网"],
      remainingCount: 0,
    });
  });

  it("maps grouped site-priority rows back to concrete site values deterministically", () => {
    const availableSites = ["dmm", "dmm_tv", "mgstage", "prestige", "javdb"];
    const enabledOptions = resolveSitePriorityOptions(["mgstage", "javdb", "dmm"], availableSites).filter(
      (option) => option.state !== "none",
    );

    expect(
      enabledOptions.map((option) => ({
        id: option.id,
        state: option.state,
        enabledSites: option.enabledSites,
      })),
    ).toEqual([
      {
        id: "official",
        state: "partial",
        enabledSites: ["mgstage"],
      },
      {
        id: "javdb",
        state: "all",
        enabledSites: ["javdb"],
      },
      {
        id: "dmm_family",
        state: "partial",
        enabledSites: ["dmm"],
      },
    ]);
    expect(enabledOptions[0]).toMatchObject({
      id: "official",
      memberLabel: "mgstage / prestige",
      statusLabel: "已启用 1/2",
    });
    expect(enabledOptions[1]).toMatchObject({
      id: "javdb",
      memberLabel: null,
      statusLabel: null,
    });
    expect(enabledOptions[2]).toMatchObject({
      id: "dmm_family",
      memberLabel: "dmm / dmm_tv",
      statusLabel: "已启用 1/2",
    });

    expect(toggleSitePriorityOption(["dmm"], availableSites, "dmm_family", true)).toEqual(["dmm", "dmm_tv"]);
    expect(moveSitePriorityOption(["mgstage", "javdb", "dmm"], availableSites, "dmm_family", -1)).toEqual([
      "mgstage",
      "dmm",
      "javdb",
    ]);
  });

  it("keeps FC2 and wiki/aggregation sources independent from the official site group", () => {
    const availableSites = [
      Website.DMM,
      Website.DMM_TV,
      Website.MGSTAGE,
      Website.PRESTIGE,
      Website.FALENO,
      Website.DAHLIA,
      Website.KM_PRODUCE,
      Website.FC2,
      Website.FC2HUB,
      Website.PPVDATABANK,
      Website.SOKMIL,
      Website.KINGDOM,
      Website.AVBASE,
      Website.R18_DEV,
      Website.AVWIKIDB,
      Website.JAVDB,
      Website.JAVBUS,
      Website.JAV321,
    ];
    const optionsById = new Map(resolveSitePriorityOptions([], availableSites).map((option) => [option.id, option]));

    expect(optionsById.get("official")).toMatchObject({
      label: "厂商官网",
      sites: ["mgstage", "prestige", "faleno", "dahlia", "km_produce"],
    });
    expect(optionsById.get("official")?.sites).not.toEqual(expect.arrayContaining(["fc2", "fc2hub", "ppvdatabank"]));
    expect(optionsById.get(Website.FC2)).toMatchObject({ sites: [Website.FC2] });
    expect(optionsById.get(Website.FC2HUB)).toMatchObject({ sites: [Website.FC2HUB] });
    expect(optionsById.get(Website.PPVDATABANK)).toMatchObject({ sites: [Website.PPVDATABANK] });
    expect(optionsById.get(Website.SOKMIL)).toMatchObject({ sites: [Website.SOKMIL] });
    expect(optionsById.get(Website.KINGDOM)).toMatchObject({ sites: [Website.KINGDOM] });
    expect(optionsById.get(Website.AVBASE)).toMatchObject({ sites: [Website.AVBASE] });
    expect(optionsById.get(Website.R18_DEV)).toMatchObject({ label: "R18.dev", sites: [Website.R18_DEV] });
    expect(optionsById.get(Website.AVWIKIDB)).toMatchObject({ sites: [Website.AVWIKIDB] });
    expect(optionsById.get(Website.JAVDB)).toMatchObject({ sites: [Website.JAVDB] });
    expect(optionsById.get(Website.JAVBUS)).toMatchObject({ sites: [Website.JAVBUS] });
    expect(optionsById.get(Website.JAV321)).toMatchObject({ sites: [Website.JAV321] });

    for (const option of optionsById.values()) {
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

describe("settings editor render contracts", () => {
  it("deduplicates path autocomplete suggestions by normalized host path", () => {
    expect(
      dedupePathAutocompleteSuggestions([
        { label: "Drive G", path: "G:/" },
        { label: "Drive G duplicate", path: "G:\\" },
        { label: "Movies", path: "G:/Movies/" },
        { label: "Movies duplicate", path: "g:/Movies" },
      ]),
    ).toEqual([
      { label: "Drive G", path: "G:/" },
      { label: "Movies", path: "G:/Movies/" },
    ]);
  });

  it("keeps OrderedSiteFieldEditor simple mode stable while rendering grouped row details", () => {
    const simpleHtml = renderToStaticMarkup(
      createElement(
        FormHarness,
        null,
        createElement(OrderedSiteFieldEditor, {
          value: ["javdb", "dmm"],
          options: ["dmm", "javdb", "avbase"],
          onChange: noop,
        }),
      ),
    );

    expect(simpleHtml).toContain("已启用 2/3");
    expect(simpleHtml).toContain(">avbase<");
    expect(simpleHtml.indexOf(">javdb<")).toBeLessThan(simpleHtml.indexOf(">dmm<"));

    const groupedHtml = renderToStaticMarkup(
      createElement(
        FormHarness,
        null,
        createElement(OrderedSiteFieldEditor, {
          value: ["dmm"],
          options: ["dmm", "dmm_tv", "javdb"],
          onChange: noop,
          rows: [
            {
              id: "dmm_family",
              label: "DMM/FANZA 系",
              description: "官方售卖与配信源",
              checkboxState: "indeterminate" as const,
              trailingControl: createElement("span", null, "日文"),
              chips: [
                { label: "dmm / dmm_tv", monospace: true, variant: "outline" as const },
                { label: "已启用 1/2", variant: "soft" as const },
              ],
            },
          ],
          selectedCount: 1,
          totalCount: 1,
          onToggleRow: noop,
          onMoveRow: noop,
          onSelectAll: noop,
          onClearAll: noop,
        }),
      ),
    );

    expect(groupedHtml).toContain("DMM/FANZA 系");
    expect(groupedHtml).toContain("官方售卖与配信源");
    expect(groupedHtml).toContain("日文");
    expect(groupedHtml).toContain("dmm / dmm_tv");
    expect(groupedHtml).toContain("已启用 1/2");
    expect(groupedHtml).toMatch(/data-state="indeterminate"|aria-checked="mixed"/);
  });

  it("renders loading profile identity without the old default-profile fallback", () => {
    const html = renderToStaticMarkup(
      createElement(ProfileCapsule, {
        profiles: [],
        activeProfile: null,
        isLoading: true,
        onSwitchProfile: noop,
        onCreateProfile: noop,
        onDeleteProfile: noop,
        onResetConfig: noop,
        onExportProfile: noop,
        onImportProfile: noop,
      }),
    );

    expect(html).toContain("aria-busy");
    expect(html).not.toContain("默认配置");
  });

  it("defers heavy section bodies unless a section is force-opened", () => {
    const deferredProps = {
      id: "custom",
      label: "Custom",
      title: "Custom",
      deferContent: true,
      estimatedContentHeight: 320,
    } satisfies Omit<ComponentProps<typeof SectionAnchor>, "children">;
    const forceOpenProps = {
      id: "custom-force",
      label: "Custom Force",
      title: "Custom Force",
      deferContent: true,
      forceOpen: true,
      estimatedContentHeight: 320,
    } satisfies Omit<ComponentProps<typeof SectionAnchor>, "children">;
    const deferredHtml = renderToStaticMarkup(
      createElement(
        SectionAnchor,
        deferredProps as ComponentProps<typeof SectionAnchor>,
        createElement("div", null, "Deferred content"),
      ),
    );
    const forceOpenHtml = renderToStaticMarkup(
      createElement(
        SectionAnchor,
        forceOpenProps as ComponentProps<typeof SectionAnchor>,
        createElement("div", null, "Force-open content"),
      ),
    );

    expect(deferredHtml).toContain('data-deferred-placeholder="true"');
    expect(deferredHtml).not.toContain("Deferred content");
    expect(forceOpenHtml).toContain("Force-open content");
    expect(forceOpenHtml).not.toContain('data-deferred-placeholder="true"');
  });

  it("hides the advanced settings footer while search filters are active", () => {
    const filteredHtml = renderToStaticMarkup(
      createElement(AdvancedSettingsFooterContent, {
        hasActiveFilters: true,
        isAdvancedVisible: false,
        onToggleShowAdvanced: noop,
      }),
    );
    const browseHtml = renderToStaticMarkup(
      createElement(AdvancedSettingsFooterContent, {
        hasActiveFilters: false,
        isAdvancedVisible: false,
        onToggleShowAdvanced: noop,
      }),
    );

    expect(filteredHtml).not.toContain("显示高级设置");
    expect(browseHtml).toContain("显示高级设置");
  });

  it("hides unsupported path browse buttons while keeping server path suggestions", () => {
    const services = createTestSettingsServices({
      getPathSuggestions: () => [
        { label: "Movies", path: "E:/Movies" },
        { label: "Output", path: "E:/Output" },
      ],
      supportsPathBrowse: false,
    });
    const html = renderToStaticMarkup(
      createElement(
        FormHarness,
        { services, values: { paths: { mediaPath: "" } } },
        createElement(ServerPathField, {
          field: {
            name: "paths.mediaPath",
            onBlur: noop,
            onChange: noop,
            ref: noop,
            value: "",
          },
        }),
      ),
    );

    expect(html).not.toContain("<button");
    expect(html).not.toContain("<datalist");
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain("运行 MDCz 服务的主机路径");
  });

  it("renders the PRD split sections and keeps advanced-only content out of public rows", () => {
    const networkHtml = renderToStaticMarkup(createElement(SectionHarness, { section: "network" }));
    const translateHtml = renderToStaticMarkup(createElement(SectionHarness, { section: "translate" }));
    const behaviorHtml = renderToStaticMarkup(createElement(SectionHarness, { section: "fileBehavior" }));
    const namingHtml = renderToStaticMarkup(
      createElement(
        FormHarness,
        { values: { naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number}" } } },
        createElement(NamingSection),
      ),
    );
    const advancedDownloadHtml = renderToStaticMarkup(
      createElement(
        FormHarness,
        { values: { download: { downloadPoster: true, sceneImageConcurrency: 4 } } },
        createElement(SettingsSectionModeProvider, { mode: "advanced" }, createElement(AssetDownloadsSection)),
      ),
    );

    expect(networkHtml).toContain("网络连接");
    expect(networkHtml).toContain("代理类型");
    expect(networkHtml).toContain("JavDB Cookie");
    expect(translateHtml).toContain("翻译服务");
    expect(translateHtml).toContain("翻译引擎");
    expect(behaviorHtml).toContain("文件行为");
    expect(behaviorHtml).toContain("成功后移动文件");
    expect(namingHtml).toContain('aria-label="查看文件夹模板占位符"');
    expect(namingHtml).toContain('aria-label="查看文件名模板占位符"');
    expect(namingHtml).not.toContain("可用占位符：{actor}");
    expect(advancedDownloadHtml).toContain("剧照下载并发");
    expect(advancedDownloadHtml).not.toContain("下载海报");
  });

  it("shows poster badge controls only when poster downloads stay enabled and badge processing is on", () => {
    const posterDisabledHtml = renderToStaticMarkup(
      createElement(
        FormHarness,
        { values: { download: { downloadPoster: false, tagBadges: true } } },
        createElement(AssetDownloadsSection),
      ),
    );
    const hiddenHtml = renderToStaticMarkup(
      createElement(
        FormHarness,
        { values: { download: { downloadPoster: true, tagBadges: false } } },
        createElement(AssetDownloadsSection),
      ),
    );
    const visibleHtml = renderToStaticMarkup(
      createElement(
        FormHarness,
        {
          values: {
            download: {
              downloadPoster: true,
              tagBadges: true,
              tagBadgeTypes: ["subtitle", "leak"],
              tagBadgePosition: "topRight",
            },
          },
        },
        createElement(AssetDownloadsSection),
      ),
    );

    expect(posterDisabledHtml).not.toContain("为封面添加标签角标");
    expect(posterDisabledHtml).not.toContain("角标类型");
    expect(posterDisabledHtml).not.toContain("角标位置");
    expect(posterDisabledHtml).not.toContain("覆盖角标图片");
    expect(hiddenHtml).toContain("为封面添加标签角标");
    expect(hiddenHtml).not.toContain("角标类型");
    expect(hiddenHtml).not.toContain("角标位置");
    expect(hiddenHtml).not.toContain("覆盖角标图片");
    expect(visibleHtml).toContain("角标类型");
    expect(visibleHtml).toContain("角标位置");
    expect(visibleHtml).toContain("覆盖角标图片");
    expect(visibleHtml).toContain("中字");
    expect(visibleHtml).toContain("流出");
  });
});
