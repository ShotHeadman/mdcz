import { OrderedSiteFieldEditor, ServerPathField } from "@mdcz/views/config-form";
import {
  AdvancedSettingsFooterContent,
  AssetDownloadsSection,
  FileBehaviorTopLevelSection,
  flattenConfig,
  NamingSection,
  NetworkTopLevelSection,
  PathsSection,
  ProfileCapsule,
  SectionAnchor,
  SettingsEditorAutosaveProvider,
  SettingsSectionModeProvider,
  type SettingsServices,
  SettingsServicesProvider,
  TranslateTopLevelSection,
} from "@mdcz/views/settings";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import { type FieldValues, FormProvider, useForm } from "react-hook-form";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const noop = vi.fn();

const baseSettingsServices = {
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
  testLLM: vi.fn(async () => ({ success: true, message: "" })),
} satisfies SettingsServices;

const createSettingsServices = (overrides: Partial<SettingsServices> = {}): SettingsServices => ({
  ...baseSettingsServices,
  ...overrides,
});

const settingsNotifier = {
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
};

function FormHarness({
  children,
  services = baseSettingsServices,
  values = {},
}: {
  children?: ReactNode;
  services?: SettingsServices;
  values?: Record<string, unknown>;
}) {
  const form = useForm<FieldValues>({ defaultValues: values });
  const flatValues = useMemo(() => flattenConfig(values), [values]);

  return (
    <SettingsServicesProvider notifier={settingsNotifier} services={services}>
      <FormProvider {...(form as ComponentProps<typeof FormProvider>)}>
        <SettingsEditorAutosaveProvider savedValues={flatValues} defaultValues={flatValues} defaultValuesReady>
          {children}
        </SettingsEditorAutosaveProvider>
      </FormProvider>
    </SettingsServicesProvider>
  );
}

test("ordered site field exposes grouped priority semantics", async () => {
  const screen = await render(
    <FormHarness>
      <OrderedSiteFieldEditor
        value={["dmm"]}
        options={["dmm", "dmm_tv", "javdb"]}
        onChange={noop}
        rows={[
          {
            id: "dmm_family",
            label: "DMM/FANZA 系",
            description: "官方售卖与配信源",
            checkboxState: "indeterminate",
            trailingControl: <span>日文</span>,
            chips: [
              { label: "dmm / dmm_tv", monospace: true, variant: "outline" },
              { label: "已启用 1/2", variant: "soft" },
            ],
          },
        ]}
        selectedCount={1}
        totalCount={1}
        onToggleRow={noop}
        onMoveRow={noop}
        onSelectAll={noop}
        onClearAll={noop}
      />
    </FormHarness>,
  );

  await expect.element(screen.getByText("DMM/FANZA 系")).toBeVisible();
  await expect.element(screen.getByText("官方售卖与配信源")).toBeVisible();
  await expect.element(screen.getByText("日文")).toBeVisible();
  await expect.element(screen.getByText("dmm / dmm_tv")).toBeVisible();
  await expect.element(screen.getByText("已启用 1/2")).toBeVisible();
  await expect.element(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
});

test("ordered site field keeps simple mode enable order stable", async () => {
  const screen = await render(
    <FormHarness>
      <OrderedSiteFieldEditor value={["javdb", "dmm"]} options={["dmm", "javdb", "avbase"]} onChange={noop} />
    </FormHarness>,
  );

  await expect.element(screen.getByText("已启用 2/3")).toBeVisible();
  await expect.element(screen.getByText("avbase", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("javdb", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("dmm", { exact: true })).toBeVisible();
});

test("profile capsule marks loading busy state without default profile fallback", async () => {
  const screen = await render(
    <ProfileCapsule
      profiles={[]}
      activeProfile={null}
      isLoading
      onSwitchProfile={noop}
      onCreateProfile={noop}
      onDeleteProfile={noop}
      onResetConfig={noop}
      onExportProfile={noop}
      onImportProfile={noop}
    />,
  );

  expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.container.textContent ?? "").not.toContain("默认配置");
});

test("section anchors defer content until force-opened", async () => {
  const deferred = await render(
    <SectionAnchor id="custom" label="Custom" title="Custom" deferContent estimatedContentHeight={320}>
      <div>Deferred content</div>
    </SectionAnchor>,
  );
  await expect.element(deferred.getByText("Deferred content")).not.toBeInTheDocument();
  expect(deferred.container.querySelector('[data-deferred-placeholder="true"]')).not.toBeNull();

  const forced = await render(
    <SectionAnchor
      id="custom-force"
      label="Custom Force"
      title="Custom Force"
      deferContent
      forceOpen
      estimatedContentHeight={320}
    >
      <div>Force-open content</div>
    </SectionAnchor>,
  );
  await expect.element(forced.getByText("Force-open content")).toBeVisible();
  expect(forced.container.querySelector('[data-deferred-placeholder="true"]')).toBeNull();
});

test("advanced settings footer hides while search filters are active", async () => {
  const filtered = await render(
    <AdvancedSettingsFooterContent hasActiveFilters isAdvancedVisible={false} onToggleShowAdvanced={noop} />,
  );
  await expect.element(filtered.getByRole("button", { name: "显示高级设置" })).not.toBeInTheDocument();

  const browse = await render(
    <AdvancedSettingsFooterContent hasActiveFilters={false} isAdvancedVisible={false} onToggleShowAdvanced={noop} />,
  );
  await expect.element(browse.getByRole("button", { name: "显示高级设置" })).toBeVisible();
});

test("server path fields keep autocomplete suggestions without browse buttons", async () => {
  const services = createSettingsServices({
    getPathSuggestions: () => [
      { label: "Movies", path: "E:/Movies" },
      { label: "Output", path: "E:/Output" },
    ],
    isServer: true,
  });

  const screen = await render(
    <FormHarness services={services} values={{ paths: { mediaPath: "" } }}>
      <ServerPathField
        field={{
          name: "paths.mediaPath",
          onBlur: noop,
          onChange: noop,
          ref: noop,
          value: "",
        }}
      />
    </FormHarness>,
  );

  expect(screen.container.querySelector('input[aria-autocomplete="list"]')).not.toBeNull();
  expect(screen.container.querySelector("button")).toBeNull();
  expect(screen.container.querySelector("datalist")).toBeNull();
});

test("paths section surfaces scan exclusion directories with autocomplete inputs", async () => {
  const screen = await render(
    <FormHarness
      values={{
        paths: {
          failedOutputFolder: "failed",
          defaultScanExcludeDirs: ["E:/Output", "failed_22"],
        },
      }}
    >
      <PathsSection />
    </FormHarness>,
  );

  await expect.element(screen.getByText("排除目录")).toBeVisible();
  const pathInputs = Array.from(
    screen.container.querySelectorAll('input[aria-autocomplete="list"]'),
  ) as HTMLInputElement[];
  expect(pathInputs.some((input) => input.value === "E:/Output")).toBe(true);
  expect(pathInputs.some((input) => input.value === "failed_22")).toBe(true);
  expect(pathInputs.length).toBeGreaterThanOrEqual(2);
});

test("settings sections expose public labels and naming placeholder help", async () => {
  const network = await render(
    <FormHarness
      values={{
        network: {
          proxyType: "none",
          proxy: "",
          useProxy: false,
          timeout: 30,
          retryCount: 3,
          javdbCookie: "",
          javbusCookie: "",
        },
      }}
    >
      <NetworkTopLevelSection forceOpen />
    </FormHarness>,
  );
  await expect.element(network.getByText("网络连接")).toBeVisible();
  await expect.element(network.getByText("代理类型")).toBeVisible();
  await expect.element(network.getByText("JavDB Cookie")).toBeVisible();

  const translate = await render(
    <FormHarness
      values={{
        translate: {
          enableTranslation: false,
          engine: "google",
          targetLanguage: "zh-CN",
        },
      }}
    >
      <TranslateTopLevelSection forceOpen />
    </FormHarness>,
  );
  await expect.element(translate.getByText("翻译服务")).toBeVisible();
  await expect.element(translate.getByText("翻译引擎")).toBeVisible();

  const behavior = await render(
    <FormHarness
      values={{
        behavior: {
          successFileMove: false,
          failedFileMove: false,
          successFileRename: false,
          deleteEmptyFolder: false,
          scrapeSoftlinkPath: false,
          saveLog: false,
        },
      }}
    >
      <FileBehaviorTopLevelSection forceOpen />
    </FormHarness>,
  );
  await expect.element(behavior.getByText("文件行为")).toBeVisible();
  await expect.element(behavior.getByText("成功后移动文件")).toBeVisible();

  const naming = await render(
    <FormHarness values={{ naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number}" } }}>
      <NamingSection />
    </FormHarness>,
  );
  await expect.element(naming.getByRole("button", { name: "查看文件夹模板占位符" })).toBeVisible();
  await expect.element(naming.getByRole("button", { name: "查看文件名模板占位符" })).toBeVisible();
  await expect.element(naming.getByText("可用占位符：{actor}")).not.toBeInTheDocument();

  const advancedDownload = await render(
    <FormHarness values={{ download: { downloadPoster: true, sceneImageConcurrency: 4 } }}>
      <SettingsSectionModeProvider mode="advanced">
        <AssetDownloadsSection />
      </SettingsSectionModeProvider>
    </FormHarness>,
  );
  await expect.element(advancedDownload.getByText("剧照下载并发")).toBeVisible();
  await expect.element(advancedDownload.getByText("下载海报")).not.toBeInTheDocument();
});

test("title repair settings expose ordered rules and add validated rows", async () => {
  const screen = await render(
    <FormHarness
      values={{
        naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number}" },
        titleRepair: {
          enabled: true,
          rules: [{ source: "催●", replacement: "催眠" }],
        },
      }}
    >
      <NamingSection />
    </FormHarness>,
  );

  await expect.element(screen.getByText("修复遮蔽标题")).toBeVisible();
  await expect.element(screen.getByLabelText("第 1 条规则的替换原文")).toHaveValue("催●");
  await screen.getByLabelText("新规则的替换原文").fill("●●");
  await screen.getByLabelText("新规则的替换结果").fill("秘密");
  await screen.getByRole("button", { name: "添加规则" }).click();
  await expect.element(screen.getByLabelText("第 2 条规则的替换原文")).toHaveValue("●●");
});

test("poster badge controls follow download and badge visibility gates", async () => {
  const posterDisabled = await render(
    <FormHarness values={{ download: { downloadPoster: false, tagBadges: true } }}>
      <AssetDownloadsSection />
    </FormHarness>,
  );
  await expect.element(posterDisabled.getByText("为封面添加标签角标")).not.toBeInTheDocument();
  await expect.element(posterDisabled.getByText("角标类型", { exact: true })).not.toBeInTheDocument();
  await expect.element(posterDisabled.getByText("角标位置", { exact: true })).not.toBeInTheDocument();
  await expect.element(posterDisabled.getByText("覆盖角标图片", { exact: true })).not.toBeInTheDocument();

  const badgeOff = await render(
    <FormHarness values={{ download: { downloadPoster: true, tagBadges: false } }}>
      <AssetDownloadsSection />
    </FormHarness>,
  );
  await expect.element(badgeOff.getByText("为封面添加标签角标")).toBeVisible();
  await expect.element(badgeOff.getByText("角标类型", { exact: true })).not.toBeInTheDocument();
  await expect.element(badgeOff.getByText("角标位置", { exact: true })).not.toBeInTheDocument();
  await expect.element(badgeOff.getByText("覆盖角标图片", { exact: true })).not.toBeInTheDocument();

  const badgeOn = await render(
    <FormHarness
      values={{
        download: {
          downloadPoster: true,
          tagBadges: true,
          tagBadgeTypes: ["subtitle", "leak"],
          tagBadgePosition: "topRight",
        },
      }}
    >
      <AssetDownloadsSection />
    </FormHarness>,
  );
  await expect.element(badgeOn.getByText("角标类型", { exact: true })).toBeVisible();
  await expect.element(badgeOn.getByText("角标位置", { exact: true })).toBeVisible();
  await expect.element(badgeOn.getByText("覆盖角标图片", { exact: true })).toBeVisible();
  await expect.element(badgeOn.getByText("中字")).toBeVisible();
  await expect.element(badgeOn.getByText("流出")).toBeVisible();
});
